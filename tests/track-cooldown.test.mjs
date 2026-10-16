import test from 'node:test';
import assert from 'node:assert/strict';
import '../spotify-skip-journal.js';
import '../auto-track-feedback.js';
import '../track-cooldown.js';
const C=OfficeTrackCooldown, A=OfficeAutoTrackFeedback, N=Date.parse('2026-10-15T17:07:42+02:00');
const event=(at=N,kind='early',trackId='70cHKK8bHAfJrOGVnfRG9J')=>({version:1,account:'owner',id:'event'+at,
  trackId,playlistId:'omm',at,kind,durationMs:200000,fromMs:kind==='early'?14600:kind==='middle'?42800:150000,
  toMs:kind==='early'?26600:kind==='middle'?53600:160000});
function fixture(){
  let now=N, account='owner',fail=false;
  const data=new Map(),storage={getItem:k=>data.get(k)??null};
  const edit=async(k,base,next)=>{if(fail)throw new Error('quota');assert.equal(storage.getItem(k),base);data.set(k,next);};
  let a;
  const c=C.create({getAccount:()=>account,storage,edit,now:()=>now,legacy:key=>a?.state(key)});
  a=A.create({getAccount:()=>account,storage,edit,now:()=>now,preserve:(key,s)=>c.preserve(key,s)});
  return {a,c,data,at:t=>now=t,account:v=>account=v,fail:()=>fail=true};
}
for(const kind of ['early','middle','late'])test(`cooldown ${kind}: independent of scoring switch, exact expiry and Track ID`,async()=>{
  const f=fixture(),e=event(N,kind);assert.equal(f.a.enabled(),false);
  assert.equal(await f.c.record(e),kind!=='late');
  for(const delta of [0,C.WINDOW-1,C.WINDOW,C.WINDOW+1]){
    f.at(N+delta);assert.equal(f.c.blocked().has(e.trackId),kind!=='late'&&delta<C.WINDOW);
    assert.equal(f.c.blocked().has('otherEdition'),false);
  }
});
test('👍 reset, repeated toggle and disabled scoring cannot remove a saved block; account isolation',async()=>{
  const f=fixture();await f.a.configure(true);await f.a.record(event());
  await f.a.reset(event().trackId);await f.a.configure(false);
  assert.equal(f.a.score(event().trackId),0);assert.equal(f.c.blocked().has(event().trackId),true);
  assert.equal(Object.keys(f.a.state('owner').events).length,0);
  f.account('other');assert.equal(f.c.blocked().size,0);
  f.account('owner');assert.equal(f.c.blocked().size,1);
});
test('latest skip renews 14 days; stale client union cannot shorten or revive an expired block',async()=>{
  const f=fixture(),e=event();await f.c.record(e);const old=f.c.state('owner');
  f.at(N+C.DAY);await f.c.record(event(N+C.DAY,'middle'));await f.c.accept('owner',old);
  f.at(N+C.WINDOW);assert.equal(f.c.blocked().size,1);
  f.at(N+C.WINDOW+C.DAY);await f.c.accept('owner',old);assert.equal(f.c.blocked().size,0);
});
test('existing S2 events are promoted before reset; no diagnostic S1 backfill',async()=>{
  const f=fixture(),s=A.add(A.empty('owner'),event(),N);
  f.data.set(A.localKey('owner'),JSON.stringify(s));
  assert.equal(f.c.blocked().size,1);await f.a.reset(event().trackId);
  assert.equal(f.c.state('owner').tracks[event().trackId],N);
  assert.equal(f.c.blocked().size,1);
  const other=fixture();assert.equal(other.c.blocked().size,0);
});
test('failed preservation prevents destructive S2 reset and keeps original data',async()=>{
  const f=fixture();f.data.set(A.localKey('owner'),JSON.stringify(A.add(A.empty('owner'),event(),N)));
  const before=f.data.get(A.localKey('owner'));f.fail();await assert.rejects(()=>f.a.reset(event().trackId));
  assert.equal(f.data.get(A.localKey('owner')),before);assert.equal(f.c.blocked().size,1);
});
test('quota and unsupported schemas fail closed without deleting prior blocks',async()=>{
  const f=fixture();await f.c.record(event());const before=f.data.get(C.localKey('owner'));
  f.at(N+1);f.fail();await assert.rejects(()=>f.c.record(event(N+1,'middle','second')));
  assert.equal(f.data.get(C.localKey('owner')),before);
  f.data.set(C.localKey('owner'),'{"version":2}');assert.throws(()=>f.c.blocked());
  assert.equal(f.data.get(C.localKey('owner')),'{"version":2}');
});
test('bounded state refuses overflow; future entries do not block until their timestamp',()=>{
  const s=C.empty('owner');for(let i=0;i<C.MAX_ROWS;i++)s.tracks['t'+i]=N;
  assert.equal(C.valid(s),true);assert.throws(()=>C.merge(s,{...C.empty('owner'),tracks:{overflow:N}},'owner',N));
  const future={...C.empty('owner'),tracks:{future:N+1000}};
  assert.equal(C.blocked(future,N).size,0);assert.equal(C.blocked(future,N+1000).size,1);
  assert.throws(()=>C.parse(s,'other'));assert.equal(C.valid({...s,secret:'bad'}),false);
});
