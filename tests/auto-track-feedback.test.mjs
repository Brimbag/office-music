import test from 'node:test';
import assert from 'node:assert/strict';
import '../spotify-skip-journal.js';
import '../auto-track-feedback.js';
const A=OfficeAutoTrackFeedback,N=Date.parse('2026-10-11T12:00:00Z');
const event=(id='e',kind='early',at=N,trackId='A')=>({version:1,account:'owner',id,kind,at,trackId,playlistId:'omm',durationMs:200000,fromMs:kind==='early'?10000:kind==='middle'?60000:150000,toMs:kind==='early'?15000:kind==='middle'?65000:155000});
const add=(s,id,kind='early',at=N,trackId='A')=>A.add(s,event(id,kind,at,trackId),at);
for(const [kind,want] of [['early',-100],['middle',-50],['late',0]])test(`S2 ${kind}: separate bounded track penalty`,()=>{const s=add(A.empty('owner'),'e',kind);assert.equal(A.score(s,'A',N),want);assert.equal(A.score(s,'B',N),0);assert.doesNotMatch(JSON.stringify(s),/artists|score|penalty|token/);});
test('S2 early escalation −100/−150/−200/−250 never banks above cap',()=>{let s=A.empty('owner');for(let i=0;i<7;i++){s=add(s,'e'+i);assert.equal(A.score(s,'A',N),-Math.min(250,100+i*50));}assert.equal(A.score(s,'A',N+30*A.DAY),-125);assert.equal(A.score(s,'A',N+90*A.DAY),0);});
test('S2 middle skips and early escalation interleave deterministically',()=>{let s=add(A.empty('owner'),'a','middle');s=add(s,'b','early');s=add(s,'c','middle');assert.equal(A.score(s,'A',N),-200);assert.equal(A.score(A.merge(s,s,'owner',N),'A',N),-200);});
test('S2 continuous decay, future clock and exact 90-day expiry',()=>{const s=add(A.empty('owner'),'a');assert.equal(A.score(s,'A',N-1),0);assert.equal(A.score(s,'A',N+30*A.DAY),-50);assert.ok(A.score(s,'A',N+90*A.DAY-1)<0);assert.equal(A.score(s,'A',N+90*A.DAY),0);});
test('S2 duplicate IDs are idempotent; contradictory payload is preserved as conflict',()=>{const s=add(A.empty('owner'),'a');assert.deepEqual(A.add(s,event('a'),N),s);assert.throws(()=>A.add(s,event('a','early',N,'B'),N));});
test('S2 reset watermark survives stale device and equal-time skip, later real skip works',()=>{const old=add(A.empty('owner'),'a'),reset=A.reset(old,'A',N+1000);assert.equal(A.score(A.merge(old,reset,'owner',N+1000),'A',N+1000),0);const simultaneous=add(A.empty('owner'),'b','early',N+1000);assert.equal(A.score(A.merge(simultaneous,reset,'owner',N+1000),'A',N+1000),0);const newer=add(reset,'c','early',N+2000);assert.equal(A.score(newer,'A',N+2000),-100);});
test('S2 union is commutative and independent concurrent tracks/reset are retained',()=>{const a=add(A.empty('owner'),'a'),b=add(A.empty('owner'),'b','middle',N,'B');assert.deepEqual(A.merge(a,b,'owner',N),A.merge(b,a,'owner',N));const reset=A.reset(a,'A',N);const s=A.merge(reset,b,'owner',N);assert.equal(A.score(s,'A',N),0);assert.equal(A.score(s,'B',N),-50);});
test('S2 global floor prevents resurrection after 90-day cleanup and tombstone expiry',()=>{const old=add(A.empty('owner'),'a');const reset=A.reset(old,'A',N);const cleaned=A.normalize(reset,N+91*A.DAY);assert.equal(Object.keys(cleaned.resets).length,0);assert.equal(Object.keys(A.merge(old,cleaned,'owner',N+91*A.DAY).events).length,0);});
for(const bad of ['account','kind','future','stale','boundary','id'])test(`S2 rejects ${bad} without modifying previous state`,()=>{const s=add(A.empty('owner'),'a'),before=JSON.stringify(s),e=event('bad');if(bad==='account')e.account='other';if(bad==='kind')e.kind='unknown';if(bad==='future')e.at++;if(bad==='stale')e.at-=10001;if(bad==='boundary')e.toMs=40000;if(bad==='id')e.trackId='spotify:local';assert.throws(()=>A.add(s,e,N));assert.equal(JSON.stringify(s),before);});
test('S2 future schema, additional fields and cross-account import fail closed',()=>{const s=A.empty('owner');for(const bad of [{...s,version:2},{...s,token:'secret'},{...s,account:'other'}])assert.throws(()=>A.parse(bad,'owner'));});
test('S2 event/size limits refuse new data rather than silently dropping scores/resets',()=>{const s=A.empty('owner');for(let i=0;i<A.MAX_ROWS;i++)s.events['e'+i]={trackId:'A',at:N,kind:'early',weight:100};assert.equal(A.valid(s),true);assert.throws(()=>add(s,'overflow'));assert.equal(Object.keys(s.events).length,A.MAX_ROWS);});
function local(){const rows=new Map();let account='owner',fail=false;const c=A.create({getAccount:()=>account,storage:{getItem:key=>rows.get(key)??null},now:()=>N,edit:async(key,base,next)=>{if(fail)throw new Error('quota');assert.equal(rows.get(key)??null,base);rows.set(key,next);}});return {c,rows,account:a=>account=a,fail:()=>fail=true};}
test('S2 local opt-in defaults off, no S1 backfill; disabling removes only automatic influence',async()=>{const f=local();assert.equal(f.c.enabled(),false);assert.equal(await f.c.record(event()),false);await f.c.configure(true);assert.equal(f.c.score('A'),0);await f.c.record(event());assert.equal(f.c.score('A'),-100);await f.c.configure(false);assert.equal(f.c.score('A'),0);assert.equal(Object.keys(f.c.state('owner').events).length,1);});
test('S2 separate account namespaces do not carry ratings or opt-in across login',async()=>{const f=local();await f.c.configure(true);await f.c.record(event());f.account('other');assert.equal(f.c.enabled(),false);assert.equal(f.c.score('A'),0);await f.c.configure(true);assert.equal(f.c.score('A'),0);f.account('owner');assert.equal(f.c.score('A'),-100);});
test('S2 reset survives disabling/removing manual preference and restarting client',async()=>{const f=local();await f.c.configure(true);await f.c.record(event());await f.c.configure(false);await f.c.reset('A');await f.c.configure(true);assert.equal(f.c.score('A'),0);assert.equal(Object.keys(f.c.state('owner').resets).length,1);});
test('S2 failed local edit retains previous data and produces no penalty',async()=>{const f=local();await f.c.configure(true);f.fail();await assert.rejects(()=>f.c.record(event()));assert.equal(f.c.has('owner'),false);assert.equal(f.c.score('A'),0);});
test('S2 up on a clean client persists a reset before later cloud import, even while disabled',async()=>{const f=local();await f.c.reset('A');const old=add(A.empty('owner'),'old');await f.c.accept('owner',old);await f.c.configure(true);assert.equal(f.c.score('A'),0);assert.ok(f.c.state('owner').resets.A);});
test('S2 expiry of the first early skip cannot promote a surviving later skip or increase penalty',()=>{let s=add(A.empty('owner'),'first','early',N);s=add(s,'later','early',N+89*A.DAY);const before=A.score(s,'A',N+90*A.DAY-1),after=A.score(s,'A',N+90*A.DAY);assert.ok(after>=before);assert.ok(after>-50&&after<-48);const clean=A.normalize(s,N+90*A.DAY);assert.equal(clean.events.later.weight,50);assert.equal(A.score(clean,'A',N+90*A.DAY),after);});
test('S2 concurrent first early skips converge to one first and one subsequent contribution',()=>{const a=add(A.empty('owner'),'a'),b=add(A.empty('owner'),'b');const m=A.merge(a,b,'owner',N);assert.equal(m.events.a.weight,100);assert.equal(m.events.b.weight,50);assert.equal(A.score(m,'A',N),-150);assert.deepEqual(A.merge(m,b,'owner',N),m);});
test('S2 unsupported stored schema can always be disabled without deleting data',async()=>{const f=local();await f.c.configure(true);f.rows.set(A.localKey('owner'),'{"version":2}');await f.c.configure(false);assert.equal(f.c.enabled(),false);assert.equal(f.rows.get(A.localKey('owner')),'{"version":2}');await assert.rejects(()=>f.c.configure(true));assert.equal(f.c.enabled(),false);});

test('stable default initialization preserves explicit choices, validates state and does not backfill events',async()=>{
 const f=local();await f.c.initializeDefault();assert.equal(f.c.enabled(),true);assert.equal(f.c.has('owner'),false);
 await f.c.configure(false);await f.c.initializeDefault();assert.equal(f.c.enabled(),false);
 f.account('other');await f.c.initializeDefault();assert.equal(f.c.enabled(),true);assert.equal(f.c.score('A'),0);
 f.account('broken');f.rows.set(A.localKey('broken'),'{"version":2}');await assert.rejects(()=>f.c.initializeDefault());
 assert.equal(f.c.enabled(),false);assert.equal(f.rows.get(A.localKey('broken')),'{"version":2}');
});
test('stable default CAS never overwrites a concurrent explicit disable; storage errors remain failures',async()=>{
 const rows=new Map(),storage={getItem:k=>rows.get(k)??null};
 const c=A.create({getAccount:()=> 'owner',storage,edit:async(key,base)=>{
  assert.equal(base,null);rows.set(key,'0');const e=new Error('conflict');e.name='LocalStateConflict';throw e;
 }});
 await c.initializeDefault();assert.equal(c.enabled(),false);
 const f=local();f.fail();await assert.rejects(()=>f.c.initializeDefault());assert.equal(f.c.enabled(),false);
});
