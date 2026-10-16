/* Exact-track replay exclusion. Independent of S2 enablement and rating resets. */
(function(root){
  'use strict';
  const KEY='office_track_cooldown_v1', DAY=86400000, WINDOW=14*DAY, MAX_ROWS=512, MAX_BYTES=65536;
  const id=v=>typeof v==='string'&&/^[A-Za-z0-9]{1,64}$/.test(v);
  const account=v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\s\x00-\x1f]/.test(v);
  const empty=account=>({version:1,account,tracks:Object.create(null)});
  function valid(s){try{return s&&Object.keys(s).sort().join()==='account,tracks,version'&&s.version===1&&account(s.account)&&
    s.tracks&&typeof s.tracks==='object'&&!Array.isArray(s.tracks)&&Object.keys(s.tracks).length<=MAX_ROWS&&
    Object.entries(s.tracks).every(([key,at])=>id(key)&&!['__proto__','constructor','prototype'].includes(key)&&Number.isSafeInteger(at)&&at>=0)&&
    new TextEncoder().encode(JSON.stringify(s)).length<=MAX_BYTES;}catch{return false;}}
  function parse(raw,account){const s=raw==null?empty(account):typeof raw==='string'?JSON.parse(raw):raw;
    if(!valid(s)||s.account!==account)throw new Error('Nieobsługiwane dane blokad 14 dni; dane zachowano.');return s;}
  function merge(a,b,account,now=Date.now()){
    a=parse(a,account);b=parse(b,account);const out=empty(account);
    for(const [key,at] of [...Object.entries(a.tracks),...Object.entries(b.tracks)].sort(([a],[b])=>a.localeCompare(b)))
      if(at>now-WINDOW)out.tracks[key]=Math.max(out.tracks[key]??0,at);
    if(!valid(out))throw new Error('Limit blokad 14 dni; wcześniejsze dane zachowano.');return out;
  }
  function fromFeedback(s,now=Date.now()){
    const out=empty(s.account);
    for(const e of Object.values(s.events))if(e.at>Math.max(s.floor,s.resets[e.trackId]??-1,now-WINDOW))
      out.tracks[e.trackId]=Math.max(out.tracks[e.trackId]??0,e.at);
    return out;
  }
  function blocked(s,now=Date.now()){return new Set(Object.entries(s.tracks).filter(([,at])=>at<=now&&now<at+WINDOW).map(([id])=>id));}
  const localKey=account=>KEY+':'+encodeURIComponent(account);
  function create({getAccount,storage=root.localStorage,edit,legacy=()=>null,now=()=>Date.now()}){
    const state=a=>parse(storage.getItem(localKey(a)),a);
    async function accept(account,incoming){
      for(let i=0;i<3;i++){
        const key=localKey(account),base=storage.getItem(key),next=JSON.stringify(merge(base,incoming,account,now()));
        if(base===next)return;
        try{await edit(key,base,next);return;}catch(e){if(e.name!=='LocalStateConflict'||i===2)throw e;}
      }
    }
    const combined=()=>{const a=getAccount();if(!a)return null;const old=legacy(a);return merge(state(a),old?fromFeedback(old,now()):null,a,now());};
    return Object.freeze({state,accept,combined,
      blocked:()=>{const s=combined();return s?blocked(s,now()):new Set();},
      async preserve(a,s){await accept(a,fromFeedback(s,now()));},
      async record(event){const a=getAccount();if(!a||event.account!==a||!root.OfficeSkipJournal.validEvent(event)||event.at>now()||event.at<now()-10000)throw new Error('Nieaktualne pominięcie; bez nowej blokady.');
        if(event.kind==='late')return false;const next=empty(a);next.tracks[event.trackId]=event.at;await accept(a,next);return true;}
    });
  }
  root.OfficeTrackCooldown=Object.freeze({KEY,DAY,WINDOW,MAX_ROWS,MAX_BYTES,empty,valid,parse,merge,fromFeedback,blocked,localKey,create});
})(globalThis);
