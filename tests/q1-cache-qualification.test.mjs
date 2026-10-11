import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startBrowserHarness} from './helpers/browser.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/q1-2-cache-qualification.json',import.meta.url),'utf8')).reuseQualifyingCache;
let harness;before(async()=>harness=await startBrowserHarness());after(async()=>harness?.close());
async function run(kind,policy){const s=await harness.page();try{return await s.page.evaluate(({kind,policy,baseline})=>{
 Date.now=()=>Date.parse('2026-10-11T12:00:00Z');Math.random=()=>.25;let seed=1;crypto.getRandomValues=a=>{for(let i=0;i<a.length;i++)a[i]=seed=(Math.imul(seed,1664525)+1013904223)>>>0;return a;};
 const selected=['bartek','asia','edyta','monika'].map(id=>({id,genres:['rock'],artists:[],categories:[],taste:{hasSurvey:true,likedGenres:['Rock'],okGenres:[],blockedGenres:[]}}));
 const make=(artist,n,variant=false,co=false)=>({id:`${artist}-${n}`,uri:`spotify:track:${artist}-${n}`,name:`Song ${n}${variant?' - Rework':''}`,artists:[{id:artist.repeat(22),name:artist},...(co?[{id:'A'.repeat(22),name:'A'}]:[])],album:{name:'Album'}});
 const rows=['A','B'].flatMap(artist=>Array.from({length:artist==='A'?2:1},(_,n)=>({track:make(artist,n),queries:['genre:"rock"'],savedAt:Date.now()})));
 if(kind.startsWith("first-"))rows[0].track.artists.push({id:"o",name:"Royal Philharmonic Orchestra"});
 saveCandidatePool(rows);addLastFmTracks(['A','B','C'].flatMap(artist=>Array.from({length:20},(_,n)=>({name:`Song ${n}`,artist:{name:artist}}))),{tags:['rock']});
 if(kind.startsWith('first-'))localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify((kind==='first-classical'?['classical','rock']:['rock','classical']).map(tag=>({artist:'A',tags:[tag],sources:['tag'],savedAt:Date.now()}))));
 const a=createCandidateAcquisition(selected);let additions;
 if(kind==='saturated')additions=Array.from({length:15},(_,n)=>make('A',n+2));
 else if(kind==='existing')additions=rows.map(r=>r.track);
 else if(kind==='coartist')additions=[make('C',2,false,true)];
 else if(kind==='duplicate')additions=[{...make('B',0),id:'alternate',uri:'spotify:track:alternate'}];
 else additions=[make('A',2),make('B',1),make('B',2),make('C',2,true),make('C',3),make('C',4)];
 const cache=new Map(additions.map(track=>[track.id,{track,queries:['genre:"rock"'],savedAt:Date.now()-1000,lastUsedAt:Date.now()}]));
 const original=eligibleGroupCandidates,calls=[];eligibleGroupCandidates=(...args)=>{calls.push({rows:(args[3]||loadCandidatePool()).length,canonical:(args[4]||args[3]||loadCandidatePool()).length});return original(...args);};
 if(policy==='baseline')reuseQualifyingCache=(0,eval)(`(${baseline})`);
 reuseQualifyingCache(cache,a);
 const pool=loadCandidatePool(),ctx=acquisitionContext(selected);const {eligible,stats}=original(selected,generationBlocklists(selected),ctx);const result=selectGroupPlaylist(eligible,10,ctx,stats);
 return {pool,ids:result.tracks.map(t=>t.id),details:[...result.details],counts:result.discoveryCount,calls,canonical:[...canonicalCleanVariantSignatures].sort()};
 },{kind,policy,baseline});}finally{assert.deepEqual(s.errors,[]);await s.close();}}
for(const kind of ['saturated','existing','coartist','duplicate','mixed','first-classical','first-modern'])test(`Q1.3 ${kind}: identical pool, scores, selection and canonical variants`,async()=>{
 const a=await run(kind,'baseline'),b=await run(kind,'candidate');const {calls:ac,...ao}=a,{calls:bc,...bo}=b;assert.deepEqual(bo,ao);
 if(['saturated','coartist','duplicate'].includes(kind)){assert.ok(ac.length>0);assert.equal(bc.length,0);}
 if(kind==='mixed'){assert.ok(bc[0].rows<ac[0].rows);assert.equal(bc[0].canonical,ac[0].canonical);assert.ok(b.pool.some(r=>r.track.id==='C-3'));}
});
test('Q1.3 partial qualification keeps existing clean versions in canonical context',async()=>{
 const s=await harness.page();try{const out=await s.page.evaluate(()=>{
  const p=[{id:'bartek',genres:['rock'],artists:[],categories:[],taste:{hasSurvey:true,likedGenres:['Rock'],okGenres:[],blockedGenres:[]}}];
  const clean={track:{id:'clean',uri:'spotify:track:clean',name:'Song',artists:[{id:'a',name:'A'}]},queries:['genre:"rock"'],savedAt:Date.now()};const remaster={...clean,track:{...clean.track,id:'remaster',uri:'spotify:track:remaster',name:'Song - 2020 Remaster'}};
  addLastFmArtists([{name:'A'}],{tags:['rock']});const ctx=acquisitionContext(p,[clean,remaster]);const a=eligibleGroupCandidates(p,generationBlocklists(p),ctx,[clean,remaster]);const b=eligibleGroupCandidates(p,generationBlocklists(p),ctx,[remaster],[clean,remaster]);
  return {full:a.stats.unwantedVariant,partial:b.stats.unwantedVariant,eligible:b.eligible.length};
 });assert.equal(out.full,1);assert.equal(out.partial,1);assert.equal(out.eligible,0);}finally{await s.close();}
});
