import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

async function variants(tags) {
  const session = await harness.page();
  try {
    const result = await session.page.evaluate(tags => {
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Def Leppard', tags, savedAt: Date.now() }]));
      const track = { name: 'Animal', album: { name: 'Drastic Symphonies' }, artists: [{ name: 'Def Leppard' }, { name: 'Royal Philharmonic Orchestra' }] };
      return {
        orchestra: looksLikeUnwantedVariant(track),
        original: looksLikeUnwantedVariant({ ...track, album: { name: 'Hysteria' }, artists: [track.artists[0]] }),
        classicalWork: looksLikeUnwantedVariant({ ...track, name: 'Symphony No. 5 (Orchestra)' })
      };
    }, tags);
    assert.deepEqual(session.errors, []);
    return result;
  } finally { await session.close(); }
}

for (const tag of ['hard rock', 'classic rock', 'glam rock', 'heavy metal', 'pop-rock', 'symphonic metal', 'post-rock']) {
  test(`Animal: podgatunek ${tag} jest mocnym dowodem nowoczesnego wykonawcy`, async () => {
    assert.deepEqual(await variants([tag]), { orchestra: true, original: false, classicalWork: false });
  });
}

test('orchestral/symphonic nie maskuje mocnego dowodu rocka', async () => {
  assert.deepEqual(await variants(['hard rock', 'orchestral', 'symphonic']), { orchestra: true, original: false, classicalWork: false });
});

for (const tags of [[], ['orchestral'], ['symphonic'], ['hard rock', 'classical'], ['pop', 'modern classical'], ['rockabilly'], ['popcorn']]) {
  test(`ochrona klasyki i brak dowodu: ${JSON.stringify(tags)}`, async () => {
    assert.deepEqual(await variants(tags), { orchestra: false, original: false, classicalWork: false });
  });
}
