import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import '../play-cooldown.js';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const state=read('functions/api/state.js').replace('"../../artist-exclusions.js"',JSON.stringify(url(read('artist-exclusions.js'))));
let source=read('functions/api/play-cooldown.js').replace("'./state.js'",JSON.stringify(url(state)));
for(const p of ['play-cooldown.js'])source=source.replace(`'../../${p}'`,JSON.stringify(url(read(p))));
const api=await import(url(source)),C=OfficePlayCooldown;
function db(t){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE app_state(account_id TEXT,state_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(account_id,state_key))');t.after(()=>sqlite.close());
  return {sqlite,beforeBatch:null,prepare(sql){return {bind(...args){return {sql,args,all:async()=>({results:sqlite.prepare(sql).all(...args)})};}};},async batch(rows){this.beforeBatch?.();this.beforeBatch=null;return rows.map(({sql,args})=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}}));}};}
const request=(method='GET',body,who='owner')=>new Request('https://local/api/play-cooldown',{method,headers:{Authorization:'Bearer '+who},...(body===undefined?{}:{body:JSON.stringify(body)})});
const auth=t=>t.mock.method(globalThis,'fetch',async(_url,o)=>Response.json({account_id:o.headers.Authorization.slice(7),id:'public'}));
const get=async DB=>{const r=await api.onRequestGet({request:request(),env:{DB}});return {status:r.status,...await r.json()};};
const put=(DB,s,base=null,who='owner')=>api.onRequestPut({request:request('PUT',{state:s,base},who),env:{DB}});
test('D1 cooldown: immutable account, CAS union and omission cannot delete a live block',async t=>{
  auth(t);const DB=db(t),s={...C.empty('owner'),tracks:{A:Date.now()-1000},signatures:{'artist|song':Date.now()-1000}};
  assert.equal((await put(DB,s)).status,200);let remote=await get(DB);
  assert.equal((await put(DB,{...s,tracks:{B:Date.now()}})).status,409);
  assert.equal((await put(DB,{...s,tracks:{B:Date.now()}},remote.base)).status,200);
  remote=await get(DB);assert.deepEqual(Object.keys(remote.state.tracks).sort(),['A','B']);assert.ok(remote.state.signatures['artist|song']);
  assert.equal((await put(DB,C.empty('owner'),remote.base)).status,200);
  assert.deepEqual(Object.keys((await get(DB)).state.tracks).sort(),['A','B']);
  assert.equal((await put(DB,s,null,'other')).status,400);
});
test('future/invalid state rejected; unsupported stored schema preserved; auth has no public-ID fallback',async t=>{
  auth(t);const DB=db(t);
  assert.equal((await put(DB,{...C.empty('owner'),tracks:{A:Date.now()+360000}})).status,400);
  assert.equal((await put(DB,{...C.empty('owner'),secret:'x'})).status,400);
  DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('owner',C.KEY,'{"version":2}','now');
  assert.equal((await get(DB)).status,503);assert.equal((await put(DB,C.empty('owner'))).status,409);
  assert.equal(DB.sqlite.prepare('SELECT value_json FROM app_state').get().value_json,'{"version":2}');
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'public'}));assert.equal((await get(DB)).status,502);
});

test('GET removes expired identities without changing CAS predecessor; same title by another artist stays distinct',async t=>{
  auth(t);const DB=db(t),s=C.empty('owner'),now=Date.now();s.tracks.expired=now-C.WINDOW;s.signatures['other artist|song']=now-1000;
  const original=JSON.stringify(s);DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('owner',C.KEY,original,'now');
  const r=await get(DB);assert.equal(r.base,original);assert.deepEqual(Object.keys(r.state.tracks),[]);
  assert.ok(r.state.signatures['other artist|song']);assert.equal(r.state.signatures['artist|song'],undefined);
  assert.equal(DB.sqlite.prepare('SELECT value_json FROM app_state').get().value_json,original);
});
test('API rejects unauthenticated calls, spoofed owner, extra fields, malformed JSON and oversize before writing',async t=>{
  auth(t);const DB=db(t);
  assert.equal((await api.onRequestGet({request:new Request('https://local/api/play-cooldown'),env:{DB}})).status,401);
  assert.equal((await put(DB,C.empty('other'))).status,400);
  const invalid=new Request('https://local/api/play-cooldown',{method:'PUT',headers:{Authorization:'Bearer owner'},body:'{broken'});
  assert.equal((await api.onRequestPut({request:invalid,env:{DB}})).status,400);
  const oversize=new Request('https://local/api/play-cooldown',{method:'PUT',headers:{Authorization:'Bearer owner','Content-Length':String(C.MAX_BYTES*4)},body:'{}'});
  assert.equal((await api.onRequestPut({request:oversize,env:{DB}})).status,413);
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM app_state').get().n,0);
});
