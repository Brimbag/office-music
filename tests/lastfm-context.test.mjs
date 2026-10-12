import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness; before(async () => { harness = await startBrowserHarness(); }); after(async () => { await harness?.close(); });
async function run(fn,arg) { const s = await harness.page(); try { const r = await s.page.evaluate(fn,arg); assert.deepEqual(s.errors, []); return r; } finally { await s.close(); } }
test('Q1.9: LF2 self-merge of actual Last.fm metadata must not reset learning', async () => {
 const r = await run(async () => {
  getAutoFeedbackAccount = () => 'account'; localStorage.setItem(LASTFM_USER_KEY, 'listener');
  const row = { artist: 'A', track: 'Song', savedAt: Date.now(), tags: ['rock'], sources: ['tag'], catalogEvidence: OfficeArtistCatalogEvidence.mergeMetadata([], OfficeArtistCatalogEvidence.metadata({ name: 'Song', artist: { name: 'A' }, album: 'Album' })).records };
  localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify([row]));
  const selected = selectedProfiles(), rotation = await createSearchRotation(selected), before = localStorage.getItem(LASTFM_TRACK_POOL_KEY);
  const evidenceBefore = OfficeArtistCatalogEvidence.analyze({ lastfmTracks: loadLastFmTrackPool() });
  applyLastFmCloudCatalog(compactLocalLastFm());
  const after = localStorage.getItem(LASTFM_TRACK_POOL_KEY), evidenceAfter = OfficeArtistCatalogEvidence.analyze({ lastfmTracks: loadLastFmTrackPool() });
  const learning = await rememberSearchRotation({ rotation, selected }, { outcome: 'success', searchEffectiveness: { final: true, pages: [{ query: 'x', source: 'Spotify', status: 'ok', raw: 0, filtered: 0, retained: 0, safe: 0 }] } });
  return { before, after, evidenceBefore, evidenceAfter, learning, areas: rotation.changedAreas };
 });
 assert.notEqual(r.before, r.after); assert.deepEqual(r.evidenceBefore, r.evidenceAfter); assert.equal(r.learning, 'saved'); assert.deepEqual(r.areas, []);
});
for (const field of ['tags','sources','savedAt','artist','track','album','artistMbid','trackMbid','unknown','lastUsedAt','records','array-order']) test(`Q1.9: genuine ${field} changes still invalidate learning`, async () => {
 const r = await run(async field => {
  getAutoFeedbackAccount = () => 'account';
  const row = {artist:'A',track:'Song',savedAt:Date.now(),tags:['rock','metal'],sources:['tag'],catalogEvidence:[{artistName:'A',trackName:'Song',album:'Album'}]};
  localStorage.setItem(LASTFM_TRACK_POOL_KEY,JSON.stringify([row]));const selected=selectedProfiles(),rotation=await createSearchRotation(selected);
  if (['tags','sources'].includes(field)) row[field].push('new');
  else if (field==='savedAt') row.savedAt--;
  else if (['artist','track','unknown','lastUsedAt'].includes(field)) row[field]='changed';
  else if (field==='array-order') row.tags.reverse();
  else if (field!=='records') row.catalogEvidence[0][field]=field.endsWith('Mbid')?'12345678-1234-1234-1234-123456789abc':'Changed';
  const rows=[row];if(field==='records')rows.push({...row,track:'Another'});
  localStorage.setItem(LASTFM_TRACK_POOL_KEY,JSON.stringify(rows));
  const learning=await rememberSearchRotation({rotation,selected},{outcome:'success',searchEffectiveness:{final:true,pages:[]}});
  return {learning,areas:rotation.changedAreas,saved:localStorage.getItem(OmmSearchRotation.KEY)};
 },field);
 assert.equal(r.learning,'context-changed');assert.deepEqual(r.areas,['lastfmTracks']);assert.equal(r.saved,null);
});
test('Q1.9: JSON formatting/key order is neutral, malformed data and unknown evidence fields preserved',async()=>{
 const r=await run(()=>{
  const first=[{artist:'A',track:'S',catalogEvidence:[{artistName:'A',trackName:'S',album:'',artistMbid:'',trackMbid:''}]}];
  const second=[{catalogEvidence:[{trackName:'S',artistName:'A'}],track:'S',artist:'A'}];
  return {a:searchRotationLastFmTracks(JSON.stringify(first)),b:searchRotationLastFmTracks(JSON.stringify(second,null,2)),invalid:searchRotationLastFmTracks('bad'),future:searchRotationLastFmTracks('{"version":2}'),unknown:searchRotationLastFmTracks('[{"artist":"A","catalogEvidence":[{"future":""}]}]')};
 });assert.equal(r.a,r.b);assert.equal(r.invalid,'bad');assert.equal(r.future,'{"version":2}');assert.ok(r.unknown.includes('future'));
});
