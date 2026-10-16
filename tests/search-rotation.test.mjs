import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const source=readFileSync(new URL('../search-rotation.js',import.meta.url),'utf8');
const context='a'.repeat(64), other='b'.repeat(64), HOUR=3600000;
function api(){const env=vm.createContext({TextEncoder});vm.runInContext(source,env);return env.OmmSearchRotation;}
const failure=(query='artist:"A"')=>({query,source:'Spotify',status:'ok',raw:10,filtered:10,retained:10,safe:0,selected:0});
function learn(lib,raw,ctx,pages,at){const m=lib.create(raw,ctx,at);m.observe(pages,at);return m.serialize(raw,at)??raw;}
test('dwa niepowodzenia, cooldown 30/60/120 min i jedna priorytetowa próba',()=>{
 const lib=api(),q='artist:"A"';let raw=learn(lib,null,context,[failure(q)],0);
 assert.equal(lib.create(raw,context,1).rank(q,0,false,1),0);
 raw=learn(lib,raw,context,[failure(q)],1000);
 const m=lib.create(raw,context,1001);assert.equal(m.rank(q,0,false,1001),1);assert.equal(m.rank(q,0,false,1000+.5*HOUR),-1);assert.equal(m.rank(q,0,true,1000+.5*HOUR),1);
 raw=learn(lib,raw,context,[failure(q)],2000);assert.equal(JSON.parse(raw).entries[0].retryAt,2000+HOUR);
 raw=learn(lib,raw,context,[failure(q)],3000);raw=learn(lib,raw,context,[failure(q)],4000);assert.equal(JSON.parse(raw).entries[0].misses,4);assert.equal(JSON.parse(raw).entries[0].retryAt,4000+2*HOUR);
});
test('Lifer: bezpieczne bez wyboru zerują streak, także przy częściowej retencji',()=>{
 const lib=api(),q='artist:"Lifer"';let raw=learn(lib,null,context,[failure(q)],0);raw=learn(lib,raw,context,[failure(q)],1000);
 assert.equal(lib.create(raw,context,1001).rank(q,2,false,1001),0);
 raw=learn(lib,raw,context,[{...failure(q),safe:6,retained:6,selected:0}],2000);assert.equal(JSON.parse(raw).entries.length,0);
});
for(const kind of ['error','cache','partial-retention','missing-raw','unfinished'])test(`nie uczymy fałszywego niepowodzenia: ${kind}`,()=>{
 const lib=api(),p=failure();if(kind==='error')p.status='http-429';if(kind==='cache')p.source='cache';if(kind==='partial-retention')p.retained=3;if(kind==='missing-raw')p.raw=null;if(kind==='unfinished')delete p.safe;
 assert.equal(learn(lib,null,context,[p],0),null);
});
test('pusta poprawna strona jest dowodem; wiele stron liczymy raz, nieznane wyniki nie są karą',()=>{
 const lib=api(),p={...failure(),raw:0,filtered:0,retained:0};let raw=learn(lib,null,context,[p,p],0);assert.equal(JSON.parse(raw).entries[0].misses,1);
 assert.equal(learn(lib,null,context,[failure(),{...failure(),retained:2}],0),null);
});
test('konteksty/konta są izolowane, TTL i cofnięty zegar neutralizują stare dane',()=>{
 const lib=api(),q='artist:"A"';let raw=learn(lib,null,context,[failure(q)],0);raw=learn(lib,raw,context,[failure(q)],1000);
 assert.equal(lib.create(raw,other,1001).rank(q,0,false,1001),0);assert.equal(lib.create(raw,context,999).rank(q,0,false,999),0);assert.equal(lib.create(raw,context,1000+lib.TTL).rank(q,0,false,1000+lib.TTL),0);
 const expired=learn(lib,raw,context,[failure(q)],1000+lib.TTL);assert.equal(JSON.parse(expired).entries[0].misses,1);
});
for(const raw of ['bad-json','{"version":2,"entries":[]}','{"version":1,"entries":[],"extra":1}'])test(`nie nadpisujemy uszkodzonego/nieobsługiwanego stanu ${raw}`,()=>{
 const lib=api(),m=lib.create(raw,context,0);m.observe([failure()],0);assert.equal(m.rank('artist:"A"',0),0);assert.equal(m.serialize(raw,0),null);
});
test('limit rekordów/bajtów i scalanie zmian innych kontekstów bez utraty ich obserwacji',()=>{
 const lib=api();let raw=null;
 for(let i=0;i<140;i++)raw=learn(lib,raw,i%2?context:other,[failure(`artist:"A${i}"`)],i);
 assert.equal(JSON.parse(raw).entries.length,128);assert.ok(new TextEncoder().encode(raw).length<=lib.MAX_BYTES);
 const a=lib.create(null,context,1000),b=lib.create(null,other,1000);a.observe([failure('A')],1000);b.observe([failure('B')],1000);
 assert.equal(JSON.parse(a.serialize(b.serialize(null,1000),1000)).entries.length,2);
});
let harness;before(async()=>{harness=await startBrowserHarness();});after(async()=>harness?.close());
async function evaluate(fn,arg){const s=await harness.page();try{const r=await s.page.evaluate(fn,arg);assert.deepEqual(s.errors,[]);return r;}finally{await s.close();}}
test('fingerprint resetuje profile, dane, ustawienia, historię i wygasłe blokady; pomija własne zapisy puli',async()=>{
 const r=await evaluate(async()=>{
  renderProfiles();getAutoFeedbackAccount=()=> 'accountA';const base=await searchRotationContext(),changes=[];
  const check=async edit=>{edit();changes.push(await searchRotationContext());};
  await check(()=>{document.querySelector('input[data-profile-id="asia"]').checked=false;});
  await check(()=>{localStorage.setItem(FEEDBACK_KEY,JSON.stringify({x:{value:-1,artists:['A']}}));});
  await check(()=>{localStorage.setItem(HISTORY_KEY,JSON.stringify([{trackId:'x',trackName:'X',artistNames:['A'],playedAt:new Date().toISOString(),source:'spotify'}]));});
  await check(()=>{recognizabilityLevel.value='0';});
  await check(()=>{localStorage.setItem(LASTFM_TRACK_POOL_KEY,JSON.stringify([{artist:'A',track:'X',tags:['rock'],savedAt:Date.now()}]));});
  await check(()=>{getAutoFeedbackAccount=()=> 'accountB';});
  const beforePool=await searchRotationContext();localStorage.setItem(CANDIDATE_POOL_KEY,'[]');writeSearchCache('x',0,[],{raw:0,total:0});localStorage.setItem(SEED_ARTIST_ROTATION_KEY,'{}');const afterPool=await searchRotationContext();
  return {base,changes,beforePool,afterPool};
 });assert.equal(new Set([r.base,...r.changes]).size,r.changes.length+1);assert.equal(r.beforePool,r.afterPool);assert.match(r.base,/^[0-9a-f]{64}$/);
});
test('zmiana danych w trakcie generowania i błąd generowania nie zapisują uczenia',async()=>{
 const r=await evaluate(async()=>{
  getAutoFeedbackAccount=()=> 'accountA';const rotation=await createSearchRotation(),report={outcome:'success',searchEffectiveness:{final:true,pages:[{query:'x',source:'Spotify',status:'ok',raw:0,filtered:0,retained:0,safe:0}]}};
  const acquisition={rotation};await rememberSearchRotation(acquisition,{...report,outcome:'error'});const error=localStorage.getItem(OmmSearchRotation.KEY);
  localStorage.setItem(FEEDBACK_KEY,'{}');await rememberSearchRotation(acquisition,report);return {error,changed:localStorage.getItem(OmmSearchRotation.KEY)};
 });assert.equal(r.error,null);assert.equal(r.changed,null);
});
test('uczenie pozostaje lokalne, poza preferencjami/D1/eksportem; brak konta wyłącza je',async()=>{
 const r=await evaluate(async()=>{
  getAutoFeedbackAccount=()=> 'accountA';const acquisition={rotation:await createSearchRotation()};
  await rememberSearchRotation(acquisition,{outcome:'success',searchEffectiveness:{final:true,pages:[{query:'PRIVATE_QUERY',source:'Spotify',status:'ok',raw:0,filtered:0,retained:0,safe:0}]}});
  const saved=localStorage.getItem(OmmSearchRotation.KEY),exported=exportedStorageState(),cloud=durableLocalStateForCloud();getAutoFeedbackAccount=()=> '';return {saved,exported,cloud,disabled:await createSearchRotation()};
 });assert.match(r.saved,/PRIVATE_QUERY/);assert.ok(!JSON.stringify(r.exported).includes('PRIVATE_QUERY'));assert.ok(!JSON.stringify(r.cloud).includes('PRIVATE_QUERY'));assert.equal(r.disabled,null);
});
test('potwierdzone starsze konto monitora może użyć rotacji bez poluzowania tożsamości feedbacku',async()=>{
 const r=await evaluate(async()=>{
  getAutoFeedbackAccount=()=> '';playbackSession=()=>({account:'verified-legacy',session:'private-session-tag'});
  const rotation=await createSearchRotation();return {context:rotation.context,auto:getAutoFeedbackAccount()};
 });assert.match(r.context,/^[a-f0-9]{64}$/);assert.equal(r.auto,'');assert.ok(!r.context.includes('private'));
});
test('kontekst jest tylko odczytem; wygaśnięcie cooldown zmienia hash bez zmiany historii',async()=>{
 const r=await evaluate(async()=>{
  renderProfiles();getAutoFeedbackAccount=()=> 'accountA';let now=Date.now();Date.now=()=>now;
  localStorage.setItem(HISTORY_KEY,JSON.stringify([{trackId:'x',trackName:'X',artistNames:['A'],artistIds:['a'],playedAt:new Date(now-2*3600000+1000).toISOString(),source:'spotify'}]));artistCooldownHours.value='2';
  const writes=[],original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){writes.push(k);return original.call(this,k,v);};
  const first=await searchRotationContext();now+=2000;const second=await searchRotationContext();return {first,second,writes};
 });assert.notEqual(r.first,r.second);assert.deepEqual(r.writes,[]);
});
test('błąd quota pamięci rotacji nie usuwa danych i nie przerywa zapisanego wyniku',async()=>{
 const r=await evaluate(async()=>{
  getAutoFeedbackAccount=()=> 'accountA';const acquisition={rotation:await createSearchRotation()};
  localStorage.setItem(FEEDBACK_KEY,'{}');acquisition.rotation=await createSearchRotation();
  const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===OmmSearchRotation.KEY)throw new DOMException('Full','QuotaExceededError');return original.call(this,k,v);};
  await rememberSearchRotation(acquisition,{outcome:'success',searchEffectiveness:{final:true,pages:[{query:'x',source:'Spotify',status:'ok',raw:0,filtered:0,retained:0,safe:0}]}});
  return {feedback:localStorage.getItem(FEEDBACK_KEY),memory:localStorage.getItem(OmmSearchRotation.KEY)};
 });assert.equal(r.feedback,'{}');assert.equal(r.memory,null);
});
test('due probe nie omija twardej blokady wykonawcy',async()=>{
 const r=await evaluate(async()=>{
  const now=Date.now(),ctx='a'.repeat(64),raw=JSON.stringify({version:1,entries:[{context:ctx,query:'artist:"a"',misses:2,at:now-3600000,retryAt:now-1}]});
  const selected=[{id:'bartek',artists:[],blockedArtists:['A'],taste:{hasSurvey:true,likedGenres:['Rock']}}],a=createCandidateAcquisition(selected);a.rotation={memory:OmmSearchRotation.create(raw,ctx,now),probed:false,deferred:new Set()};
  newSearchesThisGeneration=0;maxNewSearchesThisGeneration=1;const calls=[];searchTracks=async(_t,q)=>{calls.push(q);newSearchesThisGeneration++;return [];};
  await primeDiverseQueries('token',[{query:'artist:"A"'},{query:'artist:"B"'}],1,a);return calls;
 });assert.deepEqual(r,['artist:"B"']);
});
for(const people of [2,4])test(`${people} osoby: po dwóch niepowodzeniach inne źródło daje 2→4 utwory w tym samym budżecie`,async()=>{
 const r=await evaluate(async people=>{
  const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,name:profiles[id].name,genres:['rock'],artists:[],categories:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}));
  const make=(artist,n)=>({id:`${artist}${n}`,uri:`spotify:track:${artist}${n}`,name:`Song ${n}`,artists:[{id:artist,name:artist}]});
  const all=['A','B'].flatMap(artist=>[0,1].map(n=>make(artist,n)));addLastFmTracks(all.map(t=>({name:t.name,artist:{name:t.artists[0].name}})),{tags:['rock']});
  let now=Date.now();Date.now=()=>now;const ctx='a'.repeat(64),bad={query:'genre:"rock"',source:'Spotify',status:'ok',raw:10,filtered:10,retained:10,safe:0};
  let memory=OmmSearchRotation.create(null,ctx,now);memory.observe([bad],now);let raw=memory.serialize(null,now);now++;memory=OmmSearchRotation.create(raw,ctx,now);memory.observe([bad],now);raw=memory.serialize(raw,now);now++;
  const outputs=[];waitForSearchSlot=async()=>{};
  for(const learned of [false,true]){
   localStorage.setItem(CANDIDATE_POOL_KEY,JSON.stringify(all.slice(0,2).map(track=>({track,queries:['artist:"A"'],savedAt:now}))));
   newSearchesThisGeneration=0;maxNewSearchesThisGeneration=1;const acquisition=createCandidateAcquisition(selected);
   if(learned)acquisition.rotation={memory:OmmSearchRotation.create(raw,ctx,now),probed:false,deferred:new Set()};
   const calls=[];searchTracks=async(_t,q)=>{calls.push(q);newSearchesThisGeneration++;if(q.startsWith('artist:'))addToCandidatePool(q,all.slice(2));return [];};
   await primeDiverseQueries('token',[{query:'genre:"rock"'},{query:'artist:"B"'}],1,acquisition);
   const model=buildGroupRecommendationContext(selected),{eligible,stats}=eligibleGroupCandidates(selected,generationBlocklists(selected),model);Math.random=()=>.25;const result=selectGroupPlaylist(eligible,4,model,stats);
   outputs.push({calls,count:newSearchesThisGeneration,length:result.tracks.length,scores:eligible.flatMap(i=>Object.values(i.byUser).map(x=>x.score)),discovery:result.discoveryCount,max:result.discoveryQuota.max});
  }return outputs;
 },people);assert.equal(r[0].length,2);assert.equal(r[1].length,4);assert.deepEqual(r[0].calls,['genre:"rock"']);assert.deepEqual(r[1].calls,['artist:"B"']);assert.equal(r[0].count,r[1].count);assert.ok(r[1].scores.every(s=>s>=35));assert.ok(r[1].discovery<=r[1].max);
});
test('priorytetowe próby są ograniczone do jednej; zdegradowane zapytania pozostają fallbackiem',async()=>{
 const r=await evaluate(async()=>{
  const now=Date.now(),ctx='a'.repeat(64),queries=['artist:"A"','artist:"B"','artist:"C"'],raw=JSON.stringify({version:1,entries:queries.slice(0,2).map(query=>({context:ctx,query:canonicalQuery(query),misses:2,at:now-3600000,retryAt:now-1}))});
  const selected=[{id:'bartek',artists:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}],a=createCandidateAcquisition(selected);a.rotation={memory:OmmSearchRotation.create(raw,ctx,now),probed:false,deferred:new Set()};
  newSearchesThisGeneration=0;maxNewSearchesThisGeneration=3;const calls=[];searchTracks=async(_t,q)=>{calls.push(q);newSearchesThisGeneration++;return [];};
  await primeDiverseQueries('token',queries.map(query=>({query})),3,a);return {calls,probed:a.rotation.probed};
 });assert.deepEqual(r.calls,['artist:"A"','artist:"C"','artist:"B"']);assert.equal(r.probed,true);
});
test('trzy pełne generowania rzeczywiście zapisują uczenie i przekierowują trzecie żądanie',async()=>{
 const r=await evaluate(async()=>{
  const selected=['bartek','asia'].map(id=>({id,name:profiles[id].name,artists:[],genres:['rock'],categories:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}));
  const make=(id,artist)=>({id,uri:`spotify:track:${id}`,name:`Song ${id}`,artists:[{id:artist,name:artist}]});
  const existing=Array.from({length:6},(_,i)=>make(`old${i}`,`Artist${i}`)),newTracks=[make('new0','NewA'),make('new1','NewB')];
  let now=Date.now();Date.now=()=>now;localStorage.setItem(CANDIDATE_POOL_KEY,JSON.stringify(existing.map(track=>({track,queries:[`artist:"${track.artists[0].name}"`],savedAt:now}))));
  addLastFmTracks([...existing,...newTracks].map(t=>({name:t.name,artist:{name:t.artists[0].name}})),{tags:['rock']});
  localStorage.setItem('spotify_access_token','mock-token');localStorage.setItem('spotify_token_expires',String(now+3600000));
  selectedProfiles=()=>selected;getAutoFeedbackAccount=()=> 'mock-account';playlistLength.value='30';
  cleanupOldOfficePlaylists=async()=>({});refreshLastFmBeforeGeneration=async()=>{};syncSpotifyRecentHistory=async()=>{};uploadCloudStateIfChanged=async()=>({});OfficePlaylistCover.apply=async()=>false;waitForSearchSlot=async()=>{};
  primeManualSeedArtists=async(token,_selected,_budget,acquisition)=>primeDiverseQueries(token,[{query:'genre:"rock"'},{query:'genre:"pop"'}],1,acquisition);
  primeProfileGenres=async()=>{};primeCommonGroupQueries=async()=>{};
  const searches=[];fetch=async (input,options={})=>{
   const u=new URL(input,location.href);if(u.pathname==='/v1/search'){
    const query=u.searchParams.get('q');searches.push(query);
    const tracks=query==='genre:"rock"'?Array.from({length:10},(_,i)=>({...make(`bad${i}`,'Bad'),name:`Bad ${i} - Live`})):newTracks;
    return Response.json({tracks:{items:tracks,total:100}});
   }
   if(u.pathname==='/api/track-cooldown')return options.method==='GET'?Response.json({base:null,state:OfficeTrackCooldown.empty('mock-account')}):Response.json({state:JSON.parse(options.body).state});
   if(u.pathname==='/api/generations')return Response.json({ok:true,saved:true});
   if(u.pathname.endsWith('/items'))return Response.json({snapshot_id:'done'});
   return Response.json({id:'made',name:'Made',uri:'spotify:playlist:made'});
  };
  const results=[];for(let i=0;i<3;i++){await generateOfficePlaylist();results.push({outcome:lastGenerationReport.outcome,length:lastGenerationReport.length,rotation:lastGenerationReport.searchRotation,message:progressBox.querySelectorAll('p')[1]?.textContent,raw:localStorage.getItem(OmmSearchRotation.KEY)});now+=1000;}
  return {searches,results,text:playlistResult.querySelector("#playlistDiagnostics")?.textContent};
 });assert.deepEqual(r.searches,['genre:"rock"','genre:"rock"','genre:"pop"'],JSON.stringify(r.results));assert.ok(r.results.every(x=>x.outcome==='success'&&x.rotation.learning==='saved'));assert.deepEqual(r.results.map(x=>x.length),[6,6,8]);assert.equal(JSON.parse(r.results[1].raw).entries[0].misses,2);assert.equal(r.results[2].rotation.deferred,1);assert.match(r.text,/uczenie: zapisano lokalnie/);
});
