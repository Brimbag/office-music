import test from 'node:test';
import assert from 'node:assert/strict';
import '../spotify-playback-monitor.js';
const M=globalThis.OfficeSpotifyPlayback;
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function clock() {
 let t=0,id=0;const jobs=new Map();
 return {wall:()=>1760000000000+t,mono:()=>t,setTimer:(fn,ms)=>{jobs.set(++id,{at:t+ms,fn});return id;},clearTimer:id=>jobs.delete(id),
  async advance(ms){const end=t+ms;while(true){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;t=next[1].at;jobs.delete(next[0]);next[1].fn();await flush();}t=end;await flush();},jobs};
}
const payload=(extra={})=>({is_playing:true,progress_ms:10000,device:{id:'device',name:'Desktop',is_active:true,is_restricted:false,volume_percent:40,supports_volume:true},context:{uri:'spotify:playlist:omm'},item:{type:'track',id:'track',uri:'spotify:track:track',duration_ms:200000},...extra});
function setup(response=()=>Response.json(payload())) {
 const c=clock();let session={account:'owner',session:'login'},calls=0;const seen=[];
 const core=M.createCore({...c,getSession:()=>session,request:async(_scope,_signal,attempt)=>{attempt();calls++;return response();},onSnapshot:s=>seen.push(s),random:()=>0});
 return {c,core,seen,calls:()=>calls,setSession:s=>session=s};
}
test('M normalizes track, episode, capabilities and nullable values without coercion',()=>{
 const track=M.normalize(payload());assert.equal(track.item.type,'track');assert.equal(track.device.volumePercent,40);assert.equal(track.device.supportsVolume,true);
 const episode=M.normalize(payload({item:{type:'episode',id:'ep',uri:'spotify:episode:ep',duration_ms:180000,show:{id:'rmf'}}}));assert.equal(episode.item.showId,'rmf');assert.equal(episode.item.type,'episode');
 const unknown=M.normalize(payload({progress_ms:null,device:{id:null,volume_percent:null,supports_volume:false},item:{type:'other'}}));assert.equal(unknown.progressMs,null);assert.equal(unknown.device.volumePercent,null);assert.equal(unknown.device.supportsVolume,false);assert.equal(unknown.device.active,null);assert.equal(unknown.item.type,'unknown');
 assert.equal(M.normalize(null),null);assert.equal(M.normalize({}),null);assert.equal(M.normalize(payload({progress_ms:-1})).progressMs,null);
 assert.equal(M.normalize(payload({device:{volume_percent:101,supports_volume:'true'}})).device.volumePercent,null);
});
test('M Retry-After supports seconds/date, bounded delays and safe missing values',()=>{
 const now=Date.parse('2026-10-11T10:00:00Z');assert.equal(M.retryDelay('20',now),20000);assert.equal(M.retryDelay('0',now),1000);
 assert.equal(M.retryDelay('Sun, 11 Oct 2026 10:00:30 GMT',now),30000);assert.equal(M.retryDelay('999999999',now),86400000);
 for(const h of [null,'','garbage','-1'])assert.equal(M.retryDelay(h,now),null);
});
test('M concurrent consumers share one immutable observation and fresh cache; no overlapping GET',async()=>{
 let finish;const s=setup(()=>new Promise(r=>finish=r));
 const one=s.core.read(),two=s.core.read({fresh:true});await flush();assert.equal(s.calls(),1);finish(Response.json(payload()));
 const [a,b]=await Promise.all([one,two]);assert.equal(a,b);assert.equal(Object.isFrozen(a.device),true);assert.equal(s.seen.length,1);
 assert.equal(await s.core.read(),a);assert.equal(s.calls(),1);assert.equal(s.core.diagnostics().cacheHits,1);assert.equal(s.c.jobs.size,0);
});
for(const scenario of ['204','401','403','429','quota','500','invalid','network','timeout','body-timeout'])test(`M failure and continuity break: ${scenario}`,async()=>{
 const s=setup(()=>{
  if(scenario==='network')throw new TypeError('private token must never be logged');
  if(scenario==='timeout')return new Promise(()=>{});
  if(scenario==='body-timeout')return {status:200,ok:true,json:()=>new Promise(()=>{})};
  if(scenario==='204')return new Response(null,{status:204});
  if(scenario==='invalid')return Response.json({private:'bad'});
  if(scenario==='quota')return Response.json({error:{message:'QUOTA_EXCEEDED'}},{status:429});
  return Response.json({error:'private upstream'},{status:Number(scenario),headers:scenario==='429'?{'Retry-After':'20'}:{}});
 });
 const pending=s.core.read();await flush();if(scenario.includes('timeout'))await s.c.advance(5000);const sample=await pending;
 assert.equal(sample.available,false);assert.equal(sample.continuity.continuous,false);assert.doesNotMatch(JSON.stringify(s.core.diagnostics()),/private|token|track|Desktop/);
 assert.doesNotMatch(JSON.stringify(sample),/private|token/);assert.equal(s.c.jobs.size,0);
 if(['401','403','quota'].includes(scenario)){await s.c.advance(120000);await s.core.read({fresh:true});assert.equal(s.calls(),1);}
 if(scenario==='429'){await s.core.read({fresh:true});assert.equal(s.calls(),1);await s.c.advance(19999);await s.core.read();assert.equal(s.calls(),1);await s.c.advance(1);await s.core.read();assert.equal(s.calls(),2);}
});
test('M 429 without Retry-After backs off and does not retry in a tight loop',async()=>{
 const s=setup(()=>Response.json({error:'limited'},{status:429}));await s.core.read();assert.equal(s.core.diagnostics().backoffMs,30000);
 await s.c.advance(30000);await s.core.read();assert.equal(s.core.diagnostics().backoffMs,60000);assert.equal(s.calls(),2);
});
test('M unavailable device is distinct from Spotify HTTP error',async()=>{
 const s=setup(()=>Response.json(payload({device:null,item:null,is_playing:false,progress_ms:null})));
 const sample=await s.core.read();assert.equal(sample.available,true);assert.equal(sample.device,null);assert.equal(sample.isPlaying,false);assert.equal(sample.status,'ok');
});
for(const scenario of ['observed','device','context','paused','seek','gap','missing_progress','item_type'])test(`M conservative continuity: ${scenario}`,async()=>{
 let state=payload();const s=setup(()=>Response.json(state));const first=await s.core.read();assert.equal(first.continuity.continuous,false);
 await s.c.advance(scenario==='gap'?11000:5000);state=payload({progress_ms:15000});
 if(scenario==='device')state.device={...state.device,id:'other'};
 if(scenario==='context')state.context={uri:'spotify:playlist:outside'};
 if(scenario==='paused')state.is_playing=false;
 if(scenario==='seek')state.progress_ms=90000;
 if(scenario==='missing_progress')state.progress_ms=null;
 if(scenario==='item_type')state.item={...state.item,type:'episode'};
 const next=await s.core.read({fresh:true});assert.equal(next.continuity.reason,scenario);assert.equal(next.continuity.continuous,scenario==='observed');
});
test('M session change cancels and ignores late response, and resets fatal state',async()=>{
 let finish;const s=setup(()=>new Promise(r=>finish=r));const old=s.core.read();await flush();s.setSession({account:'other',session:'new'});s.core.syncSession();finish(Response.json(payload()));
 assert.equal((await old).status,'session_changed');assert.equal(s.seen.length,0);
 const pending=s.core.read();await flush();finish(Response.json(payload()));const current=await pending;assert.equal(current.account,'other');assert.equal(current.continuity.continuous,false);
});
test('M shared snapshots are account scoped, fresh, rebuilt from whitelist and never continuous on follower',async()=>{
 const s=setup();const a=await s.core.read();s.core.invalidate('leader');
 assert.equal(s.core.shared({...a,account:'other'}),null);assert.equal(s.core.shared({...a,receivedAt:s.c.wall()-1001}),null);
 const b=s.core.shared({...a,item:{...a.item,name:'Shared title',artists:['Shared artist'],token:'private'},token:'private',device:{...a.device,token:'private'}});assert.equal(b.item.name,'Shared title');assert.deepEqual(b.item.artists,['Shared artist']);assert.equal(b.continuity.reason,'follower');assert.doesNotMatch(JSON.stringify(b),/token|private/);
 assert.equal(await s.core.read(),b);assert.equal(s.calls(),1);
});
function locks() {
 const held=new Set();return {request(name,_options,callback){return Promise.resolve().then(async()=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}});}};
}
function pollSetup({playing=true}={}) {
 const c=clock();let visible=true,busy=false,calls=0;const samples=[];
 const m=M.create({...c,locks:locks(),leaseRequest:async()=>true,channelFactory:()=>null,getSession:()=>({account:'owner',session:'login'}),visible:()=>visible,busy:()=>busy,
  request:async(_scope,_signal,attempt)=>{attempt();calls++;return Response.json(payload({is_playing:playing,progress_ms:10000+c.mono()}));}});
 return {c,m,samples,calls:()=>calls,visible:v=>visible=v,busy:v=>busy=v};
}
test('M zero polling and timers without explicitly active consumer',async()=>{
 const s=pollSetup();const off=s.m.subscribe('passive',()=>{});await s.c.advance(60000);assert.equal(s.calls(),0);assert.equal(s.c.jobs.size,0);off();s.m.dispose();
});
test('M two active consumers share <=12 GET per rolling minute and exactly the same snapshot',async()=>{
 const s=pollSetup();const a=[],b=[];const offA=s.m.subscribe('volume',sample=>a.push(sample),{active:true}),offB=s.m.subscribe('skip',sample=>b.push(sample),{active:true});
 await flush();await s.c.advance(59999);assert.equal(s.calls(),12);assert.equal(a.length,12);assert.equal(b.length,12);for(let i=0;i<a.length;i++)assert.equal(a[i],b[i]);
 offA();const before=s.calls();await s.c.advance(5000);assert.equal(s.calls(),before+1);offB();await s.c.advance(60000);assert.equal(s.calls(),before+1);s.m.dispose();assert.equal(s.c.jobs.size,0);
});
test('M pause uses 30s cadence and visibility/generation stops polling without catch-up',async()=>{
 const s=pollSetup({playing:false});const seen=[];s.m.subscribe('armed',sample=>seen.push(sample),{active:true});await flush();await s.c.advance(59999);assert.equal(s.calls(),2);
 s.visible(false);s.m.wake('visibility');await s.c.advance(120000);assert.equal(s.calls(),2);
 s.visible(true);s.m.wake('visibility');await flush();assert.equal(s.calls(),3);assert.equal(seen.at(-1).continuity.continuous,false);
 s.busy(true);s.m.wake('generation');await s.c.advance(60000);assert.equal(s.calls(),3);s.busy(false);s.m.wake('generation');await flush();assert.equal(s.calls(),4);s.m.dispose();
});
test('M resume during an aborted read restarts exactly one polling loop',async()=>{
 const c=clock();let visible=true,calls=0;const seen=[];
 const m=M.create({...c,locks:locks(),leaseRequest:async()=>true,channelFactory:()=>null,getSession:()=>({account:'owner',session:'login'}),visible:()=>visible,
  request:async(_scope,signal,attempt)=>{attempt();calls++;if(calls===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));return Response.json(payload());}});
 m.subscribe('armed',sample=>seen.push(sample),{active:true});await flush();assert.equal(calls,1);
 visible=false;m.wake('hidden');visible=true;m.wake('resume');await flush();await c.advance(0);assert.equal(calls,2);assert.equal(seen.length,1);assert.equal(seen[0].continuity.continuous,false);m.dispose();
});
test('M delayed preflight does not send a GET after the deadline or sleep',async()=>{
 const c=clock();let start,calls=0;
 const m=M.createCore({...c,getSession:()=>({account:'owner',session:'login'}),request:async(_scope,_signal,attempt)=>{await new Promise(r=>start=r);attempt();calls++;return Response.json(payload());}});
 const pending=m.read();await flush();await c.advance(5001);start();assert.equal((await pending).status,'timeout');await flush();assert.equal(calls,0);
});
test('M background polling is opt-in per active consumer; visibility change does not reset ownership',async()=>{
 const s=pollSetup();const off=s.m.subscribe('rmf-volume',()=>{},{active:true,background:true});await flush();const before=s.calls();
 s.visible(false);s.m.wake('visibility');await s.c.advance(10000);assert.equal(s.calls(),before+2);assert.equal(s.m.diagnostics().leader,true);
 off();await s.c.advance(60000);assert.equal(s.calls(),before+2);s.m.dispose();
});
test('M passive background flag cannot enable hidden polling for ordinary active consumer',async()=>{
 const s=pollSetup();s.visible(false);s.m.subscribe('ordinary',()=>{},{active:true});s.m.subscribe('passive',()=>{},{background:true});await flush();await s.c.advance(60000);assert.equal(s.calls(),0);s.m.dispose();
});
test('M queued background consumer can restart an existing hidden ordinary consumer safely',async()=>{
 const s=pollSetup();s.visible(false);s.m.subscribe('ordinary',()=>{},{active:true});await flush();assert.equal(s.calls(),0);
 const off=s.m.subscribe('rmf-volume',()=>{},{active:true,background:true});await flush();assert.equal(s.calls(),1);
 off();await s.c.advance(60000);assert.equal(s.calls(),1);s.m.dispose();
});
test('S3.1 monitor whitelists bounded track labels, never extra fields or podcast labels',()=>{
 const p=payload({item:{type:'track',id:'track',uri:'spotify:track:track',duration_ms:200000,name:' Song ',artists:[{name:' Artist ',token:'secret'},{name:'bad\nname'}],access_token:'secret'}});
 const item=M.normalize(p).item;assert.equal(item.name,'Song');assert.deepEqual(item.artists,['Artist']);assert.ok(!JSON.stringify(item).includes('secret'));
 assert.equal(M.normalize(payload({item:{type:'episode',name:'Episode',artists:[{name:'A'}]}})).item.name,undefined);
 assert.equal(M.normalize(payload({item:{type:'track',name:'x'.repeat(301)}})).item.name,undefined);
});
