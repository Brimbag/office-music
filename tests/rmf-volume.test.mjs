import test from 'node:test';
import assert from 'node:assert/strict';
import '../rmf-volume.js';
const V=globalThis.OfficeRmfVolume;
const ep=(id='facts',name='10:00 Fakty',show=V.SHOW)=>({id,uri:`spotify:episode:${id}`,name,release_date:'2026-10-11',show:{id:show}});
function memory(){const rows=new Map();return Object.assign(async(action,r)=>{
 const old=rows.get(r.account);
 if(action==='get')return old?{...old}:null;
 if(action==='claim'&&old || action==='take'&&old?.revision!==r.expected || ['save','remove'].includes(action)&&(!old||old.owner!==r.owner||old.revision!==r.expected))return false;
 if(action==='remove')rows.delete(r.account);else {const clean={...r};delete clean.expected;rows.set(r.account,clean);}return true;
},{rows});}
function fixture({baseline=40,gain=10,store=memory(),lookup,write}={}){
 let at=10000,clock=10000,current=baseline,session={account:'owner',session:'login'},visible=true,busy=false,sub=null,device={id:'PC',active:true,restricted:false,supportsVolume:true};
 let item={type:'episode',id:'facts',uri:'spotify:episode:facts',showId:V.SHOW},playing=true,number=0;
 const writes=[],statuses=[];
 function snapshot(overrides={}){return {available:true,status:'ok',...session,isPlaying:playing,device:{...device,volumePercent:current},item:{...item},receivedAt:at,observationId:String(++number),...overrides};}
 let force=null;
 const monitor={subscribe(_name,listener){sub=listener;return ()=>{sub=null;};},read:async()=>typeof force==='function'?force():force||snapshot()};
 const controller=V.create({monitor,getSession:()=>session,store,confirmationDelays:[0,0],wall:()=>at,mono:()=>clock,uuid:()=>`id-${++number}`,visible:()=>visible,busy:()=>busy,onStatus:s=>statuses.push(s),
  lookup:lookup||(async id=>ep(id)),write:write||(async(value,id)=>{writes.push({value,id});current=value;})});
 controller.remember([ep('facts'),ep('facts-2')]);
 return {controller,store,writes,statuses,arm:()=>controller.arm(gain),send:async(overrides={},leader=true)=>controller.consume(snapshot(overrides),{leader}),
 setVolume:v=>current=v,item:v=>item=v,playing:v=>playing=v,device:v=>device={...device,...v},session:v=>session=v,
 visible:v=>visible=v,busy:v=>busy=v,advance:v=>{at+=v;clock+=v;},force:v=>force=v,snapshot,active:()=>!!sub};
}
for(const [baseline,expected] of [[0,0],[20,22],[40,44],[65,70],[70,70],[90,90],[100,100],[15,17]])test(`V relative boost ${baseline}→${expected}, correct restoration`,async()=>{
 const f=fixture({baseline});await f.arm();await f.send();assert.deepEqual(f.writes,expected>baseline?[{value:expected,id:'PC'}]:[]);
 f.item({type:'track',id:'music',uri:'spotify:track:music'});await f.send();assert.deepEqual(f.writes,expected>baseline?[{value:expected,id:'PC'},{value:baseline,id:'PC'}]:[]);
 assert.equal(f.store.rows.size,0);
});
for(const [gain,expected] of [[0,40],[1,40],[10,44],[20,48]])test(`V gain boundary ${gain}`,()=>assert.equal(V.target(40,gain),expected));
for(const [base,gain] of [[null,10],[40.5,10],[-1,10],[101,10],[40,-1],[40,21],[40,1.5]])test(`V rejects invalid input ${base}/${gain}`,()=>assert.equal(V.target(base,gain),null));
test('V default disabled means zero polling, lookups, PUT or storage claims',async()=>{const f=fixture();await f.send();assert.deepEqual(f.writes,[]);assert.equal(f.active(),false);assert.equal(f.store.rows.size,0);});
test('V duplicate episode and consecutive Facts keep original music baseline',async()=>{const f=fixture();await f.arm();await f.send();await f.send();f.item({type:'episode',id:'facts-2',uri:'spotify:episode:facts-2',showId:V.SHOW});await f.send();assert.equal(f.writes.length,1);f.item({type:'track',id:'music'});await f.send();assert.deepEqual(f.writes.map(w=>w.value),[44,40]);});
for(const ending of ['skip','pause','disable','hidden','pagehide','generation'])test(`V restores on ${ending}, never changes transport`,async()=>{
 const f=fixture();await f.arm();await f.send();
 if(ending==='skip'){f.item({type:'track',id:'skip'});await f.send();}
 else if(ending==='pause'){f.playing(false);await f.send();f.playing(true);await f.send();}
 else {if(ending==='hidden')f.visible(false);await Promise.all([f.controller.suspend(ending),f.controller.suspend(ending)]);}
 assert.deepEqual(f.writes.map(w=>w.value),[44,40]);assert.equal(f.store.rows.size,0);
});
test('V manual volume wins, duplicates and disabling cannot restore old baseline',async()=>{const f=fixture();await f.arm();await f.send();f.setVolume(48);await f.send();await f.send();await f.controller.suspend();assert.deepEqual(f.writes.map(w=>w.value),[44]);assert.equal(f.store.rows.get('owner').phase,'manual');const saved=await f.controller.inspect();assert.equal(saved.manual,true);await f.controller.recover(saved);assert.equal(f.store.rows.size,0);assert.equal(f.writes.length,1);});
for(const d of [{supportsVolume:false},{supportsVolume:null},{restricted:true},{restricted:null},{active:false},{id:''}])test(`V fail closed capability ${JSON.stringify(d)}`,async()=>{const f=fixture();f.device(d);await f.arm();await f.send();assert.equal(f.writes.length,0);});
for(const baseline of [null,40.2])test(`V unknown volume ${baseline} no PUT`,async()=>{const f=fixture({baseline});await f.arm();await f.send();assert.equal(f.writes.length,0);});
for(const name of ['10:00 Fakty sportowe','24:00 Fakty','Fakty','10:00 Fakty extra'])test(`V ignores non-regular episode ${name}`,()=>assert.equal(V.regular(ep('fake',name)),false));
test('V same title wrong show, spoofed URI and track cannot boost',async()=>{for(const item of [{type:'episode',id:'facts',uri:'spotify:episode:facts',showId:'other'},{type:'episode',id:'facts',uri:'spotify:episode:other',showId:V.SHOW},{type:'track',id:'facts',uri:'spotify:track:facts'}]){const f=fixture();f.item(item);await f.arm();await f.send();assert.equal(f.writes.length,0);}});
test('V lookup validates both exact Spotify episode ID and show, cached once',async()=>{let calls=0;const f=fixture({lookup:async()=>{calls++;return ep('imposter');}});f.item({type:'episode',id:'unknown',uri:'spotify:episode:unknown',showId:V.SHOW});await f.arm();await f.send();await f.send();assert.equal(calls,1);assert.equal(f.writes.length,0);});
test('V confirmed metadata lookup can boost unknown regular Facts',async()=>{const f=fixture();f.item({type:'episode',id:'unknown',uri:'spotify:episode:unknown'});await f.arm();await f.send();assert.deepEqual(f.writes.map(w=>w.value),[44]);assert.equal(f.controller.diagnostics().lookups,1);});
for(const change of ['device','session','gap','leader','network'])test(`V ${change} leaves recovery, never writes a different device`,async()=>{const f=fixture();await f.arm();await f.send();if(change==='device')f.device({id:'OTHER'});if(change==='session')f.session({account:'owner',session:'new'});if(change==='gap')f.advance(11000);await f.send(change==='network'?{available:false,status:'network'}:{},change!=='leader');assert.equal(f.writes.length,1);assert.equal(f.store.rows.get('owner').phase,'recovery');await f.send();assert.equal(f.writes.length,1);});
test('V reload cannot compound, explicit fresh recovery required',async()=>{const store=memory(),a=fixture({store});await a.arm();await a.send();const b=fixture({store,baseline:44});await b.arm();await b.send();assert.equal(b.active(),false);assert.equal(b.writes.length,0);const saved=await b.controller.inspect();assert.equal(saved.baseline,40);assert.equal(await b.controller.recover(saved),true);assert.deepEqual(b.writes,[{value:40,id:'PC'}]);assert.equal(store.rows.size,0);await a.send();assert.equal(a.writes.length,1);});
test('V concurrent controllers claim one baseline before PUT',async()=>{const store=memory(),a=fixture({store}),b=fixture({store});await Promise.all([a.arm(),b.arm()]);await Promise.all([a.send(),b.send()]);assert.equal(a.writes.length+b.writes.length,1);assert.equal(store.rows.size,1);});
for(const code of [401,403,429,503,'network'])test(`V ${code} write failure retains intent and never retries blindly`,async()=>{let writes=0;const f=fixture({write:async()=>{writes++;const e=new Error('private body');e.code=code;throw e;}});await f.arm();await f.send();await f.send();assert.equal(writes,1);assert.equal(f.active(),false);assert.equal(f.store.rows.get('owner').phase,'recovery');assert.equal(JSON.stringify(f.statuses).includes('private body'),false);});
test('V unconfirmed successful PUT is ambiguous, no repeat or stale restore',async()=>{let writes=0;const f=fixture({write:async()=>{writes++;}});await f.arm();await f.send();assert.equal(f.store.rows.get('owner').phase,'recovery');await f.controller.suspend();await f.send();assert.equal(writes,1);});
test('V persistence failure prevents first write, existing preferences remain untouched',async()=>{const f=fixture({store:async action=>{if(action==='get')return null;throw new Error('quota');}});await f.arm();await f.send();assert.equal(f.writes.length,0);assert.equal(f.controller.diagnostics().enabled,false);});
test('V recovery rejects stale confirmation after manual change',async()=>{const f=fixture();await f.arm();await f.send();f.advance(11000);await f.send();const saved=await f.controller.inspect();f.setVolume(55);assert.equal(await f.controller.recover(saved),false);assert.equal(f.writes.length,1);const newer=await f.controller.inspect();assert.equal(await f.controller.recover(newer),true);assert.equal(f.writes.length,1);assert.equal(f.store.rows.size,0);});
test('V hidden and busy cannot arm or gain from stale snapshot',async()=>{for(const flag of ['visible','busy']){const f=fixture();f[flag](flag==='busy');await f.arm();await f.send();assert.equal(f.writes.length,0);assert.equal(f.active(),false);}const f=fixture();await f.arm();await f.send({receivedAt:0});assert.equal(f.writes.length,0);});
test('V timeout after potentially applied PUT retains baseline and does not retry late response',async()=>{
 let timer,release,aborted=false,at=10000,vol=40,writes=0;const store=memory();const snap=()=>({available:true,status:'ok',account:'owner',session:'login',isPlaying:true,device:{id:'PC',active:true,restricted:false,supportsVolume:true,volumePercent:vol},item:{type:'episode',id:'facts',uri:'spotify:episode:facts',showId:V.SHOW},receivedAt:at});
 const m={subscribe:()=>()=>{},read:async()=>snap()};const c=V.create({monitor:m,getSession:()=>({account:'owner',session:'login'}),store,wall:()=>at,mono:()=>at,uuid:(()=>{let n=0;return()=>`id-${++n}`;})(),setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{},lookup:async()=>ep(),write:async(_v,_d,_s,signal)=>{writes++;vol=44;signal.addEventListener('abort',()=>aborted=true);await new Promise(r=>release=r);}});
 c.remember([ep()]);await c.arm();const pending=c.consume(snap(),{leader:true});while(!release)await new Promise(r=>setImmediate(r));timer();await pending;assert.equal(aborted,true);assert.equal(store.rows.get('owner').baseline,40);assert.equal(store.rows.get('owner').phase,'recovery');release();await c.consume(snap(),{leader:true});assert.equal(writes,1);
});
test('V metadata API 429 stops polling and respects Retry-After before rearming',async()=>{
 let calls=0;const f=fixture({lookup:async()=>{calls++;const e=new Error('rate');e.code=429;e.retryAt=100000;throw e;}});f.item({type:'episode',id:'unknown',uri:'spotify:episode:unknown'});await f.arm();await f.send();await f.arm();assert.equal(f.active(),false);assert.equal(calls,1);f.advance(90001);await f.arm();await f.send();assert.equal(calls,2);
});
test('V device changes during fresh preflight prevent boost, not just restoration',async()=>{const f=fixture();await f.arm();f.force({...f.snapshot(),device:{...f.snapshot().device,id:'OTHER'}});await f.send();assert.equal(f.writes.length,0);assert.equal(f.store.rows.size,0);});
test('V session changes while metadata response is pending cannot write',async()=>{let resolve;const f=fixture({lookup:async()=>new Promise(r=>resolve=r)});f.item({type:'episode',id:'unknown',uri:'spotify:episode:unknown'});await f.arm();const p=f.send();while(!resolve)await new Promise(r=>setImmediate(r));f.session({account:'other',session:'other'});resolve(ep('unknown'));await p;assert.equal(f.writes.length,0);assert.equal(f.store.rows.size,0);});
test('V recovery cannot clear another controller intent while its write may still be in flight',async()=>{
 const store=memory();await store('claim',{version:1,account:'owner',session:'login',owner:'other',device:'PC',episode:'facts',baseline:40,target:44,phase:'applying',at:10000,revision:'pending'});
 const f=fixture({store});assert.equal(await f.controller.inspect(),null);assert.equal(store.rows.size,1);assert.equal(f.writes.length,0);f.advance(30000);const saved=await f.controller.inspect();assert.equal(saved.current,40);assert.equal(await f.controller.recover(saved),true);assert.equal(f.writes.length,0);assert.equal(store.rows.size,0);
});
test('V.1 no saved level is distinct from failure, without playback request',async()=>{const f=fixture();assert.equal(await f.controller.inspect(),null);assert.equal(f.controller.diagnostics().inspection,'none');assert.equal(f.writes.length,0);assert.equal(f.controller.diagnostics().confirmationReads,0);});
test('V.1 missing verified session has its own inspection reason',async()=>{const f=fixture();f.session(null);assert.equal(await f.controller.inspect(),null);assert.equal(f.controller.diagnostics().inspection,'no_session');});
test('V.1 healthy PUT plus delayed readback 41→45 confirms with one PUT',async()=>{
 const f=fixture({baseline:41});let reads=0;f.force(()=>({...f.snapshot(),device:{...f.snapshot().device,volumePercent:++reads<=2?41:45}}));await f.arm();await f.send();assert.deepEqual(f.writes,[{value:45,id:'PC'}]);assert.equal(f.controller.diagnostics().status,'boosted');assert.equal(f.controller.diagnostics().enabled,true);assert.equal(f.controller.diagnostics().confirmationReads,2);assert.equal(f.statuses.at(-1).errorCode,0);assert.equal(f.store.rows.get('owner').phase,'boosted');
});
test('V.1 ignored volume PUT is bounded and not called a network failure',async()=>{
 const f=fixture({baseline:41,write:async()=>{}});await f.arm();await f.send();assert.equal(f.controller.diagnostics().writes,1);assert.equal(f.controller.diagnostics().confirmationReads,3);assert.equal(f.controller.diagnostics().failureReason,'volume_not_confirmed');assert.equal(f.statuses.at(-1).errorCode,0);assert.equal(f.store.rows.get('owner').phase,'recovery');
});
test('V.1 delayed restoration confirms without repeated PUT',async()=>{
 const f=fixture({baseline:41});await f.arm();await f.send();f.item({type:'track',id:'music'});let reads=0;f.force(()=>({...f.snapshot(),device:{...f.snapshot().device,volumePercent:++reads===1?45:41}}));await f.send();assert.deepEqual(f.writes.map(w=>w.value),[45,41]);assert.equal(f.store.rows.size,0);
});
test('V.1 manual change during delayed confirmation wins without more reads or restoration',async()=>{
 const f=fixture({baseline:41});let reads=0;f.force(()=>({...f.snapshot(),device:{...f.snapshot().device,volumePercent:++reads===1?41:52}}));await f.arm();await f.send();assert.equal(f.writes.length,1);assert.equal(f.controller.diagnostics().status,'manual');assert.equal(f.controller.diagnostics().confirmationReads,1);await f.controller.suspend();assert.equal(f.writes.length,1);
});
test('V.1 playback 429 during confirmation stops reads and preserves intent',async()=>{
 const f=fixture();let reads=0;f.force(()=>++reads===1?f.snapshot():{...f.snapshot(),available:false,status:'rate_limited',httpStatus:429});await f.arm();await f.send();assert.equal(f.writes.length,1);assert.equal(f.controller.diagnostics().confirmationReads,1);assert.equal(f.statuses.at(-1).errorCode,429);assert.equal(f.store.rows.get('owner').phase,'recovery');
});
for(const kind of ['different_device','unsupported_device','playback_unavailable'])test(`V.1 inspection reports ${kind} distinctly`,async()=>{const f=fixture();await f.arm();await f.send();if(kind==='different_device')f.device({id:'OTHER'});if(kind==='unsupported_device')f.device({supportsVolume:false});if(kind==='playback_unavailable')f.force({...f.snapshot(),available:false,status:'network'});assert.equal(await f.controller.inspect(),null);assert.equal(f.controller.diagnostics().inspection,kind);assert.equal(f.writes.length,1);assert.equal(f.store.rows.size,1);});
test('V.1 confirmation deadline ignores late successful read and retains recovery',async()=>{
 let timer,finish,reads=0,writes=0,row=null,n=0,status;const scope={account:'owner',session:'login'};
 const snap=value=>({available:true,status:'ok',...scope,receivedAt:10000,isPlaying:true,device:{id:'PC',active:true,restricted:false,supportsVolume:true,volumePercent:value},item:{type:'episode',id:'facts',uri:'spotify:episode:facts',showId:V.SHOW}});
 const db=memory();const monitor={subscribe:()=>()=>{},read:async()=>++reads===1?snap(41):new Promise(r=>finish=()=>r(snap(45)))};
 const c=V.create({monitor,getSession:()=>scope,store:db,wall:()=>10000,mono:()=>10000,visible:()=>true,uuid:()=>`id-${++n}`,setTimer:fn=>{timer=fn;return n;},clearTimer:()=>{},write:async()=>{writes++;},lookup:async()=>null,onStatus:s=>status=s});c.remember([ep()]);await c.arm();const p=c.consume(snap(41),{leader:true});while(!finish)await new Promise(r=>setImmediate(r));timer();await p;assert.equal(c.diagnostics().failureReason,'confirmation_timeout');assert.equal(status.errorCode,0);assert.equal(db.rows.get('owner').phase,'recovery');finish();await new Promise(r=>setImmediate(r));assert.equal(db.rows.get('owner').phase,'recovery');assert.equal(reads,2);assert.equal(writes,1);
});
test('V.1 resolving saved intent clears obsolete confirmation failure',async()=>{const f=fixture({write:async()=>{}});await f.arm();await f.send();assert.equal(f.controller.diagnostics().failureReason,'volume_not_confirmed');const saved=await f.controller.inspect();assert.equal(await f.controller.recover(saved),true);assert.equal(f.controller.diagnostics().failureReason,'');assert.equal(f.statuses.at(-1).errorCode,0);assert.equal(f.store.rows.size,0);});
