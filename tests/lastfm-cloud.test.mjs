import test from 'node:test';
import assert from 'node:assert/strict';
import '../lastfm-cloud.js';
const c = OfficeLastFmCloud, now = Date.now();
const artist = (name = 'Artist', time = now) => ({ artist: name, tags: ['rock'], sources: ['tag'], savedAt: time });
const track = (name = 'Song', time = now, who = 'Artist') => ({ ...artist(who, time), track: name });
test('LF2 compact catalog strips history, recent evidence, OAuth, raw caches and usage timestamps', () => {
 const cache = c.compact(' LF ', [{ ...artist(), recentCount: 99, recentObservation: { plays: [now] }, access_token: 'secret', lastUsedAt: now }], [{ ...track(), history: [now], raw: {} }]);
 assert.equal(cache.user, 'lf'); assert.equal(c.valid(cache), true);
 assert.deepEqual(Object.keys(cache.artists[0]).sort(), ['artist','savedAt','sources','tags']);
 assert.equal(JSON.stringify(cache).includes('secret'), false);
 for (const field of ['recentCount', 'recentObservation', 'raw', 'access_token']) assert.equal(c.valid({ ...cache, artists: [{ ...cache.artists[0], [field]: 'x' }] }), false);
});
test('LF2 original timestamp expires exactly after 45 days; reads and merge never renew it', () => {
 const row = artist('Boundary', now - c.TTL), old = artist('Expired', now - c.TTL - 1);
 const a = c.compact('lf', [row, old], [], now); assert.equal(a.artists.length, 1);
 assert.equal(c.merge(a, a, now).artists[0].savedAt, row.savedAt);
 assert.equal(c.merge(a, a, now + 1).artists.length, 0); assert.equal(c.valid(a, now + c.TTL), true);
 assert.equal(c.compact('lf', [artist('Future', now + 300001)], [], now).artists.length, 0);
});
test('LF2 merge is additive, idempotent, owner isolated, preserves catalog ambiguity and latest original savedAt', () => {
 const one = c.compact('lf', [{ ...artist(), tags: ['metal'] }], [track('One')]);
 const two = c.compact('lf', [artist('Other')], [track('Two')]);
 const merged = c.merge(one, two); assert.equal(merged.artists.length, 2); assert.equal(merged.tracks.length, 2);
 assert.deepEqual(c.merge(merged, merged), merged); assert.deepEqual(c.merge(two, one), merged);
 assert.throws(() => c.merge(one, { ...two, user: 'other' }), /innego konta/);
 const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12,'0')}`);
 const collision = c.merge(c.compact('lf', [{ ...artist(), catalogMbids: ids.slice(0,3) }], []), c.compact('lf', [{ ...artist(), catalogMbids: ids.slice(3) }], []));
 assert.equal(collision.artists[0].catalogMbids.length, 4); assert.equal(collision.artists[0].catalogEvidenceTruncated, true);
});
test('LF2 full 1800/3000 pools fit bounded cloud subset, UTF-8 included; round robin preserves diversity', t => {
 const artists = Array.from({ length: 1800 }, (_,i) => artist(`Artist ${i} 日本`));
 const tracks = Array.from({ length: 3000 }, (_,i) => track(`Song ${i} 日本`, now, i < 1000 ? 'Prolific' : `Artist ${i}`));
 const cache = c.compact('lf', artists, tracks), raw = c.bytes({ artists, tracks });
 assert.ok(c.bytes(cache) <= c.MAX_BYTES); assert.ok(cache.artists.length > 100); assert.ok(new Set(cache.tracks.map(r => r.artist)).size > 100);
 assert.equal(c.valid(cache), true); assert.deepEqual(c.compact('lf', artists, tracks), cache);
 t.diagnostic(JSON.stringify({ rawBytes: raw, compactBytes: c.bytes(cache), artists: cache.artists.length, tracks: cache.tracks.length }));
});
for (const bad of [null, {}, {version:2,user:'lf',artists:[],tracks:[]}, {version:1,user:'LF',artists:[],tracks:[]}, {version:1,user:'lf',artists:[artist(),artist()],tracks:[]}]) test(`LF2 rejects malformed catalog ${JSON.stringify(bad).slice(0,60)}`, () => assert.equal(c.valid(bad),false));
test('LF2 repeated merge of four catalog records does not create false truncation',()=>{
 const records=Array.from({length:4},(_,i)=>({artistName:'Artist',trackName:`Song ${i}`,artistMbid:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`}));
 const a=c.compact('lf',[],[{...track(),catalogEvidence:records}]);assert.deepEqual(c.merge(a,a),a);assert.equal(c.merge(a,a).tracks[0].catalogEvidenceTruncated,undefined);
});
