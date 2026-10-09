import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {startBrowserHarness} from '../helpers/browser.mjs';
import {installP4Fixture} from '../helpers/p4-fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('../fixtures/p4-baseline-v43.23.json',import.meta.url),'utf8'));
const repetitions=Number(process.env.OMM_BENCH_REPETITIONS||3);assert.ok(Number.isInteger(repetitions)&&repetitions>=1&&repetitions<=20);
const h=await startBrowserHarness(),results=[];
try {
 for(const people of [2,4])for(const tracks of [false,true]) {
  const s=await h.page();try {
   const result=await s.page.evaluate(({fixture,baseline,people,tracks,repetitions})=>{
    Date.now=()=>Date.parse('2026-10-09T09:00:00Z');(0,eval)(`(${fixture})`)({people});
    const current=retainLastFmPool,coverage=retentionCoverage,legacy=(0,eval)(`(${baseline.functions.retainLastFmPool})`),oldCoverage=(0,eval)(`(${baseline.functions.retentionCoverage})`);
    const pool=tracks?loadLastFmTrackPool():loadLastFmArtistPool();const additions=tracks?400:40;
    for(let i=0;i<additions;i++)pool.push({artist:`Fresh fixture ${i}`, ...(tracks?{track:`Fresh song ${i}`} :{}),tags:['jazz','metal'],sources:['tag'],savedAt:Date.now()-1});
    const run=fn=>{const start=performance.now();const rows=fn(pool,tracks?3000:1800,tracks);return {ms:performance.now()-start,serialized:JSON.stringify(rows)};};
    const before=[],after=[];let canonical;
    for(let i=0;i<=repetitions;i++) {
     retentionCoverage=oldCoverage;const a=run(legacy);retentionCoverage=coverage;const b=run(current);
     if(a.serialized!==b.serialized)throw new Error('Last.fm retention changed records/order/data');
     if(canonical && canonical!==a.serialized)throw new Error('Retention baseline is not repeatable');canonical=a.serialized;
     if(i){before.push(a.ms);after.push(b.ms);}
    }
    return {people,tracks,offered:pool.length,length:JSON.parse(canonical).length,before,after,canonical};
   },{fixture:installP4Fixture.toString(),baseline,people,tracks,repetitions});
   assert.deepEqual(s.errors,[]);results.push({...result,canonical:undefined,semanticHash:createHash('sha256').update(result.canonical).digest('hex')});
  }finally{await s.close();}
 }
 console.log(JSON.stringify({baselineCommit:baseline.commit,repetitions,note:'Synthetic full Last.fm pools plus new records; fixed model clock; identical entire retained records/order. No network. Before then after in each pair. Small samples are not production p95.',results},null,2));
}finally{await h.close();}
