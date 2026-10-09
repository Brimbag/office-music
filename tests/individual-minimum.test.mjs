import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/selection-v43.16.json', import.meta.url), 'utf8'));
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}

for (const people of [2, 4]) {
  for (const score of [34.99, 35, 35.01]) {
    test(`${people} profile, minimum ${score}: normalna ścieżka i fallback, także rozluźnione sąsiedztwo`, async () => {
      const result = await evaluate(({ people, score }) => {
        Math.random = () => 0.25;
        const profiles = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], taste: {} }));
        return [70, 36].map(base => {
          const ctx = buildGroupRecommendationContext(profiles);
          const items = ['safe', 'boundary'].map((id, i) => {
            const track = { id, uri: `spotify:track:${id}`, name: id, artists: [{ name: 'Same artist' }] };
            const item = groupCandidateStatic(track, ctx);
            for (const p of profiles) item.byUser[p.id].score = i && p.id === profiles.at(-1).id ? score : 80;
            item.minScore = i ? score : 80; item.groupBase = i ? base : 90;
            item.features.discovery = false;
            return item;
          });
          const stats = newRejectionStats(2), output = selectGroupPlaylist(items, 2, ctx, stats);
          return { ids: output.tracks.map(t => t.id), rejected: stats.lowIndividualFit, fallback: stats.fallbackSelections };
        });
      }, { people, score });
      assert.deepEqual(result.map(r => r.ids), score < 35 ? [['safe'], ['safe']] : [['safe', 'boundary'], ['safe', 'boundary']]);
      assert.deepEqual(result.map(r => r.rejected), score < 35 ? [1, 1] : [0, 0]);
      assert.equal(result[1].fallback, score < 35 ? 0 : 1);
    });
  }
}

test('wysoka średnia, dodatni feedback i dowolnie duże bonusy nie maskują słabego profilu ani błędnego minScore', async () => {
  const result = await evaluate(() => {
    const profiles = ['bartek', 'asia'].map(id => ({ id, artists: [], taste: {} }));
    const ctx = buildGroupRecommendationContext(profiles);
    const track = { id: 'bad', uri: 'spotify:track:bad', name: 'Bad', artists: [{ name: 'Artist' }] };
    const item = groupCandidateStatic(track, ctx);
    item.byUser.bartek.score = 100; item.byUser.asia.score = 34.99;
    item.minScore = 100; item.groupBase = 1000; item.features.feedback = 1000; item.features.discovery = false;
    const original = dynamicCandidateScore;
    dynamicCandidateScore = () => { throw new Error('Unsafe candidate reached bonuses'); };
    try { const stats = newRejectionStats(1); return { length: selectGroupPlaylist([item], 1, ctx, stats).tracks.length, rejected: stats.lowIndividualFit }; }
    finally { dynamicCandidateScore = original; }
  });
  assert.deepEqual(result, { length: 0, rejected: 1 });
});

test('brak oceny, NaN, Infinity i tekst odrzucane; nieobecny profil ignorowany, pusty skład nie wybiera', async () => {
  const result = await evaluate(() => {
    const profile = { id: 'bartek', artists: [], taste: {} }, ctx = buildGroupRecommendationContext([profile]);
    const track = { id: 'one', uri: 'spotify:track:one', name: 'One', artists: [{ name: 'Artist' }] };
    const item = groupCandidateStatic(track, ctx); item.groupBase = 80; item.minScore = 80; item.features.discovery = false;
    const invalid = [undefined, NaN, Infinity, '35'].map(score => {
      item.byUser.bartek = score === undefined ? undefined : { score };
      return selectGroupPlaylist([item], 1, ctx, newRejectionStats(1)).tracks.length;
    });
    item.byUser.bartek = { score: 35 }; item.byUser.absent = { score: 0 };
    const presentOnly = selectGroupPlaylist([item], 1, ctx, newRejectionStats(1)).tracks.length;
    ctx.selected = [];
    return { invalid, presentOnly, empty: selectGroupPlaylist([item], 1, ctx, newRejectionStats(1)).tracks.length };
  });
  assert.deepEqual(result, { invalid: [0, 0, 0, 0], presentOnly: 1, empty: 0 });
});

for (const people of [2, 4]) {
  test(`${people} profile: porównanie v43.16.D i B na tych samych ocenach, skrócenie i bezpieczne uzupełnienie`, async t => {
    const result = await evaluate(({ people, sources }) => {
      Math.random = () => 0.25;
      const newEligible = eligibleGroupCandidates, newSelect = selectGroupPlaylist;
      const oldEligible = (0, eval)(`(${sources.eligibleGroupCandidates})`), oldSelect = (0, eval)(`(${sources.selectGroupPlaylist})`);
      const cases = [], now = Date.now();
      const originalFetch = fetch; let fetches = 0;
      window.fetch = () => { fetches++; throw new Error('Unexpected API request'); };
      try {
        for (const scenario of ['compatible', 'shortage', 'replacements', 'noCommonGround']) {
          const count = scenario === 'replacements' || scenario === 'compatible' ? 20 : 16;
          const tracks = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ id: `a${Math.floor(i / 2)}`, name: `Artist ${Math.floor(i / 2)}` }], album: { name: 'Album' } }));
          const unsafe = scenario === 'compatible' ? [] : scenario === 'noCommonGround' ? tracks : tracks.slice(0, 4);
          const unsafeArtists = new Set(unsafe.map(t => t.artists[0].name));
          // Every actual satisfaction score comes from the unchanged production
          // scoring function; the last present person knows only safe artists.
          const profiles = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map((id, i) => ({
            id, genres: [], manualGenres: [], artists: tracks.map(t => t.artists[0].name).filter(name => i < people - 1 || !unsafeArtists.has(name)),
            taste: { hasSurvey: true, likedGenres: i < people - 1 ? ['Rock'] : [], okGenres: [], blockedGenres: [] }
          }));
          localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
          localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({ artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
          const blocks = generationBlocklists(profiles), output = {};
          for (const [mode, eligibleFn, selectFn] of [['before', oldEligible, oldSelect], ['after', newEligible, newSelect]]) {
            const ctx = buildGroupRecommendationContext(profiles), { eligible, stats } = eligibleFn(profiles, blocks, ctx);
            const selected = selectFn(eligible, 16, ctx, stats);
            const scores = [...selected.details.values()].flatMap(d => Object.values(d.byUser));
            output[mode] = { length: selected.tracks.length, min: scores.length ? Math.min(...scores) : null, weak: Object.values(selected.satisfaction).reduce((n, r) => n + r.weak, 0), averages: Object.fromEntries(Object.entries(selected.satisfaction).map(([id, r]) => [id, r.average])), artists: new Set(selected.tracks.flatMap(t => [...trackArtistKeys(t)])).size, discovery: selected.discoveryCount, rejected: stats.lowIndividualFit };
          }
          cases.push({ scenario, ...output });
        }
      } finally { window.fetch = originalFetch; }
      return { cases, fetches };
    }, { people, sources: baseline.sources });
    assert.equal(result.fetches, 0);
    assert.deepEqual(result.cases.map(r => [r.before.length, r.after.length]), [[16, 16], [16, 12], [16, 16], [16, 0]]);
    for (const row of result.cases) {
      assert.equal(row.after.weak, 0);
      if (row.after.length) assert.ok(row.after.min >= 35);
      if (['shortage', 'noCommonGround'].includes(row.scenario)) assert.equal(row.before.min, 34);
      if (row.scenario === 'compatible') assert.deepEqual(row.after.averages, row.before.averages);
    }
    t.diagnostic(JSON.stringify({ people, ...result }));
  });
}

test('bramka kwalifikacji sprawdza każdą osobę, także Bartka; odrzucenie liczone raz', async () => {
  const result = await evaluate(() => {
    const selected = ['bartek', 'asia', 'edyta', 'monika'].map(id => ({ id, artists: [], taste: {} }));
    const original = groupCandidateStatic;
    const empty = () => new Set(), blocklists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
    const rows = selected.map((profile, i) => ({ track: { id: `bad${i}`, uri: `spotify:track:bad${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] }, weak: profile.id }));
    rows.push({ track: { id: 'safe', uri: 'spotify:track:safe', name: 'Safe', artists: [{ name: 'Safe artist' }] } });
    const ctx = buildGroupRecommendationContext(selected);
    groupCandidateStatic = track => {
      const item = original(track, ctx);
      item.byUser = Object.fromEntries(selected.map(p => [p.id, { score: rows.find(r => r.track.id === track.id).weak === p.id ? 34.99 : 80 }]));
      item.minScore = 80; item.maxScore = 80; item.groupBase = 90; item.features.discovery = false;
      return item;
    };
    const recognizability = recognizabilityPass; recognizabilityPass = () => true;
    try {
      const { eligible, stats } = eligibleGroupCandidates(selected, blocklists, ctx, rows);
      const output = selectGroupPlaylist(eligible, 5, ctx, stats);
      return { eligible: eligible.map(r => r.track.id), selected: output.tracks.map(t => t.id), rejected: stats.lowIndividualFit };
    } finally { groupCandidateStatic = original; recognizabilityPass = recognizability; }
  });
  assert.deepEqual(result, { eligible: ['safe'], selected: ['safe'], rejected: 4 });
});
