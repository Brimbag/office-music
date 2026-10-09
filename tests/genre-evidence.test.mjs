import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/features-v43.18.json', import.meta.url), 'utf8'));

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

for (const people of [2, 4]) {
  test(`${people} profile: długość po B/C, niepowiązane dowody i bezpieczne zamienniki`, async t => {
    const session = await harness.page();
    try {
      const result = await session.page.evaluate(({ people, source }) => {
        Math.random = () => 0.25; discoveryLevel.value = '30';
        const original = groupTrackFeatures, old = (0, eval)(`(${source})`);
        const profiles = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({
          id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] }
        }));
        const cases = [], now = Date.now(), originalFetch = fetch;
        let fetches = 0;
        window.fetch = () => { fetches++; throw new Error('Unexpected API request'); };
        try {
          for (const scenario of ['compatible', 'shortage', 'replacements']) {
            const tracks = Array.from({ length: scenario === 'replacements' ? 20 : 16 }, (_, i) => ({
              id: `g${i}`, uri: `spotify:track:g${i}`, name: `Song ${i}`,
              artists: [{ id: `a${Math.floor(i / 2)}`, name: `Artist ${Math.floor(i / 2)}` }], album: { name: 'Album' }
            }));
            localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
            localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map((track, i) => ({
              artist: track.artists[0].name, track: track.name,
              tags: scenario !== 'compatible' && i >= 12 && i < 16 ? ['jazz'] : ['rock'], sources: ['tag'], savedAt: now
            }))));
            const blocks = generationBlocklists(profiles), output = {};
            for (const [mode, implementation] of [['before', old], ['after', original]]) {
              groupTrackFeatures = implementation;
              const ctx = buildGroupRecommendationContext(profiles);
              const { eligible, stats } = eligibleGroupCandidates(profiles, blocks, ctx);
              const selected = selectGroupPlaylist(eligible, 16, ctx, stats);
              const scores = [...selected.details.values()].flatMap(d => Object.values(d.byUser));
              output[mode] = { ids: selected.tracks.map(t => t.id), length: selected.tracks.length,
                eligible: eligible.length, min: scores.length ? Math.min(...scores) : null,
                averages: Object.fromEntries(Object.entries(selected.satisfaction).map(([id, r]) => [id, r.average])),
                discovery: selected.discoveryCount, maximumDiscovery: selected.discoveryQuota.max };
            }
            cases.push({ scenario, ...output });
          }
        } finally { groupTrackFeatures = original; window.fetch = originalFetch; }
        return { cases, fetches };
      }, { people, source: baseline.source });
      assert.deepEqual(session.errors, []);
      assert.equal(result.fetches, 0);
      assert.deepEqual(result.cases.map(r => [r.before.length, r.after.length]), [[16, 16], [16, 12], [16, 16]]);
      assert.deepEqual(result.cases[0].before, result.cases[0].after);
      for (const row of result.cases) {
        assert.ok(row.after.min >= 35);
        assert.ok(row.after.discovery <= row.after.maximumDiscovery);
        if (row.scenario !== 'compatible') assert.ok(row.after.ids.every(id => !['g12', 'g13', 'g14', 'g15'].includes(id)));
      }
      t.diagnostic(JSON.stringify({ people, ...result }));
    } finally { await session.close(); }
  });
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
  closeTo(evidence.pop.weight, 0.20 * 0.82);
  closeTo(evidence.rock.weight, 0.20 * 0.58);
  closeTo(evidence.jazz.weight, 1);
});

test('powiązany tag utworu Pop Rock nadal wzmacnia obie kategorie', async () => {
  const { evidence } = await features({ query: 'rock', trackTags: ['pop rock', 'jazz'] });
  closeTo(evidence.pop.weight, 0.82); closeTo(evidence.rock.weight, 0.58);
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
