/* S1 diagnostic events only. Never reads or writes feedback, scores or transport. */
(function(root){
  'use strict';
  const MAX_EVENTS=100, RETENTION_MS=30*86400000, SESSION_MS=8*60*60*1000;
  const id=v=>typeof v==='string' && /^[A-Za-z0-9]{1,64}$/.test(v);
  const text=v=>typeof v==='string' && v.length>0 && v.length<=128 && !/[\x00-\x1f]/.test(v);
  const finite=v=>Number.isFinite(v) && v>=0;
  function classify(low,high,duration){
    if(!finite(low)||!finite(high)||!finite(duration)||duration<=30000||low>high||high>=duration-12000)return null;
    if(high<duration*.2)return 'early';
    if(low>=duration*.2 && high<duration*.7)return 'middle';
    if(low>=duration*.7)return 'late';
    return null;
  }
  function validEvent(r){return r?.version===1 && text(r.account)&&text(r.id)&&id(r.trackId)&&id(r.playlistId)&&
    finite(r.at)&&finite(r.durationMs)&&r.durationMs<=86400000&&['early','middle','late'].includes(r.kind)&&finite(r.fromMs)&&finite(r.toMs)&&classify(r.fromMs,r.toMs,r.durationMs)===r.kind;}
  const clean=r=>({version:1,account:r.account,id:r.id,trackId:r.trackId,playlistId:r.playlistId,at:r.at,
    durationMs:r.durationMs,fromMs:r.fromMs,toMs:r.toMs,kind:r.kind});
  function createStore(db=root.indexedDB,wall=Date.now){
    let opening;
    const open=()=>opening ||= new Promise((resolve,reject)=>{
      if(!db){reject(new Error('storage'));return;}
      const req=db.open('omm_skip_journal_v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('events',{keyPath:['account','id']}).createIndex('account','account');
      req.onsuccess=()=>resolve(req.result);req.onerror=req.onblocked=()=>reject(new Error('storage'));
    });
    return async function store(action,account,event){
      if(!text(account)||!['list','append'].includes(action)||action==='append'&&(!validEvent(event)||event.account!==account))throw new Error('invalid');
      const now=wall();if(action==='append' && (event.at>now || event.at<now-RETENTION_MS))throw new Error('invalid');
      const connection=await open();
      return new Promise((resolve,reject)=>{
        const tx=connection.transaction('events',action==='append'?'readwrite':'readonly'),rows=tx.objectStore('events');let result;
        const req=rows.index('account').getAll(account);
        req.onsuccess=()=>{
          const stored=req.result,valid=stored.filter(r=>validEvent(r)&&r.at<=now&&r.at>=now-RETENTION_MS).map(clean);
          if(action==='list'){result=valid.sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id)).slice(0,MAX_EVENTS);return;}
          if(stored.some(r=>!validEvent(r)||r.at>now+1000)){tx.abort();return;}
          const old=stored.find(r=>r.id===event.id);
          if(old){if(JSON.stringify(clean(old))!==JSON.stringify(clean(event))){tx.abort();return;}result={duplicate:true};return;}
          const latest=[...valid,clean(event)].sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id)).slice(0,MAX_EVENTS);
          const keep=new Set(latest.map(r=>r.id));
          for(const row of stored)if(!keep.has(row.id))rows.delete([account,row.id]);
          if(keep.has(event.id))rows.add(clean(event));result={duplicate:false,retained:keep.has(event.id)};
        };
        tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('storage'));
      });
    };
  }
  function create({monitor,getSession,store=createStore(),onStatus=()=>{},onEvent=()=>{},busy=()=>false,
    wall=Date.now,mono=()=>performance.now(),uuid=()=>root.crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout}){
    let active=false,selection=null,device='',anchor=null,unsubscribe=null,timer=null,until=0,epoch=0,flight=Promise.resolve(),lastObservation='';
    let status='off',reason='',recorded=0,duplicates=0;const ignored={};
    const same=(a,b)=>a&&b&&a.account===b.account&&a.session===b.session;
    const report=()=>{try{onStatus({active,status,reason,recorded,duplicates,ignored:{...ignored}});}catch{}};
    function reset(why){anchor=null;reason=why;ignored[why]=(ignored[why]||0)+1;report();}
    function stop(why='stopped'){active=false;epoch++;anchor=null;selection=null;device='';lastObservation='';clearTimer(timer);timer=null;unsubscribe?.();unsubscribe=null;status=why;reason='';report();}
    function qualified(s){return s?.available && s.status==='ok' && text(s.observationId) && same(selection,s) && s.isPlaying===true &&
      s.device?.active===true && text(s.device.id) && s.item?.type==='track' && id(s.item.id) && s.item.uri===`spotify:track:${s.item.id}` &&
      (selection.auto ? /^spotify:playlist:[A-Za-z0-9]{1,64}$/.test(s.contextUri || '') : selection.uri===s.contextUri && selection.tracks.has(s.item.id)) && finite(s.progressMs) && s.item.durationMs>30000 &&
      finite(s.item.durationMs) && s.progressMs<=s.item.durationMs && finite(s.receivedAt) && wall()>=s.receivedAt && wall()-s.receivedAt<=1000 &&
      finite(s.receivedMono) && finite(s.requestStartedMono) && s.receivedMono>=s.requestStartedMono && s.receivedMono-s.requestStartedMono<=5000 &&
      Math.abs(mono()-s.receivedMono)<=1000;}
    const newAnchor=s=>({sample:s,instance:uuid(),stable:false});
    async function consume(s,meta,turn){
      if(!active || turn!==epoch)return;
      if(!same(selection,getSession())){stop('session');return;}
      if(wall()>=until){stop('expired');return;}
      if(busy()){reset('busy');return;}
      if(!meta?.leader){reset('leader');return;}
      if(!qualified(s)){if(selection.auto)status='waiting';reset(!s?.available?'api':s?.item?.type==='episode'?'podcast':!s?.isPlaying?'paused':'outside');return;}
      if(s.observationId===lastObservation)return;lastObservation=s.observationId;
      if(device && device!==s.device.id){if(!selection.auto){stop('device');return;}reset('device');}
      if(selection.auto && selection.uri!==s.contextUri){reset('context');selection.uri=s.contextUri;selection.id=s.contextUri.slice('spotify:playlist:'.length);}
      device=s.device.id;status='watching';
      if(!anchor){anchor=newAnchor(s);reason='stabilizing';report();return;}
      const prev=anchor.sample,elapsed=s.receivedMono-prev.receivedMono;
      if(s.continuity?.continuous!==true || s.continuity.reason!=='observed' || elapsed<0 || elapsed>10000 ||
        Math.abs((s.receivedAt-prev.receivedAt)-elapsed)>2000 || s.item.id===prev.item.id &&
        (s.item.durationMs!==prev.item.durationMs || Math.abs((s.progressMs-prev.progressMs)-elapsed)>2000)){
        reset(s.continuity?.reason==='seek'?'seek':'gap');anchor=newAnchor(s);return;
      }
      if(s.item.id===prev.item.id){if(elapsed>=1000)anchor.stable=true;anchor.sample=s;reason=anchor.stable?'observing':'stabilizing';report();return;}
      const previous=anchor;anchor=newAnchor(s);
      if(!previous.stable){reset('unstable');anchor=newAnchor(s);return;}
      const latency=prev.receivedMono-prev.requestStartedMono+s.receivedMono-s.requestStartedMono;
      const low=Math.max(0,prev.progressMs-latency-2000),high=prev.progressMs+elapsed+latency+2000;
      const kind=classify(low,high,prev.item.durationMs);
      if(s.progressMs>elapsed+latency+2000 || !kind){reset(!kind?'end_or_boundary':'next_progress');anchor=newAnchor(s);return;}
      const event={version:1,account:selection.account,id:previous.instance,trackId:prev.item.id,playlistId:selection.id,
        at:s.receivedAt,durationMs:prev.item.durationMs,fromMs:low,toMs:high,kind};
      try{
        const result=await store('append',event.account,event);
        if(turn!==epoch || !same(selection,getSession()))return;
        if(result?.retained===false){ignored.retention=(ignored.retention||0)+1;reason='retention';report();return;}
        if(result?.duplicate)duplicates++;else {recorded++;onEvent(event);}reason='recorded';report();
      }catch{if(turn===epoch)stop('storage');}
    }
    function receive(s,meta){const turn=epoch;flight=flight.then(()=>consume(s,meta,turn)).catch(()=>{if(turn===epoch)stop('storage');});return flight;}
    function arm(playlist){
      stop();const scope=getSession();
      if(!scope || !text(scope.account) || !text(scope.session) || !id(playlist?.id) || playlist.uri!==`spotify:playlist:${playlist.id}` || !Array.isArray(playlist.tracks))throw new Error('selection');
      const tracks=new Set(playlist.tracks.filter(t=>id(t?.id)&&t.uri===`spotify:track:${t.id}`).map(t=>t.id));
      if(!tracks.size || tracks.size>1000)throw new Error('selection');
      selection={...scope,id:playlist.id,uri:playlist.uri,tracks};active=true;status='waiting';until=wall()+SESSION_MS;
      timer=setTimer(()=>stop('expired'),SESSION_MS);
      unsubscribe=monitor.subscribe('skip-journal',receive,{active:true,background:true});report();
    }
    function armAll(){
      stop();const scope=getSession();
      if(!scope || !text(scope.account) || !text(scope.session))throw new Error('session');
      selection={...scope,auto:true,id:'',uri:''};active=true;status='waiting';until=wall()+SESSION_MS;
      timer=setTimer(()=>stop('expired'),SESSION_MS);unsubscribe=monitor.subscribe('skip-journal',receive,{active:true,background:true});report();
    }
    function pause(){
      if(!active)return;
      if(!selection?.auto){stop('generation');return;}
      active=false;epoch++;anchor=null;lastObservation='';unsubscribe?.();unsubscribe=null;status='generation';reason='';report();
    }
    function resume(){
      if(status!=='generation' || !selection?.auto)return;
      if(wall()>=until){stop('expired');return;}
      if(!same(selection,getSession())){stop('session');return;}
      active=true;epoch++;anchor=null;device='';lastObservation='';status='waiting';reason='';
      unsubscribe=monitor.subscribe('skip-journal',receive,{active:true,background:true});report();
    }
    async function events(){const scope=getSession();if(!scope)return [];return store('list',scope.account);}
    return Object.freeze({arm,armAll,pause,resume,stop,events,receive,diagnostics:()=>({active,status,reason,playlistId:selection?.id || "",recorded,duplicates,ignored:{...ignored}})});
  }
  root.OfficeSkipJournal=Object.freeze({classify,validEvent,createStore,create,MAX_EVENTS,RETENTION_MS,SESSION_MS});
})(globalThis);
