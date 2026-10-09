import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [beforePath, afterPath] = process.argv.slice(2);
assert.ok(beforePath && afterPath, 'Usage: node compare-generation.mjs before.json after.json');
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));
assert.equal(before.fixedClock, true); assert.equal(after.fixedClock, true);
assert.equal(before.repetitions, after.repetitions);
assert.equal(before.transportDelayMs, after.transportDelayMs);
assert.equal(before.instrument, after.instrument);
assert.equal(before.results.length, after.results.length);
const semantic = row => ({
  people: row.people, cache: row.cache, caseKind: row.caseKind || 'normal', ...(row.target !== undefined ? { target: row.target, poolSize: row.poolSize } : {}), before: row.before, after: row.after,
  ids: row.ids, length: row.length, selection: row.selection, diagnostics: row.diagnostics,
  searches: row.searches, requests: row.requests.map(({ serviceMs, ...request }) => request),
  stateBytes: row.stateBytes, disabled: row.disabled
});
const percentile = rows => [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * .95) - 1];
const median = rows => { const ordered = [...rows].sort((a, b) => a - b); return ordered.length % 2 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2; };
const results = before.results.map((old, index) => {
  const current = after.results[index];
  assert.equal(old.people, current.people); assert.equal(old.cache, current.cache);
  assert.equal(old.raw.length, current.raw.length);
  for (let i = 0; i < old.raw.length; i++) {
    assert.deepEqual(semantic(current.raw[i]), semantic(old.raw[i]), `Semantic mismatch ${old.people}/${old.cache}/sample ${i}`);
    assert.deepEqual(semantic(old.raw[i]), semantic(old.raw[0]), 'Frozen baseline is not repeatable');
    for (const sample of [old.raw[i], current.raw[i]]) {
      const total = sample.metrics.generateOfficePlaylist.inclusiveMs;
      assert.ok(Math.abs(Object.values(sample.metrics).reduce((sum, metric) => sum + metric.exclusiveMs, 0) - total) < .01);
    }
  }
  const oldTimes = old.raw.map(row => row.metrics.generateOfficePlaylist.inclusiveMs);
  const newTimes = current.raw.map(row => row.metrics.generateOfficePlaylist.inclusiveMs);
  const baselineMedian = median(oldTimes), candidateMedian = median(newTimes);
  const result = semantic(old.raw[0]);
  return { people: old.people, cache: old.cache, caseKind: old.caseKind || 'normal', ...(old.target !== undefined ? { target: old.target, poolSize: old.poolSize } : {}), samples: old.raw.length,
    baselineMedianMs: baselineMedian, candidateMedianMs: candidateMedian,
    baselineP95Ms: percentile(oldTimes), candidateP95Ms: percentile(newTimes),
    medianImprovementPercent: 100 * (baselineMedian - candidateMedian) / baselineMedian,
    semanticHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    result, baselineFunctions: old.functions, candidateFunctions: current.functions,
    // Repeated semantic fields are verified above and stored once, not 10 times.
    baselineSamples: old.raw.map(row => ({ metrics: row.metrics, serviceMs: row.requests.map(request => request.serviceMs), ...(row.progressReport?{progressReport:row.progressReport}:{}) })),
    candidateSamples: current.raw.map(row => ({ metrics: row.metrics, serviceMs: row.requests.map(request => request.serviceMs), ...(row.progressReport?{progressReport:row.progressReport}:{}) }))
  };
});
console.log(JSON.stringify({ baselineCommit: before.baselineCommit, candidateVersion: after.appVersion,
  fixedClock: true, transportDelayMs: before.transportDelayMs,
  note: 'Controlled full-pool Chromium comparison. All samples pass exact semantic parity (IDs/order/scores/diagnostics/pools/requests/size). With five samples p95 is the sample maximum, not a production percentile. Inclusive function times overlap.', results }, null, 2));
