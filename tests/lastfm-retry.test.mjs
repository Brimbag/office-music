import test from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
for (const scenario of ['error', 'partial', 'ok']) test(`LF1 tag refresh ${scenario}: success timestamp and backoff`, async () => {
 const h = await startBrowserHarness(); const s = await h.page();
 try {
  const r = await s.page.evaluate(async scenario => {
   const original = lastFmRequest; let calls = 0;
   lastFmRequest = async method => {
    calls++; if (scenario === 'error' || (scenario === 'partial' && calls === 1)) throw new Error('offline');
    return method === 'tag.getTopArtists' ? {topartists:{artist:[]}} : {tracks:{track:[]}};
   };
   try {
    await syncLastFmSources([{genres:['rock']}], {includeRecent:false, maxTagCalls:4});
    const first = calls, timestamp = localStorage.getItem(LASTFM_AUTO_TAG_SYNC_KEY);
    const attempt = JSON.parse(localStorage.getItem(LASTFM_SYNC_ATTEMPT_KEY));
    localStorage.setItem(LASTFM_AUTO_RECENT_SYNC_KEY, String(Date.now()));
    await refreshLastFmBeforeGeneration([{genres:['rock']}], 60);
    return {first, calls, timestamp:!!timestamp, result:attempt.tags};
   } finally { lastFmRequest = original; }
  }, scenario);
  assert.equal(r.timestamp, scenario === 'ok'); assert.equal(r.result, scenario); assert.equal(r.calls, r.first);
  assert.deepEqual(s.errors, []);
 } finally {await s.close(); await h.close();}
});
