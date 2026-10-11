import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/q1-4-pagination.json',import.meta.url),'utf8'));
let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>harness?.close());
async function evaluate(fn,arg){const s=await harness.page();try{const r=await s.page.evaluate(fn,arg);assert.deepEqual(s.errors,[]);return r;}finally{await s.close();}}

test('nieznany katalog zaczyna od zera; legacy cache jest zachowany bez zgadywania zakresu',async()=>{
 const r=await evaluate(()=>{
  const query='artist:"A"';Math.random=()=>.999;
  const empty=searchOffsetsForQuery(query);
  writeSearchCache(query,0,[]);writeSearchCache(query,90,[]);
  return {empty,plan:searchPaginationPlan(query),offsets:searchOffsetsForQuery(query)};
 });assert.equal(r.empty[0],0);assert.equal(r.plan.state,'unknown');assert.equal(r.offsets[0],10);assert.deepEqual(new Set(r.offsets),new Set([0,10,20,30,40,50,60,70,80,90]));
});
for(const total of [0,1,5,10,11,38,63,100,107,1000])test(`potwierdzony total ${total}: nowe strony tylko w zakresie, cache poza nim nadal dostępny`,async()=>{
 const r=await evaluate(total=>{
  const q='genre:"rock"',offset=total===0?50:0,raw=Math.min(10,total);
  writeSearchCache(q,offset,[],{raw,total});
  // Legacy out-of-range cache must never be deleted or queried again.
  writeSearchCache(q,90,[]);
  return {plan:searchPaginationPlan(q),offsets:searchOffsetsForQuery(q),cache:readSearchCache(q,90)};
 },total);
 assert.equal(r.plan.total,total);assert.ok(r.plan.uncached.every(n=>n<total));assert.equal(r.plan.state,total===0?'empty':'bounded');assert.ok(r.offsets.includes(90));assert.deepEqual(r.cache,[]);
 if(total>10)assert.equal(r.plan.uncached.length,Math.min(10,Math.ceil(total/10))-1-(total>90?1:0));
});
test('znany zakres z głębokiej strony wciąż preferuje nieodczytaną stronę zero',async()=>{
 const r=await evaluate(()=>{writeSearchCache('x',80,[],{raw:0,total:63});return {plan:searchPaginationPlan('x'),offsets:searchOffsetsForQuery('x')};});
 assert.equal(r.offsets[0],0);assert.deepEqual(r.plan.uncached,[0,10,20,30,40,50,60]);assert.ok(r.offsets.includes(80));
});
for(const kind of ['kitty','empty-inside','different-totals'])test(`sprzeczne metadane ${kind}: ostrożna kolejność bez twardego odcinania katalogu`,async()=>{
 const r=await evaluate(kind=>{
  if(kind==='kitty')writeSearchCache('x',40,[],{raw:5,total:5});
  if(kind==='empty-inside')writeSearchCache('x',0,[],{raw:0,total:63});
  if(kind==='different-totals'){writeSearchCache('x',0,[],{raw:10,total:20});writeSearchCache('x',10,[],{raw:10,total:100});}
  return {plan:searchPaginationPlan('x'),offsets:searchOffsetsForQuery('x')};
 },kind);assert.equal(r.plan.state,'contradictory');assert.equal(r.plan.total,null);assert.deepEqual(r.offsets.slice(0,r.plan.uncached.length),r.plan.uncached);
});
test('filtr nazw ani częściowa strona nie wyznaczają końca katalogu',async()=>{
 const r=await evaluate(()=>{
  writeSearchCache('artist:"Mars Volta"',0,[],{raw:10,total:107});
  writeSearchCache('partial',0,[],{raw:5,total:100});
  return [searchPaginationPlan('artist:"Mars Volta"'),searchPaginationPlan('partial')];
 });for(const plan of r){assert.equal(plan.state,'bounded');assert.equal(plan.uncached.length,9);}
});
test('wygasłe, uszkodzone i niepełne metadane nie tworzą fałszywego limitu',async()=>{
 const r=await evaluate(()=>{
  const plans=[];
  for(const metadata of [{raw:null,total:0},{raw:0,total:-1},{raw:11,total:0},{raw:0,total:1.5},{raw:'0',total:0}]){
   writeSearchCache('x',0,[],metadata);plans.push(searchPaginationPlan('x').state);
  }
  localStorage.setItem(searchCacheKey('x',0),JSON.stringify({savedAt:Date.now()-SEARCH_CACHE_TTL_MS-1,items:[],metadata:{raw:0,total:0}}));
  plans.push(searchOffsetsForQuery('x')[0]);localStorage.setItem(searchCacheKey('x',0),'bad-json');plans.push(searchOffsetsForQuery('x')[0]);return plans;
 });assert.deepEqual(r,['unknown','unknown','unknown','unknown','unknown',0,0]);
});
test('rotacja znanego katalogu odwiedza różne nieopłacone strony i nie przekracza offsetu 90',async()=>{
 const r=await evaluate(()=>{
  writeSearchCache('x',0,[],{raw:10,total:63});
  const outputs=[];for(const seed of [0,1,2,3]){crypto.getRandomValues=array=>{array.fill(seed);return array;};outputs.push(searchOffsetsForQuery('x'));}return outputs;
 });assert.ok(new Set(r.map(x=>x[0])).size>1);for(const offsets of r){assert.equal(offsets.at(-1),0);assert.ok(offsets.every(n=>n>=0&&n<=60));}
});
test('krótki katalog nie zużywa kolejnego budżetu; następny wykonawca dostaje żądanie',async()=>{
 const r=await evaluate(async()=>{
  writeSearchCache('artist:"small"',0,[],{raw:1,total:1});
  writeSearchCache('artist:"empty"',50,[],{raw:0,total:0});
  const selected=[{id:'bartek',artists:[],genres:[],categories:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}];
  newSearchesThisGeneration=0;maxNewSearchesThisGeneration=1;waitForSearchSlot=async()=>{};
  const calls=[];fetch=async input=>{const u=new URL(input);calls.push([u.searchParams.get('q'),u.searchParams.get('offset')]);return Response.json({tracks:{items:[],total:0}});};
  await primeDiverseQueries('token',['artist:"small"','artist:"empty"','artist:"new"'].map(query=>({query})),1,createCandidateAcquisition(selected));return {calls,count:newSearchesThisGeneration};
 });assert.deepEqual(r.calls,[['artist:"new"','0']]);assert.equal(r.count,1);
});
test('plan wielu stron reaguje na świeżą odpowiedź total=1, bez requestów offset 10/20',async()=>{
 const r=await evaluate(async()=>{
  waitForSearchSlot=async()=>{};newSearchesThisGeneration=0;maxNewSearchesThisGeneration=12;
  const calls=[];fetch=async input=>{const u=new URL(input);calls.push(Number(u.searchParams.get('offset')));return Response.json({tracks:{items:[{id:'x',uri:'spotify:track:x',name:'Live - Live',artists:[{id:'a',name:'A'}]}],total:1}});};
  await collectFromQueries('token',['genre:"rock"'],3,new Set(),new Set(),new Map(),new Set(),new Set(),new Set(),[]);
  return {calls,count:newSearchesThisGeneration};
 });assert.deepEqual(r.calls,[0]);assert.equal(r.count,1);
});
test('429 i 401 zachowują offset i jeden budżet Search; plan zmienia się dopiero po sukcesie',async()=>{
 const r=await evaluate(async()=>{
  const now=Date.now();localStorage.setItem('spotify_access_token','old');localStorage.setItem('spotify_refresh_token','mock-refresh');localStorage.setItem('spotify_token_expires',String(now+3600000));
  waitForSearchSlot=async()=>{};sleep=async()=>{};newSearchesThisGeneration=0;maxNewSearchesThisGeneration=12;
  let count=0,refresh=0;const calls=[];fetch=async input=>{
   const u=new URL(input);if(u.pathname==='/api/token'){refresh++;return Response.json({access_token:'new',expires_in:3600});}
   calls.push(Number(u.searchParams.get('offset')));count++;
   if(count===1)return Response.json({}, {status:429,headers:{'Retry-After':'1'}});
   if(count===2)return Response.json({}, {status:401});return Response.json({tracks:{items:[],total:0}});
  };
  const offset=searchOffsetsForQuery('x')[0];await searchTracks('old','x',offset);return {calls,refresh,count:newSearchesThisGeneration,plan:searchPaginationPlan('x')};
 });assert.deepEqual(r.calls,[0,0,0]);assert.equal(r.refresh,1);assert.equal(r.count,1);assert.equal(r.plan.state,'empty');assert.deepEqual(r.plan.uncached,[]);
});
test('błąd sieci nie tworzy potwierdzenia pustego katalogu ani drugiego zapytania',async()=>{
 const r=await evaluate(async()=>{
  waitForSearchSlot=async()=>{};newSearchesThisGeneration=0;let calls=0;fetch=async()=>{calls++;throw new TypeError('network');};
  try{await searchTracks('token','x',searchOffsetsForQuery('x')[0]);}catch{}
  return {calls,count:newSearchesThisGeneration,plan:searchPaginationPlan('x')};
 });assert.equal(r.calls,1);assert.equal(r.count,1);assert.equal(r.plan.state,'unknown');assert.equal(r.plan.uncached[0],0);
});
for(const people of [2,4])test(`${people} osoby: małe katalogi dają 0→4 utwory przy tych samych dwóch żądaniach i progach`,async()=>{
 const outputs=[];
 for(const old of [true,false])outputs.push(await evaluate(async({old,people,baseline})=>{
  if(old)searchOffsetsForQuery=(0,eval)(`(${baseline.searchOffsetsForQuery})`);
  const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,name:profiles[id].name,artists:[],genres:['rock'],categories:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}));
  const make=(artist,n)=>({id:`${artist}${n}`,uri:`spotify:track:${artist}${n}`,name:`Song ${n}`,artists:[{id:artist,name:artist}]});
  const tracks=['A','B'].flatMap(a=>[0,1].map(n=>make(a,n)));
  addLastFmTracks(tracks.map(t=>({name:t.name,artist:{name:t.artists[0].name}})),{tags:['rock']});
  waitForSearchSlot=async()=>{};newSearchesThisGeneration=0;maxNewSearchesThisGeneration=2;Math.random=()=>0;crypto.getRandomValues=array=>{array.fill(0);return array;};
  const calls=[];fetch=async input=>{const u=new URL(input),offset=Number(u.searchParams.get('offset')),artist=u.searchParams.get('q').includes('"A"')?'A':'B';calls.push(offset);return Response.json({tracks:{items:offset===0?tracks.filter(t=>t.artists[0].name===artist):[],total:2}});};
  await primeDiverseQueries('token',['artist:"A"','artist:"B"'].map(query=>({query})),2,createCandidateAcquisition(selected));
  const ctx=buildGroupRecommendationContext(selected),{eligible,stats}=eligibleGroupCandidates(selected,generationBlocklists(selected),ctx);Math.random=()=>.25;
  const result=selectGroupPlaylist(eligible,4,ctx,stats);
  return {calls,count:newSearchesThisGeneration,ids:result.tracks.map(t=>t.id),scores:eligible.flatMap(i=>Object.values(i.byUser).map(x=>x.score)),discovery:result.discoveryCount,maxDiscovery:result.discoveryQuota.max,artists:[...new Set(result.tracks.flatMap(t=>[...trackArtistKeys(t)]))]};
 },{old,people,baseline}));
 assert.deepEqual(outputs[0].calls,[10,10]);assert.deepEqual(outputs[1].calls,[0,0]);assert.equal(outputs[0].count,2);assert.equal(outputs[1].count,2);assert.equal(outputs[0].ids.length,0);assert.equal(outputs[1].ids.length,4);assert.ok(outputs[1].scores.every(x=>x>=35));assert.equal(outputs[1].artists.length,2);assert.ok(outputs[1].discovery<=outputs[1].maxDiscovery);
});
