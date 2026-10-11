/* Derived, local acquisition memory; never feedback, a blocklist or cloud state. */
(function(root) {
  const KEY='omm_search_priority_v1', HOUR=3600000, TTL=24*HOUR, MAX=128, MAX_BYTES=65536;
  const integer=v=>Number.isSafeInteger(v)&&v>=0;
  const valid=e=>e&&Object.keys(e).length===5&&typeof e.context==='string'&&/^[a-f0-9]{64}$/.test(e.context)&&
    typeof e.query==='string'&&e.query.length>0&&e.query.length<240&&integer(e.misses)&&e.misses>=1&&e.misses<=4&&integer(e.at)&&integer(e.retryAt)&&e.retryAt>=e.at;
  function read(raw,now) {
    if(!raw)return [];
    try { if(new TextEncoder().encode(raw).length>MAX_BYTES)return null;
      const state=JSON.parse(raw);if(state?.version!==1||Object.keys(state).length!==2||!Array.isArray(state.entries)||state.entries.length>MAX||!state.entries.every(valid)||new Set(state.entries.map(e=>`${e.context}:${e.query}`)).size!==state.entries.length)return null;
      return state.entries.filter(e=>now>=e.at&&now-e.at<TTL).map(e=>({...e}));
    }catch{return null;}
  }
  root.OmmSearchRotation={KEY,TTL,MAX,MAX_BYTES,create(raw,context,now=Date.now()) {
    const initial=read(raw,now),supported=initial!==null&&typeof context==='string'&&/^[a-f0-9]{64}$/.test(context);
    const entries=initial||[],changes=new Map();
    return {
      rank(query,capacity,probed=false,at=Date.now()) {
        if(!supported||capacity>0)return 0;
        const e=entries.find(e=>e.context===context&&e.query===query);
        if(!e||e.misses<2||at<e.at||at-e.at>=TTL)return 0;
        return at>=e.retryAt&&!probed?-1:1;
      },
      observe(pages,at=Date.now()) {
        if(!supported)return;
        const grouped=new Map();
        for(const p of pages||[]) {
          if(p.source!=='Spotify'||p.status!=='ok'||!integer(p.raw)||!integer(p.safe)||!p.query||p.query.length>=240)continue;
          const state=grouped.get(p.query)||{safe:false,complete:true};
          state.safe ||= p.safe>0;
          // Retired/invalid/duplicate IDs were not all qualified. Do not guess.
          state.complete &&= p.filtered===0||p.retained===p.filtered;
          grouped.set(p.query,state);
        }
        for(const [query,result] of grouped) {
          if(result.safe){changes.set(query,null);continue;}
          if(!result.complete)continue;
          const prior=entries.find(e=>e.context===context&&e.query===query);
          const recent=prior&&at>=prior.at&&at-prior.at<TTL?prior.misses:0;
          const misses=Math.min(4,recent+1);
          changes.set(query,{context,query,misses,at,retryAt:at+(misses<2?0:Math.min(2*HOUR,.5*HOUR*2**(misses-2)))});
        }
      },
      serialize(currentRaw,at=Date.now()) {
        if(!supported||!changes.size)return null;
        const current=read(currentRaw,at);if(current===null)return null;
        const merged=current.filter(e=>e.context!==context||!changes.has(e.query));
        merged.push(...[...changes.values()].filter(Boolean));
        merged.sort((a,b)=>b.at-a.at||a.context.localeCompare(b.context)||a.query.localeCompare(b.query));
        const raw=JSON.stringify({version:1,entries:merged.slice(0,MAX)});
        return new TextEncoder().encode(raw).length<=MAX_BYTES?raw:null;
      }
    };
  }};
})(globalThis);
