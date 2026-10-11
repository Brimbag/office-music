/* Read-only playback infrastructure. Consumers must explicitly arm polling. */
(function(root) {
  const text = value => typeof value === 'string' && value.length <= 512 ? value : '';
  const number = value => Number.isFinite(value) && value >= 0 && value <= 86400000 ? value : null;
  const flag = value => typeof value === 'boolean' ? value : null;
  const freeze = value => { if(value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const sameScope = (a,b) => Boolean(a && b && a.account === b.account && a.session === b.session);
  const emptyState = () => ({isPlaying:false,device:null,item:null,contextUri:'',progressMs:null});
  function normalize(data) {
    if(!data || typeof data !== 'object' || Array.isArray(data) || typeof data.is_playing !== 'boolean')return null;
    const d=data.device, item=data.item;
    return {isPlaying:data.is_playing,contextUri:text(data.context?.uri),progressMs:number(data.progress_ms),
      device:d && typeof d === 'object' ? {id:text(d.id),name:text(d.name),active:flag(d.is_active),restricted:flag(d.is_restricted),
        volumePercent:Number.isInteger(d.volume_percent) && d.volume_percent>=0 && d.volume_percent<=100 ? d.volume_percent : null,supportsVolume:flag(d.supports_volume)} : null,
      item:item && typeof item === 'object' ? {type:['track','episode'].includes(item.type)?item.type:'unknown',id:text(item.id),uri:text(item.uri),durationMs:number(item.duration_ms),showId:text(item.show?.id)} : null};
  }
  function retryDelay(header,now) {
    if(typeof header!=='string' || !header.trim())return null;
    const value=header.trim();
    const ms=/^\d+(?:\.\d+)?$/.test(value) ? Number(value)*1000 : Date.parse(value)-now;
    return Number.isFinite(ms) && ms>=0 ? Math.min(86400000,Math.max(1000,ms)) : null;
  }
  function createCore({getSession,request,onSnapshot=()=>{},onDiagnostic=()=>{},wall=Date.now,mono=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,random=Math.random,timeoutMs=5000}) {
    let scope=null,epoch=0,flight=null,controller=null,last=null,previous=null,reason='initial',sequence=0,until=0,fatal='',failures=0;
    const counts={cycles:0,requests:0,cacheHits:0,failures:0,shared:0}; let attempts=[];
    const diagnostics=()=>({status:fatal || last?.status || 'idle',requests:counts.requests,cycles:counts.cycles,cacheHits:counts.cacheHits,failures:counts.failures,shared:counts.shared,
      requestsLastMinute:attempts.filter(t=>wall()-t<60000 && wall()>=t).length,backoffMs:Math.max(0,until-wall())});
    const report=()=>{try{onDiagnostic(diagnostics());}catch{}};
    function invalidate(why='gap') {epoch++;controller?.abort();controller=null;flight=null;last=null;previous=null;reason=why;}
    function syncSession() {
      const next=getSession();
      if(!sameScope(next,scope)){invalidate('session');scope=next && next.account && next.session ? {...next} : null;until=0;fatal='';failures=0;}
      return scope;
    }
    const failed=(status,httpStatus=null)=>({...emptyState(),available:false,status,httpStatus});
    function continuity(state,start,end) {
      if(!previous)return {continuous:false,reason};
      if(!state.isPlaying || !previous.isPlaying)return {continuous:false,reason:'paused'};
      if(!state.device?.id || state.device.active!==true || previous.device?.active!==true || state.device.id!==previous.device?.id)return {continuous:false,reason:'device'};
      if(!state.contextUri || state.contextUri!==previous.contextUri)return {continuous:false,reason:'context'};
      if(!state.item?.id || !previous.item?.id || state.item.type==='unknown' || state.item.type!==previous.item.type)return {continuous:false,reason:'item_type'};
      if(state.progressMs===null || state.item.durationMs===null || previous.progressMs===null || previous.item.durationMs===null)return {continuous:false,reason:'missing_progress'};
      const elapsed=end-previous.receivedMono;
      if(wall()<previous.receivedAt || Math.abs((wall()-previous.receivedAt)-elapsed)>2000)return {continuous:false,reason:'clock'};
      if(elapsed<0 || elapsed>10000 || start<previous.receivedMono || end-start>timeoutMs)return {continuous:false,reason:'gap'};
      if(state.item.id===previous.item.id && Math.abs((state.progressMs-previous.progressMs)-elapsed)>2000)return {continuous:false,reason:'seek'};
      return {continuous:true,reason:'observed'};
    }
    function publish(state,times) {
      const sample=freeze({...state,account:scope.account,session:scope.session,observationId:`${scope.session}:${++sequence}`,...times,
        continuity:state.available?continuity(state,times.requestStartedMono,times.receivedMono):{continuous:false,reason:state.status},retryAt:until});
      last=sample;previous=sample.available?sample:null;reason=sample.available?'initial':sample.status;
      try{onSnapshot(sample);}catch{}report();return sample;
    }
    function read({fresh=false}={}) {
      if(!syncSession())return Promise.resolve(freeze({...failed('no_session'),continuity:{continuous:false,reason:'session'}}));
      if(fatal || wall()<until)return Promise.resolve(last || freeze({...failed(fatal || 'rate_limited'),continuity:{continuous:false,reason:fatal || 'backoff'}}));
      if(flight)return flight;
      if(!fresh && last && last.available && wall()>=last.receivedAt && wall()-last.receivedAt<=1000){counts.cacheHits++;report();return Promise.resolve(last);}
      const turn=epoch, captured={...scope},startedAt=wall(),startedMono=mono(),abort=new AbortController();controller=abort;counts.cycles++;
      let timer;
      const expired=new Promise((_,reject)=>{timer=setTimer(()=>{abort.abort();reject(new Error('timeout'));},timeoutMs);});
      const attempt=()=>{if(abort.signal.aborted || turn!==epoch || !sameScope(getSession(),captured))throw new Error('cancelled');if(mono()-startedMono>timeoutMs || wall()-startedAt>timeoutMs || wall()<startedAt){abort.abort();throw new Error('late request');}counts.requests++;attempts=attempts.filter(t=>wall()-t<60000 && wall()>=t);attempts.push(wall());report();};
      const operation=(async()=>{
        let state;
        try {
          const response=await Promise.race([Promise.resolve().then(()=>request(captured,abort.signal,attempt)),expired]);
          if(turn!==epoch || !sameScope(getSession(),captured))return freeze({...failed('session_changed'),continuity:{continuous:false,reason:'session'}});
          let data=null;
          if(response.status!==204) { try{data=await Promise.race([response.json(),expired]);}catch(error){if(abort.signal.aborted)throw error;} }
          if(mono()-startedMono>timeoutMs || wall()-startedAt>timeoutMs || wall()<startedAt){abort.abort();throw new Error('late response');}
          if(turn!==epoch || !sameScope(getSession(),captured))return freeze({...failed('session_changed'),continuity:{continuous:false,reason:'session'}});
          const quota=[data?.error?.reason,data?.error?.message,data?.error].some(v=>typeof v==='string' && v.includes('QUOTA_EXCEEDED'));
          if(quota){fatal='quota_exceeded';state=failed(fatal,response.status);}
          else if([401,403].includes(response.status)){fatal=response.status===401?'unauthorized':'forbidden';state=failed(fatal,response.status);}
          else if(response.status===429){failures++;until=wall()+(retryDelay(response.headers.get('Retry-After'),wall()) ?? Math.min(300000,30000*2**Math.min(failures-1,4))*(1+random()*.1));state=failed('rate_limited',429);}
          else if(response.status===204){failures=0;state=failed('inactive',204);}
          else if(!response.ok){failures++;until=wall()+Math.min(300000,5000*2**Math.min(failures-1,6))*(1+random()*.1);state=failed('unavailable',response.status);}
          else {
            const parsed=normalize(data);
            if(!parsed){failures++;until=wall()+5000;state=failed('invalid',response.status);}
            else {failures=0;state={...parsed,available:true,status:'ok',httpStatus:response.status};}
          }
        } catch {
          if(turn!==epoch || !sameScope(getSession(),captured))return freeze({...failed('session_changed'),continuity:{continuous:false,reason:'session'}});
          failures++;until=wall()+Math.min(300000,5000*2**Math.min(failures-1,6))*(1+random()*.1);state=failed(abort.signal.aborted?'timeout':'network');
        } finally {clearTimer(timer);}
        if(!state.available && state.status!=='inactive')counts.failures++;
        return publish(state,{requestStartedAt:startedAt,receivedAt:wall(),requestStartedMono:startedMono,receivedMono:mono()});
      })();
      flight=operation;
      void operation.finally(()=>{if(flight===operation){flight=null;controller=null;}}).catch(()=>{});
      return operation;
    }
    function shared(sample) {
      if(!syncSession() || sample?.account!==scope.account || typeof sample.available!=='boolean' || typeof sample.observationId!=='string' || sample.observationId.length>600 ||
        !Number.isFinite(sample.receivedAt) || wall()<sample.receivedAt-500 || wall()-sample.receivedAt>1000)return null;
      // Rebuild the whitelist rather than accepting arbitrary cross-tab payloads.
      const state=sample.available===true ? normalize({is_playing:sample.isPlaying,progress_ms:sample.progressMs,context:{uri:sample.contextUri},
        device:sample.device && {id:sample.device.id,name:sample.device.name,is_active:sample.device.active,is_restricted:sample.device.restricted,volume_percent:sample.device.volumePercent,supports_volume:sample.device.supportsVolume},
        item:sample.item && {type:sample.item.type,id:sample.item.id,uri:sample.item.uri,duration_ms:sample.item.durationMs,show:{id:sample.item.showId}}}) : null;
      const allowed=['ok','inactive','unauthorized','forbidden','quota_exceeded','rate_limited','network','timeout','invalid','unavailable'];
      if(!allowed.includes(sample.status) || sample.available===true && (!state || sample.status!=='ok') || !sample.available && sample.status==='ok')return null;
      if(Number.isFinite(sample.retryAt) && sample.retryAt>wall())until=Math.max(until,Math.min(sample.retryAt,wall()+86400000));
      if(['unauthorized','forbidden','quota_exceeded'].includes(sample.status))fatal=sample.status;
      previous=null;reason='leader';counts.shared++;
      last=freeze({...state || emptyState(),available:sample.available===true,status:sample.status,httpStatus:Number.isInteger(sample.httpStatus)?sample.httpStatus:null,
        account:scope.account,session:scope.session,observationId:sample.observationId,requestStartedAt:Number.isFinite(sample.requestStartedAt)?sample.requestStartedAt:sample.receivedAt,
        receivedAt:sample.receivedAt,requestStartedMono:mono(),receivedMono:mono(),continuity:{continuous:false,reason:'follower'},retryAt:until});
      report();return last;
    }
    return Object.freeze({read,invalidate,syncSession,shared,diagnostics,blocked:()=>Boolean(fatal) || wall()<until});
  }

  /* Atomic lease fallback stores coordination only, never playback or tokens. */
  async function lease(indexedDB,key,owner,now,release=false) {
    if(!indexedDB)throw new Error('coordination unavailable');
    const db=await new Promise((resolve,reject)=>{
      const open=indexedDB.open('omm_playback_coordination_v1',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('leases');
      open.onsuccess=()=>resolve(open.result);open.onerror=open.onblocked=()=>reject(new Error('coordination unavailable'));
    });
    try {return await new Promise((resolve,reject)=>{
      const tx=db.transaction('leases','readwrite'),store=tx.objectStore('leases'),get=store.get(key);let granted=false;
      get.onsuccess=()=>{const old=get.result;
        if(release){if(old?.owner===owner)store.delete(key);}
        else if(!old || old.owner===owner || !Number.isFinite(old.until) || old.until<=now){store.put({owner,until:now+15000},key);granted=true;}
      };
      tx.oncomplete=()=>resolve(granted);tx.onerror=tx.onabort=()=>reject(new Error('coordination unavailable'));
    });}finally{db.close();}
  }
  function create({getSession,request,onDiagnostic=()=>{},visible=()=>!document.hidden,busy=()=>false,
    locks=root.navigator?.locks,indexedDB=root.indexedDB,channelFactory=name=>root.BroadcastChannel?new BroadcastChannel(name):null,
    wall=Date.now,mono=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,random=Math.random,timeoutMs=5000,
    leaseRequest=(key,owner,at,release)=>lease(indexedDB,key,owner,at,release)}) {
    const consumers=new Map();let leader=false,timer=null,disposed=false,releaseLock=null,held=null,pumping=false,turn=0,channel=null,account='',due=0,owner=root.crypto.randomUUID(),coordination='idle';
    const notify=(sample,isLeader)=>{for(const c of consumers.values())try{c.listener(sample,{leader:isLeader});}catch{}};
    const report=()=>{try{onDiagnostic({...core.diagnostics(),leader,coordination,armed:[...consumers.values()].filter(c=>c.active).length});}catch{}};
    const core=createCore({getSession,request,wall,mono,setTimer,clearTimer,random,timeoutMs,onDiagnostic:()=>report(),onSnapshot:sample=>{
      const authority=leader && runnable() && (!held || held.until>wall());
      notify(sample,authority);try{channel?.postMessage({kind:'sample',sample});}catch{}report();
    }});
    const backgroundActive=()=>[...consumers.values()].some(c=>c.active && c.background);
    const runnable=()=>!disposed && Boolean(getSession()?.account && getSession()?.session) && (visible() || backgroundActive()) && !busy() && [...consumers.values()].some(c=>c.active);
    function connect() {
      const next=getSession()?.account || '';if(next===account)return;
      if(account)suspend('session');
      channel?.close();channel=null;account=next;core.syncSession();
      if(account)try{channel=channelFactory(`omm-playback-v1:${account}`);if(channel)channel.onmessage=event=>{
        if(disposed || leader || (!visible() && !backgroundActive()) || busy())return;
        const sample=event.data?.kind==='sample' ? core.shared(event.data.sample) : null;if(sample)notify(sample,false);
      };}catch{}
    }
    async function release() {
      leader=false;
      if(releaseLock){const done=releaseLock;releaseLock=null;done();}
      const old=held;held=null;
      if(old)try{await leaseRequest(old.key,old.owner,wall(),true);}catch{}
    }
    function suspend(reason='suspended') {turn++;clearTimer(timer);timer=null;due=0;core.invalidate(reason);void release();report();}
    async function acquire(captured) {
      const key=`omm-playback-leader:${getSession().account}`,leaseOwner=`${owner}:${captured}`,leaseAt=wall();
      coordination=locks?'web-lock':'lease';
      // Both modes share the atomic gate, including tabs with different capabilities.
      const granted=await leaseRequest(key,leaseOwner,leaseAt);
      const drop=async()=>{try{await leaseRequest(key,leaseOwner,wall(),true);}catch{}if(held?.owner===leaseOwner)held=null;};
      if(captured!==turn || !runnable() || wall()>=leaseAt+15000){if(granted)await drop();return false;}
      if(!granted){if(leader){core.invalidate('leader');await release();}return false;}
      held={key,owner:leaseOwner,until:leaseAt+15000};
      if(locks) {
        if(leader && releaseLock)return true;
        return new Promise(resolve=>{
          void locks.request(key,{ifAvailable:true},async lock=>{
            if(!lock || captured!==turn || !runnable() || wall()>=leaseAt+15000){await drop();resolve(false);return;}
            leader=true;core.invalidate('leader');
            await new Promise(done=>{releaseLock=done;resolve(true);});
          }).catch(async()=>{coordination='unavailable';await drop();resolve(false);});
        });
      }
      if(!leader)core.invalidate('leader');
      leader=true;return true;
    }
    async function pump() {
      if(pumping)return;if(!runnable()){suspend('inactive');return;}pumping=true;const captured=turn;
      try {
        connect();core.syncSession();
        if(await acquire(captured) && captured===turn && runnable() && wall()>=due && !core.blocked()) {
          const sample=await core.read({fresh:true});
          if(captured===turn && runnable())due=wall()+(sample.available && sample.isPlaying && sample.device?.id ? 5000 : 30000);
        }
      } catch {coordination='unavailable';core.invalidate('coordination');await release();}
      finally {pumping=false;report();if(runnable() && coordination!=='unavailable')timer=setTimer(pump,captured===turn?5000:0);}
    }
    function wake(reason='gap') {if(reason==='visibility' && backgroundActive()){report();return;}suspend(reason);connect();if(runnable())void pump();}
    function subscribe(name,listener,{active=false,background=false}={}) {
      if(disposed || typeof name!=='string' || consumers.has(name) || typeof listener!=='function')throw new Error('Invalid playback consumer');
      const wasActive=[...consumers.values()].some(c=>c.active),wasRunnable=runnable();
      consumers.set(name,{listener,active:active===true,background:background===true});if(active===true && (!wasActive || !wasRunnable && runnable()))wake('consumer');else{connect();report();}
      let removed=false;return ()=>{if(!removed){removed=true;consumers.delete(name);if(![...consumers.values()].some(c=>c.active))suspend('consumer');report();}};
    }
    async function read(options) {if(disposed)return null;connect();if(runnable() && !pumping && timer===null)void pump();return core.read(options);}
    function dispose(){disposed=true;consumers.clear();suspend('closed');channel?.close();channel=null;}
    return Object.freeze({subscribe,read,wake,suspend,dispose,diagnostics:()=>({...core.diagnostics(),leader,coordination,armed:[...consumers.values()].filter(c=>c.active).length})});
  }
  root.OfficeSpotifyPlayback=Object.freeze({normalize,retryDelay,createCore,create,lease});
})(globalThis);
