import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try {
    const result = await session.page.evaluate(run, arg);
    assert.deepEqual(session.errors, []);
    return result;
  } finally { await session.close(); }
}

test('Rework/Reworked wymaga kontekstu wersji, zwykłe tytuły i nazwy są chronione', async () => {
  const result = await evaluate(() => {
    const track = (name, album = 'Album', artist = 'Artist') => ({ name, album: { name: album }, artists: [{ name: artist }] });
    return [
      track('World Hold On (Children Of The Sky) - FISHER Rework'),
      track('Song (Reworked)'), track('Song [2026 Rework]'), track('Song', 'Album - Rework'),
      track('Rework'), track('The Rework of My Life'), track('Song', 'Rework'), track('Song', 'Album', 'Rework')
    ].map(looksLikeUnwantedVariant);
  });
  assert.deepEqual(result, [true, true, true, true, false, false, false, false]);
});

test('oznaczenia orkiestrowe w metadanych, bez odrzucania zwykłego tytułu Orchestra', async () => {
  const result = await evaluate(() => {
    const track = (name, album = 'Album') => ({ name, album: { name: album }, artists: [{ name: 'Artist' }] });
    return [track('Song - Orchestral Version'), track('Song (Orchestra)'), track('Song', 'Album [Orchestral Arrangement]'), track('Song', 'Orchestral Version'), track('Orchestra'), track('Song', 'The Orchestra')].map(looksLikeUnwantedVariant);
  });
  assert.deepEqual(result, [true, true, true, true, false, false]);
});

test('Def Leppard + Royal Philharmonic Orchestra: mocne tagi, bez słabego genre query', async () => {
  const result = await evaluate(() => {
    const track = { name: 'Animal', album: { name: 'Drastic Symphonies' }, artists: [{ name: 'Def Leppard' }, { name: 'Royal Philharmonic Orchestra' }] };
    const noTags = looksLikeUnwantedVariant(track);
    saveCandidatePool([{ track: { ...track, id: 'animal', uri: 'spotify:track:animal' }, queries: ['genre:"rock"'], savedAt: Date.now() }]);
    const weakQuery = looksLikeUnwantedVariant(track);
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Def Leppard', tags: ['rock'], savedAt: Date.now() }]));
    return { noTags, weakQuery, strongTags: looksLikeUnwantedVariant(track) };
  });
  assert.deepEqual(result, { noTags: false, weakQuery: false, strongTags: true });
});

test('muzyka klasyczna, wykonawca orkiestrowy i The Cinematic Orchestra pozostają dozwolone', async () => {
  const result = await evaluate(() => {
    const track = (name, artists, album = 'Album') => ({ name, album: { name: album }, artists: artists.map(name => ({ name })) });
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([
      { artist: 'Ludovico Einaudi', tags: ['modern classical', 'pop'], savedAt: Date.now() },
      { artist: 'The Cinematic Orchestra', tags: ['electronic'], savedAt: Date.now() },
      { artist: 'London Symphony Orchestra', tags: ['rock'], savedAt: Date.now() }
    ]));
    return [
      track('Symphony No. 5 (Orchestra)', ['Ludwig van Beethoven', 'Royal Philharmonic Orchestra']),
      track('Goldberg Variations, BWV 988 (Variation 1)', ['Johann Sebastian Bach']),
      track('Clair de Lune', ['Claude Debussy', 'Royal Philharmonic Orchestra']),
      track('Experience - Orchestral Version', ['Ludovico Einaudi', 'Royal Philharmonic Orchestra']),
      track('Work', ['London Symphony Orchestra', 'Royal Philharmonic Orchestra']),
      track('To Build a Home', ['The Cinematic Orchestra'])
    ].map(looksLikeUnwantedVariant);
  });
  assert.deepEqual(result, [false, false, false, false, false, false]);
});

test('ochrona klasyki nie omija Rework ani Live; wyłączony filtr pozwala na alternatywne wersje', async () => {
  const result = await evaluate(() => {
    const track = name => ({ name, album: { name: 'Album' }, artists: [{ name: 'Composer' }] });
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Composer', tags: ['classical'], savedAt: Date.now() }]));
    const before = ['Symphony No. 5 - Rework', 'Concerto No. 1 - Live'].map(name => looksLikeUnwantedVariant(track(name)));
    avoidRemixes.checked = false;
    return { before, after: looksLikeUnwantedVariant(track('Song - Rework')) };
  });
  assert.deepEqual(result, { before: [true, true], after: false });
});

test('wersja orkiestrowa nie udaje zwykłego wydania przy ocenie remastera', async () => {
  const result = await evaluate(() => {
    const track = (id, name) => ({ id, name, artists: [{ name: 'Artist' }], album: { name: 'Album' } });
    rebuildCanonicalCleanVariantSignatures([{ track: track('orchestra', 'Song (Orchestra)') }]);
    const onlyAlternative = looksLikeUnwantedVariant(track('remaster', 'Song - 2025 Remaster'));
    rebuildCanonicalCleanVariantSignatures([{ track: track('ordinary', 'Song') }]);
    return { onlyAlternative, ordinaryExists: looksLikeUnwantedVariant(track('remaster', 'Song - 2025 Remaster')), ordinary: looksLikeUnwantedVariant(track('ordinary', 'Song')) };
  });
  assert.deepEqual(result, { onlyAlternative: false, ordinaryExists: true, ordinary: false });
});

test('nowe filtry nie zmieniają sygnatur zapisanych wcześniej ocen Rework', async () => {
  const result = await evaluate(() => {
    const track = { name: 'Song - FISHER Rework', artists: [{ name: 'Artist' }], album: { name: 'Album' } };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ 'artist|song fisher rework': { value: -1, artists: ['artist'] } }));
    return { signature: trackSignature(track), feedback: trackFeedbackValue(track) };
  });
  assert.deepEqual(result, { signature: 'artist|song fisher rework', feedback: -1 });
});

for (const people of [2, 4]) {
  test(`wpływ selekcji dla ${people} profili: Rework odpada, zwykłe utwory uzupełniają wynik`, async () => {
    const result = await evaluate(people => {
      Math.random = () => 0.25;
      const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
      const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}${i < 2 ? ' - Rework' : ''}`, artists: [{ name: `Artist ${i}` }], album: { name: 'Album' } }));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({ artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: Date.now() }))));
      function generate(pool) {
        saveCandidatePool(pool.map(track => ({ track, queries: ['genre:"rock"'], savedAt: Date.now() })));
        const ctx = buildGroupRecommendationContext(selected);
        const empty = () => new Set();
        const lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
        const { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx);
        const result = selectGroupPlaylist(eligible, 6, ctx, stats);
        return { length: result.tracks.length, ids: result.tracks.map(track => track.id), rejected: stats.unwantedVariant, averages: Object.values(result.satisfaction).map(row => row.average) };
      }
      return { shortage: generate(tracks.slice(0, 6)), replacements: generate(tracks) };
    }, people);
    assert.equal(result.shortage.length, 4); assert.equal(result.replacements.length, 6);
    for (const row of Object.values(result)) {
      assert.equal(row.rejected, 2); assert.ok(row.ids.every(id => !['t0', 't1'].includes(id)));
      assert.ok(row.averages.every(score => Math.abs(score - 56.04) < 1e-9));
    }
  });
}

test('obie strony pokazują dokładną wersję wdrożenia w nagłówku i tytule', async () => {
  for (const path of ['/', '/taste.html']) {
    const session = await harness.page(path);
    try {
      assert.match(await session.page.title(), /v43\.18\.C/);
      assert.match(await session.page.locator('h1').textContent(), /v43\.18\.C/);
      assert.deepEqual(session.errors, []);
    } finally { await session.close(); }
  }
});
