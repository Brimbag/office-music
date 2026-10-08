import { startBrowserHarness } from '../helpers/browser.mjs';
const harness = await startBrowserHarness();
try {
  const session = await harness.page();
  try {
    const result = await session.page.evaluate(() => {
      Math.random = () => 0.25;
      const now = Date.now();
      const tracks = Array.from({ length: 2000 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: i < 100 ? `Song ${i}` : `Song ${i} - Rework`, artists: [{ name: i < 100 ? `Good${i}` : 'Bad' }] }));
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(Array.from({ length: 1800 }, (_, i) => ({ artist: i < 100 ? `Good${i}` : `Unused${i}`, tags: ['rock'], sources: ['tag'], savedAt: now }))));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ artist: i < 100 ? `Good${i}` : `Unused${i}`, track: i < 100 ? `Song ${i}` : `Unused ${i}`, tags: ['rock'], sources: ['tag'], savedAt: now }))));
      const snapshotContext = acquisitionContext, results = [];
      try {
        for (const people of [2, 4]) {
          const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, genres: ['rock'], artists: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
          const blocks = generationBlocklists(selected), samples = { before: [], after: [] }, counts = {};
          for (let iteration = 0; iteration < 11; iteration++) {
            for (const mode of iteration % 2 ? ['after', 'before'] : ['before', 'after']) {
              acquisitionContext = mode === 'before' ? buildGroupRecommendationContext : snapshotContext;
              const start = performance.now(), coverage = acquisitionCoverage(selected, blocks);
              if (iteration > 0) samples[mode].push(performance.now() - start);
              counts[mode] = { artists: coverage.artists, qualifying: coverage.qualifying.length };
            }
          }
          const p95 = data => [...data].sort((a, b) => a - b)[Math.ceil(data.length * 0.95) - 1];
          results.push({ people, samples: 10, p95BeforeMs: p95(samples.before), p95AfterMs: p95(samples.after), counts });
        }
      } finally { acquisitionContext = snapshotContext; }
      return results;
    });
    if (session.errors.length) throw Error(session.errors.join('\n'));
    console.log(JSON.stringify({ note: 'Full pools 2000/1800/3000; 100 qualified artists; coverage assessment only, no API or final playlist selection; snapshot vs original default reads, alternating samples plus warmup', results: result }, null, 2));
  } finally { await session.close(); }
} finally { await harness.close(); }
