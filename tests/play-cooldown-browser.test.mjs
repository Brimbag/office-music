import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
import '../play-cooldown.js';
const C=OfficePlayCooldown,N=Date.parse('2026-10-16T18:00:00Z'),DAY=86400000;
let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>{await harness?.close();});
async function setup(page){await page.evaluate(now=>{
  window.replayNow=now;Date.now=()=>replayNow;Math.random=()=>.25;
  localStorage.setItem('spotify_access_token','mock');localStorage.setItem('spotify_token_expires',String(now+3600000));
  lastFmSpotifyAccount='public';autoFeedbackAccount='owner';playbackSessionTag='test';playbackSessionVerified=true;playbackVerifiedAccess='mock';
  artistCooldownHours.value='0';discoveryLevel.value='0';
  window.replayTrack={id:'trackA',uri:'spotify:track:trackA',name:'Fixture Song',artists:[{id:'artistA',name:'Fixture Artist'}],album:{name:'Fixture'}};
  window.replayProfiles=['bartek','asia'].map(id=>({id,name:id,artists:[],genres:['rock'],blockedArtists:[],categories:[],
    taste:{hasSurvey:true,likedGenres:['Rock'],okGenres:[],blockedGenres:[]}}));
  window.replayEntry=(source='spotify',at=Date.now()-2*86400000)=>({source,sourceAccount:source==='spotify'?'public':'listener',
    playedAt:new Date(at).toISOString(),trackId:source==='spotify'?'trackA':'',trackName:'Fixture Song',artistNames:['Fixture Artist']});
  window.replaySeed=()=>{addLastFmTracks([{name:replayTrack.name,artist:{name:'Fixture Artist'}}],{tags:['rock']});
    saveCandidatePool([{track:replayTrack,queries:['genre:"rock"'],savedAt:Date.now()}]);};
  window.replaySelect=()=>{const ctx=acquisitionContext(replayProfiles),{eligible,stats}=eligibleGroupCandidates(replayProfiles,generationBlocklists(replayProfiles),ctx);
    return selectGroupPlaylist(eligible,30,ctx,stats).tracks.map(t=>t.id);};
},N);}
async function page(){const s=await harness.page();await setup(s.page);return s;}
function remote(){
  let raw=null;const calls=[];
  return {calls,get raw(){return raw;},set raw(value){raw=value;},async attach(page){
    await page.route('**/api/play-cooldown',async route=>{
      const r=route.request();calls.push(r.method());let body,status=200;
      if(r.method()==='GET')body={base:raw,state:C.merge(raw,null,'owner',N)};
      else {const sent=r.postDataJSON();if(sent.base!==raw){status=409;body={error:'conflict'};}
        else{const state=C.merge(raw,sent.state,'owner',N);raw=JSON.stringify(state);body={state};}}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
  }};
}
for(const source of ['spotify','lastfm'])test(`computer A ${source} play -> computer B cached candidate excluded, including restart and like/off`,async()=>{
  const a=await page(),b=await page(),cloud=remote();
  try{
    await cloud.attach(a.page);await cloud.attach(b.page);
    await a.page.evaluate(async source=>{
      localStorage.setItem(LASTFM_USER_KEY,'listener');localStorage.setItem(HISTORY_KEY,JSON.stringify([replayEntry(source)]));
      await syncPlayCooldown('mock',{force:true,required:true});
    },source);
    const r=await b.page.evaluate(async()=>{
      replaySeed();const before=replaySelect();await syncPlayCooldown('mock',{force:true,required:true});
      await setTrackFeedback(replayTrack,1);await autoTrackFeedback.configure(false);
      writeSearchCache('genre:"rock"',0,[replayTrack]);
      return {before,after:replaySelect(),history:loadHistory(),liked:trackFeedbackValue(replayTrack),enabled:autoTrackFeedback.enabled()};
    });
    assert.deepEqual(r.before,['trackA']);assert.deepEqual(r.after,[]);assert.deepEqual(r.history,[]);assert.equal(r.liked,1);assert.equal(r.enabled,false);
    await b.page.addInitScript(now=>{window.replayNow=now;Date.now=()=>replayNow;},N);
    await b.page.reload();await b.page.waitForFunction(()=>window.ommStorageReady!==false);await setup(b.page);
    const restarted=await b.page.evaluate(()=>{
      replaySeed();const rows=readSearchCache('genre:"rock"',0);return {ids:replaySelect(),cached:rows.map(t=>t.id),history:loadHistory()};
    });assert.deepEqual(restarted.ids,[]);assert.deepEqual(restarted.cached,['trackA']);assert.deepEqual(restarted.history,[]);
    assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  }finally{await a.close();await b.close();}
});
test('Last.fm names use existing Unicode/version normalization; another artist or title is not blocked',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      localStorage.setItem(LASTFM_USER_KEY,'listener');
      await capturePlayedHistory([{...replayEntry('lastfm'),artistNames:['Måneskin'],trackName:'ZITTI E BUONI'}]);
      const b=buildHistoryBlocklists();const check=(artist,title)=>[trackSignature({name:title,artists:[{name:artist}]}),...trackDuplicateSignatures({name:title,artists:[{name:artist}]})].some(k=>b.blockedTrackSignatures.has(k));
      return [check('MA\u030aNESKIN','zitti e buoni - 2025 Remaster'),check('Måneskin','ZITTI E BUONI (Radio Edit)'),check('Other','ZITTI E BUONI'),check('Måneskin','ZITTI E BUONI Again')];
    });assert.deepEqual(r,[true,true,false,false]);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('cache coverage and stale fallback candidates respect cloud plays until the exact boundary',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      replaySeed();const acquisition=createCandidateAcquisition(replayProfiles);acquisition.blockProfiles=replayProfiles;
      const before=getAcquisitionCoverage(acquisition).qualifying.length;
      const ctx=acquisitionContext(replayProfiles),{eligible,stats}=eligibleGroupCandidates(replayProfiles,generationBlocklists(replayProfiles),ctx);
      eligible[0].groupBase=1000;for(const user of replayProfiles)eligible[0].byUser[user.id].score=80;eligible[0].minScore=80;
      await capturePlayedHistory([replayEntry('spotify',Date.now())]);
      const during=getAcquisitionCoverage(acquisition).qualifying.length,deadline=acquisition.coverageCache.until;
      const stale=selectGroupPlaylist(eligible,150,ctx,stats).tracks.map(t=>t.id);
      replayNow+=OfficePlayCooldown.WINDOW-1;const last=replaySelect();replayNow++;
      return {before,during,deadline,stale,last,after:replaySelect(),coverageAfter:getAcquisitionCoverage(acquisition).qualifying.length};
    });assert.equal(r.before,1);assert.equal(r.during,0);assert.equal(r.deadline,N+C.WINDOW);assert.deepEqual(r.stale,[]);assert.deepEqual(r.last,[]);
    assert.deepEqual(r.after,['trackA']);assert.equal(r.coverageAfter,1);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('source batch is registered before history is truncated, and clearing history cannot remove exclusions',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      const entries=Array.from({length:1601},(_,i)=>({...replayEntry('spotify',Date.now()-i*1000),trackId:'t'+i,trackName:'Song '+i}));
      await capturePlayedHistory(entries);mergeHistoryEntries(entries);const kept=loadHistory().length;
      clearAppHistory();return {kept,blocks:playCooldown.blocked().tracks.size,history:loadHistory().length};
    });assert.equal(r.kept,1500);assert.equal(r.blocks,1601);assert.equal(r.history,0);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('legacy promotion requires known source ownership; generated records, future plays and foreign accounts are not uploaded',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      localStorage.setItem(LASTFM_USER_KEY,'listener');const valid=replayEntry();
      await capturePlayedHistory([valid,{...valid,trackId:'foreign',sourceAccount:'other'}, {...valid,trackId:'missing',sourceAccount:''},
        {...valid,trackId:'generated',source:'generated'}, {...valid,trackId:'future',playedAt:new Date(Date.now()+1).toISOString()},
        {...replayEntry('lastfm'),trackName:'Other Song',sourceAccount:'otherListener'}]);
      const first=playCooldown.state('owner');autoFeedbackAccount='other';
      return {first,other:[...playCooldown.blocked().tracks]};
    });assert.deepEqual(Object.keys(r.first.tracks),['trackA']);assert.deepEqual(r.other,[]);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('old backup import unions active register; malformed register is rejected without altering local data',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      await capturePlayedHistory([replayEntry()]);const key=OfficePlayCooldown.localKey('owner'),before=localStorage.getItem(key);
      let rejected=false;try{OmmLocalState.validate({format:'office-music-state',version:1,storage:{[key]:'{"version":2}'}});}catch{rejected=true;}
      await OmmLocalState.importState({office_rmf_settings_v2:'{}'});
      return {before,after:localStorage.getItem(key),rejected};
    });assert.deepEqual(JSON.parse(r.after),JSON.parse(r.before));assert.equal(r.rejected,true);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('a CAS conflict re-reads and keeps both computers, including a newer play of the same song',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      let gets=0,puts=0,remote=OfficePlayCooldown.fromPlays('owner',[{trackId:'remote',at:Date.now()-1000}],Date.now());
      await capturePlayedHistory([replayEntry()]);
      fetch=async(_url,o)=>{if(o.method==='GET'){gets++;return Response.json({state:remote,base:JSON.stringify(remote)});}
        puts++;if(puts===1){remote=OfficePlayCooldown.merge(remote,OfficePlayCooldown.fromPlays('owner',[{trackId:'trackA',at:Date.now()}]),'owner');return Response.json({error:'conflict'},{status:409});}
        remote=OfficePlayCooldown.merge(remote,JSON.parse(o.body).state,'owner');return Response.json({state:remote});};
      await syncPlayCooldown('mock',{force:true});return {gets,puts,remote};
    });assert.equal(r.gets,2);assert.equal(r.puts,2);assert.equal(r.remote.tracks.trackA,N);assert.ok(r.remote.tracks.remote);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
for(const failure of ['503','429','network','schema'])test(`cloud ${failure} prevents generation before Spotify side effects`,async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async failure=>{
      replaySeed();let creates=0,writes=0,cleanups=0,calls=0;
      getValidAccessToken=async()=> 'mock';syncTrackCooldown=async()=>({saved:1});persistGenerationLog=async()=>({status:'local'});
      createPlaylist=async()=>{creates++;};addItemsToPlaylist=async()=>{writes++;};cleanupOldOfficePlaylists=async()=>{cleanups++;};
      fetch=async()=>{calls++;if(failure==='network')throw new Error('private secret');if(failure==='schema')return Response.json({base:null,state:{version:2}});
        return Response.json({error:'private secret'},{status:Number(failure),headers:{'Retry-After':'60'}});};
      await generateOfficePlaylist();return {creates,writes,cleanups,calls,text:playlistResult.textContent};
    },failure);assert.equal(r.creates,0);assert.equal(r.writes,0);assert.equal(r.cleanups,0);assert.equal(r.calls,1);assert.doesNotMatch(r.text,/private secret/);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
async function generator(page,late=false){return page.evaluate(async late=>{
  replaySeed();let creates=0,writes=0,gets=0,puts=0;let remote=OfficePlayCooldown.empty('owner');
  getValidAccessToken=async()=> 'mock';selectedProfiles=()=>replayProfiles;
  syncTrackCooldown=async()=>({saved:1});cleanupOldOfficePlaylists=async()=>({});
  refreshLastFmBeforeGeneration=syncSpotifyRecentHistory=async()=>{};
  primeManualSeedArtists=primeProfileGenres=primeCommonGroupQueries=async()=>{};
  persistGenerationLog=async()=>({status:'local'});uploadCloudStateIfChanged=async()=>({saved:0});
  fetch=async(_url,o)=>{if(String(_url)!=='/api/play-cooldown')return Response.json({tracks:[]});if(o.method==='GET'){gets++;if(late&&gets===3)remote=OfficePlayCooldown.fromPlays('owner',[{at:Date.now(),trackId:'trackA'}]);return Response.json({state:remote,base:JSON.stringify(remote)});}
    puts++;remote=OfficePlayCooldown.merge(remote,JSON.parse(o.body).state,'owner');return Response.json({state:remote});};
  createPlaylist=async()=>{creates++;return {id:'made',uri:'spotify:playlist:made',external_urls:{spotify:'https://open.spotify.com/playlist/made'}};};
  addItemsToPlaylist=async()=>{writes++;};await generateOfficePlaylist();return {creates,writes,gets,puts,text:playlistResult.textContent};
},late);}
test('real generator confirms cloud before selection and again before the final items write',async()=>{
  const s=await page();try{const r=await generator(s.page);assert.equal(r.creates,1);assert.equal(r.writes,1);assert.equal(r.gets,3);assert.equal(r.puts,3);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('a remote play arriving during playlist creation prevents final items write',async()=>{
  const s=await page();try{const r=await generator(s.page,true);assert.equal(r.creates,1);assert.equal(r.writes,0);assert.match(r.text,/Blokady zmieniły/);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('actual Spotify sync captures a confirmed play before local history persistence',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      fetch=async()=>Response.json({items:[{track:replayTrack,played_at:new Date(Date.now()-1000).toISOString()}]});
      const count=await syncSpotifyRecentHistory('mock',true);
      return {count,blocks:[...playCooldown.blocked().tracks],history:loadHistory().length};
    });assert.equal(r.count,1);assert.deepEqual(r.blocks,['trackA']);assert.equal(r.history,1);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('actual Last.fm sync captures a name-only play using its paired source account',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      localStorage.setItem(LASTFM_USER_KEY,'listener');lastFmUserInput.value='listener';
      lastFmRequest=async()=>({recenttracks:{track:[{name:'Fixture Song',artist:{name:'Fixture Artist'},date:{uts:String(Math.floor(Date.now()/1000)-1)}}],
        '@attr':{totalPages:'1',page:'1'}}});
      await syncLastFmSources(replayProfiles,{includeTags:false,includeRecent:true});
      return {blocks:[...playCooldown.blocked().signatures],history:loadHistory().length};
    });assert.deepEqual(r.blocks,['fixture artist|fixture song']);assert.equal(r.history,1);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('failed source capture is not swallowed; pending batch is retried and source TTLs are invalidated',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      localStorage.setItem(RECENT_HISTORY_SYNC_KEY,'123');localStorage.setItem(LASTFM_AUTO_RECENT_SYNC_KEY,'123');
      const edit=OmmLocalState.edit;OmmLocalState.edit=async(key,...args)=>{if(key.startsWith(OfficePlayCooldown.KEY))throw new Error('quota');return edit(key,...args);};
      fetch=async()=>Response.json({items:[{track:replayTrack,played_at:new Date(Date.now()-1000).toISOString()}]});
      let rejected=false;try{await syncSpotifyRecentHistory('mock',true);}catch{rejected=true;}
      const before={history:loadHistory().length,pending:playCapturePending.get('owner').length,
        spotify:localStorage.getItem(RECENT_HISTORY_SYNC_KEY),lastfm:localStorage.getItem(LASTFM_AUTO_RECENT_SYNC_KEY)};
      OmmLocalState.edit=edit;await capturePlayedHistory([]);
      return {rejected,before,pending:playCapturePending.size,blocks:[...playCooldown.blocked().tracks]};
    });assert.equal(r.rejected,true);assert.equal(r.before.history,0);assert.equal(r.before.pending,1);assert.equal(r.before.spotify,null);assert.equal(r.before.lastfm,null);
    assert.equal(r.pending,0);assert.deepEqual(r.blocks,['trackA']);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('required sync waits for a background flight and then confirms a newer local batch',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      let gets=0,puts=0,release,remote=OfficePlayCooldown.empty('owner');const gate=new Promise(resolve=>release=resolve);
      fetch=async(_url,o)=>{if(o.method==='GET'){gets++;if(gets===1)await gate;return Response.json({state:remote,base:JSON.stringify(remote)});}
        puts++;remote=OfficePlayCooldown.merge(remote,JSON.parse(o.body).state,'owner');return Response.json({state:remote});};
      const background=syncPlayCooldown('mock');while(gets===0)await new Promise(resolve=>setTimeout(resolve,0));
      const required=syncPlayCooldown('mock',{force:true,required:true});await capturePlayedHistory([replayEntry()]);release();
      await Promise.all([background,required]);return {gets,puts,remote};
    });assert.equal(r.gets,2);assert.equal(r.puts,2);assert.ok(r.remote.tracks.trackA);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('cloud rate limit respects Retry-After without another request; 401 refresh retries once',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      let calls=0;fetch=async()=>{calls++;return Response.json({},{status:429,headers:{'Retry-After':'60'}});};
      for(let i=0;i<2;i++)try{await syncPlayCooldown('mock',{force:true});}catch{}
      const limited={calls,remaining:playCooldownSyncBackoff.until-Date.now()};replayNow+=60000;
      let refreshes=0,gets=0;refreshAccessToken=async()=>{refreshes++;localStorage.setItem('spotify_access_token','new');playbackVerifiedAccess='new';return 'new';};
      fetch=async(_url,o)=>{if(o.method==='GET'&&gets++===0)return Response.json({},{status:401});
        return Response.json(o.method==='GET'?{base:null,state:OfficePlayCooldown.empty('owner')}:{state:JSON.parse(o.body).state});};
      await syncPlayCooldown('mock',{force:true});return {limited,refreshes,gets};
    });assert.equal(r.limited.calls,1);assert.equal(r.limited.remaining,60000);assert.equal(r.refreshes,1);assert.equal(r.gets,2);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
test('an account change during a cloud read cannot import blocks into either current account',async()=>{
  const s=await page();try{
    const r=await s.page.evaluate(async()=>{
      fetch=async()=>{autoFeedbackAccount='other';return Response.json({base:null,state:OfficePlayCooldown.fromPlays('owner',[{trackId:'remote',at:Date.now()}])});};
      let rejected=false;try{await syncPlayCooldown('mock',{force:true});}catch{rejected=true;}
      return {rejected,current:[...playCooldown.blocked().tracks],old:playCooldown.state('owner').tracks};
    });assert.equal(r.rejected,true);assert.deepEqual(r.current,[]);assert.deepEqual(r.old,{});assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
