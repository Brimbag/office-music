import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {entry,loadGenerationApi} from './helpers/generation-log.mjs';
const api=await loadGenerationApi(),migration=readFileSync(new URL('../migrations/0001_generation_logs.sql',import.meta.url),'utf8');
function database(t,migrate=true){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE app_state(account_id TEXT,state_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(account_id,state_key))');if(migrate){sqlite.exec(migration);sqlite.exec(migration);}t.after(()=>sqlite.close());return {sqlite,failBatch:false,prepare(sql){return {bind(...args){return {sql,args,all:async()=>({results:sqlite.prepare(sql).all(...args)})};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(({sql,args},i)=>{if(this.failBatch&&i===1)throw new Error('injected');return /^SELECT/i.test(sql)?{results:sqlite.prepare(sql).all(...args)}:{meta:{changes:sqlite.prepare(sql).run(...args).changes}};});sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
const auth=t=>t.mock.method(globalThis,'fetch',async(_url,options)=>Response.json({account_id:options.headers.Authorization.slice(7),id:'mutable'}));
const post=(e=entry(),owner='one')=>new Request('https://local/api/generations',{method:'POST',headers:{Authorization:`Bearer ${owner}`},body:JSON.stringify(e)});
const get=(owner='one',query='')=>new Request(`https://local/api/generations${query}`,{headers:{Authorization:`Bearer ${owner}`}});
test('LOG1 migration is additive/idempotent; journals isolated by immutable account_id',async t=>{
 auth(t);const DB=database(t);DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('one','office_seed_bartek','Queen','old');
 assert.equal((await api.onRequestPost({request:post(),env:{DB}})).status,200);const b=entry();b.length=47;b.selection.discovery=12;
 assert.equal((await api.onRequestPost({request:post(b,'two'),env:{DB}})).status,200);
 const first=await(await api.onRequestGet({request:get(),env:{DB}})).json(),second=await(await api.onRequestGet({request:get('two'),env:{DB}})).json();
 assert.equal(first.entries[0].entry.length,48);assert.equal(second.entries[0].entry.length,47);assert.equal(DB.sqlite.prepare('SELECT value_json FROM app_state').get().value_json,'Queen');
});
test('LOG1 duplicates including reordered object keys are idempotent; conflicting ID preserves original',async t=>{
 auth(t);const DB=database(t),a=entry();await api.onRequestPost({request:post(a),env:{DB}});
 const reordered=Object.fromEntries(Object.entries(a).reverse());const dup=await(await api.onRequestPost({request:post(reordered),env:{DB}})).json();assert.equal(dup.duplicate,true);assert.equal(dup.saved,false);
 a.length=47;assert.equal((await api.onRequestPost({request:post(a),env:{DB}})).status,409);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM generation_logs').get().n,1);
});
test('LOG1 retention stays at 100/account and never deletes another account',async t=>{
 auth(t);const DB=database(t);await api.onRequestPost({request:post(entry(),'two'),env:{DB}});
 for(let i=1;i<=105;i++){const e=entry(`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`);assert.equal((await api.onRequestPost({request:post(e),env:{DB}})).status,200);}
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM generation_logs WHERE account_id=?').get('one').n,100);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM generation_logs WHERE account_id=?').get('two').n,1);
 const result=await(await api.onRequestGet({request:get('one','?limit=100'),env:{DB}})).json();assert.equal(result.entries.length,100);
 const sorted=DB.sqlite.prepare('SELECT generation_id FROM generation_logs WHERE account_id=? ORDER BY record_order DESC').all('one');assert.deepEqual(result.entries.map(r=>r.entry.id),sorted.map(r=>r.generation_id));
});
test('LOG1 failed atomic retention batch rolls back insertion; missing schema safely returns 503',async t=>{
 auth(t);const DB=database(t);DB.failBatch=true;assert.equal((await api.onRequestPost({request:post(),env:{DB}})).status,503);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM generation_logs').get().n,0);
 const missing=database(t,false);assert.equal((await api.onRequestPost({request:post(),env:{DB:missing}})).status,503);assert.equal((await api.onRequestGet({request:get(),env:{DB:missing}})).status,503);
});
for(const kind of ['invalid','secret','oversize','malformed'])test(`LOG1 API rejects ${kind} without partial SQL`,async t=>{
 auth(t);const DB=database(t);let e=entry();if(kind==='invalid')e.requested=null;if(kind==='secret')e.refresh_token='secret';const body=kind==='oversize'?'x'.repeat(16385):kind==='malformed'?'bad':JSON.stringify(e);
 const request=new Request('https://local/api/generations',{method:'POST',headers:{Authorization:'Bearer one'},body});assert.equal((await api.onRequestPost({request,env:{DB}})).status,kind==='oversize'?413:400);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM generation_logs').get().n,0);
});
for(const query of ['?limit=0','?limit=101','?limit=foo','?limit=1&limit=2','?account_id=two'])test(`LOG1 invalid GET ${query}`,async t=>{auth(t);const DB=database(t);assert.equal((await api.onRequestGet({request:get('one',query),env:{DB}})).status,400);});
test('LOG1 missing immutable identity / unauthenticated access never touches database',async t=>{
 const DB=database(t);t.mock.method(globalThis,'fetch',async()=>Response.json({id:'mutable'}));assert.equal((await api.onRequestPost({request:post(),env:{DB}})).status,502);assert.equal((await api.onRequestGet({request:new Request('https://local/api/generations'),env:{DB}})).status,401);
});

test('LOG1 concurrent duplicate submissions use one ID and do not renew retention order/time',async t=>{
 auth(t);const DB=database(t);const replies=await Promise.all(Array.from({length:8},()=>api.onRequestPost({request:post(),env:{DB}})));
 assert.ok(replies.every(r=>r.status===200));assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM generation_logs').get().n,1);
 DB.sqlite.prepare('UPDATE generation_logs SET created_at=?').run('2000-01-01T00:00:00.000Z');const before=DB.sqlite.prepare('SELECT record_order FROM generation_logs').get().record_order;
 await api.onRequestPost({request:post(),env:{DB}});const after=DB.sqlite.prepare('SELECT record_order,created_at FROM generation_logs').get();assert.equal(after.record_order,before);assert.equal(after.created_at,'2000-01-01T00:00:00.000Z');
});
test('LOG1 retention follows actual insertion order even when clock timestamps tie or go backwards',async t=>{
 auth(t);const DB=database(t);await api.onRequestPost({request:post(),env:{DB}});DB.sqlite.prepare('UPDATE generation_logs SET created_at=?').run('9999-01-01T00:00:00.000Z');
 const e=entry('00000000-0000-0000-0000-000000000002');await api.onRequestPost({request:post(e),env:{DB}});
 const list=await(await api.onRequestGet({request:get(),env:{DB}})).json();assert.equal(list.entries[0].entry.id,e.id);
});
