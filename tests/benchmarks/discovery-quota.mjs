import { readFileSync } from 'node:fs';
import { startBrowserHarness } from '../helpers/browser.mjs';
const baseline = JSON.parse(readFileSync(new URL('../fixtures/selection-v43.17.json', import.meta.url), 'utf8'));
const harness = await startBrowserHarness();
try {
  const session = await harness.page();
  try {
    const results = await session.page.evaluate(({ source, quotaSource }) => {
      Math.random = () => 0.25; discoveryLevel.value = '30';
      const oldSelect = (0, eval)(`(${source})`), results = [];
      for (const people of [2, 4]) for (const scenario of ['full-valid', 'short-conflicting']) {
        const profiles = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], taste: {} }));
        const now = Date.now();
        localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({
          track: { id: `t${i}`, name: `Song ${i}`, uri: `spotify:track:t${i}`, artists: [{ name: `Pool artist ${i}` }] }, queries: [], savedAt: now
        }))));
        const ctx = buildGroupRecommendationContext(profiles);
        const items = Array.from({ length: 129 }, (_, i) => {
          const discovery = scenario === 'full-valid' ? i >= 80 : i < 20;
          const names = scenario === 'full-valid' ? [`Artist ${i}`] : i < 20 ? [`A${Math.floor(i / 2)}`, `B${Math.floor(i / 2)}`] : i < 60 ? [`${i % 4 < 2 ? 'A' : 'B'}${Math.floor((i - 20) / 4)}`] : i < 70 ? [`Independent${i}`] : ['Saturated'];
          const track = { id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: names.map(name => ({ name })) };
          const item = groupCandidateStatic(track, ctx); item.features.discovery = discovery;
          item.groupBase = discovery ? 100 : scenario === 'full-valid' ? 70 : 36;
          item.minScore = 60; item.maxScore = 60; for (const p of profiles) item.byUser[p.id].score = 60;
          return item;
        });
        const samples = { before: [], after: [] }, counts = {};
        for (let iteration = 0; iteration < 11; iteration++) {
          for (const mode of iteration % 2 ? ['after', 'before'] : ['before', 'after']) {
            const start = performance.now();
            const currentQuota = discoveryQuotaForTotal;
            let output;
            try {
              if (mode === 'before') discoveryQuotaForTotal = (0, eval)(`(${quotaSource})`);
              output = (mode === 'before' ? oldSelect : selectGroupPlaylist)(items, 60, ctx, newRejectionStats(items.length));
            } finally { discoveryQuotaForTotal = currentQuota; }
            if (iteration > 0) samples[mode].push(performance.now() - start);
            counts[mode] = { length: output.tracks.length, discovery: output.discoveryCount, max: output.discoveryQuota.max, averages: Object.values(output.satisfaction).map(r => r.average) };
          }
        }
        const p95 = rows => [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * 0.95) - 1];
        results.push({ people, scenario, pool: 2000, eligible: 129, repetitions: 10, p95Ms: { before: p95(samples.before), after: p95(samples.after) }, samplesMs: samples, counts });
      }
      const stressCandidates = Array.from({ length: 2000 }, (_, i) => ({
        id: `stress${i}`, signatures: [`stress${i}`], discovery: i < 21, order: i, score: 60,
        artists: [i < 21 ? `Discovered${i}` : i < 29 ? `Known${i}` : 'Saturated']
      }));
      const stressSelected = stressCandidates.slice(0, 31), stressSamples = [];
      let stressResult;
      for (let i = 0; i < 11; i++) {
        const start = performance.now();
        stressResult = OfficeDiscoveryQuota.repair({ selected: stressSelected, candidates: stressCandidates, total: 60, quota: discoveryQuotaForTotal });
        if (i) stressSamples.push(performance.now() - start);
      }
      const stressP95 = [...stressSamples].sort((a, b) => a - b)[Math.ceil(stressSamples.length * 0.95) - 1];
      return { baseline: 'v43.17.B', scope: 'selector only, 129 precomputed eligible scores in 2000-row context; no acquisition/network timing',
        results, plannerStress: { candidates: 2000, repetitions: 10, p95Ms: stressP95, samplesMs: stressSamples, beforeLength: 31,
          beforeDiscovery: 21, afterLength: stressResult.afterLength, afterDiscovery: stressResult.afterDiscovery } };
    }, { source: baseline.source, quotaSource: baseline.quotaSource });
    if (session.errors.length) throw new Error(session.errors.join('\n'));
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } finally { await session.close(); }
} finally { await harness.close(); }
