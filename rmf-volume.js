/* Optional RMF volume control. No playlist, queue, feedback or credential persistence. */
(function(root){
  'use strict';
  const SHOW='2BeZqsvzZUSldlZWvjeGe3';
  const text=v=>typeof v==='string' && v.length>0 && v.length<=512;
  const volume=v=>Number.isInteger(v) && v>=0 && v<=100;
  function target(baseline,gain=10){
    if(!volume(baseline)||!Number.isInteger(gain)||gain<0||gain>20)return null;
    return baseline>=70?baseline:Math.min(70,Math.round(baseline*(1+gain/100)));
  }
  function regular(ep,show=ep?.show?.id){
    return show===SHOW && text(ep?.id) && ep.uri===`spotify:episode:${ep.id}` &&
      /^(?:[01]\d|2[0-3]):00 Fakty$/i.test(String(ep.name||'').trim()) && /^\d{4}-\d{2}-\d{2}$/.test(ep.release_date||'');
  }
  function validIntent(r){return r?.version===1 && text(r.account)&&text(r.owner)&&text(r.device)&&text(r.episode)&&text(r.session)&&
    volume(r.baseline)&&volume(r.target)&&r.target>r.baseline&&r.target<=70&&Number.isFinite(r.at)&&text(r.revision)&&
    ['applying','boosted','restoring','recovery','manual'].includes(r.phase);}
  // An intent is also a non-expiring exclusive lease. Expiry must never convert an
  // already boosted volume into the next controller's baseline. Recovery is explicit.
  function createStore(db=root.indexedDB){
    let opening;
    function open(){return opening ||= new Promise((resolve,reject)=>{
      if(!db){reject(new Error('storage'));return;}
      const req=db.open('omm_rmf_volume_v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('intents',{keyPath:'account'});
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('storage'));req.onblocked=()=>reject(new Error('storage'));
    });}
    return async function store(action,record){
      const connection=await open();
      return new Promise((resolve,reject)=>{
        const tx=connection.transaction('intents','readwrite'),rows=tx.objectStore('intents');let result;
        const req=rows.get(record.account);
        req.onsuccess=()=>{
          const old=req.result;
          if(action==='get'){result=old||null;return;}
          if(action==='claim' && old){result=false;return;}
          if(action==='take' && (!old||old.revision!==record.expected)){result=false;return;}
          if(['save','remove'].includes(action) && (!old||old.owner!==record.owner||old.revision!==record.expected)){result=false;return;}
          if(action==='remove')rows.delete(record.account);else {const clean={...record};delete clean.expected;rows.put(clean);}
          result=true;
        };
        tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('storage'));
      });
    };
  }
  function create({monitor,getSession,write,lookup,store=createStore(),onStatus=()=>{},visible=()=>!root.document?.hidden,
    busy=()=>false,leader=()=>monitor.diagnostics?.().leader ?? true,wall=Date.now,mono=()=>root.performance.now(),uuid=()=>root.crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout,timeoutMs=5000}){
    const owner=uuid(),known=new Map(),attempted=new Set();let enabled=false,gain=10,cycle=null,unsubscribe=null,job=null,last=null,lastMono=null,epoch=0;
    let suppressed='',recoverable=null,status='off',writes=0,lookups=0,suspending=null,retryAt=0,errorCode=0;
    const scope=()=>getSession();
    const same=(s,p)=>s&&p&&s.account===p.account&&s.session===p.session;
    function report(s){status=s;onStatus({status:s,enabled,gain,writes,lookups,errorCode,recovery:Boolean(recoverable),baseline:recoverable?.baseline??cycle?.baseline??null,target:recoverable?.target??cycle?.target??null});}
    function fresh(s){return s?.available && s.status==='ok' && same(scope(),s) && wall()>=s.receivedAt && wall()-s.receivedAt<=1000;}
    function capable(s){return fresh(s)&&text(s.device?.id)&&s.device.active===true&&s.device.restricted===false&&s.device.supportsVolume===true&&volume(s.device.volumePercent);}
    function remember(episodes,show=SHOW){for(const ep of episodes||[]){if(text(ep?.id))known.set(ep.id,regular(ep,show));}while(known.size>100)known.delete(known.keys().next().value);}
    async function limited(fn){const controller=new AbortController();let timer;
      try{return await Promise.race([fn(controller.signal),new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);})]);}
      finally{clearTimer(timer);controller.abort();}
    }
    async function confirmed(s){
      const item=s?.item;if(item?.type!=='episode'||!text(item.id)||item.uri!==`spotify:episode:${item.id}`||item.showId && item.showId!==SHOW)return false;
      if(known.has(item.id))return known.get(item.id);
      if(attempted.has(item.id))return false;
      attempted.add(item.id);if(attempted.size>100)attempted.delete(attempted.values().next().value);lookups++;
      const atEpoch=epoch,session=scope();
      let ep;try { ep=await limited(signal=>lookup(item.id,session,signal)); } catch(error) { attempted.delete(item.id); throw error; }
      if(atEpoch!==epoch||!same(session,scope()))throw new Error('session');
      const ok=ep?.id===item.id && regular(ep);known.set(item.id,ok);return ok;
    }
    async function save(phase){const next={...cycle,phase,at:wall(),revision:uuid(),expected:cycle.revision};
      if(!await store('save',next))throw new Error('ownership');delete next.expected;cycle=next;return next;
    }
    async function release(){if(cycle && !await store('remove',{account:cycle.account,owner,expected:cycle.revision}))throw new Error('ownership');cycle=null;recoverable=null;}
    async function recovery(){if(cycle){try{await save('recovery');}catch{}recoverable=cycle;}report('recovery');}
    async function checkOwnership(){const row=await store('get',{account:cycle.account});if(!validIntent(row)||row.owner!==owner||row.revision!==cycle.revision)throw new Error('ownership');}
    async function change(s,value,phase){
      if(!capable(s)||s.device.id!==cycle.device||!same(cycle,scope()))throw new Error('device');
      await checkOwnership();const atEpoch=epoch;await save(phase);
      // Absolute PUT is not retried after network failure/timeout. The persisted
      // intent survives an ambiguous response; confirmation uses the shared reader.
      if(!capable(s) || phase==='applying' && (!enabled || !visible() || busy() || !leader())) throw new Error("stale");
      writes++;await limited(signal=>write(value,cycle.device,{account:cycle.account,session:cycle.session},signal));
      if(atEpoch!==epoch||!same(cycle,scope()))throw new Error('session');
      const after=await monitor.read({fresh:true});
      if(!capable(after)||after.device.id!==cycle.device)throw new Error('confirmation');
      last=after;lastMono=mono();
      if(after.device.volumePercent!==value){
        if(after.device.volumePercent!==cycle.baseline && after.device.volumePercent!==cycle.target){suppressed=after.item?.id||'';await save('manual');report('manual');return false;}
        throw new Error('confirmation');
      }
      if(phase==='restoring'){await release();report(enabled?'ready':'off');}
      else {await save('boosted');report('boosted');}
      return true;
    }
    async function restore(s){
      if(!capable(s)||s.device.id!==cycle.device||!same(cycle,scope())){await recovery();return;}
      if(s.device.volumePercent!==cycle.target){suppressed=s.item?.id||'';await save('manual');report('manual');return;}
      await change(s,cycle.baseline,'restoring');
    }
    async function consume(s,meta={}){
      if(!enabled||job)return;
      const previousMono=lastMono;last=s;lastMono=mono();
      job=(async()=>{try{
        if(!cycle){
          if(!meta.leader||!visible()||busy()||!capable(s)||!s.isPlaying){report(fresh(s)?'unsupported':'waiting');return;}
          const row=await store('get',{account:s.account});
          if(row){recoverable=validIntent(row)?row:null;report('recovery');return;}
          if(suppressed && s.item?.id===suppressed){report('manual');return;}
          suppressed='';
          if(!await confirmed(s)){report('ready');return;}
          // Metadata lookup can take seconds; never write using a stale observation.
          const before=await monitor.read({fresh:true});
          if(!enabled||!visible()||busy()||!leader()||!capable(before)||!before.isPlaying||before.device.id!==s.device.id||before.item?.id!==s.item.id)return;
          const next=target(before.device.volumePercent,gain);
          if(next<=before.device.volumePercent){suppressed=before.item.id;report('unchanged');return;}
          const record={version:1,account:before.account,session:before.session,owner,device:before.device.id,episode:before.item.id,
            baseline:before.device.volumePercent,target:next,phase:'applying',at:wall(),revision:uuid()};
          if(!await store('claim',record)){report('recovery');return;}cycle=record;
          if(!enabled||!visible()||busy()||!leader()||!same(cycle,scope())){await release();return;}
          await change(before,next,'applying');return;
        }
        if(!meta.leader||!fresh(s)||previousMono!==null && (mono()-previousMono>10000||mono()<previousMono)||!same(cycle,scope())||s.device?.id!==cycle.device){await recovery();return;}
        if(cycle.phase==='recovery'){report('recovery');return;}
        if(cycle.phase==='manual'){
          if(s.item?.id!==suppressed && s.item?.type!=='episode'){await release();suppressed='';report('ready');}else report('manual');return;
        }
        if(!capable(s)){await recovery();return;}
        if(s.device.volumePercent!==cycle.target){suppressed=s.item?.id||'';await save('manual');report('manual');return;}
        if(!s.isPlaying){suppressed=s.item?.id||'';await restore(s);return;}
        if(await confirmed(s)){cycle.episode=s.item.id;await save('boosted');report('boosted');return;}
        await restore(s);
      }catch(error){errorCode=[401,403,429].includes(error.code)?error.code:503;retryAt=error.retryAt||wall()+30000;enabled=false;unsubscribe?.();unsubscribe=null;if(cycle)await recovery();else report('unavailable');}})();
      try{await job;}finally{job=null;}
    }
    async function arm(nextGain=10){
      if(target(40,nextGain)===null)throw new Error('gain');
      if(enabled || job || suspending)return;gain=nextGain;
      if (wall()<retryAt) { report("unavailable"); return; }
      if(!scope()||!visible()||busy()){report('waiting');return;}
      const session=scope(),startEpoch=epoch;const row=await store("get",{account:session.account});
      if(startEpoch!==epoch || !same(session,scope()) || !visible() || busy()) { report("waiting"); return; }
      if(row){recoverable=validIntent(row)?row:null;report("recovery");return;}
      enabled=true;epoch++;lastMono=null;errorCode=0;
      unsubscribe=monitor.subscribe('rmf-volume',consume,{active:true});report('ready');
    }
    async function stop(reason){
      enabled=false;epoch++;unsubscribe?.();unsubscribe=null;
      const pending=job;if(pending)await pending;
      job=(async()=>{try{
        if(cycle?.phase==='boosted' && lastMono!==null && mono()-lastMono<=10000 && mono()>=lastMono && same(cycle,scope())){
          const current=await monitor.read({fresh:true});await restore(current);
        }else if(cycle && cycle.phase!=='manual')await recovery();
        else report(cycle?'manual':'off');
      }catch{await recovery();}})();
      try{await job;}finally{job=null;report(recoverable?'recovery':cycle?.phase==='manual'?'manual':'off');}
    }
    function suspend(reason='hidden'){
      if(suspending)return suspending;
      suspending=stop(reason).finally(()=>{suspending=null;});return suspending;
    }
    async function inspect(){
      if(job)return null;const session=scope();if(!session){report('waiting');return null;}
      const row=await store('get',{account:session.account});recoverable=validIntent(row)?row:null;
      if(row && !recoverable){report('storage');return null;}
      if(!row){report(enabled?'ready':'off');return null;}
      // Another card may still be awaiting an applying/restoring request. Do not
      // erase or take its intent merely because the device still shows baseline.
      if(['applying','restoring'].includes(row.phase) && wall()-row.at<30000){report('recovery');return null;}
      const s=await monitor.read({fresh:true});
      if(!capable(s)||s.device.id!==row.device){report('recovery');return null;}
      // Different current volume proves the saved target is no longer ours.
      return {account:session.account,session:session.session,device:row.device,baseline:row.baseline,target:row.target,
        current:s.device.volumePercent,revision:row.revision,manual:row.phase==='manual'};
    }
    async function recover(confirmation){
      if(job||!confirmation)return false;
      enabled=false;unsubscribe?.();unsubscribe=null;epoch++;
      job=(async()=>{try{
        if(!same(scope(),confirmation))return false;
        const row=await store('get',{account:confirmation.account});
        if(!validIntent(row)||row.revision!==confirmation.revision)return false;
        const s=await monitor.read({fresh:true});
        if(!capable(s)||s.device.id!==row.device||s.device.volumePercent!==confirmation.current)return false;
        const record={...row,owner,session:confirmation.session,revision:uuid(),expected:row.revision};
        if(!await store('take',record))return false;delete record.expected;cycle=record;
        if(row.phase==='manual'||s.device.volumePercent!==row.target){await release();report('off');return true;}
        await change(s,row.baseline,'restoring');return !cycle;
      }catch{await recovery();return false;}})();
      try{return await job;}finally{job=null;}
    }
    return Object.freeze({arm,suspend,consume,remember,inspect,recover,diagnostics:()=>({status,enabled,gain,writes,lookups,phase:cycle?.phase||null})});
  }
  root.OfficeRmfVolume=Object.freeze({SHOW,target,regular,validIntent,createStore,create});
})(globalThis);
