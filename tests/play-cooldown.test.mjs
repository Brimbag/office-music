import test from 'node:test';
import assert from 'node:assert/strict';
import '../play-cooldown.js';
const C=OfficePlayCooldown,N=Date.parse('2026-10-16T12:00:00Z'),DAY=86400000;
const plays=(at=N)=>[{at,trackId:'trackA',signatures:['artist|song']}];
function fixture(){
  let owner='owner',now=N,fail=false;const data=new Map();
  const c=C.create({getAccount:()=>owner,now:()=>now,storage:{getItem:key=>data.get(key)??null},
    edit:async(key,base,next)=>{if(fail)throw new Error('quota');assert.equal(data.get(key)??null,base);data.set(key,next);}});
  return {c,data,at:n=>now=n,owner:v=>owner=v,fail:()=>fail=true};
}
test('ID and Last.fm signatures expire exactly after 14 days; future and generated events cannot be supplied as plays',()=>{
  const s=C.fromPlays('owner',[...plays(),{at:N+1,trackId:'future'},{at:N-C.WINDOW,trackId:'expired'}],N);
  assert.deepEqual([...C.blocked(s,N).tracks],['trackA']);
  assert.deepEqual([...C.blocked(s,N+C.WINDOW-1).signatures],['artist|song']);
  assert.equal(C.blocked(s,N+C.WINDOW).tracks.size,0);
  assert.equal(C.blocked(s,N+C.WINDOW).signatures.size,0);
});
test('union keeps latest timestamp; empty or stale computer cannot shorten blocks',()=>{
  const a=C.fromPlays('owner',plays(N-DAY),N),b=C.fromPlays('owner',plays(),N);
  assert.equal(C.merge(a,b,'owner',N).tracks.trackA,N);
  assert.equal(C.merge(b,a,'owner',N).signatures['artist|song'],N);
  assert.equal(C.merge(b,null,'owner',N).tracks.trackA,N);
  assert.equal(Object.keys(C.merge(a,b,'owner',N+C.WINDOW).tracks).length,0);
});
test('local register survives controller restart and is isolated by immutable owner',async()=>{
  const f=fixture();await f.c.record('owner',plays());f.owner('other');assert.equal(f.c.blocked().tracks.size,0);
  await assert.rejects(()=>f.c.accept('owner',C.empty('owner')));
  f.owner('owner');const persisted=C.parse(f.data.get(C.localKey('owner')),'owner');assert.equal(persisted.tracks.trackA,N);
  assert.throws(()=>C.parse(persisted,'other'));
});
test('quota or unknown schema preserves existing state and prevents a successful write',async()=>{
  const f=fixture();await f.c.record('owner',plays());const before=f.data.get(C.localKey('owner'));f.fail();
  await assert.rejects(()=>f.c.record('owner',[{at:N,trackId:'new'}]));assert.equal(f.data.get(C.localKey('owner')),before);
  f.data.set(C.localKey('owner'),'{"version":2}');assert.throws(()=>f.c.blocked());
  assert.equal(f.data.get(C.localKey('owner')),'{"version":2}');
});
test('retention exceeds 1500 history rows without trimming any active block; overflow fails explicitly',()=>{
  const s=C.empty('owner');for(let i=0;i<C.MAX_ROWS;i++)s.tracks['t'+i]=N;
  assert.equal(C.valid(s),true);assert.equal(Object.keys(C.merge(s,null,'owner',N).tracks).length,C.MAX_ROWS);
  assert.throws(()=>C.merge(s,C.fromPlays('owner',[{at:N,trackId:'overflow'}],N),'owner',N),/Limit/);
  assert.equal(Object.keys(s.tracks).length,C.MAX_ROWS);
});
test('schema rejects extra data, invalid identities, timestamps, prototype keys and oversized signatures',()=>{
  const s=C.fromPlays('owner',plays(),N);
  assert.equal(C.valid({...s,token:'secret'}),false);
  assert.equal(C.valid({...s,tracks:{'not an ID':N}}),false);
  assert.equal(C.valid({...s,tracks:{A:NaN}}),false);
  assert.equal(C.valid({...s,signatures:{'no separator':N}}),false);
  assert.equal(C.valid({...s,signatures:{['a'.repeat(1024)+'|title']:N}}),false);
  assert.equal(C.valid({...s,tracks:JSON.parse('{"__proto__":123}')}),false);
  assert.throws(()=>C.fromPlays('owner',[{at:N,trackId:'not an ID'}],N));
});
test('local conflicts retry a union without overwriting another tab',async()=>{
  let raw=null,calls=0;const c=C.create({getAccount:()=> 'owner',now:()=>N,storage:{getItem:()=>raw},edit:async(_key,base,next)=>{
    calls++;if(calls===1){raw=JSON.stringify(C.fromPlays('owner',[{at:N,trackId:'otherTab'}],N));const e=new Error('conflict');e.name='LocalStateConflict';throw e;}
    assert.equal(base,raw);raw=next;
  }});await c.record('owner',plays());assert.deepEqual([...c.blocked().tracks].sort(),['otherTab','trackA']);assert.equal(calls,2);
});
