import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadStateApi } from './helpers/state-api.mjs';
import '../lastfm-cloud.js';
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const stateModule = readFileSync(new URL('../functions/api/state.js', import.meta.url),'utf8').replace('"../../artist-exclusions.js"',JSON.stringify(url(readFileSync(new URL('../artist-exclusions.js',import.meta.url),'utf8'))));
const source = readFileSync(new URL('../functions/api/lastfm.js',import.meta.url),'utf8').replace("'./state.js'",JSON.stringify(url(stateModule))).replace("'../../lastfm-cloud.js'",JSON.stringify(url(readFileSync(new URL('../lastfm-cloud.js',import.meta.url),'utf8'))));
const api = await import(url(source)), oldApi = await loadStateApi(), c = OfficeLastFmCloud;
function database(t) {
 const sqlite = new DatabaseSync(':memory:'); sqlite.exec('CREATE TABLE app_state(account_id TEXT,state_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(account_id,state_key))');t.after(()=>sqlite.close());
 return {sqlite,beforeBatch:null,prepare(sql){return {bind(...args){return {sql,args,all:async()=>({results:sqlite.prepare(sql).all(...args)})};}};},async batch(statements){this.beforeBatch?.();this.beforeBatch=null;sqlite.exec('BEGIN');try{const result=statements.map(({sql,args})=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const cache = (artist='First') => c.compact('lf',[{artist,tags:['rock'],sources:['tag'],savedAt:Date.now()}],[]);
const put = (cache,base=null,token='one') => new Request('https://local/api/lastfm',{method:'PUT',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({cache,base})});
const get = (token='one') => new Request('https://local/api/lastfm',{headers:{Authorization:`Bearer ${token}`}});
const auth = t => t.mock.method(globalThis,'fetch',async(_url,options)=>Response.json({account_id:options.headers.Authorization.slice(7),id:'mutable'}));
test('LF2 API bounded catalog, immutable account isolation and CAS merge using real SQLite',async t=>{
 auth(t);const DB=database(t),a=cache(),b=cache('Second');
 assert.equal((await api.onRequestPut({request:put(a),env:{DB}})).status,200);
 assert.equal((await api.onRequestPut({request:put(b),env:{DB}})).status,409);
 const remote=await(await api.onRequestGet({request:get(),env:{DB}})).json();assert.deepEqual(remote.cache,a);
 assert.equal((await api.onRequestPut({request:put(c.merge(a,b),remote.base),env:{DB}})).status,200);
 assert.equal((await api.onRequestPut({request:put(b,null,'two'),env:{DB}})).status,200);
 assert.deepEqual((await(await api.onRequestGet({request:get('two'),env:{DB}})).json()).cache,b);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM app_state').get().n,2);
});
test('LF2 API concurrent insert/update and deletion between GET and PUT never overwrite',async t=>{
 auth(t);const DB=database(t),a=cache(),b=cache('Racing'),raw=JSON.stringify(b);
 DB.beforeBatch=()=>DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('one',c.KEY,raw,'race');
 assert.equal((await api.onRequestPut({request:put(a),env:{DB}})).status,409);
 DB.beforeBatch=()=>DB.sqlite.prepare('DELETE FROM app_state').run();
 assert.equal((await api.onRequestPut({request:put(a,raw),env:{DB}})).status,409);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM app_state').get().n,0);
});
test('LF2 legacy state client cannot read, overwrite or delete the new catalog',async t=>{
 auth(t);const DB=database(t);await api.onRequestPut({request:put(cache()),env:{DB}});
 const result=await oldApi.onRequestGet({request:get(),env:{DB}});assert.equal(Object.hasOwn((await result.json()).state,c.KEY),false);
 const request=new Request('https://local/api/state',{method:'PUT',headers:{Authorization:'Bearer one'},body:JSON.stringify({state:{office_seed_bartek:'Queen'}})});
 assert.equal((await oldApi.onRequestPut({request,env:{DB}})).status,200);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM app_state WHERE state_key=?').get(c.KEY).n,1);
});
for (const kind of ['unknown-field','missing-base','invalid-cache','oversize','invalid-json']) test(`LF2 API rejects ${kind} before writing`,async t=>{
 auth(t);const DB=database(t);let body={cache:cache(),base:null};if(kind==='unknown-field')body.access_token='secret';if(kind==='missing-base')delete body.base;if(kind==='invalid-cache')body.cache.version=2;
 const raw=kind==='oversize'?'x'.repeat(512*1024+1):kind==='invalid-json'?'null bad':JSON.stringify(body);
 const response=await api.onRequestPut({request:new Request('https://local/api/lastfm',{method:'PUT',headers:{Authorization:'Bearer one'},body:raw}),env:{DB}});
 assert.equal(response.status,kind==='oversize'?413:400);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM app_state').get().n,0);
});
test('LF2 API preserves an unsupported future stored schema and rejects missing immutable identity',async t=>{
 const DB=database(t);auth(t);DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('one',c.KEY,JSON.stringify({version:2}),'future');
 assert.equal((await api.onRequestGet({request:get(),env:{DB}})).status,409);
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'mutable'}));assert.equal((await api.onRequestGet({request:get(),env:{DB}})).status,502);
 assert.equal((await api.onRequestGet({request:new Request('https://local/api/lastfm'),env:{DB}})).status,401);
});
