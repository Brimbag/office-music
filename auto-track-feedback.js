/* S2: exact Spotify Track ID events; independent from manual and artist feedback. */
(function(root){
  'use strict';
  const KEY='office_auto_track_feedback_v1', MAX_BYTES=128*1024, MAX_ROWS=512, DAY=86400000;
  const id=v=>typeof v==='string'&&/^[A-Za-z0-9]{1,64}$/.test(v);
  const text=v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\s\x00-\x1f]/.test(v);
  const num=v=>Number.isSafeInteger(v)&&v>=0;
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(',').sort().join();
  const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
  const empty=account=>({version:1,account,floor:0,events:Object.create(null),resets:Object.create(null)});
  function valid(s){try{return validShape(s);}catch{return false;}}
  function validShape(s){
    return exact(s,'version,account,floor,events,resets')&&s.version===1&&text(s.account)&&num(s.floor)&&
      [s.events,s.resets].every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).length<=MAX_ROWS)&&bytes(s)<=MAX_BYTES&&
      Object.entries(s.events).every(([key,e])=>text(key)&&!['__proto__','constructor','prototype'].includes(key)&&exact(e,'trackId,at,kind,weight')&&[50,100].includes(e.weight)&&(e.kind!=='middle'||e.weight===50)&&id(e.trackId)&&num(e.at)&&['early','middle'].includes(e.kind))&&
      Object.entries(s.resets).every(([key,at])=>id(key)&&num(at));
  }
  function parse(raw,account){
    const s=raw==null?empty(account):typeof raw==='string'?JSON.parse(raw):raw;
    if(!valid(s)||s.account!==account)throw new Error('Nieobsługiwane dane automatycznych kar; dane zachowano.');
    return s;
  }
  function normalize(s,now=Date.now()){
    const out=empty(s.account);out.floor=Math.max(s.floor,Math.max(0,now-90*DAY));
    for(const [key,at] of Object.entries(s.resets).sort())if(at>out.floor)out.resets[key]=at;
    for(const [key,e] of Object.entries(s.events).sort())if(e.at>out.floor&&e.at>(out.resets[e.trackId]??-1))out.events[key]={...e};
    const seen=new Set();
    for(const [,e] of Object.entries(out.events).sort(([a,x],[b,y])=>x.at-y.at||a.localeCompare(b))){if(e.kind==='early'){if(seen.has(e.trackId))e.weight=50;seen.add(e.trackId);}}
    if(!valid(out))throw new Error('Limit dziennika automatycznych kar; wcześniejsze dane zachowano.');
    return out;
  }
  function merge(a,b,account,now=Date.now()){
    a=parse(a,account);b=parse(b,account);const out=empty(account);out.floor=Math.max(a.floor,b.floor);
    for(const [key,at] of [...Object.entries(a.resets),...Object.entries(b.resets)])out.resets[key]=Math.max(out.resets[key]??0,at);
    for(const [key,e] of [...Object.entries(a.events),...Object.entries(b.events)]){
      if(Object.hasOwn(out.events,key)&&(out.events[key].trackId!==e.trackId||out.events[key].at!==e.at||out.events[key].kind!==e.kind))throw new Error('Konflikt ID pominięcia; dane zachowano.');
      out.events[key]={trackId:e.trackId,at:e.at,kind:e.kind,weight:Math.min(out.events[key]?.weight??100,e.weight)};
    }
    return normalize(out,now);
  }
  function add(s,event,now=Date.now()){
    if(!root.OfficeSkipJournal?.validEvent(event)||event.account!==s.account||event.at>now||event.at<now-10000)throw new Error('Nieaktualne pominięcie; bez kary.');
    if(event.kind==='late')return normalize(s,now);
    const next=empty(s.account);const previousEarly=Object.values(s.events).some(e=>e.trackId===event.trackId&&e.kind==='early'&&e.at>Math.max(s.floor,s.resets[event.trackId]??-1,now-90*DAY));
    next.events[event.id]={trackId:event.trackId,at:event.at,kind:event.kind,weight:s.events[event.id]?.weight??(event.kind==='early'&&!previousEarly?100:50)};
    return merge(s,next,s.account,now);
  }
  function reset(s,trackId,now=Date.now()){
    if(!id(trackId))throw new Error('Brak Spotify Track ID; nie resetuję po nazwie.');
    const next=empty(s.account);next.resets[trackId]=now;return merge(s,next,s.account,now);
  }
  function score(s,trackId,now=Date.now()){
    if(!id(trackId))return 0;let total=0,last=0;
    const events=Object.entries(s.events).filter(([,e])=>e.trackId===trackId&&e.at>Math.max(s.floor,s.resets[trackId]??-1,now-90*DAY)&&e.at<=now)
      .sort(([a,x],[b,y])=>x.at-y.at||a.localeCompare(b));
    for(const [,e] of events){const weight=e.weight;total=Math.min(250,total*Math.pow(.5,(e.at-last)/(30*DAY))+weight);last=e.at;}
    return total?-total*Math.pow(.5,(now-last)/(30*DAY)):0;
  }
  const localKey=account=>KEY+':'+encodeURIComponent(account);
  const enabledKey=account=>KEY+'_enabled:'+encodeURIComponent(account);
  function create({getAccount,storage=root.localStorage,edit,now=()=>Date.now(),onError=()=>{}}){
    const enabled=()=>{const a=getAccount();return Boolean(a&&storage.getItem(enabledKey(a))==='1');};
    let memo=null;
    const state=a=>{const raw=storage.getItem(localKey(a));if(memo?.a===a&&memo.raw===raw)return memo.s;const s=parse(raw,a);memo={a,raw,s};return s;};
    async function update(account,fn){
      for(let attempt=0;attempt<3;attempt++){
        const key=localKey(account),base=storage.getItem(key),next=JSON.stringify(fn(parse(base,account)));
        if(base===next)return;
        try{await edit(key,base,next);return;}catch(e){if(e.name!=='LocalStateConflict'||attempt===2)throw e;}
      }
    }
    return Object.freeze({enabled,state,has:a=>storage.getItem(localKey(a))!==null,
      async configure(value){const a=getAccount();if(!text(a))throw new Error('Połącz Spotify.');if(value)state(a);const key=enabledKey(a);await edit(key,storage.getItem(key),value?'1':'0');},
      async record(event){const a=getAccount();if(!enabled()||a!==event.account)return false;await update(a,s=>add(s,event,now()));return Object.hasOwn(state(a).events,event.id);},
      async reset(trackId){const a=getAccount();if(!a)return;await update(a,s=>reset(s,trackId,now()));},
      async accept(account,remote){await update(account,s=>merge(s,remote,account,now()));},
      score(trackId){const a=getAccount();if(!a||!enabled())return 0;try{return score(state(a),trackId,now());}catch{onError();return 0;}}
    });
  }
  root.OfficeAutoTrackFeedback=Object.freeze({KEY,MAX_BYTES,MAX_ROWS,DAY,empty,valid,parse,normalize,merge,add,reset,score,localKey,enabledKey,create});
})(globalThis);
