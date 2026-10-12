import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let h;before(async()=>h=await startBrowserHarness());after(async()=>h.close());
async function setup(page){await page.evaluate(()=>{
 localStorage.setItem('spotify_access_token','old');localStorage.setItem('spotify_refresh_token','refresh-old');localStorage.setItem('spotify_token_expires',String(Date.now()+3600000));
 lastFmSpotifyAccount='public-owner';autoFeedbackAccount='owner';playbackSessionTag='login';playbackSessionVerified=true;playbackVerifiedAccess='old';playbackSessionNeedsCheck=false;spotifyPlaybackMonitor.wake('session');mixerBox.style.display='block';document.getElementById('generatorTools').open=true;
 window.s1Playlist={id:'omm',uri:'spotify:playlist:omm',name:'Office Music Mixer',tracks:['A','B','C'].map(id=>({id,uri:`spotify:track:${id}`,name:'Track '+id,artists:[{name:'Artist '+id}]}))};
 localStorage.setItem(RECENT_PLAYLISTS_KEY,JSON.stringify([s1Playlist]));refreshSkipPlaylistChoices();refreshAutoSkip();
 window.s1Calls=[];window.s1State={id:'A',type:'track',base:10000,started:performance.now(),context:'spotify:playlist:omm',device:'PC',volume:40,playing:true};
 window.s1Set=(id,type='track',base=0)=>Object.assign(s1State,{id,type,base,started:performance.now(),context:type==='track'?'spotify:playlist:omm':'spotify:show:'+RMF_SHOW_ID});
 fetch=async(url,opts={})=>{
  url=String(url);s1Calls.push({url,method:opts.method||'GET'});
  if(url.includes('/me/player/volume')){s1State.volume=Number(new URL(url).searchParams.get('volume_percent'));return new Response(null,{status:204});}
  if(url.includes('/me/player?'))return Response.json({is_playing:s1State.playing,progress_ms:Math.round(s1State.base+performance.now()-s1State.started),device:{id:s1State.device,is_active:true,is_restricted:false,supports_volume:true,volume_percent:s1State.volume},context:{uri:s1State.context},item:{id:s1State.id,type:s1State.type,uri:`spotify:${s1State.type}:${s1State.id}`,duration_ms:200000,...s1State.type==='episode'?{show:{id:RMF_SHOW_ID}}:{name:'Track '+s1State.id,artists:[{name:'Artist '+s1State.id}]}}});
  throw new Error('Unexpected mocked API');
 };
});}
async function start(page){await page.locator('#skipJournalPanel').evaluate(el=>el.open=true);await page.locator('#skipJournalEnabled').check();await page.waitForFunction(()=>skipJournalController.diagnostics().reason==='stabilizing');}
async function transition(page){const previous=await page.evaluate(()=>skipJournalController.diagnostics().recorded);await page.waitForTimeout(1100);await page.evaluate(()=>spotifyPlaybackMonitor.read({fresh:true}));await page.waitForFunction(()=>skipJournalController.diagnostics().reason==='observing');await page.evaluate(async()=>{s1Set('B');await spotifyPlaybackMonitor.read({fresh:true});});await page.waitForFunction(previous=>skipJournalController.diagnostics().recorded===previous+1,previous);}
async function enable(page){await page.locator('#skipJournalPanel').evaluate(el=>el.open=true);await page.locator('#autoSkipEnabled').check();await page.waitForFunction(()=>autoTrackFeedback.enabled());}
test('S2 ignores all earlier S1 tests; opt-in stops old observation and only a new live skip is rated',async()=>{const s=await h.page();try{await setup(s.page);await start(s.page);await transition(s.page);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),false);await enable(s.page);assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.score('A')),0);await s.page.evaluate(()=>s1Set('A','track',10000));await start(s.page);await transition(s.page);await s.page.waitForFunction(()=>Object.keys(autoTrackFeedback.state('owner').events).length===1);const r=await s.page.evaluate(()=>({score:autoTrackFeedback.score('A'),events:autoTrackFeedback.state('owner'),manual:loadFeedback(),artist:feedbackArtistStats().size,calls:s1Calls,oldCount:skipJournalController.diagnostics().recorded}));assert.ok(r.score<=-99&&r.score>=-100);assert.equal(r.events.account,'owner');assert.equal(r.oldCount,2);assert.deepEqual(r.manual,{});assert.equal(r.artist,0);assert.ok(r.calls.every(c=>c.method==='GET'&&c.url.includes('/me/player?')));assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 exact Track ID, no artist exclusion; manual down unchanged and up resets without resurrection',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{
 const now=Date.now(),track=s1Playlist.tracks[0],sameName={...track,id:'OTHER',uri:'spotify:track:OTHER'};
 const e={version:1,account:'owner',id:'live',trackId:'A',playlistId:'omm',at:now,durationMs:200000,fromMs:10000,toMs:15000,kind:'early'};
 await autoTrackFeedback.record(e);const automatic={own:feedbackScore(track),other:feedbackScore(sameName),artist:hasStrongNegativeArtistFeedback(track),blocked:trackHasArtistExclusion(track)};
 await setTrackFeedback(track,-1);const down=feedbackScore(track);await setTrackFeedback(track,1);const up=feedbackScore(track);await setTrackFeedback(track,1);const cleared=feedbackScore(track);return {automatic,down,up,cleared,events:autoTrackFeedback.state('owner')};
 });assert.ok(r.automatic.own<=-99&&r.automatic.own>=-100);assert.equal(r.automatic.other,0);assert.equal(r.automatic.artist,false);assert.equal(r.automatic.blocked,false);assert.equal(r.down,-375);assert.equal(r.up,108);assert.equal(r.cleared,0);assert.deepEqual(r.events.events,{});assert.ok(r.events.resets.A);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 local data and opt-in survive reload/export; disabled penalties do not affect manual ratings',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);await start(s.page);await transition(s.page);await s.page.waitForFunction(()=>autoTrackFeedback.has('owner'));const raw=await s.page.evaluate(()=>localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner')));await s.page.reload();await s.page.waitForFunction(()=>window.ommStorageReady!==false);await setup(s.page);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),true);assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);assert.equal(await s.page.evaluate(()=>localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner'))),raw);assert.equal(await s.page.evaluate(()=>exportedStorageState()[OfficeAutoTrackFeedback.localKey('owner')]),raw);await s.page.locator('#skipJournalPanel').evaluate(el=>el.open=true);await s.page.locator('#autoSkipEnabled').uncheck();await s.page.waitForFunction(()=>!autoTrackFeedback.enabled());assert.equal(await s.page.evaluate(()=>feedbackScore(s1Playlist.tracks[0])),0);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),true);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 cloud 409 re-reads and unions concurrent scores/reset, never backfills S1',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{
 const A=OfficeAutoTrackFeedback,now=Date.now();let remote=A.empty('owner'),attempt=0,gets=0;remote.events.remote={trackId:'B',kind:'middle',weight:50,at:now-1000};
 await autoTrackFeedback.record({version:1,account:'owner',id:'local',trackId:'A',playlistId:'omm',at:now,durationMs:200000,fromMs:10000,toMs:15000,kind:'early'});
 fetch=async(url,options)=>{if(url!=='/api/auto-feedback')throw new Error('Unexpected endpoint');if(options.method==='GET'){gets++;return Response.json({state:remote,base:JSON.stringify(remote)});}const body=JSON.parse(options.body);attempt++;if(attempt===1){remote=A.reset(remote,'A',Date.now());return Response.json({error:'conflict'},{status:409});}remote=A.merge(remote,body.state,'owner');return Response.json({state:remote});};
 await syncAutoTrackFeedback('old',{force:true});return {attempt,gets,state:autoTrackFeedback.state('owner'),scoreA:autoTrackFeedback.score('A'),scoreB:autoTrackFeedback.score('B')};
 });assert.equal(r.attempt,2);assert.equal(r.gets,2);assert.equal(r.scoreA,0);assert.ok(r.scoreB<=-49&&r.scoreB>=-50);assert.deepEqual(Object.keys(r.state.events),['remote']);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 quota failure preserves data; invalid/future local schema cannot crash selection',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{const key=OfficeAutoTrackFeedback.localKey('owner');localStorage.setItem(key,'{"version":2}');const score=feedbackScore(s1Playlist.tracks[0]);let failed=false;try{await autoTrackFeedback.reset('A');}catch{failed=true;}return {score,failed,raw:localStorage.getItem(key),status:document.getElementById('autoSkipStatus').textContent};});assert.equal(r.score,0);assert.equal(r.failed,true);assert.equal(r.raw,'{"version":2}');assert.match(r.status,/dane zachowano/);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 missing immutable account_id never falls back to mutable public id',async()=>{const s=await h.page();try{await setup(s.page);await s.page.evaluate(()=>autoFeedbackAccount='');await s.page.locator('#skipJournalPanel').evaluate(el=>el.open=true);await s.page.locator('#autoSkipEnabled').click();await s.page.waitForFunction(()=>!document.getElementById('autoSkipEnabled').disabled);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),false);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('public-owner')),false);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
for(const people of [2,4])test(`S2 ${people} profiles: unchanged individual minimum, weaker group ranking and safe length/fallback`,async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async people=>{
 const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,artists:[],genres:[],taste:{}})),track=s1Playlist.tracks[0];
 const make=()=>{const ctx=buildGroupRecommendationContext(selected),item=groupCandidateStatic(track,ctx);item.features.discovery=false;return {ctx,item};};
 const before=make();await autoTrackFeedback.record({version:1,account:'owner',id:'live',trackId:'A',playlistId:'omm',at:Date.now(),durationMs:200000,fromMs:10000,toMs:15000,kind:'early'});const after=make();
 const delta=after.item.groupBase-before.item.groupBase;const equalScores=JSON.stringify(before.item.byUser)===JSON.stringify(after.item.byUser);
 function result(base){const {ctx,item}=make();for(const p of selected)item.byUser[p.id].score=40;item.minScore=40;item.maxScore=40;item.groupBase=base;item.features.feedback=0;const stats=newRejectionStats(1);return {length:selectGroupPlaylist([item],1,ctx,stats).tracks.length,stats};}
 return {delta,equalScores,baseline:result(60),safe:result(60+delta),boundaryBefore:result(36),boundaryAfter:result(36+delta)};
 },people);assert.ok(r.delta>-8.1&&r.delta<-7.9);assert.equal(r.equalScores,true);assert.equal(r.baseline.length,1);assert.equal(r.safe.length,1);assert.equal(r.boundaryBefore.length,1);assert.equal(r.boundaryAfter.length,0);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 concurrent local clients preserve both events through the existing atomic edit fence',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{const A=OfficeAutoTrackFeedback,second=A.create({getAccount:getAutoFeedbackAccount,edit:(...args)=>OmmLocalState.edit(...args)}),e={version:1,account:'owner',id:'one',trackId:'A',playlistId:'omm',at:Date.now(),durationMs:200000,fromMs:10000,toMs:15000,kind:'early'};await Promise.all([autoTrackFeedback.record(e),second.record({...e,id:'two',kind:'middle',fromMs:60000,toMs:65000})]);return {ids:Object.keys(autoTrackFeedback.state('owner').events).sort(),score:autoTrackFeedback.score('A')};});assert.deepEqual(r.ids,['one','two']);assert.ok(r.score<=-149&&r.score>=-150);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 account change during cloud request discards reply without mixing data',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{fetch=async()=>{autoFeedbackAccount='other';return Response.json({state:OfficeAutoTrackFeedback.empty('owner'),base:null});};let failed=false;try{await syncAutoTrackFeedback('old',{force:true});}catch{failed=true;}return {failed,old:autoTrackFeedback.has('owner'),other:autoTrackFeedback.has('other')};});assert.deepEqual(r,{failed:true,old:false,other:false});assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 cloud network/429 fail without replay or deleting local/manual preferences',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{const e={version:1,account:'owner',id:'one',trackId:'A',playlistId:'omm',at:Date.now(),durationMs:200000,fromMs:10000,toMs:15000,kind:'early'};await autoTrackFeedback.record(e);const before=localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner'));let n=0,failures=0;fetch=async()=>{n++;throw new TypeError('offline private-marker');};try{await syncAutoTrackFeedback('old',{force:true});}catch{failures++;}fetch=async()=>{n++;return Response.json({error:'429 private-marker'},{status:429});};try{await syncAutoTrackFeedback('old',{force:true});}catch{failures++;}return {before,after:localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner')),n,failures};});assert.equal(r.before,r.after);assert.equal(r.n,2);assert.equal(r.failures,2);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 import validates schema/account before replacing any preference',async()=>{const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(()=>{const A=OfficeAutoTrackFeedback,before=JSON.stringify({...localStorage});let rejected=0;for(const raw of ['{"version":2}',JSON.stringify(A.empty('other'))])try{OmmLocalState.validate({format:'office-music-state',version:1,storage:{[A.localKey('owner')]:raw}});}catch{rejected++;}return {rejected,before,after:JSON.stringify({...localStorage})};});assert.equal(r.rejected,2);assert.equal(r.before,r.after);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
for(const people of [2,4])test(`S2 ${people} profiles: cap −250 is not a hidden −40 fallback/artist ban`,async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async people=>{const track=s1Playlist.tracks[0],now=Date.now();for(let i=0;i<4;i++)await autoTrackFeedback.record({version:1,account:'owner',id:'repeat'+i,trackId:'A',playlistId:'omm',at:now,durationMs:200000,fromMs:10000,toMs:15000,kind:'early'});const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,artists:[],taste:{}})),ctx=buildGroupRecommendationContext(selected),item=groupCandidateStatic(track,ctx);for(const p of selected)item.byUser[p.id].score=50;item.minScore=50;item.maxScore=50;item.groupBase=40;item.features.discovery=false;const stats=newRejectionStats(1);return {manual:item.features.feedback,auto:item.features.autoFeedback,length:selectGroupPlaylist([item],1,ctx,stats).tracks.length,fallback:stats.fallbackSelections,artist:hasStrongNegativeArtistFeedback(track)};},people);assert.equal(r.manual,0);assert.ok(r.auto<-249);assert.equal(r.length,1);assert.equal(r.fallback,1);assert.equal(r.artist,false);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 late failed write from stopped observation cannot stop a newly armed session',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);await s.page.evaluate(()=>{autoTrackFeedback=OfficeAutoTrackFeedback.create({getAccount:getAutoFeedbackAccount,edit:()=>new Promise((resolve,reject)=>window.rejectOldAutoWrite=()=>reject(new Error('quota')))});});await start(s.page);await transition(s.page);await s.page.waitForFunction(()=>Boolean(window.rejectOldAutoWrite));await s.page.locator('#skipJournalEnabled').uncheck();await s.page.evaluate(()=>s1Set('A','track',10000));await start(s.page);await s.page.evaluate(()=>rejectOldAutoWrite());await s.page.waitForTimeout(100);assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),true);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),false);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 optional autosync honors Retry-After, preserves data and redacts raw API errors',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{let calls=0;fetch=async()=>{calls++;return Response.json({error:'private-marker'},{status:429,headers:{'Retry-After':'60'}});};await syncAutoTrackFeedbackSafely('old',{force:true});await syncAutoTrackFeedbackSafely('old',{force:true});return {calls,backoff:autoFeedbackSyncBackoff.until-Date.now(),status:document.getElementById('autoSkipStatus').textContent};});assert.equal(r.calls,1);assert.ok(r.backoff>58000&&r.backoff<=60000);assert.doesNotMatch(r.status,/private-marker/);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S2 retrying failed up-reset cannot toggle off manual protection and revive auto penalty',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);const r=await s.page.evaluate(async()=>{await autoTrackFeedback.record({version:1,account:'owner',id:'one',trackId:'A',playlistId:'omm',at:Date.now(),durationMs:200000,fromMs:10000,toMs:15000,kind:'early'});const real=autoTrackFeedback;autoTrackFeedback={...real,reset:async()=>{throw new Error('quota');}};await setTrackFeedback(s1Playlist.tracks[0],1);const first=trackFeedbackValue(s1Playlist.tracks[0]);await setTrackFeedback(s1Playlist.tracks[0],1);const retry=trackFeedbackValue(s1Playlist.tracks[0]);return {first,retry,score:feedbackScore(s1Playlist.tracks[0]),status:document.getElementById('autoSkipStatus').textContent};});assert.equal(r.first,1);assert.equal(r.retry,1);assert.equal(r.score,108);assert.match(r.status,/Nie zdjęto/);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S3 unknown playlist is observed but never auto-rated, even with S2 enabled',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);await s.page.evaluate(()=>s1State.context='spotify:playlist:external');await start(s.page);await s.page.waitForTimeout(1100);await s.page.evaluate(()=>spotifyPlaybackMonitor.read({fresh:true}));await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='observing');await s.page.evaluate(async()=>{s1Set('B');s1State.context='spotify:playlist:external';await spotifyPlaybackMonitor.read({fresh:true});});await s.page.waitForFunction(()=>skipJournalController.diagnostics().recorded===1);const r=await s.page.evaluate(async()=>({events:await skipJournalController.events(),auto:autoTrackFeedback.has('owner')}));assert.equal(r.events[0].playlistId,'external');assert.equal(r.auto,false);assert.deepEqual(s.errors,[]);}finally{await s.close();}});
test('S3 OMM context with next queued track outside its snapshot is diagnostic only',async()=>{const s=await h.page();try{await setup(s.page);await enable(s.page);await start(s.page);await s.page.waitForTimeout(1100);await s.page.evaluate(()=>spotifyPlaybackMonitor.read({fresh:true}));await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='observing');await s.page.evaluate(async()=>{s1Set('outside');await spotifyPlaybackMonitor.read({fresh:true});});await s.page.waitForFunction(()=>skipJournalController.diagnostics().recorded===1);await s.page.waitForTimeout(100);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),false);assert.deepEqual(s.errors,[]);}finally{await s.close();}});

// Stable defaults are initialized only by a verified profile, not the test's manual session fixture.
test('stable defaults: verified session starts shared observation and only a new OMM skip is rated',async()=>{
 const s=await h.page();try{
  await setup(s.page);await s.page.evaluate(()=>refreshSkipDefaults());
  await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='stabilizing');
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),true);
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),false);
  await transition(s.page);await s.page.waitForFunction(()=>autoTrackFeedback.has('owner'));
  const r=await s.page.evaluate(()=>({count:Object.keys(autoTrackFeedback.state('owner').events).length,score:autoTrackFeedback.score('A'),calls:s1Calls,armed:spotifyPlaybackMonitor.diagnostics().armed}));
  assert.equal(r.count,1);assert.ok(r.score<=-99&&r.score>=-100);assert.equal(r.armed,1);
  assert.ok(r.calls.every(c=>c.method==='GET'&&c.url.includes('/me/player?')));assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('stable defaults preserve explicit off, initialize per account, and never enable without a verified session',async()=>{
 const s=await h.page();try{
  await s.page.evaluate(()=>refreshSkipDefaults());assert.equal(await s.page.evaluate(()=>spotifyPlaybackMonitor.diagnostics().armed),0);
  await setup(s.page);await s.page.evaluate(async()=>{
   await OmmLocalState.edit(OfficeAutoTrackFeedback.enabledKey('owner'),null,'0');
   await OmmLocalState.edit('office_skip_observation_enabled_v1:public-owner',null,'0');
   await refreshSkipDefaults();
  });
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),false);assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);
  await s.page.evaluate(async()=>{lastFmSpotifyAccount='other-public';autoFeedbackAccount='other';playbackSessionTag='other-login';await refreshSkipDefaults();});
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),true);assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),true);
  assert.equal(await s.page.evaluate(()=>localStorage.getItem(OfficeAutoTrackFeedback.enabledKey('owner'))),'0');assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('stable defaults: off persists after session revalidation, busy defers startup, regular refresh does not rearm stopped monitor',async()=>{
 const s=await h.page();try{
  await setup(s.page);await s.page.evaluate(async()=>{generationInFlight=true;await refreshSkipDefaults();});
  assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);
  await s.page.evaluate(async()=>{generationInFlight=false;await refreshSkipDefaults();});
  await s.page.waitForFunction(()=>skipJournalController.diagnostics().active);
  await s.page.evaluate(async()=>{skipJournalController.stop('expired');await refreshSkipDefaults();});
  assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);
  await s.page.locator('#skipJournalPanel').evaluate(el=>el.open=true);
  await s.page.locator('#skipJournalEnabled').check();await s.page.waitForFunction(()=>skipJournalController.diagnostics().active);
  await s.page.locator('#skipJournalEnabled').uncheck();await s.page.waitForFunction(()=>!document.getElementById('skipJournalEnabled').disabled);
  await s.page.evaluate(async()=>{playbackSessionTag='revalidated';await refreshSkipDefaults();});
  assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('stable defaults reject damaged automatic grades without deleting data or starting observation',async()=>{
 const s=await h.page();try{
  await setup(s.page);await s.page.evaluate(async()=>{localStorage.setItem(OfficeAutoTrackFeedback.localKey('owner'),'bad');await refreshSkipDefaults();});
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),false);assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().active),false);
  assert.equal(await s.page.evaluate(()=>localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner'))),'bad');assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('stable defaults never retroactively rate old diagnostic entries and external playlists remain diagnostic only',async()=>{
 const s=await h.page();try{
  await setup(s.page);await start(s.page);await transition(s.page);assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),false);
  await s.page.evaluate(async()=>{skipJournalController.stop();s1Set('A','track',10000);s1State.context='spotify:playlist:external';await refreshSkipDefaults();});
  await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='stabilizing');
  await s.page.waitForTimeout(1100);await s.page.evaluate(()=>spotifyPlaybackMonitor.read({fresh:true}));
  await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='observing');
  await s.page.evaluate(async()=>{s1Set('B');s1State.context='spotify:playlist:external';await spotifyPlaybackMonitor.read({fresh:true});});
  await s.page.waitForFunction(()=>skipJournalController.diagnostics().recorded===2);
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.has('owner')),false);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});

test('stable defaults integrate with real getProfile and restart with fresh anchors after reload',async()=>{
 const s=await h.page();try{
  await setup(s.page);await s.page.evaluate(async()=>{
   const transport=fetch;fetch=(url,opts)=>String(url)==='https://api.spotify.com/v1/me'?Promise.resolve(Response.json({id:'public-owner',account_id:'owner'})):transport(url,opts);
   await getProfile('old');
  });
  await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='stabilizing');
  await transition(s.page);await s.page.waitForFunction(()=>autoTrackFeedback.has('owner'));
  const before=await s.page.evaluate(()=>localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner')));
  await s.page.reload();await s.page.waitForFunction(()=>window.ommStorageReady!==false);await setup(s.page);
  await s.page.evaluate(()=>refreshSkipDefaults());await s.page.waitForFunction(()=>skipJournalController.diagnostics().reason==='stabilizing');
  assert.equal(await s.page.evaluate(()=>skipJournalController.diagnostics().recorded),0);
  assert.equal(await s.page.evaluate(()=>localStorage.getItem(OfficeAutoTrackFeedback.localKey('owner'))),before);
  assert.equal(await s.page.evaluate(()=>autoTrackFeedback.enabled()),true);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
