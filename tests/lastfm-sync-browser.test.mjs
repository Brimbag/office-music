import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let h; before(async()=>h=await startBrowserHarness());after(async()=>h.close());
for (const scenario of ['healthy','missing','spotify-error','lastfm-error']) test(`LF3 paired history path: ${scenario}, reuse and safe failures`,async()=>{
 const s=await h.page();
 try {
 const r=await s.page.evaluate(async scenario=>{
  lastFmSpotifyAccount='sp';lastFmUserInput.value='lf';localStorage.setItem(LASTFM_USER_KEY,'lf');
  let sp=0,lf=0;const oldSp=spotifyGenerationRequest,oldLf=lastFmRequest;
  const plays=Array.from({length:6},(_,i)=>({track:{id:`id${i}`,type:'track',name:`Song ${i}`,duration_ms:240000,artists:[{id:'artist',name:'Artist'}]},played_at:new Date(Date.now()-(120-i*10)*60000).toISOString()}));
  spotifyGenerationRequest=async()=>{sp++;if(scenario==='spotify-error')throw new Error('offline');return {ok:true,json:async()=>({items:plays})};};
  lastFmRequest=async()=>{lf++;if(scenario==='lastfm-error')throw new Error('offline');return {recenttracks:{'@attr':{totalPages:'1'},track:scenario==='healthy'?plays.map(p=>({name:p.track.name,artist:{'#text':'Artist'},date:{uts:String(Math.floor(Date.parse(p.played_at)/1000))}})):[]}};};
  try {
   await Promise.all([checkLastFmSync('fake'),checkLastFmSync('fake')]);
   const first=document.getElementById('lastFmSyncStatus').dataset.syncState;
   const before=JSON.stringify(buildHistoryBlocklists().blockedTrackSignatures.size);
   if(scenario==='missing')document.getElementById('lastFmSyncDismiss').click();
   await checkLastFmSync('fake');renderLastFmSync();
   return {sp,lf,first,dismissed:syncMonitorRead(LASTFM_SYNC_NOTICE_KEY)?.dismissed||false,notice:document.getElementById('lastFmSyncStatus').textContent,unchanged:before===JSON.stringify(buildHistoryBlocklists().blockedTrackSignatures.size),keys:loadHistory().map(r=>r.sourceAccount)};
  }finally{spotifyGenerationRequest=oldSp;lastFmRequest=oldLf;}
 },scenario);
 assert.equal(r.first,scenario==='healthy'?'healthy':scenario==='missing'?'suspected_issue':'api_error');
 assert.equal(r.sp,1);assert.equal(r.lf,1);assert.equal(r.unchanged,true);
 if(scenario==='missing'){assert.equal(r.dismissed,true);assert.match(r.notice,/zamknięte/);}
 assert.ok(r.keys.every(k=>['sp','lf'].includes(k)));assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LF3 raw Last.fm request deduplication shares one fetch',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{let calls=0;const old=fetch;fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return new Response(JSON.stringify({recenttracks:{track:[],'@attr':{totalPages:'0'}}}));};try{await Promise.all([lastFmRequest('user.getRecentTracks',{user:'lf'}),lastFmRequest('user.getRecentTracks',{user:'lf'})]);return calls;}finally{fetch=old;}});
 assert.equal(r,1);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LF3 account switch during Spotify request discards the stale result',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{lastFmSpotifyAccount='old';const old=spotifyGenerationRequest;spotifyGenerationRequest=async()=>{lastFmSpotifyAccount='new';return {ok:true,json:async()=>({items:[{track:{id:'t',name:'Song',artists:[]},played_at:new Date().toISOString()}]})};};try{await syncSpotifyRecentHistory('fake',true);return {history:loadHistory().length,observation:syncMonitorRead(SPOTIFY_HISTORY_OBSERVATION_KEY)};}finally{spotifyGenerationRequest=old;}});
 assert.equal(r.history,0);assert.equal(r.observation,null);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LF3 background check preserves active generation tag budget and counters',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{lastFmSpotifyAccount='sp';lastFmUserInput.value='lf';localStorage.setItem(LASTFM_USER_KEY,'lf');lastFmCallsThisSync=7;lastFmTagCallBudgetThisSync=8;const oldSp=spotifyGenerationRequest,oldLf=lastFmRequest;spotifyGenerationRequest=async()=>({ok:true,json:async()=>({items:[]})});lastFmRequest=async()=>({recenttracks:{track:[],'@attr':{totalPages:'0'}}});try{await checkLastFmSync('fake');return [lastFmCallsThisSync,lastFmTagCallBudgetThisSync];}finally{spotifyGenerationRequest=oldSp;lastFmRequest=oldLf;}});
 assert.deepEqual(r,[7,8]);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LF3 fresh legacy history keeps its TTL without assigning ownership or fetching again',async()=>{
 const s=await h.page();try{
 const r=await s.page.evaluate(async()=>{lastFmSpotifyAccount='sp';localStorage.setItem(RECENT_HISTORY_SYNC_KEY,String(Date.now()));let calls=0;const old=spotifyGenerationRequest;spotifyGenerationRequest=async()=>{calls++;throw new Error('unexpected request');};try{const n=await syncSpotifyRecentHistory('fake');return {calls,n,observation:syncMonitorRead(SPOTIFY_HISTORY_OBSERVATION_KEY)};}finally{spotifyGenerationRequest=old;}});
 assert.equal(r.calls,0);assert.equal(r.n,0);assert.equal(r.observation,null);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
