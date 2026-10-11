import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
import {entry} from './helpers/generation-log.mjs';
let h;before(async()=>h=await startBrowserHarness());after(async()=>h.close());
const setup=async page=>page.evaluate(e=>{
  lastFmSpotifyAccount='owner';generationHistoryAuthorized=true;
  localStorage.setItem('spotify_access_token','fake');localStorage.setItem('spotify_token_expires',String(Date.now()+3600000));
  localStorage.setItem('office_generation_log_last_v1',JSON.stringify({account:'owner',entry:e}));
  getValidAccessToken=async()=>localStorage.getItem('spotify_access_token');
  document.getElementById('mixerBox').style.display='block';document.getElementById('generatorTools').open=true;document.getElementById('generationHistoryPanel').open=true;
},entry());
for(const scenario of ['success','empty','503','429','network','timeout','invalid','duplicate-id','401-recovered','401-twice','refresh-network'])test(`LOG2 read-only history: ${scenario}`,async()=>{
 const s=await h.page();try{
 await setup(s.page);
 const r=await s.page.evaluate(async({scenario,e})=>{
  let calls=0,refreshes=0,requests=[];const oldFetch=fetch,oldRefresh=refreshAccessToken,oldTimeout=AbortSignal.timeout;
  const before={...localStorage};
  const row={entry:e,receivedAt:'2026-10-11T00:00:01.000Z'};
  fetch=async(url,options)=>{calls++;requests.push({url,method:options.method,body:options.body,cache:options.cache});
   if(scenario==='network')throw new Error('secret raw error');
   if(scenario==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
   if(['503','429'].includes(scenario))return Response.json({error:'secret upstream'}, {status:Number(scenario),headers:{'Retry-After':'60'}});
   if(scenario.startsWith('401') || scenario==='refresh-network'){if(calls===1 || scenario==='401-twice')return Response.json({ok:false},{status:401});}
   if(scenario==='invalid')return Response.json({ok:true,entries:[{entry:{...e,token:'secret'},receivedAt:row.receivedAt}]});
   return Response.json({ok:true,entries:scenario==='empty'?[]:scenario==='duplicate-id'?[row,row]:[row]});};
  refreshAccessToken=async()=>{refreshes++;if(scenario==='refresh-network')throw new Error('offline secret');return 'renewed';};
  if(scenario==='timeout')AbortSignal.timeout=()=>{const c=new AbortController();setTimeout(()=>c.abort(),5);return c.signal;};
  try{await generationHistoryView.load();if(['429','503'].includes(scenario))await generationHistoryView.load();return {calls,refreshes,requests,cloud:document.getElementById('generationHistoryRows').textContent,local:document.getElementById('generationHistoryLocal').textContent,status:document.getElementById('generationHistoryStatus').textContent,disabled:document.getElementById('generationHistoryRefresh').disabled,unchanged:JSON.stringify(before)===JSON.stringify({...localStorage}),generator:generationInFlight};}
  finally{fetch=oldFetch;refreshAccessToken=oldRefresh;AbortSignal.timeout=oldTimeout;}
 },{scenario,e:entry()});
 const okay=['success','401-recovered'].includes(scenario);
 assert.equal(r.calls,scenario.startsWith('401')?2:1);assert.equal(r.refreshes,scenario.startsWith('401')||scenario==='refresh-network'?1:0);
 assert.equal(r.disabled,false);assert.equal(r.unchanged,true);assert.equal(r.generator,false);
 assert.ok(r.requests.every(x=>x.method==='GET' && x.url==='/api/generations?limit=100' && x.body===undefined && x.cache==='no-store'));
 if(okay){assert.match(r.cloud,/48\/60/);assert.match(r.cloud,/23.9 s/);assert.match(r.cloud,/27.1/);assert.match(r.cloud,/Edyta 67.0/);assert.match(r.cloud,/limit wykonawcy: 18/);assert.match(r.cloud,/potwierdzono zapis/);assert.equal(r.local,'');}
 else {assert.match(r.local,/Kopia lokalna/);assert.match(r.local,/48\/60/);assert.doesNotMatch(r.cloud,/48\/60/);}
 assert.doesNotMatch(r.status,/secret/);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
test('LOG2 filters are local, keep source order and preserve legacy version records',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async e=>{
 const old=fetch;let calls=0;const failure={...e,id:'00000000-0000-0000-0000-000000000002',version:'v43.35.LOG2',outcome:'error',profiles:['bartek','asia','monika'],length:0,playlistCreated:false,selection:null};
 fetch=async()=>{calls++;return Response.json({ok:true,entries:[{entry:failure,receivedAt:e.finishedAt},{entry:e,receivedAt:e.finishedAt}]});};
 try{await generationHistoryView.load();const rows=document.getElementById('generationHistoryRows'),all=rows.textContent;
 const select=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change'));return rows.textContent;};
 return {calls,all,success:select('generationHistoryOutcome','success'),absent:select('generationHistoryProfile','monika'),failure:(select('generationHistoryOutcome','error')),legacy:(select('generationHistoryProfile',''),select('generationHistoryOutcome',''),select('generationHistoryVersion','v43.34.LOG1'))};}
 finally{fetch=old;}
 },entry());assert.equal(r.calls,1);assert.ok(r.all.indexOf('v43.35.LOG2')<r.all.indexOf('v43.34.LOG1'));assert.doesNotMatch(r.success,/przerwane/);assert.match(r.absent,/Brak wpisów pasujących/);assert.match(r.failure,/Brak potwierdzenia/);assert.match(r.legacy,/v43.34.LOG1/);assert.doesNotMatch(r.legacy,/v43.35.LOG2/);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
for(const scenario of ['logged-out','other-owner','corrupt-local','unsafe-local','late-account','logout','external-session'])test(`LOG2 private data boundaries: ${scenario}`,async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async({scenario,e})=>{
 let calls=0,release;const old=fetch;
 if(scenario==='logged-out')generationHistoryAuthorized=false;
 if(scenario==='other-owner')localStorage.setItem('office_generation_log_last_v1',JSON.stringify({account:'different',entry:e}));
 if(scenario==='corrupt-local')localStorage.setItem('office_generation_log_last_v1','{');
 if(scenario==='unsafe-local')localStorage.setItem('office_generation_log_last_v1',JSON.stringify({account:'owner',entry:{...e,version:'<img src=x onerror="window.xss=1">'}}));
 fetch=async()=>{calls++;if(['late-account','logout','external-session'].includes(scenario))await new Promise(resolve=>release=resolve);return Response.json({ok:true,entries:scenario==='other-owner'||scenario==='corrupt-local'||scenario==='unsafe-local'?[]:[{entry:e,receivedAt:e.finishedAt}]});};
 try{const pending=generationHistoryView.load();if(['late-account','logout','external-session'].includes(scenario)){while(!release)await new Promise(r=>setTimeout(r,0));
  if(scenario==='late-account'){lastFmSpotifyAccount='different';generationHistoryView.reset();}
  if(scenario==='logout')clearTokens();
  if(scenario==='external-session')window.dispatchEvent(new StorageEvent('storage',{key:'spotify_access_token',newValue:'other',storageArea:localStorage}));
  release();}
 await pending;return {calls,cloud:document.getElementById('generationHistoryRows').textContent,local:document.getElementById('generationHistoryLocal').textContent,disabled:document.getElementById('generationHistoryRefresh').disabled,xss:window.xss||0};}
 finally{fetch=old;}
 },{scenario,e:entry()});assert.equal(r.calls,scenario==='logged-out'?0:1);assert.doesNotMatch(r.cloud,/48\/60/);assert.equal(r.local,'');assert.equal(r.disabled,false);assert.equal(r.xss,0);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('LOG2 deduplicates simultaneous refresh and has no startup/open/filter polling',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async e=>{
 let calls=0,release;const old=fetch;fetch=async()=>{calls++;await new Promise(r=>release=r);return Response.json({ok:true,entries:[]});};
 try{await new Promise(r=>setTimeout(r,20));const before=calls;const one=generationHistoryView.load(),two=generationHistoryView.load();while(!release)await new Promise(r=>setTimeout(r,0));release();await Promise.all([one,two]);return {before,calls};}finally{fetch=old;}
 },entry());assert.deepEqual(r,{before:0,calls:1});assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('LOG2 stale cloud data survives transient error and local row is not claimed as complete history',async()=>{
 const s=await h.page();try{await setup(s.page);const r=await s.page.evaluate(async e=>{
 const old=fetch;let calls=0;fetch=async()=>++calls===1?Response.json({ok:true,entries:[{entry:e,receivedAt:e.finishedAt}]}):Response.json({ok:false},{status:503});
 try{await generationHistoryView.load();await generationHistoryView.load();return {text:document.getElementById('generationHistoryRows').textContent,status:document.getElementById('generationHistoryStatus').textContent};}finally{fetch=old;}
 },entry());assert.match(r.text,/48\/60/);assert.match(r.status,/Zachowano dostępne dane/);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
test('LOG2 mobile layout and keyboard refresh remain usable',async()=>{
 const s=await h.page();try{await setup(s.page);await s.page.setViewportSize({width:375,height:812});await s.page.evaluate(e=>{fetch=async()=>Response.json({ok:true,entries:[{entry:e,receivedAt:e.finishedAt}]});},entry());
 await s.page.locator('#generationHistoryRefresh').focus();await s.page.keyboard.press('Enter');await s.page.waitForFunction(()=>document.getElementById('generationHistoryStatus').textContent.includes('1 ostatnich'));
 const r=await s.page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,card:document.querySelector('.generation-history-card').getBoundingClientRect().width}));assert.equal(r.overflow,false);assert.ok(r.card<=375);assert.deepEqual(s.errors,[]);}finally{await s.close();}
});
