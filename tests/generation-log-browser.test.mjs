import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {startBrowserHarness} from './helpers/browser.mjs';import {entry} from './helpers/generation-log.mjs';
let h;before(async()=>h=await startBrowserHarness());after(async()=>h.close());
for(const scenario of ['success','duplicate','503-no-table','429','401-recovered','401-twice','network','timeout','quota'])test(`LOG1 optional write ${scenario}`,async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async({scenario,entry})=>{
  let calls=0,refreshes=0,body;const oldFetch=fetch,oldRefresh=refreshAccessToken,oldSet=Storage.prototype.setItem,oldTimeout=AbortSignal.timeout;
  localStorage.setItem('office_seed_bartek','Queen');localStorage.setItem('office_search_cache_v1:preserve','raw');
  const previous=JSON.stringify(durableLocalStateForCloud());
  fetch=async(_url,options)=>{calls++;body=JSON.parse(options.body);if(scenario==='network')throw new TypeError('offline');if(scenario==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
   if(scenario==='503-no-table')return Response.json({error:'missing table'},{status:503});if(scenario==='429')return Response.json({error:'limited'},{status:429});if(scenario.startsWith('401')&&(calls===1||scenario==='401-twice'))return Response.json({error:'expired'},{status:401});return Response.json({ok:true,duplicate:scenario==='duplicate'});};
  refreshAccessToken=async()=>{refreshes++;return 'new-token';};
  if(scenario==='timeout')AbortSignal.timeout=()=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('timeout','TimeoutError')),5);return c.signal;};
  if(scenario==='quota')Storage.prototype.setItem=function(key,value){if(key==='office_generation_log_last_v1')throw new DOMException('full','QuotaExceededError');return oldSet.call(this,key,value);};
  try{const result=await persistGenerationLog('fake',entry);return {result,calls,refreshes,body,status:progressBox.querySelector('[data-generation-log]').textContent,prefsSame:previous===JSON.stringify(durableLocalStateForCloud()),rawCache:localStorage.getItem('office_search_cache_v1:preserve'),local:localStorage.getItem('office_generation_log_last_v1'),inFlight:cloudRequestsInFlight};}
  finally{fetch=oldFetch;refreshAccessToken=oldRefresh;Storage.prototype.setItem=oldSet;AbortSignal.timeout=oldTimeout;}
 },{scenario,entry:entry()});
 const okay=['success','duplicate','401-recovered','quota'].includes(scenario);assert.equal(r.result.status,okay?'saved':'error');assert.equal(r.calls,scenario.startsWith('401')?2:1);assert.equal(r.refreshes,scenario.startsWith('401')?1:0);assert.equal(r.body.id,entry().id);assert.equal(r.prefsSame,true);assert.equal(r.rawCache,'raw');assert.equal(r.inFlight,0);assert.equal(r.result.localSaved,scenario!=='quota');assert.equal(Boolean(r.local),scenario!=='quota');assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LOG1 unavailable UUID generation is isolated from playlist generation and restored controls',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{
  const old=crypto.randomUUID;crypto.randomUUID=()=>{throw new Error('unavailable');};
  // The missing Spotify session fails the ordinary generator path, not UUID allocation before try/finally.
  try{await generateOfficePlaylist();return {disabled:generateButton.disabled,active:generationInFlight,outcome:lastGenerationReport.outcome,journal:lastGenerationReport.journal.status};}finally{crypto.randomUUID=old;}
 });assert.deepEqual(r,{disabled:false,active:false,outcome:'error',journal:'error'});assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LOG1 LF2 diagnostic distinguishes actual write from reused confirmation',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{
  localStorage.setItem(LASTFM_USER_KEY,'lf');lastFmSpotifyAccount='sp';
  localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify([{artist:'Artist',tags:['rock'],sources:['tag'],savedAt:Date.now()}]));
  const old=lastFmCloudRequest;let cache=null,base=null,puts=0;lastFmCloudRequest=async(_token,options)=>{if(options.method==='PUT'){puts++;cache=JSON.parse(options.body).cache;base=JSON.stringify(cache);return {ok:true};}return {cache,base};};
  try{const one=await syncLastFmCloud('fake'),two=await syncLastFmCloud('fake');appendLastFmCloudDiagnostic(OfficeGenerationLog.cloudResult({catalog:one}));appendLastFmCloudDiagnostic(OfficeGenerationLog.cloudResult({catalog:two}));return {one,two,puts,text:progressBox.textContent};}finally{lastFmCloudRequest=old;}
 });assert.equal(r.one.written,true);assert.equal(r.two.written,false);assert.equal(r.two.skipped,true);assert.equal(r.two.artists,1);assert.equal(r.puts,1);assert.match(r.text,/zapisano/);assert.match(r.text,/poprzedniego potwierdzenia/);
 }finally{await s.close();}
});
test('LOG1 honors authentication Retry-After across generations without adding retries or deleting caches',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async entry=>{
  let calls=0;const old=fetch;fetch=async()=>{calls++;return Response.json({error:'limited'},{status:503,headers:{'Retry-After':'300'}});};
  try{const first=await persistGenerationLog('fake',entry),second=await persistGenerationLog('fake',entry);return {calls,first:first.status,second:second.status,remaining:generationJournalBackoff.until-Date.now(),inFlight:cloudRequestsInFlight};}finally{fetch=old;}
 },entry());assert.equal(r.calls,1);assert.equal(r.first,'error');assert.equal(r.second,'deferred');assert.ok(r.remaining>299000);assert.equal(r.inFlight,0);
 }finally{await s.close();}
});
