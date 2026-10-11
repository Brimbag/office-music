import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQ1 } from './helpers/q1-audit.mjs';
const row=(id,discovery=false,artist=id)=>({id,discovery,safe:true,artists:[artist],signatures:[id],byUser:{bartek:60,asia:55},historyKnown:false});
const fixture=(rows,selected=[],extra={})=>({requested:60,rows,selected,discovery:selected.filter(id=>rows.find(r=>r.id===id)?.discovery).length,discoverySetting:30,maximumShare:.35,maximumDiscovery:Math.floor(selected.length*.35),filters:{rawPool:rows.length,eligible:rows.length},selectionCounters:{},repair:null,stop:null,...extra});
test('Q1 audit does not mutate input; below-target discovery does not imply shortening',()=>{
 const rows=Array.from({length:50},(_,i)=>row(String(i),i<5));const input=fixture(rows,rows.map(r=>r.id));const before=JSON.stringify(input),a=analyzeQ1(input);
 assert.equal(a.length,50);assert.equal(a.discoveryShare,.1);assert.equal(a.optimisticUpperBound,50);assert.equal(JSON.stringify(input),before);
});
for(const length of [36,48,50])test(`Q1 21/${length}: classification uses actual discovery quota`,()=>{
 const rows=Array.from({length:length+1},(_,i)=>row(String(i),i<21)),selected=rows.slice(0,length).map(r=>r.id);
 const a=analyzeQ1(fixture(rows,selected));assert.equal(a.unused.appendableKnown,1);assert.equal(a.discovery,21);assert.ok(a.hardFailures.discoveryAboveMaximum>0);
 assert.equal(a.maximumDiscovery,Math.floor(length*.35));
});
test('Q1 distinguishes no safe pool from unused hard-safe known candidate',()=>{
 const a=row('a'),b=row('b');const known=analyzeQ1(fixture([a,b],['a']));assert.equal(known.diagnosis,'unused_appendable_candidates');assert.equal(known.unused.appendableKnown,1);
 const noSupply=analyzeQ1(fixture([a],['a']));assert.equal(noSupply.diagnosis,'insufficient_safe_pool');
});
test('Q1 residual reasons are a partition, not repeated selection-counter totals',()=>{
 const rows=[row('a',false,'A'),row('b',true,'A'),row('c'),row('artist-limit',false,'A'),{...row('duplicate'),signatures:['a']},{...row('unsafe'),safe:false},row('discovery',true),row('known')];
 const result=analyzeQ1(fixture(rows,['a','b','c']));
 assert.deepEqual(result.unused,{total:5,unsafe:1,duplicate:1,artistLimit:1,discoveryQuota:1,appendable:1,appendableKnown:1,appendableDiscovery:0});
});
for(const setting of [0,100])test(`Q1 respects discovery ${setting}% meaning`,()=>{
 const a=analyzeQ1(fixture([row('known'),row('discovery',true)],[],{discoverySetting:setting}));
 assert.equal(a.unused.appendable,1);assert.equal(a.unused[setting?'appendableDiscovery':'appendableKnown'],1);assert.equal(a.optimisticUpperBound,1);
});
test('Q1 optimistic bound includes artist cap but is never claimed as achievable',()=>{
 const rows=Array.from({length:10},(_,i)=>row(String(i),false,'same'));
 assert.equal(analyzeQ1(fixture(rows)).optimisticUpperBound,2);
});
test('Q1 truly history-known share differs from non-discovery classification',()=>{
 const rows=[{...row('known-in-model'),historyKnown:false},{...row('played',true),historyKnown:true}];
 const a=analyzeQ1(fixture(rows,['known-in-model','played']));assert.equal(a.historyKnown,1);assert.equal(a.knownEligible,1);
});
test('Q1 rounding bound matches necessary quota feasibility for short playlists',()=>{
 for(let known=0;known<=8;known++){
  const rows=[...Array.from({length:known},(_,i)=>row(`k${i}`)),...Array.from({length:20},(_,i)=>row(`d${i}`,true))];
  let feasible=0;for(let length=0;length<=rows.length;length++)if(Math.max(0,length-known)<=Math.floor(length*.35+1e-9))feasible=length;
  assert.equal(analyzeQ1(fixture(rows)).optimisticUpperBound,feasible);
 }
});
test('Q1 flags a score below 35 and accepts exactly 35',()=>{
 for(const score of [34.999,35]){
  const a=analyzeQ1(fixture([{...row('a'),byUser:{bartek:60,asia:score}}],['a']));
  assert.equal(a.hardFailures.below35,score<35?1:0);
 }
});
test('Q1 identifies known shortage separately from overall candidate shortage',()=>{
 const rows=Array.from({length:80},(_,i)=>row(String(i),i>=10));
 const a=analyzeQ1(fixture(rows,rows.slice(0,15).map(row=>row.id)));
 assert.equal(a.diagnosis,'insufficient_known_candidates');assert.equal(a.bounds.discovery,15);
});
