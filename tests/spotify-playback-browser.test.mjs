import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let h;before(async()=>h=await startBrowserHarness());after(async()=>h.close());
const data={is_playing:true,progress_ms:10000,device:{id:'desktop',name:'PC',is_active:true,is_restricted:false,supports_volume:true,volume_percent:40},context:{uri:'spotify:playlist:omm'},item:{type:'track',id:'track',uri:'spotify:track:track',duration_ms:200000}};
async function setup(page){await page.evaluate(()=>{
 localStorage.setItem('spotify_access_token','old');localStorage.setItem('spotify_refresh_token','refresh-old');localStorage.setItem('spotify_token_expires',String(Date.now()+3600000));
 lastFmSpotifyAccount='owner';playbackSessionTag='login';playbackSessionVerified=true;playbackVerifiedAccess='old';playbackSessionNeedsCheck=false;spotifyPlaybackMonitor.wake('session');
});}
for(const scenario of ['valid','401','second-401','refresh-network','invalid-grant','403','429','204','episode'])test(`M Spotify adapter and existing OAuth: ${scenario}`,async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async({scenario,data})=>{
 let gets=0,refreshes=0;const urls=[],methods=[];const old=fetch;
 fetch=async(url,options)=>{
  if(String(url).includes('/api/token')){refreshes++;if(scenario==='refresh-network')throw new TypeError('private failure');if(scenario==='invalid-grant')return Response.json({error:'invalid_grant'},{status:400});return Response.json({access_token:'new',refresh_token:'refresh-new',expires_in:3600});}
  gets++;urls.push(String(url));methods.push(options.method || 'GET');
  if(['401','second-401','refresh-network','invalid-grant'].includes(scenario) && (gets===1 || scenario==='second-401'))return Response.json({error:{}},{status:401});
  if(['403','429'].includes(scenario))return Response.json({error:{}},{status:Number(scenario),headers:{'Retry-After':'20'}});
  if(scenario==='204')return new Response(null,{status:204});
  return Response.json(scenario==='episode'?{...data,item:{type:'episode',id:'ep',uri:'spotify:episode:ep',duration_ms:180000,show:{id:RMF_SHOW_ID}}}:data);
 };
 try{const result=await getSpotifyPlaybackState('stale');return {result,gets,refreshes,urls,methods,diagnostics:spotifyPlaybackMonitor.diagnostics(),text:document.getElementById('playbackMonitorStatus').textContent,refresh:localStorage.getItem('spotify_refresh_token')};}finally{fetch=old;}
 },{scenario,data});
 assert.equal(r.gets,['401','second-401'].includes(scenario)?2:1);assert.equal(r.refreshes,['401','second-401','refresh-network','invalid-grant'].includes(scenario)?1:0);
 assert.ok(r.urls.every(u=>u==='https://api.spotify.com/v1/me/player?additional_types=track,episode'));assert.ok(r.methods.every(m=>m==='GET'));
 if(['valid','401','episode'].includes(scenario)){assert.equal(r.result.available,true);assert.equal(r.result.deviceId,'desktop');assert.equal(r.result.snapshot.device.supportsVolume,true);assert.equal(r.result.snapshot.device.volumePercent,40);assert.equal(r.result.snapshot.item.type,scenario==='episode'?'episode':'track');}
 else assert.equal(r.result.available,false);
 if(scenario==='refresh-network')assert.equal(r.refresh,'refresh-old');if(scenario==='invalid-grant')assert.equal(r.refresh,null);
 assert.equal(r.diagnostics.armed,0);assert.doesNotMatch(JSON.stringify(r.diagnostics)+r.text,/refresh-old|refresh-new|private failure|spotify:track|desktop/);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('M default deployment has no polling, and two RMF playback reads share one request',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 const old=fetch;let gets=0;fetch=async()=>{gets++;await new Promise(r=>setTimeout(r,10));return Response.json(data);};
 try{await new Promise(r=>setTimeout(r,30));const before=gets;const [a,b]=await Promise.all([getSpotifyPlaybackState('old'),getSpotifyPlaybackState('old')]);await new Promise(r=>setTimeout(r,30));return {before,gets,same:a.snapshot===b.snapshot,diag:spotifyPlaybackMonitor.diagnostics()};}finally{fetch=old;}
 },data);assert.equal(r.before,0);assert.equal(r.gets,1);assert.equal(r.same,true);assert.equal(r.diag.armed,0);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M logout aborts pending fetch and late response cannot publish playback',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 const old=fetch;let finish,aborted=false;fetch=async(_url,options)=>{options.signal.addEventListener('abort',()=>aborted=true,{once:true});return new Promise(r=>finish=()=>r(Response.json(data)));};
 try{const pending=getSpotifyPlaybackState('old');while(!finish)await new Promise(r=>setTimeout(r,0));clearTokens();finish();const result=await pending;return {result,aborted,session:playbackSession(),diagnostics:spotifyPlaybackMonitor.diagnostics()};}finally{fetch=old;}
 },data);assert.equal(r.result.available,false);assert.equal(r.aborted,true);assert.equal(r.session,null);assert.equal(r.diagnostics.armed,0);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M retains manual RMF queue controls, two queue diagnostics and preferences/feedback',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 const date=warsawNowParts().dateKey,episode={id:'rmf-episode',uri:'spotify:episode:rmf-episode',name:'10:00 Fakty',release_date:date};
 const old=fetch;let player=0,queueReads=0,queueAdds=0;const before=JSON.stringify(durableLocalStateForCloud());
 fetch=async(url,options)=>{
  url=String(url);
  if(url.includes('/shows/'))return Response.json({items:[episode]});
  if(url.includes('/player/queue')){if(options.method==='POST'){queueAdds++;return new Response(null,{status:204});}queueReads++;return Response.json({currently_playing:data.item,queue:queueAdds?[episode]:[]});}
  if(url.includes('/me/player?')){player++;return Response.json(data);}
  throw new Error('Unexpected operation');
 };
 try{await manualRmfCheck(true);return {player,queueReads,queueAdds,unchanged:before===JSON.stringify(durableLocalStateForCloud()),status:rmfStatus.textContent,disabled:rmfQueueButton.disabled};}finally{fetch=old;}
 },data);assert.equal(r.player,1);assert.equal(r.queueReads,2);assert.equal(r.queueAdds,1);assert.equal(r.unchanged,true);assert.match(r.status,/dodane do kolejki/);assert.equal(r.disabled,false);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M missing infrastructure falls back to the existing RMF helper',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 spotifyPlaybackMonitor.dispose();spotifyPlaybackMonitor=null;const old=fetch;let url;fetch=async u=>{url=String(u);return Response.json(data);};
 try{return {result:await getSpotifyPlaybackState('old'),url};}finally{fetch=old;}
 },data);assert.equal(r.result.available,true);assert.equal(r.result.deviceId,'desktop');assert.equal(r.url,'https://api.spotify.com/v1/me/player');assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M token changed by another tab requires one shared identity check before playback',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 const old=fetch;let profiles=0,gets=0;
 fetch=async url=>{if(String(url).endsWith('/me')){profiles++;await new Promise(r=>setTimeout(r,10));return Response.json({id:'verified-owner',account_id:'verified-owner'});}gets++;return Response.json(data);};
 window.dispatchEvent(new StorageEvent('storage',{key:'spotify_access_token',newValue:'old',storageArea:localStorage}));
 try{const [a,b]=await Promise.all([getSpotifyPlaybackState('old'),getSpotifyPlaybackState('old')]);return {profiles,gets,available:a.available && b.available,account:a.snapshot.account,same:a.snapshot===b.snapshot};}finally{fetch=old;}
 },data);assert.deepEqual(r,{profiles:1,gets:1,available:true,account:'verified-owner',same:true});assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M account switch while identity check is pending cannot attribute playback to the old account',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 const old=fetch;let release,profiles=0,gets=0;
 fetch=async url=>{if(String(url).endsWith('/me')){profiles++;if(profiles===1)await new Promise(r=>release=r);return Response.json({id:profiles===1?'old-owner':'new-owner'});}gets++;return Response.json(data);};
 window.dispatchEvent(new StorageEvent('storage',{key:'spotify_access_token',newValue:'old',storageArea:localStorage}));
 try{const first=getSpotifyPlaybackState('old');while(!release)await new Promise(r=>setTimeout(r,0));localStorage.setItem('spotify_access_token','different');window.dispatchEvent(new StorageEvent('storage',{key:'spotify_access_token',newValue:'different',storageArea:localStorage}));release();const a=await first,b=await getSpotifyPlaybackState('different');return {first:a.available,second:b.available,account:b.snapshot.account,profiles,gets};}finally{fetch=old;}
 },data);assert.deepEqual(r,{first:false,second:true,account:'new-owner',profiles:2,gets:1});assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M guards identity even before a storage event is delivered',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async data=>{
 const old=fetch;let profiles=0,gets=0;fetch=async url=>{if(String(url).endsWith('/me')){profiles++;return Response.json({id:'new-owner'});}gets++;return Response.json(data);};
 localStorage.setItem('spotify_access_token','different');
 try{const unverified=playbackSession();const result=await getSpotifyPlaybackState('different');return {unverified,profiles,gets,account:result.snapshot.account};}finally{fetch=old;}
 },data);assert.deepEqual(r,{unverified:null,profiles:1,gets:1,account:'new-owner'});assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
async function fakeMonitor(page,mode,arm=true) {
 await page.evaluate(({mode,data,arm})=>{
  window.testTime=0;window.testJobs=new Map();window.testJobId=0;window.testGets=0;window.testSnapshots=[];
  const options={getSession:()=>({account:'shared',session:'tab-session'}),wall:()=>1760000000000+testTime,mono:()=>testTime,visible:()=>true,busy:()=>false,
   setTimer:(fn,ms)=>{testJobs.set(++testJobId,{fn,at:testTime+ms});return testJobId;},clearTimer:id=>testJobs.delete(id),
   request:async(_scope,_signal,attempt)=>{attempt();testGets++;return Response.json({...data,progress_ms:10000+testTime});}};
  if(mode!=='locks')options.locks=null;if(mode==='unavailable')options.indexedDB=null;if(mode==='lease-no-channel')options.channelFactory=()=>null;
  window.testMonitor=OfficeSpotifyPlayback.create(options);
  testMonitor.subscribe('consumer',(sample,meta)=>testSnapshots.push({sample,meta}),{active:arm});
  window.testArm=()=>testMonitor.subscribe('armed',()=>{},{active:true});
 },{mode,data,arm});
}
async function step(pages,ms) {
 await Promise.all(pages.map(p=>p.evaluate(ms=>testTime+=ms,ms)));
 await Promise.all(pages.map(p=>p.evaluate(async()=>{const jobs=[...testJobs].filter(([,j])=>j.at<=testTime);for(const [id,j] of jobs){testJobs.delete(id);j.fn();}await new Promise(r=>setTimeout(r,50));})));
}
const summary=page=>page.evaluate(()=>({gets:testGets,diag:testMonitor.diagnostics(),samples:testSnapshots}));
async function waitPair(a,b,ready){for(let i=0;i<150;i++){const states=await Promise.all([summary(a),summary(b)]);if(ready(states))return states;await new Promise(r=>setTimeout(r,20));}throw new Error('Playback coordination did not reach expected state');}
for(const mode of ['locks','lease','lease-no-channel','mixed'])test(`M one polling leader across two tabs, shared state and safe handover: ${mode}`,async()=>{
 const s=await h.page();try{
 const b=await s.page.context().newPage();const errors=[];b.on('pageerror',e=>errors.push(e.message));await b.goto(s.page.url());await b.waitForFunction(()=>window.ommStorageReady===true);
 await Promise.all([fakeMonitor(s.page,mode==='mixed'?'locks':mode,false),fakeMonitor(b,mode==='mixed'?'lease':mode,false)]);
 await Promise.all([s.page.evaluate(()=>testArm()),b.evaluate(()=>testArm())]);
 let [aState,bState]=await waitPair(s.page,b,states=>states.reduce((sum,s)=>sum+s.gets,0)===1 && states.every(s=>s.diag.coordination!=='idle') && (mode==='lease-no-channel' || states.every(s=>s.samples.length===1)));
 assert.equal(aState.gets+bState.gets,1);assert.equal(Number(aState.diag.leader)+Number(bState.diag.leader),1);
 if(mode!=='lease-no-channel'){assert.equal(aState.samples.length,1);assert.equal(bState.samples.length,1);assert.equal(aState.samples[0].sample.observationId,bState.samples[0].sample.observationId);}
 await step([s.page,b],5000);[aState,bState]=await waitPair(s.page,b,states=>states.reduce((sum,s)=>sum+s.gets,0)===2);assert.equal(aState.gets+bState.gets,2);
 const leader=aState.diag.leader?s.page:b,follower=aState.diag.leader?b:s.page;
 await leader.evaluate(()=>testMonitor.dispose());
 await leader.waitForFunction(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('omm_playback_coordination_v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('leases','readonly').objectStore('leases').get('omm-playback-leader:shared');r.onsuccess=()=>resolve(!r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});
 const before=(await summary(follower)).gets;
 await step([follower],5000);await follower.waitForFunction(()=>testMonitor.diagnostics().leader && testSnapshots.at(-1)?.meta.leader);const state=await summary(follower);assert.equal(state.gets,before+1);assert.equal(state.samples.at(-1).sample.continuity.continuous,false);assert.equal(state.samples.at(-1).meta.leader,true);
 await follower.evaluate(()=>testMonitor.dispose());assert.deepEqual(s.errors,[]);assert.deepEqual(errors,[]);
 }finally{await s.close();}
});
test('M IndexedDB lease survives abrupt leader close and expires before takeover',async()=>{
 const s=await h.page();try{const b=await s.page.context().newPage();await b.goto(s.page.url());await b.waitForFunction(()=>window.ommStorageReady===true);
 await fakeMonitor(s.page,'lease');await s.page.waitForFunction(()=>testGets===1);await fakeMonitor(b,'lease');await b.waitForFunction(()=>testMonitor.diagnostics().coordination==='lease');
 assert.equal((await summary(b)).gets,0);await s.page.close();await step([b],10000);assert.equal((await summary(b)).gets,0);await step([b],5001);await b.waitForFunction(()=>testGets===1);assert.equal((await summary(b)).samples.at(-1).sample.continuity.continuous,false);await b.evaluate(()=>testMonitor.dispose());
 }finally{await s.close();}
});
test('M unavailable coordination fails closed without a polling loop',async()=>{
 const s=await h.page();try{await fakeMonitor(s.page,'unavailable');await s.page.waitForFunction(()=>testMonitor.diagnostics().coordination==='unavailable');await step([s.page],60000);const r=await summary(s.page);assert.equal(r.gets,0);assert.equal(await s.page.evaluate(()=>testJobs.size),0);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('M lease never steals a valid owner after a backwards wall-clock jump',async()=>{
 const s=await h.page();try{const r=await s.page.evaluate(async()=>{
 const key='test-backwards';const one=await OfficeSpotifyPlayback.lease(indexedDB,key,'first',20000);const two=await OfficeSpotifyPlayback.lease(indexedDB,key,'second',0);await OfficeSpotifyPlayback.lease(indexedDB,key,'first',20000,true);return {one,two};
 });assert.deepEqual(r,{one:true,two:false});assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
