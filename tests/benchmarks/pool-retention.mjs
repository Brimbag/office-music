import { readFileSync } from 'node:fs';
import { startBrowserHarness } from '../helpers/browser.mjs';
const { saveCandidatePool: oldSave } = JSON.parse(readFileSync(new URL('../fixtures/retention-v43.14.json', import.meta.url), 'utf8'));
const h = await startBrowserHarness();
try {
 const session = await h.page();
 try {
  const result = await session.page.evaluate(({ oldSave }) => {
   Math.random = () => .25;
   const now = Date.now();
   const row = (id, name, artist, savedAt) => ({ track: { id, uri: `spotify:track:${id}`, name, artists: [{ id: artist.padEnd(22, '0'), name: artist }] }, queries: ['genre:"rock"'], savedAt });
   const good = Array.from({ length: 100 }, (_, i) => row(`good${i}`, `Song ${i}`, `Good${i}`, now - 1000));
   const old = [...good, ...Array.from({ length: 1900 }, (_, i) => row(`bad${i}`, `Song ${i} - Rework`, 'Bad', now - 2000))];
   localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(Array.from({ length: 1800 }, (_, i) => ({ artist: i < 100 ? `Good${i}` : `Unused${i}`, tags: ['rock'], sources: ['tag'], savedAt: now }))));
   localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ artist: i < 100 ? `Good${i}` : `Unused${i}`, track: i < 100 ? `Song ${i}` : `Unused ${i}`, tags: ['rock'], sources: ['tag'], savedAt: now }))));
   const incoming = row('fresh', 'Fresh - Rework', 'Bad', now);
   const newSave = saveCandidatePool, baselineSave = eval(`(${oldSave})`);
   const empty = () => new Set(), blocks = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
   const results = [];
   for (const people of [2, 4]) {
    const selected = ['bartek','asia','edyta','monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
    const samples = { baseline: [], current: [] }, output = {};
    for (let iteration = 0; iteration < 11; iteration++) {
     for (const mode of iteration % 2 ? ['current', 'baseline'] : ['baseline','current']) {
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(old));
      saveCandidatePool = mode === 'baseline' ? baselineSave : newSave;
      const start = performance.now(); addToCandidatePool('genre:"rock"', [incoming.track]);
      const ctx = buildGroupRecommendationContext(selected), { eligible, stats } = eligibleGroupCandidates(selected, blocks, ctx);
      const selection = selectGroupPlaylist(eligible, 60, ctx, stats);
      const elapsed = performance.now() - start;
      if (iteration > 0) samples[mode].push(elapsed);
      output[mode] = { length: selection.tracks.length, averages: Object.values(selection.satisfaction).map(r => r.average) };
     }
    }
    const p95 = values => [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1];
    results.push({ people, samples: samples.baseline.length, p95BaselineMs: p95(samples.baseline), p95CurrentMs: p95(samples.current), ratio: p95(samples.current)/p95(samples.baseline), output });
   }
   saveCandidatePool = newSave; return results;
  }, { oldSave });
  console.log(JSON.stringify({ note: 'Chromium; fixed full pools 2000/1800/3000; 100 qualified artists; target60; 10 alternating samples plus warmup, computations only, no API latency', results: result }, null, 2));
  if(session.errors.length) throw Error(session.errors.join('\n'));
 } finally { await session.close(); }
} finally { await h.close(); }
