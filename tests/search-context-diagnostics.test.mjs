import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
const cases = ['history', 'lastfmArtists', 'lastfmTracks', 'feedback', 'profiles', 'effectiveBlocks'];
for (const area of cases) test(`Q1.8: reports only area names for ${area}, without learning`, async () => {
 const session = await harness.page();
 try {
  const result = await session.page.evaluate(async area => {
   renderProfiles(); getAutoFeedbackAccount = () => 'verified-account';
   const selected = selectedProfiles();
   let expired = false;
   if (area === 'effectiveBlocks') generationBlocklists = () => ({ artists: new Set(expired ? [] : ['PRIVATE_ARTIST']), tracks: new Set() });
   const rotation = await createSearchRotation(selected);
   if (area === 'history') localStorage.setItem(HISTORY_KEY, 'PRIVATE_HISTORY');
   if (area === 'lastfmArtists') localStorage.setItem(LASTFM_ARTIST_POOL_KEY, 'PRIVATE_ARTIST_CATALOG');
   if (area === 'lastfmTracks') localStorage.setItem(LASTFM_TRACK_POOL_KEY, 'PRIVATE_TRACK_CATALOG');
   if (area === 'feedback') localStorage.setItem(FEEDBACK_KEY, 'PRIVATE_FEEDBACK');
   if (area === 'profiles') document.querySelector('input[data-profile-id="asia"]').checked = !document.querySelector('input[data-profile-id="asia"]').checked;
   if (area === 'effectiveBlocks') expired = true;
   const learning = await rememberSearchRotation({ rotation, selected }, { outcome: 'success', searchEffectiveness: { final: true, pages: [] } });
   const progress = OmmGenerationProgress.create(document.createElement('div'), 60);
   progress.searchRotation({ learning, changedAreas: rotation.changedAreas }, true);
   progress.finish(null, 60);
   const report = progress.report();
   return { learning, areas: rotation.changedAreas, report: report.searchRotation, saved: localStorage.getItem(OmmSearchRotation.KEY), hashes: rotation.diagnostic.hashes };
  }, area);
  assert.equal(result.learning, 'context-changed');
  assert.deepEqual(result.areas, [area]);
  assert.equal(result.saved, null);
  assert.ok(!JSON.stringify(result.report).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result.hashes).includes('PRIVATE'));
  assert.deepEqual(session.errors, []);
 } finally { await session.close(); }
});
test('Q1.8: same original combined fingerprint, ignored own writes, stable learning and unchanged learning', async () => {
 const session = await harness.page();
 try {
  const result = await session.page.evaluate(async () => {
   renderProfiles(); getAutoFeedbackAccount = () => 'verified-account';
   const selected = selectedProfiles();
   const plain = await searchRotationContext(selected), capture = {};
   const detailed = await searchRotationContext(selected, capture);
   const rotation = await createSearchRotation(selected);
   localStorage.setItem(CANDIDATE_POOL_KEY, '[]'); writeSearchCache('private-query', 0, [], { raw: 0, total: 0 });
   const learning = await rememberSearchRotation({ rotation, selected }, { outcome: 'success', searchEffectiveness: { final: true, pages: [{ query: 'private-query', source: 'Spotify', status: 'ok', raw: 0, filtered: 0, retained: 0, safe: 0 }] } });
   return { plain, detailed, learning, areas: rotation.changedAreas, hashes: Object.keys(capture.hashes), memory: !!localStorage.getItem(OmmSearchRotation.KEY) };
  });
  assert.equal(result.plain, result.detailed); assert.equal(result.learning, 'saved'); assert.equal(result.memory, true); assert.deepEqual(result.areas, []); assert.equal(result.hashes.length, 15); assert.deepEqual(session.errors, []);
 } finally { await session.close(); }
});
test('Q1.8: diagnostic hash failure does not prevent learning; missing identity has generic reason', async () => {
 const session = await harness.page();
 try {
  const result = await session.page.evaluate(async () => {
   getAutoFeedbackAccount = () => 'account';
   const original = crypto.subtle.digest.bind(crypto.subtle);
   let calls = 0;
   crypto.subtle.digest = (...args) => ++calls % 16 === 1 ? original(...args) : Promise.reject(new Error('PRIVATE_ERROR'));
   const selected = selectedProfiles(), rotation = await createSearchRotation(selected);
   const report = { outcome: 'success', searchEffectiveness: { final: true, pages: [{ query: 'x', source: 'Spotify', status: 'ok', raw: 0, filtered: 0, retained: 0, safe: 0 }] } };
   // Each fingerprint uses one combined digest plus fifteen optional area digests.
   const learning = await rememberSearchRotation({ rotation, selected }, report);
   crypto.subtle.digest = original;
   getAutoFeedbackAccount = () => ''; playbackSession = () => null;
   const changed = await rememberSearchRotation({ rotation, selected }, report);
   const container = document.createElement('div'), progress = OmmGenerationProgress.create(container, 60);
   progress.searchRotation({ learning: changed, changedAreas: rotation.changedAreas }, true); progress.finish(null, 60);
   return { learning, changed, areas: rotation.changedAreas, text: container.textContent };
  });
  assert.equal(result.learning, 'saved'); assert.equal(result.changed, 'context-changed'); assert.deepEqual(result.areas, ['unknown']); assert.ok(result.text.includes('nie można ustalić obszaru')); assert.ok(!result.text.includes('PRIVATE')); assert.deepEqual(session.errors, []);
 } finally { await session.close(); }
});
test('Q1.8: real LF2 catalog import identifies catalog areas without modifying learning policy', async () => {
 const session = await harness.page();
 try {
  const result = await session.page.evaluate(async () => {
   getAutoFeedbackAccount = () => 'account'; localStorage.setItem(LASTFM_USER_KEY, 'listener');
   const selected = selectedProfiles(), rotation = await createSearchRotation(selected);
   applyLastFmCloudCatalog(OfficeLastFmCloud.compact('listener', [{ artist: 'PrivateArtist', savedAt: Date.now(), tags: ['rock'], sources: ['test'] }], [{ artist: 'PrivateArtist', track: 'PrivateTrack', savedAt: Date.now(), tags: ['rock'], sources: ['test'] }]));
   const learning = await rememberSearchRotation({ rotation, selected }, { outcome: 'success', searchEffectiveness: { final: true, pages: [] } });
   return { learning, areas: rotation.changedAreas, saved: localStorage.getItem(OmmSearchRotation.KEY) };
  });
  assert.equal(result.learning, 'context-changed'); assert.deepEqual(result.areas, ['lastfmArtists', 'lastfmTracks']); assert.equal(result.saved, null); assert.deepEqual(session.errors, []);
 } finally { await session.close(); }
});
