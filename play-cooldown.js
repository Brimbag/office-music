/* Shared replay exclusions, separate from bounded local history and skip scores. */
(function(root){
  'use strict';
  const KEY='office_play_cooldown_v1', WINDOW=14*86400000, MAX_ROWS=20000, MAX_BYTES=1048576;
  const account=v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\s\p{Control}]/u.test(v);
  const id=v=>typeof v==='string'&&/^[A-Za-z0-9]{1,64}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const signature=v=>typeof v==='string'&&v.length<=1024&&/^[^|\p{Control}]+\|[^|\p{Control}]+$/u.test(v);
  const empty=account=>({version:1,account,tracks:Object.create(null),signatures:Object.create(null)});
  function valid(s){try{return s&&Object.keys(s).sort().join()==='account,signatures,tracks,version'&&s.version===1&&account(s.account)&&
    ['tracks','signatures'].every(key=>s[key]&&typeof s[key]==='object'&&!Array.isArray(s[key])&&
      Object.entries(s[key]).every(([value,at])=>(key==='tracks'?id(value):signature(value))&&Number.isSafeInteger(at)&&at>=0))&&
    Object.keys(s.tracks).length+Object.keys(s.signatures).length<=MAX_ROWS&&
    new TextEncoder().encode(JSON.stringify(s)).length<=MAX_BYTES;}catch{return false;}}
  function parse(raw,owner){const s=raw==null?empty(owner):typeof raw==='string'?JSON.parse(raw):raw;
    if(!valid(s)||s.account!==owner)throw new Error('Nieobsługiwany rejestr odtworzeń; dane zachowano.');return s;}
  function merge(a,b,owner,now=Date.now()){
    a=parse(a,owner);b=parse(b,owner);const out=empty(owner);
    for(const field of ['tracks','signatures']){
      for(const [key,at] of [...Object.entries(a[field]),...Object.entries(b[field])])
        if(at>now-WINDOW)out[field][key]=Math.max(out[field][key]??0,at);
      out[field]=Object.fromEntries(Object.entries(out[field]).sort(([a],[b])=>a.localeCompare(b)));
    }
    if(!valid(out))throw new Error('Limit rejestru odtworzeń; nie usunięto aktywnych blokad.');return out;
  }
  function fromPlays(owner,plays,now=Date.now()){
    const out=empty(owner);
    for(const play of plays){
      if(!Number.isSafeInteger(play.at)||play.at>now||play.at<=now-WINDOW)continue;
      if(play.trackId){if(!id(play.trackId))throw new Error('Nieprawidłowy Track ID odtworzenia.');out.tracks[play.trackId]=Math.max(out.tracks[play.trackId]??0,play.at);}
      for(const key of play.signatures||[]){if(!signature(key))throw new Error('Nieprawidłowa sygnatura odtworzenia.');out.signatures[key]=Math.max(out.signatures[key]??0,play.at);}
    }
    if(!valid(out))throw new Error('Limit rejestru odtworzeń; nie usunięto aktywnych blokad.');return out;
  }
  function blocked(state,now=Date.now()){
    const live=map=>new Set(Object.entries(map).filter(([,at])=>at<=now&&now<at+WINDOW).map(([key])=>key));
    return {tracks:live(state.tracks),signatures:live(state.signatures)};
  }
  const localKey=owner=>KEY+':'+encodeURIComponent(owner);
  function create({getAccount,storage=root.localStorage,edit,now=()=>Date.now()}){
    const state=owner=>parse(storage.getItem(localKey(owner)),owner);
    async function accept(owner,incoming){
      for(let i=0;i<3;i++){
        if(getAccount()!==owner)throw new Error('Zmieniono konto rejestru odtworzeń.');
        const key=localKey(owner),base=storage.getItem(key),next=JSON.stringify(merge(base,incoming,owner,now()));
        if(base===next)return;
        try{await edit(key,base,next);if(getAccount()!==owner)throw new Error('Zmieniono konto rejestru odtworzeń.');return;}
        catch(error){if(error.name!=='LocalStateConflict'||i===2)throw error;}
      }
    }
    return Object.freeze({state,accept,
      blocked:()=>{const owner=getAccount();return owner?blocked(state(owner),now()):{tracks:new Set(),signatures:new Set()};},
      record:(owner,plays)=>accept(owner,fromPlays(owner,plays,now()))});
  }
  root.OfficePlayCooldown=Object.freeze({KEY,WINDOW,MAX_ROWS,MAX_BYTES,empty,valid,parse,merge,fromPlays,blocked,localKey,create});
})(globalThis);
