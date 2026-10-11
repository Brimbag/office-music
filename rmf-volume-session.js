/* Queue-scoped RMF volume sessions. Preferences never arm polling on their own. */
(function(root){
  'use strict';
  const SESSION_MS=60*60*1000, MAX_PENDING=10;
  function create({monitor,getSession,onStatus=()=>{},wall=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,...options}){
    const pending=new Map();let selected=false,gain=10,active=false,observing=false,timer=null,deadline=0,starting=null,ending=null;
    let state='off',lastInfo={enabled:false,baseline:null,target:null,observedVolume:null,writes:0,lookups:0,confirmationReads:0};
    const same=(a,b)=>a && b && a.account===b.account && a.session===b.session;
    const allowed=s=>{const row=pending.get(s?.item?.id);return Boolean(selected && active && wall()<deadline && row && same(row,s) && row.device===s.device?.id);};
    const publish=()=>onStatus({...lastInfo,selected,sessionActive:active,pending:pending.size,status:active?lastInfo.status:state});
    const facade={read:opts=>monitor.read(opts),diagnostics:()=>monitor.diagnostics(),
      subscribe:(name,listener,opts)=>monitor.subscribe(name,(s,meta)=>observe(s,meta,listener),{...opts,background:true})};
    const volume=root.OfficeRmfVolume.create({...options,monitor:facade,getSession,wall,setTimer,clearTimer,
      visible:()=>true,background:true,allowed,onStatus:info=>{lastInfo=info;publish();}});
    async function finish(reason){
      if(ending)return ending;
      active=false;clearTimer(timer);timer=null;deadline=0;pending.clear();state=reason;
      ending=(async()=>{await volume.suspend(reason);if(['recovery','manual','unavailable'].includes(volume.diagnostics().status))state=volume.diagnostics().status;publish();})();
      try{await ending;}finally{ending=null;}
    }
    async function observe(s,meta,listener){
      if(!active || observing)return;observing=true;
      try{
        if(wall()>=deadline){await finish('expired');return;}
        const first=pending.values().next().value;
        if(!first || !same(first,getSession()) || s?.available && s.device?.id && s.device.id!==first.device){await finish('interrupted');return;}
        if(allowed(s) && s.available && s.isPlaying)pending.get(s.item.id).seen=true;
        await listener(s,meta);
        const diag=volume.diagnostics();
        if(['recovery','unavailable','storage'].includes(diag.status) || !diag.enabled){await finish(diag.status);return;}
        if(s?.available && s.item?.type==='track'){
          for(const [id,row] of pending)if(row.seen)pending.delete(id);
          if(!pending.size && !diag.phase)await finish('completed');
        }
      }catch{await finish('unavailable');}finally{observing=false;}
    }
    async function start(){
      if(starting)return starting;
      if(!selected || active || ending || !pending.size)return;
      starting=(async()=>{
        const first=pending.values().next().value;
        if(!same(first,getSession()) || wall()>=first.until){pending.clear();state='expired';publish();return;}
        deadline=first.until;active=true;state='ready';
        timer=setTimer(()=>{void finish('expired');},Math.max(0,deadline-wall()));
        await volume.arm(gain);
        if(!volume.diagnostics().enabled)await finish(volume.diagnostics().status);
        publish();
      })();
      try{await starting;}finally{starting=null;}
    }
    async function configure(value,nextGain=10){
      if(root.OfficeRmfVolume.target(40,nextGain)===null)throw new Error('gain');
      const changed=gain!==nextGain;selected=value===true;gain=nextGain;
      if(!selected || changed && active)await finish(!selected?'off':'settings');
      if(selected && !active){state='idle';publish();await start();}else publish();
    }
    async function queued(episode,device){
      if(ending)await ending;
      const scope=getSession();
      if(!scope || typeof device!=='string' || !device.trim() || device.length>512 || !root.OfficeRmfVolume.regular(episode))return false;
      if(!active)for(const [id,row]of pending)if(wall()>=row.until)pending.delete(id);
      const old=pending.get(episode.id);if(old && same(old,scope) && old.device===device)return true;
      if(pending.size && (!same(pending.values().next().value,scope) || pending.values().next().value.device!==device))await finish('interrupted');
      if(pending.size>=MAX_PENDING)return false;
      pending.set(episode.id,{...scope,device,until:wall()+SESSION_MS,seen:false});volume.remember([episode]);
      await start();return true;
    }
    async function suspend(reason){await finish(reason==='disabled'?'off':reason);}
    async function recover(confirmation){
      const result=await volume.recover(confirmation);
      if(!volume.diagnostics().enabled)await finish(result?'completed':'recovery');
      return result;
    }
    return Object.freeze({configure,queued,suspend,remember:volume.remember,inspect:volume.inspect,recover,
      diagnostics:()=>({...volume.diagnostics(),selected,sessionActive:active,pending:pending.size,sessionStatus:state})});
  }
  root.OfficeRmfVolumeSession=Object.freeze({create,SESSION_MS,MAX_PENDING});
})(globalThis);
