import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let h;before(async()=>h=await startBrowserHarness());after(async()=>h.close());
async function setup(page){await page.evaluate(()=>{
 localStorage.setItem('spotify_access_token','old');localStorage.setItem('spotify_refresh_token','refresh-old');localStorage.setItem('spotify_token_expires',String(Date.now()+3600000));
 mixerBox.style.display='block';lastFmSpotifyAccount='owner';playbackSessionTag='login';playbackSessionVerified=true;playbackVerifiedAccess='old';playbackSessionNeedsCheck=false;spotifyPlaybackMonitor.wake('session');
 window.vCalls=[];window.vCurrent={is_playing:true,progress_ms:10000,context:{uri:'spotify:show:'+RMF_SHOW_ID},device:{id:'PC',is_active:true,is_restricted:false,supports_volume:true,volume_percent:40},item:{type:'episode',id:'facts',uri:'spotify:episode:facts',duration_ms:180000,show:{id:RMF_SHOW_ID}}};
 window.vEpisode={id:'facts',uri:'spotify:episode:facts',name:'10:00 Fakty',release_date:'2026-10-11',show:{id:RMF_SHOW_ID}};
 window.vFetch=fetch;
 fetch=async(url,options={})=>{
   url=String(url);vCalls.push({url,method:options.method||'GET'});
   if(url.includes('/me/player/volume')){vCurrent.device.volume_percent=Number(new URL(url).searchParams.get('volume_percent'));return new Response(null,{status:204});}
   if(url.includes('/episodes/'))return Response.json(vEpisode);
   if(url.includes('/shows/'))return Response.json({items:[vEpisode]});
   if(url.includes('/me/player?'))return Response.json(vCurrent);
   throw new Error('Unexpected mocked API');
 };
});}
test('V real Chromium defaults off and renders accessible settings, persisted gain never arms',async()=>{
 const s=await h.page('/',{office_rmf_volume_settings_v1:JSON.stringify({gain:20,enabled:true})});try{
 assert.equal(await s.page.locator('#rmfVolumeEnabled').isChecked(),false);assert.equal(await s.page.locator('#rmfVolumeGain').inputValue(),'20');
 const r=await s.page.evaluate(()=>({requests:spotifyPlaybackMonitor.diagnostics().requests,armed:spotifyPlaybackMonitor.diagnostics().armed,volume:rmfVolumeController.diagnostics(),cloud:cloudStateKeys().includes('office_rmf_volume_settings_v1')}));
 assert.equal(r.requests,0);assert.equal(r.armed,0);assert.equal(r.volume.writes,0);assert.equal(r.cloud,false);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('V actual UI, shared monitor and volume adapter: music → Facts → music',async()=>{
 const s=await h.page();try{await setup(s.page);await s.page.locator('#rmfVolumeEnabled').check();
 await s.page.waitForFunction(()=>rmfVolumeController.diagnostics().status==='boosted');
 await s.page.evaluate(async()=>{vCurrent.item={type:'track',id:'music',uri:'spotify:track:music',duration_ms:200000};await spotifyPlaybackMonitor.read({fresh:true});});
 await s.page.waitForFunction(()=>rmfVolumeController.diagnostics().phase===null);
 const r=await s.page.evaluate(()=>({calls:vCalls,volume:vCurrent.device.volume_percent,status:rmfVolumeController.diagnostics(),queue:loadRmfQueued()}));
 assert.equal(r.volume,40);assert.deepEqual(r.calls.filter(c=>c.method==='PUT').map(c=>new URL(c.url).searchParams.get('volume_percent')),['44','40']);
 assert.ok(r.calls.filter(c=>c.method==='PUT').every(c=>new URL(c.url).searchParams.get('device_id')==='PC'));assert.equal(r.calls.filter(c=>c.url.includes('/episodes/')).length,1);assert.ok(!r.calls.some(c=>c.url.includes('/queue')||c.url.includes('/playlists')));assert.deepEqual(r.queue,{});assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
for(const reason of ['disable','manual','device','hidden'])test(`V Chromium ${reason} during Facts`,async()=>{
 const s=await h.page();try{await setup(s.page);await s.page.evaluate(()=>rmfVolumeController.remember([vEpisode]));await s.page.locator('#rmfVolumeEnabled').check();await s.page.waitForFunction(()=>rmfVolumeController.diagnostics().status==='boosted');
 if(reason==='disable')await s.page.locator('#rmfVolumeEnabled').uncheck();
 else if(reason==='hidden')await s.page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 else await s.page.evaluate(async reason=>{if(reason==='manual')vCurrent.device.volume_percent=55;else vCurrent.device.id='OTHER';await spotifyPlaybackMonitor.read({fresh:true});},reason);
 await s.page.waitForFunction(reason=>reason==='device'?rmfVolumeController.diagnostics().status==='recovery':reason==='manual'?rmfVolumeController.diagnostics().status==='manual':rmfVolumeController.diagnostics().enabled===false && rmfVolumeController.diagnostics().phase===null,reason);
 const r=await s.page.evaluate(()=>({puts:vCalls.filter(c=>c.method==='PUT'),volume:vCurrent.device.volume_percent}));
 assert.equal(r.puts.length,['disable','hidden'].includes(reason)?2:1);assert.equal(r.volume,reason==='manual'?55:reason==='device'?44:40);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
for(const scenario of ['401','401-again','network','403','429'])test(`V absolute PUT adapter ${scenario}: OAuth retry only authentication refusal`,async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async scenario=>{
 let puts=0,refreshes=0,auth=[];fetch=async(url,opts)=>{
  if(String(url).includes('/api/token')){refreshes++;return Response.json({access_token:'new',refresh_token:'refresh-new',expires_in:3600});}
  puts++;auth.push(opts.headers.Authorization);if(scenario==='network')throw new TypeError('private-body');
  if(scenario.startsWith('401')&&(puts===1||scenario==='401-again'))return Response.json({}, {status:401});
  if(['403','429'].includes(scenario))return Response.json({}, {status:Number(scenario),headers:{'Retry-After':'90'}});
  return new Response(null,{status:204});
 };
 let error=0,retry=0;try{await requestRmfVolumeApi('https://api.spotify.com/v1/me/player/volume?volume_percent=44&device_id=PC','PUT',playbackSession(),new AbortController().signal);}catch(e){error=e.code||503;retry=e.retryAt?e.retryAt-Date.now():0;}
 return {puts,refreshes,refreshed:auth[1]==='Bearer new',error,retry,session:!!playbackSession(),persisted:!!localStorage.getItem('spotify_refresh_token')};
 },scenario);
 assert.equal(r.puts,scenario.startsWith('401')?2:1);assert.equal(r.refreshes,scenario.startsWith('401')?1:0);assert.equal(r.error,scenario==='401'?0:scenario==='401-again'?401:scenario==='network'?503:Number(scenario));if(scenario==='429')assert.ok(r.retry>89000);assert.equal(r.persisted,true);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('V real IndexedDB atomically excludes second card and survives reload, no token storage',async()=>{
 const s=await h.page();try{const r=await s.page.evaluate(async()=>{
  const a=OfficeRmfVolume.createStore(),b=OfficeRmfVolume.createStore();const base={version:1,account:'owner',session:'login',device:'PC',episode:'facts',baseline:40,target:44,phase:'applying',at:Date.now()};
  const claimed=await Promise.all([a('claim',{...base,owner:'one',revision:'one'}),b('claim',{...base,owner:'two',revision:'two'})]);return {claimed,row:await a('get',{account:'owner'})};
 });assert.equal(r.claimed.filter(Boolean).length,1);assert.equal(r.row.baseline,40);assert.ok(!JSON.stringify(r.row).includes('token'));
 await s.page.reload();await s.page.waitForFunction(()=>window.ommStorageReady!==false);const row=await s.page.evaluate(()=>OfficeRmfVolume.createStore()('get',{account:'owner'}));assert.equal(row.revision,r.row.revision);assert.equal(await s.page.locator('#rmfVolumeEnabled').isChecked(),false);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('V catalog registration uses existing RMF fetch without extra lookup or queue operation',async()=>{
 const s=await h.page();try{await setup(s.page);await s.page.evaluate(()=>fetchRmfEpisodes('old'));await s.page.locator('#rmfVolumeEnabled').check();await s.page.waitForFunction(()=>rmfVolumeController.diagnostics().status==='boosted');const r=await s.page.evaluate(()=>({lookups:rmfVolumeController.diagnostics().lookups,shows:vCalls.filter(c=>c.url.includes('/shows/')).length,queue:vCalls.filter(c=>c.url.includes('/queue')).length}));assert.deepEqual(r,{lookups:0,shows:1,queue:0});assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('V two actual cards share exclusive persistent intent, second cannot compound',async()=>{
 const s=await h.page();let second;try{second=await s.page.context().newPage();await second.goto(s.page.url());await second.waitForFunction(()=>window.ommStorageReady!==false);
 const claim=async(page,owner)=>page.evaluate(async owner=>OfficeRmfVolume.createStore()('claim',{version:1,account:'owner',session:'login',owner,device:'PC',episode:'facts',baseline:40,target:44,phase:'applying',at:Date.now(),revision:owner}),owner);
 const results=await Promise.all([claim(s.page,'one'),claim(second,'two')]);assert.equal(results.filter(Boolean).length,1);
 await setup(second);await second.locator('#rmfVolumeEnabled').click();await second.waitForFunction(()=>rmfVolumeController.diagnostics().status==='recovery');const r=await second.evaluate(()=>({enabled:rmfVolumeController.diagnostics().enabled,calls:vCalls}));assert.equal(r.enabled,false);assert.deepEqual(r.calls,[]);assert.deepEqual(s.errors,[]);
 }finally{await second?.close();await s.close();}
});
test('V generator lock is set before awaiting volume cleanup, duplicate click does not start a second run',async()=>{
 const s=await h.page();try{const r=await s.page.evaluate(async()=>{
 let release,cleanup=0;const original=rmfVolumeController;rmfVolumeController={suspend:async()=>{cleanup++;await new Promise(r=>release=r);}};
 const getToken=getValidAccessToken;getValidAccessToken=async()=>null;
 try{const first=generateOfficePlaylist();while(!release)await new Promise(r=>setTimeout(r,0));await generateOfficePlaylist();const locked=generationInFlight;release();await first;return {cleanup,locked,unlocked:!generationInFlight};}
 finally{rmfVolumeController=original;getValidAccessToken=getToken;}
 });assert.deepEqual(r,{cleanup:1,locked:true,unlocked:true});assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('V.1 recovery button with no intent clearly allows new test, without player GET',async()=>{
 const s=await h.page();try{await setup(s.page);await s.page.locator('#rmfVolumeRecovery').click();await s.page.waitForFunction(()=>document.getElementById('rmfVolumeStatus').textContent.includes('Nie ma zapisanego poziomu'));assert.match(await s.page.locator('#rmfVolumeStatus').textContent(),/Nie ma zapisanego poziomu/);assert.deepEqual(await s.page.evaluate(()=>vCalls),[]);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('V.1 real shared monitor confirms delayed Spotify readback, never resends boost',async()=>{
 const s=await h.page();try{await setup(s.page);await s.page.evaluate(()=>{
   rmfVolumeController.remember([vEpisode]);const original=fetch;let stale=0;
   fetch=async(url,options={})=>{
     if(String(url).includes('/player/volume')){const response=await original(url,options);stale=1;return response;}
     if(String(url).includes('/me/player?')&&stale-- >0){vCalls.push({url:String(url),method:'GET'});return Response.json({...vCurrent,device:{...vCurrent.device,volume_percent:40}});}
     return original(url,options);
   };
 });await s.page.locator('#rmfVolumeEnabled').check();await s.page.waitForFunction(()=>rmfVolumeController.diagnostics().status==='boosted');const r=await s.page.evaluate(()=>({puts:vCalls.filter(c=>c.method==='PUT').length,confirmations:rmfVolumeController.diagnostics().confirmationReads,enabled:rmfVolumeController.diagnostics().enabled}));assert.deepEqual(r,{puts:1,confirmations:2,enabled:true});assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
