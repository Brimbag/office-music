import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>{await harness?.close();});
// Minimal synthetic equivalents of the five reported cases. This clock is
// not asserted to be the time of the user's actual 149-track generation.
const NOW=Date.parse('2026-10-16T18:00:00+02:00'),DAY=86400000;
const cases=[
  ['Of Monsters and Men','Little Talks',2*DAY,'spotify'],
  ['Lustra','Sniffing Cigarettes',2*DAY,'lastfm'],
  ["Blackmore's Night",'Storm',3*DAY,'spotify'],
  ['Eric Clapton','Cocaine',2*DAY,'spotify'],
  ['Måneskin','ZITTI E BUONI',2*DAY,'lastfm']
];
async function withFixture(fn,arg={}){
  const s=await harness.page();
  try{
    await s.page.evaluate(({now})=>{
      window.historyNow=now;Date.now=()=>historyNow;Math.random=()=>.25;
      artistCooldownHours.value='0';discoveryLevel.value='0';
      window.historyProfiles=['bartek','edyta','asia','monika'].map(id=>({id,name:id,artists:[],genres:['rock'],
        blockedArtists:[],categories:[],taste:{hasSurvey:true,likedGenres:['Rock'],okGenres:[],blockedGenres:[]}}));
      window.historyTrack=(artist='Fixture Artist',name='Fixture Song',id='fixtureTrack')=>({id,uri:'spotify:track:'+id,name,
        artists:[{id:'artist'+id,name:artist}],album:{name:'Synthetic album'}});
      window.historyEntry=(track,source='spotify',at=Date.now()-2*86400000)=>({source,
        trackId:source==='spotify'?track.id:'',trackName:track.name,artistNames:track.artists.map(a=>a.name),
        artistIds:source==='spotify'?track.artists.map(a=>a.id):[],trackSignature:trackSignature(track),playedAt:new Date(at).toISOString()});
      window.historySeed=tracks=>{
        addLastFmTracks(tracks.map(t=>({name:t.name,artist:{name:t.artists[0].name}})),{tags:['rock']});
        saveCandidatePool(tracks.map(track=>({track,queries:['genre:"rock"'],savedAt:Date.now()})));
      };
      window.historySelect=()=>{
        const ctx=acquisitionContext(historyProfiles),{eligible,stats}=eligibleGroupCandidates(historyProfiles,generationBlocklists(historyProfiles),ctx);
        return {ids:selectGroupPlaylist(eligible,30,ctx,stats).tracks.map(t=>t.id),recent:stats.recentTrack};
      };
    },{now:NOW});
    const result=await s.page.evaluate(fn,arg);assert.deepEqual(s.errors,[]);return result;
  }finally{await s.close();}
}
for(const [artist,title,at,source] of cases)test(`reported minimal case: ${artist} / ${title} excluded from ${source} history`,async()=>{
  const r=await withFixture(({artist,title,at,source})=>{
    const track=historyTrack(artist,title);historySeed([track]);
    localStorage.setItem(HISTORY_KEY,JSON.stringify([historyEntry(track,source,Date.now()-at)]));return historySelect();
  },{artist,title,at,source});assert.deepEqual(r.ids,[]);assert.equal(r.recent,1);
});
test('Last.fm name-only history without precomputed signature is normalized before validation',async()=>{
  const r=await withFixture(()=>{
    const track=historyTrack();historySeed([track]);const entry=historyEntry(track,'lastfm');delete entry.trackSignature;
    localStorage.setItem(HISTORY_KEY,JSON.stringify([entry]));return {history:loadHistory(),selection:historySelect()};
  });assert.equal(r.history.length,1);assert.equal(r.history[0].trackSignature,'fixture artist|fixture song');assert.deepEqual(r.selection.ids,[]);
});
test('one malformed row cannot erase valid play history or crash blocklist construction',async()=>{
  const r=await withFixture(()=>{
    const track=historyTrack();historySeed([track]);const entry=historyEntry(track);
    localStorage.setItem(HISTORY_KEY,JSON.stringify([entry,{...entry,trackId:'other',trackName:{bad:'type'},trackSignature:null,artistNames:[null,27]}]));
    return {history:loadHistory(),selection:historySelect()};
  });assert.ok(r.history.some(e=>e.trackId==='fixtureTrack'));assert.deepEqual(r.selection.ids,[]);
});
test('saving and merging name-only Last.fm plays preserves distinct tracks at the same timestamp',async()=>{
  const r=await withFixture(()=>{
    const tracks=[historyTrack(),historyTrack('Other Artist','Other Song','other')];
    const entries=tracks.map(t=>{const e=historyEntry(t,'lastfm');delete e.trackSignature;return e;});
    mergeHistoryEntries(entries);return loadHistory().map(e=>e.trackSignature).sort();
  });assert.deepEqual(r,['fixture artist|fixture song','other artist|other song']);
});
test('invalid JSON history is visible as an error to the filter, never treated as empty during selection',async()=>{
  const r=await withFixture(()=>{
    const track=historyTrack();historySeed([track]);localStorage.setItem(HISTORY_KEY,'{broken');
    try{historySelect();return {blocked:false};}catch(error){return {blocked:true,message:error.message};}
  });assert.equal(r.blocked,true);assert.match(r.message,/historii odsłuchów/);
});
test('automatic merge and generation cannot overwrite corrupt history with a partial fresh response',async()=>{
  const r=await withFixture(async()=>{
    const track=historyTrack();localStorage.setItem(HISTORY_KEY,'{broken');let mergesRejected=false,syncs=0;
    try{mergeHistoryEntries([historyEntry(track)]);}catch{mergesRejected=true;}
    getValidAccessToken=async()=> 'mock';syncTrackCooldown=async()=>{syncs++;return {saved:1};};
    refreshLastFmBeforeGeneration=syncSpotifyRecentHistory=async()=>{syncs++;};
    persistGenerationLog=async()=>({status:'local'});await generateOfficePlaylist();
    return {mergesRejected,syncs,raw:localStorage.getItem(HISTORY_KEY),error:playlistResult.textContent};
  });assert.equal(r.mergesRejected,true);assert.equal(r.syncs,0);assert.equal(r.raw,'{broken');assert.match(r.error,/historii odsłuchów/);
});
test('fresh Spotify sync and a subsequent cached-history path make identical exclusion decisions',async()=>{
  const r=await withFixture(async()=>{
    const track=historyTrack();historySeed([track]);let calls=0;lastFmSpotifyAccount='fixtureAccount';
    fetch=async()=>{calls++;return Response.json({items:[{track,played_at:new Date(Date.now()-2*86400000).toISOString()}]});};
    await syncSpotifyRecentHistory('mock',true);const fresh=historySelect();
    await syncSpotifyRecentHistory('mock');const cached=historySelect();return {calls,fresh,cached};
  });assert.equal(r.calls,1);assert.deepEqual(r.fresh,r.cached);assert.deepEqual(r.fresh.ids,[]);
});
for(const base of [40,1000])test(`name-only play cannot return from a cached candidate, fallback or repair (base ${base})`,async()=>{
  const r=await withFixture(async({base})=>{
    const track=historyTrack();historySeed([track]);const ctx=acquisitionContext(historyProfiles);
    const {eligible,stats}=eligibleGroupCandidates(historyProfiles,generationBlocklists(historyProfiles),ctx);
    const item=eligible[0];item.groupBase=base;item.features.discovery=false;
    for(const p of historyProfiles)item.byUser[p.id].score=80;item.minScore=80;item.maxScore=80;
    const entry=historyEntry(track,'lastfm');delete entry.trackSignature;saveHistory([entry]);
    const result=selectGroupPlaylist(eligible,150,ctx,stats);
    return {ids:result.tracks.map(t=>t.id),recent:stats.recentTrack};
  },{base});assert.deepEqual(r.ids,[]);assert.equal(r.recent,1);
});
for(const [age,excluded] of [[2*DAY,true],[13*DAY,true],[14*DAY,false],[14*DAY+1,false],[-DAY,false]])test(`history age ${age}: excluded=${excluded}`,async()=>{
  const r=await withFixture(({age})=>{
    const track=historyTrack();historySeed([track]);saveHistory([historyEntry(track,'spotify',Date.now()-age)]);return historySelect();
  },{age});assert.deepEqual(r.ids,excluded?[]:['fixtureTrack']);
});
test('playlist membership without an actual play does not create history exclusion',async()=>{
  const r=await withFixture(()=>{
    const track=historyTrack();historySeed([track]);
    localStorage.setItem(RECENT_PLAYLISTS_KEY,JSON.stringify([{id:'old',generatedAt:new Date(Date.now()-86400000).toISOString(),tracks:[track]}]));
    localStorage.setItem(HISTORY_KEY,JSON.stringify([{...historyEntry(track),source:'generated'}]));return historySelect();
  });assert.deepEqual(r.ids,['fixtureTrack']);
});
for(const [artist,title,blocked] of [
  ['MÅNESKIN','zitti e buoni',true],['Ma\u030aneskin','ZITTI E BUONI - 2025 Remaster',true],
  ['Måneskin','ZITTI E BUONI (Album Version)',true],['Måneskin','ZITTI E BUONI (Radio Edit)',true],
  ['Måneskin','ZITTI E BUONI feat. Guest',true],['Other Artist','ZITTI E BUONI',false],
  ['Måneskin','ZITTI E BUONI Again',false]
])test(`safe history identity: ${artist} / ${title}`,async()=>{
  const r=await withFixture(({artist,title})=>{
    const entry=historyEntry(historyTrack('Måneskin','ZITTI E BUONI'),'lastfm');saveHistory([entry]);
    const track=historyTrack(artist,title,'edition');const b=buildHistoryBlocklists();
    return b.blockedTrackSignatures.has(trackSignature(track))||trackDuplicateSignatures(track).some(s=>b.blockedTrackSignatures.has(s));
  },{artist,title});assert.equal(r,blocked);
});
test('history arriving while Spotify playlist creation is awaited prevents the final items write',async()=>{
  const r=await withFixture(async()=>{
    const track=historyTrack();historySeed([track]);
    getValidAccessToken=async()=> 'mock';syncTrackCooldown=async()=>({saved:1});selectedProfiles=()=>historyProfiles;
    cleanupOldOfficePlaylists=async()=>({});refreshLastFmBeforeGeneration=async()=>{};syncSpotifyRecentHistory=async()=>{};
    primeManualSeedArtists=primeProfileGenres=primeCommonGroupQueries=async()=>{};
    persistGenerationLog=async()=>({status:'local'});uploadCloudStateIfChanged=async()=>({saved:0});
    let writes=0;createPlaylist=async()=>{
      saveHistory([historyEntry(track)]);
      return {id:'made',uri:'spotify:playlist:made',external_urls:{spotify:'https://open.spotify.com/playlist/made'}};
    };
    addItemsToPlaylist=async()=>{writes++;};await generateOfficePlaylist();
    return {writes,history:loadHistory().length,error:playlistResult.textContent};
  });assert.equal(r.history,1);assert.equal(r.writes,0);assert.match(r.error,/Blokady zmieniły/);
});
