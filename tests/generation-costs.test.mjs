import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startBrowserHarness} from './helpers/browser.mjs';
import {installP4Fixture} from './helpers/p4-fixture.mjs';
import {installP4Variant} from './helpers/p4-variants.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/p4-baseline-v43.23.json',import.meta.url),'utf8'));
let harness;before(async()=>{harness=await startBrowserHarness();});after(async()=>{await harness?.close();});
async function evaluate(fn,arg){const s=await harness.page();try{const r=await s.page.evaluate(fn,arg);assert.deepEqual(s.errors,[]);return r;}finally{await s.close();}}
for(const people of [2,4]) test(`${people} osoby: indeks pozyskiwania zachowuje pełną kwalifikację i selekcję P3`,async()=>{
 const r=await evaluate(({fixture,old,people})=>{
  Date.now=()=>Date.parse('2026-10-09T09:00:00Z');const {selected}= (0,eval)(`(${fixture})`)({people});discoveryLevel.value='30';
  const rows=loadCandidatePool(), blocks=generationBlocklists(selected), legacy=(0,eval)(`(${old})`)(selected,rows), current=acquisitionContext(selected,rows);
  const normalize=ctx=>{const {eligible,stats}=eligibleGroupCandidates(selected,blocks,ctx,rows);Math.random=()=>.25;const result=selectGroupPlaylist(eligible,60,ctx,stats);return {stats,eligible:eligible.map(r=>({id:r.track.id,byUser:r.byUser,base:r.groupBase,recognition:r.features.recognizability,discovery:r.features.discovery})),ids:result.tracks.map(t=>t.id),satisfaction:result.satisfaction,quota:result.discoveryQuota,repair:result.discoveryRepair};};
  return {legacy:normalize(legacy),current:normalize(current),indexed:current.retentionSnapshot.artistByName instanceof Map};
 },{fixture:installP4Fixture.toString(),old:baseline.functions.acquisitionContext,people});
 assert.equal(r.indexed,true);assert.deepEqual(r.current,r.legacy);assert.ok(r.current.ids.length>0);
});
test('duplikaty Last.fm: pierwszy dowód rozpoznawalności, ostatni rekord modelu; retencja zachowuje wynik',async()=>{
 const r=await evaluate(({oldContext,oldRetention})=>{
  const now=Date.now();const track={id:'one',uri:'spotify:track:one',name:'One',artists:[{id:'twin',name:'Twin'}]};
  localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify([{artist:'Twin',tags:['jazz'],sources:['tag'],savedAt:now},{artist:'Twin',tags:['rock','metal','pop'],sources:['tag','top'],savedAt:now}]));
  const selected=[{id:'bartek',artists:[],manualGenres:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}];
  const pool=[{track,queries:['genre:"rock"'],savedAt:now}];const old=(0,eval)(`(${oldContext})`)(selected,pool),ctx=acquisitionContext(selected,pool);
  const evidence={old:lastFmEvidenceForTrack(track,old.retentionSnapshot),current:lastFmEvidenceForTrack(track,ctx.retentionSnapshot)};
  const score={old:groupCandidateStatic(track,old),current:groupCandidateStatic(track,ctx)};
  const overflow=Array.from({length:2001},(_,i)=>({track:{...track,id:`t${i}`,uri:`spotify:track:t${i}`,name:`One ${i} - Rework`},queries:[],savedAt:now}));
  overflow[0]=pool[0];const legacy=(0,eval)(`(${oldRetention})`)(structuredClone(overflow)),current=retainSpotifyPool(structuredClone(overflow));
  return {evidence,score:{old:score.old.groupBase,current:score.current.groupBase},ids:{old:legacy.map(r=>r.track.id),current:current.map(r=>r.track.id)}};
 },{oldContext:baseline.functions.acquisitionContext,oldRetention:baseline.functions.retainSpotifyPool});
 assert.deepEqual(r.evidence.old,r.evidence.current);assert.equal(r.evidence.current.maxTags,1);assert.equal(r.score.old,r.score.current);assert.deepEqual(r.ids.old,r.ids.current);
});
test('indeks pozyskiwania nie przechodzi do następnego etapu po zmianie konta lub danych',async()=>{
 const r=await evaluate(()=>{
  const now=Date.now(),selected=[{id:'bartek',artists:[],taste:{}}],track={id:'one',name:'One',artists:[{name:'A'}]};
  localStorage.setItem(LASTFM_USER_KEY,'one');localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify([{artist:'A',tags:['rock'],sources:['recent'],savedAt:now,recentObservation:{user:'one',plays:[Math.floor(now/1000)-100]}}]));
  const first=acquisitionContext(selected,[]);localStorage.setItem(LASTFM_USER_KEY,'two');const second=acquisitionContext(selected,[]);
  return {first:lastFmEvidenceForTrack(track,first.retentionSnapshot).recentCount,second:lastFmEvidenceForTrack(track,second.retentionSnapshot).recentCount,separate:first.retentionSnapshot!==second.retentionSnapshot};
 });assert.equal(r.first,1);assert.equal(r.second,0);assert.equal(r.separate,true);
});
test('bilans czasu rozdziela synchroniczną pracę, oczekiwanie i pozostały czas bez podwójnego sumowania',async()=>{
 const r=await evaluate(async()=>{
  let now=0,hidden=false;performance.now=()=>now;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  const progress=OmmGenerationProgress.create(document.createElement('div'),60);progress.stage(0);
  progress.measure('model',()=>{now+=5;progress.measure('qualification',()=>{now+=7;});now+=3;});
  let release;const waiting=progress.measureAsync('spotifyApi',()=>new Promise(resolve=>{release=resolve;}));now+=20;
  progress.measure('model',()=>{now+=10;});now+=30;release();await waiting;
  progress.stage(1);hidden=true;document.dispatchEvent(new Event('visibilitychange'));now+=40;hidden=false;document.dispatchEvent(new Event('visibilitychange'));
  progress.finish(null,47);return progress.report();
 });assert.equal(r.totalMs,115);assert.deepEqual(r.accounting,{syncMs:25,waitMs:50,otherMs:40,hiddenMs:40,maxTimerGapMs:0});assert.equal(r.metrics.model.exclusiveMs,18);assert.equal(r.stages[0].syncMs,25);assert.equal(r.stages[1].otherMs,40);assert.equal(r.stages.reduce((n,s)=>n+s.syncMs+s.waitMs+s.otherMs,0),r.totalMs);
});
test('nakładające się oczekiwania liczone raz; luka timera jest obserwacją, nie czasem CPU',async()=>{
 const r=await evaluate(async()=>{
  let now=0,tick;performance.now=()=>now;setInterval=fn=>{tick=fn;return 1;};clearInterval=()=>{};
  const progress=OmmGenerationProgress.create(document.createElement('div'),30);progress.stage(0);
  let a,b;const first=progress.measureAsync('spotifyApi',()=>new Promise(r=>{a=r;}));now=5;const second=progress.measureAsync('lastfmApi',()=>new Promise(r=>{b=r;}));now=10;a();await first;now=20;b();await second;now=3000;tick();progress.finish();return progress.report();
 });assert.equal(r.accounting.waitMs,20);assert.equal(r.accounting.otherMs,2980);assert.equal(r.accounting.maxTimerGapMs,2000);assert.equal(r.metrics.spotifyApi.inclusiveMs+r.metrics.lastfmApi.inclusiveMs,25);
});
for(const variant of ['A','B','C']) test(`eksperyment ${variant}: izolacja polityki seedów i dawnych stylów`,async()=>{
 const r=await evaluate(async({fixture,policy,variant})=>{
  const {selected,seedNames}=(0,eval)(`(${fixture})`)({people:2,poolSize:100,variant});const reference=selected.map(p=>({...p,artists:seedNames}));
  const calls=[];primeManualSeedArtists=async()=>{calls.push('manual');};primeDiverseQueries=async(_token,rows)=>calls.push(rows.map(r=>r.query));
  (0,eval)(`(${policy})`)(variant,reference);await primeManualSeedArtists();await primeDiverseQueries('mock',[{query:'artist:"Fixture Artist 0"'},{query:'artist:"Other"'},{query:'genre:"rock"'}]);
  return {calls,manual:selected[0].manualGenres,artists:selected[0].artists,stored:localStorage.getItem('office_seed_bartek'),retention:retentionProfiles().find(p=>p.id==='bartek')};
 },{fixture:installP4Fixture.toString(),policy:installP4Variant.toString(),variant});
 assert.ok(r.stored.includes('Fixture Artist 0'));assert.equal(r.manual.length>0,variant==='A');assert.equal(r.artists.length>0,variant!=='B');assert.equal(r.retention.manualGenres.length>0,variant==='A');assert.equal(r.retention.artists.length>0,variant!=='B');
 if(variant==='A')assert.equal(r.calls[0],'manual');else assert.deepEqual(r.calls,[['artist:"Other"','genre:"rock"']]);
});
test('spóźniona operacja asynchroniczna nie wydłuża zakończonego bilansu generowania',async()=>{
 const r=await evaluate(async()=>{
  let now=0;performance.now=()=>now;const progress=OmmGenerationProgress.create(document.createElement('div'),30);progress.stage(0);
  let release;const pending=progress.measureAsync('spotifyApi',()=>new Promise(resolve=>{release=resolve;}));now=10;progress.finish(new Error('Stopped'));now=50;release();await pending;return progress.report();
 });assert.equal(r.totalMs,10);assert.equal(r.accounting.waitMs,10);assert.equal(r.accounting.syncMs+r.accounting.waitMs+r.accounting.otherMs,10);assert.equal(r.metrics.spotifyApi.inclusiveMs,10);
});
for(const people of [2,4]) test(`${people} osoby: retencja Last.fm zachowuje rekordy, kolejność i nieobecne preferencje`,async()=>{
 const r=await evaluate(({fixture,oldRetention,oldCoverage,people})=>{
  Date.now=()=>Date.parse('2026-10-09T09:00:00Z');(0,eval)(`(${fixture})`)({people,poolSize:100});
  const current=retainLastFmPool,coverage=retentionCoverage,normalize=normalizeGenreName;let calls=0;
  normalizeGenreName=(...args)=>{calls++;return normalize(...args);};
  const pools=[loadLastFmArtistPool().slice(0,85),loadLastFmTrackPool().slice(0,85)];const results=[];
  for(let i=0;i<pools.length;i++) {
   pools[i][0].sources=['recent'];pools[i][0].recentObservation={user:'benchmark',plays:[Math.floor(Date.now()/1000)-60]};
   retentionCoverage=(0,eval)(`(${oldCoverage})`);calls=0;const old=(0,eval)(`(${oldRetention})`)(pools[i],60,i===1),beforeCalls=calls;
   retentionCoverage=coverage;calls=0;const after=current(pools[i],60,i===1);results.push({old,after,beforeCalls,afterCalls:calls});
  }
  return results;
 },{fixture:installP4Fixture.toString(),oldRetention:baseline.functions.retainLastFmPool,oldCoverage:baseline.functions.retentionCoverage,people});
 for(const row of r){assert.deepEqual(row.after,row.old);assert.equal(row.after.length,60);assert.ok(row.afterCalls<row.beforeCalls/2);}
});
