import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startBrowserHarness} from './helpers/browser.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/q1-1-acquisition.json',import.meta.url),'utf8')).primeDiverseQueries;
let harness;before(async()=>{harness=await startBrowserHarness();});after(async()=>harness?.close());
async function run(people,policy,kind='normal') {
 const s=await harness.page();try {return await s.page.evaluate(async({people,policy,kind,baseline})=>{
  const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,genres:['rock'],artists:[],categories:[],taste:{hasSurvey:true,likedGenres:['Rock'],okGenres:[],blockedGenres:[]}}));
  const make=(artist,n)=>({id:`${artist}-${n}`,uri:`spotify:track:${artist}-${n}`,name:`Song ${n}`,artists:[{id:artist.repeat(22),name:artist}],album:{name:'Album'}});
  saveCandidatePool([0,1].map(n=>({track:make('A',n),queries:['artist:"A"'],savedAt:Date.now()})));
  addLastFmTracks(['A','B'].flatMap(artist=>[0,1,2,3].map(n=>({name:`Song ${n}`,artist:{name:artist}}))),{tags:['rock']});
  lastFmArtistsForTags=()=>kind==='no-artists'?['A']:['A','B'];
  if(policy==='baseline')primeDiverseQueries=(0,eval)(`(${baseline})`);
  if(kind==='cached-artists')hasFreshSearchCache=(q)=>q.startsWith('artist:');
  newSearchesThisGeneration=0;maxNewSearchesThisGeneration=kind==='zero-budget'?0:1;
  const calls=[];
  searchTracks=async(_token,query)=>{calls.push(query);newSearchesThisGeneration++;const tracks=query==='artist:"B"'?[make('B',0),make('B',1)]:[make('A',2),make('A',3)];addToCandidatePool(query,tracks);return tracks;};
  await primeCommonGroupQueries('test',selected,1);
  const ctx=buildGroupRecommendationContext(selected);const {eligible,stats}=eligibleGroupCandidates(selected,generationBlocklists(selected),ctx);Math.random=()=>.25;
  const result=selectGroupPlaylist(eligible,6,ctx,stats);
  const counts={};for(const t of result.tracks)for(const a of trackArtistKeys(t))counts[a]=(counts[a]||0)+1;
  return {calls,length:result.tracks.length,counts,average:Object.values(result.satisfaction).map(x=>x.average),minimum:Math.min(...[...result.details.values()].flatMap(d=>Object.values(d.byUser)))};
 },{people,policy,kind,baseline});}finally{assert.deepEqual(s.errors,[]);await s.close();}
}
for(const people of [2,3,4])test(`Q1.2 ${people} profiles: one paid request grows safe playlist 2→4, same fit and caps`,async()=>{
 const a=await run(people,'baseline'),b=await run(people,'candidate');assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);assert.equal(a.length,2);assert.equal(b.length,4);assert.equal(b.calls[0],'artist:"B"');assert.deepEqual(a.average,b.average);assert.ok(b.minimum>=35);assert.ok(Object.values(b.counts).every(n=>n<=2));
});
for(const kind of ['no-artists','cached-artists'])test(`Q1.2 retains genre fallback: ${kind}`,async()=>{const x=await run(4,'candidate',kind);assert.equal(x.calls.length,1);assert.ok(x.calls[0].startsWith('genre:'));assert.equal(x.length,2);});
test('Q1.2 exhausted budget spends zero requests',async()=>{const x=await run(4,'candidate','zero-budget');assert.equal(x.calls.length,0);assert.equal(x.length,2);});
