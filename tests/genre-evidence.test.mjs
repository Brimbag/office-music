import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

async function features(spec) {
  const session = await harness.page();
  try {
    const result = await session.page.evaluate(spec => {
      const track = { id: 'fixture', uri: 'spotify:track:fixture', name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' } };
      const savedAt = Date.now();
      saveCandidatePool([{ track, queries: spec.query ? [`genre:"${spec.query}"`] : [], savedAt }]);
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(spec.artistTags?.length ? [{ artist: 'Artist', tags: spec.artistTags, sources: ['tag'], savedAt }] : []));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(spec.trackTags?.length ? [{ artist: 'Artist', track: 'Song', tags: spec.trackTags, sources: ['tag'], savedAt }] : []));
      const selected = ['bartek', 'edyta', 'asia', 'monika'].slice(0, spec.people || 2).map(id => ({
        id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] }
      }));
      const ctx = buildGroupRecommendationContext(selected);
      const features = groupTrackFeatures(track, ctx);
      const staticInfo = groupCandidateStatic(track, ctx);
      return { evidence: Object.fromEntries(features.aspectEvidence), byUser: staticInfo.byUser, groupBase: staticInfo.groupBase };
    }, spec);
    assert.deepEqual(session.errors, []);
    return result;
  } finally { await session.close(); }
}
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('tag Jazz wykonawcy nie wzmacnia zapytania Rock', async () => {
  const { evidence } = await features({ query: 'rock', artistTags: ['jazz'] });
  closeTo(evidence.rock.weight, 0.20);
  assert.equal(evidence.rock.source, 'spotify-genre-query');
  closeTo(evidence.jazz.weight, 0.72);
});

test('silny tag Jazz utworu nie wzmacnia kategorii Pop ani Rock z zapytania Pop Rock', async () => {
  const { evidence } = await features({ query: 'pop rock', trackTags: ['jazz'] });
  closeTo(evidence.pop.weight, 0.20 * 0.58);
  closeTo(evidence.rock.weight, 0.20 * 0.58);
  closeTo(evidence.jazz.weight, 1);
});

test('powiązany tag utworu Pop Rock nadal wzmacnia obie kategorie', async () => {
  const { evidence } = await features({ query: 'rock', trackTags: ['pop rock', 'jazz'] });
  closeTo(evidence.pop.weight, 0.58); closeTo(evidence.rock.weight, 0.58);
  assert.equal(evidence.rock.source, 'derived-category');
});

test('bezpośredni tag Rock nie jest osłabiany przez dziedziczenie kategorii', async () => {
  const { evidence } = await features({ query: 'rock', artistTags: ['rock'], trackTags: ['jazz'] });
  closeTo(evidence.rock.weight, 0.72);
  assert.equal(evidence.rock.source, 'lastfm-artist-tag');
});

test('hierarchia rodzica zachowuje własną wagę, kategoria Metal bierze tylko Hard Rock', async () => {
  const { evidence } = await features({ query: 'hard rock', trackTags: ['jazz'] });
  closeTo(evidence.rock.weight, 0.20 * 0.82);
  closeTo(evidence.metal.weight, 0.20 * 0.58);
  assert.equal(evidence.rock.source, 'spotify-genre-query:parent');
});

test('sam Jazz nie tworzy dowodu Rock', async () => {
  const { evidence } = await features({ trackTags: ['jazz'] });
  assert.ok(!Object.hasOwn(evidence, 'rock'));
});

for (const people of [2, 4]) {
  test(`wynik dla ${people} osób nie przejmuje siły niepowiązanego tagu`, async () => {
    const { byUser } = await features({ query: 'rock', trackTags: ['jazz'], people });
    assert.equal(Object.keys(byUser).length, people);
    for (const result of Object.values(byUser)) {
      closeTo(result.likedMatches, 0.58 * 0.20);
      closeTo(result.score, 34 + 38 * 0.58 * 0.20);
    }
  });
}
