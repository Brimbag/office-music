import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let h; before(async()=>h=await startBrowserHarness());after(async()=>h.close());
for (const scenario of ['new-device','existing-full','conflict','quota','account-switch','wrong-owner','offline','legacy-server']) test(`LF2 browser sync ${scenario}`,async()=>{
 const session=await h.page();try{
 const result=await session.page.evaluate(async scenario=>{
  const now=Date.now();localStorage.setItem(LASTFM_USER_KEY,'lf');lastFmSpotifyAccount='sp';
  const row=(artist)=>({artist,tags:['rock'],sources:['tag'],savedAt:now});
  const remote=OfficeLastFmCloud.compact(scenario==='wrong-owner'?'other':'lf',[row('Remote')],[{...row('Remote'),track:'Song'}]);
  if(scenario==='existing-full')localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify(Array.from({length:1800},(_,i)=>({...row(`Local ${i}`),recentCount:10,recentObservation:{user:'lf',plays:[Math.floor(now/1000)]},tags:Array.from({length:25},(_,j)=>`tag${j}`)}))));
  const preferences=JSON.stringify(durableLocalStateForCloud());let reads=0,writes=0,body=null;const original=lastFmCloudRequest;
  lastFmCloudRequest=async(_token,options)=>{
   if(scenario==='offline'||scenario==='legacy-server')throw new Error(scenario==='offline'?'offline':'HTTP 404');
   if(options.method==='GET') {reads++;await new Promise(r=>setTimeout(r,10));if(scenario==='account-switch')lastFmSpotifyAccount='different';return {cache:remote,base:JSON.stringify(remote)};}
   writes++;body=JSON.parse(options.body);if(scenario==='conflict'&&writes===1){const error=new Error('race');error.status=409;throw error;}return {ok:true};
  };
  if(scenario==='conflict')localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify([row('Local')]));
  let quotaTriggered=false;
  const originalSet=Storage.prototype.setItem;
  if(scenario==='quota')Storage.prototype.setItem=function(key,value){if(key===LASTFM_ARTIST_POOL_KEY){quotaTriggered=true;throw new DOMException('full','QuotaExceededError');}return originalSet.call(this,key,value);};
  try {
   const [first,second]=await Promise.all([syncLastFmCloudSafely('fake'),syncLastFmCloudSafely('fake')]);
   const readsBefore=reads;if (!first.error) await syncLastFmCloudSafely('fake');
   return {first,second,reads,writes,readsBefore,body,quotaTriggered,artists:loadLastFmArtistPool(),tracks:loadLastFmTrackPool(),history:loadHistory().length,prefsSame:preferences===JSON.stringify(durableLocalStateForCloud()),status:cloudStatus.textContent};
  }finally{lastFmCloudRequest=original;Storage.prototype.setItem=originalSet;}
 },scenario);
 assert.equal(result.history,0);
 if(scenario==='new-device'){assert.equal(result.artists.length,1);assert.equal(result.tracks.length,1);assert.equal(result.artists[0].recentCount,0);assert.equal(result.reads,1);assert.equal(result.writes,0);assert.equal(result.prefsSame,true);}
 if(scenario==='existing-full'){assert.equal(result.artists.length,1800);assert.equal(result.artists.some(r=>r.artist==='Remote'),false);assert.equal(result.artists[0].tags.length,25);assert.equal(result.artists[0].recentCount,1);assert.equal(result.artists[0].recentObservation.plays.length,1);}
 if(scenario==='conflict'){assert.equal(result.reads,2);assert.equal(result.writes,2);assert.deepEqual(result.body.cache.artists.map(r=>r.artist),['Local','Remote']);assert.equal(result.reads,result.readsBefore);}
 if(['quota','account-switch','wrong-owner','offline','legacy-server'].includes(scenario)){assert.ok(result.first.error);assert.equal(result.artists.length,0);assert.equal(result.writes,0);assert.match(result.status,/Dane lokalne zachowano/);}
 assert.deepEqual(session.errors,[]);
 }finally{await session.close();}
});
test('LF2 import is additive, preserves local observations and all existing tags and original timestamps',async()=>{
 const s=await h.page();try{
 const result=await s.page.evaluate(()=>{
  const savedAt=Date.now()-1000;localStorage.setItem(LASTFM_USER_KEY,'lf');
  localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify([{artist:'Local',tags:['metal'],sources:['tag','recent'],savedAt,recentObservation:{user:'lf',plays:[Math.floor(Date.now()/1000)]},recentCount:1,lastUsedAt:7}]));
  applyLastFmCloudCatalog(OfficeLastFmCloud.compact('lf',[{artist:'Local',tags:['rock'],sources:['tag'],savedAt}],[]));
  return {row:loadLastFmArtistPool()[0],savedAt};
 });assert.deepEqual(result.row.tags,['metal','rock']);assert.equal(result.row.savedAt,result.savedAt);assert.equal(result.row.recentCount,1);assert.equal(result.row.lastUsedAt,7);
 }finally{await s.close();}
});
for (const scenario of ['401-restored','401-twice','429','network']) test(`LF2 transport ${scenario}: bounded retry, backoff and optional failure`,async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async scenario=>{
  let calls=0,refreshes=0;const old=fetch,oldRefresh=refreshAccessToken;
  fetch=async()=>{calls++;if(scenario==='network')throw new TypeError('offline');if(scenario==='429')return Response.json({error:'rate limited'},{status:429,headers:{'Retry-After':'300'}});if(calls===1||scenario==='401-twice')return Response.json({error:'expired'},{status:401});return Response.json({cache:null,base:null});};
  refreshAccessToken=async()=>{refreshes++;return 'new-token';};
  try{
   const first=await syncLastFmCloudSafely('fake'),until=lastFmCloudBackoff?.until;
   const second=await syncLastFmCloudSafely('fake');
   return {calls,refreshes,first,second,remaining:(until||0)-Date.now(),sameUntil:until===lastFmCloudBackoff?.until};
  }finally{fetch=old;refreshAccessToken=oldRefresh;}
 },scenario);
 assert.equal(r.calls,scenario.startsWith('401')?2:1);assert.equal(r.refreshes,scenario.startsWith('401')?1:0);
 if(scenario==='401-restored'){assert.equal(r.first.error,undefined);assert.equal(r.second.skipped,true);}else{assert.ok(r.first.error);assert.ok(r.second.error);assert.equal(r.sameUntil,true);assert.ok(r.remaining> (scenario==='429'?299000:119000));}
 assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LF2 optional sync failure does not prevent the existing preference upload',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{
  let saved=0;const old=cloudApiRequest,oldCatalog=lastFmCloudRequest;
  cloudApiRequest=async(_token,options)=>{if(options.method==='PUT'){saved++;return {saved:12};}return {state:{}};};
  lastFmCloudRequest=async()=>{throw new Error('offline');};
  try{const result=await uploadCloudStateIfChanged('fake',{force:true});return {result,saved,status:cloudStatus.textContent};}finally{cloudApiRequest=old;lastFmCloudRequest=oldCatalog;}
 });assert.equal(r.saved,1);assert.equal(r.result.saved,12);assert.equal(r.result.catalog.error,'offline');assert.match(r.status,/baza Last.fm niezsynchronizowana/);
 }finally{await s.close();}
});
test('LF2 a stalled optional request times out once and never replays a write',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{
  const oldFetch=fetch,oldTimeout=AbortSignal.timeout;let calls=0,timeout;
  AbortSignal.timeout=ms=>{timeout=ms;const c=new AbortController();setTimeout(()=>c.abort(new DOMException('timeout','TimeoutError')),5);return c.signal;};
  fetch=async(_url,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));};
  try{let error;try{await lastFmCloudRequest('fake',{method:'PUT',body:'{}'});}catch(e){error=e.name;}return {calls,timeout,error};}finally{fetch=oldFetch;AbortSignal.timeout=oldTimeout;}
 });assert.deepEqual(r,{calls:1,timeout:10000,error:'TimeoutError'});
 }finally{await s.close();}
});
