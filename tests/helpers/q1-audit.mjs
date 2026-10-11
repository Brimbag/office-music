// Read-only audit. Contains no recommendation, storage, or network mutations.
export function captureQ1Input(eligible, requested, ctx, initialStats, result) {
  const history = loadHistory().filter(row => ['spotify','lastfm'].includes(row.source) && new Date(row.playedAt).getTime() <= Date.now());
  const historyIds = new Set(history.map(row => row.trackId).filter(Boolean));
  const historySignatures = new Set(history.map(row => trackSignatureFromParts(row.trackName,row.artistNames)));
  return {
    requested, maximumShare: Math.min(1,(Number(discoveryLevel.value || 0)+5)/100),
    discoverySetting: Number(discoveryLevel.value || 0),
    filters: initialStats, selectionCounters: result.rejectionStats,
    repair: result.discoveryRepair, stop: result.rejectionStats.selectionStopDiagnostics,
    rows: eligible.map(item => ({
      id: item.track.id, artists: [...trackArtistKeys(item.track)],
      signatures: trackDuplicateSignatures(item.track),
      discovery: !!item.features.discovery, safe: acquisitionQualifying(item),
      byUser: Object.fromEntries(ctx.selected.map(p=>[p.id,item.byUser[p.id]?.score || 0])),
      historyKnown: historyIds.has(item.track.id) || historySignatures.has(trackSignature(item.track))
    })),
    selected: result.tracks.map(track=>track.id), discovery: result.discoveryCount,
    maximumDiscovery: result.discoveryQuota.max
  };
}
export function analyzeQ1(input) {
  const selectedIds=new Set(input.selected), chosen=input.rows.filter(row=>selectedIds.has(row.id));
  const safe=input.rows.filter(row=>row.safe), known=safe.filter(row=>!row.discovery), discovery=safe.filter(row=>row.discovery);
  const artistCounts=new Map(), signatures=new Set();
  for(const row of chosen){for(const artist of row.artists)artistCounts.set(artist,(artistCounts.get(artist)||0)+1);for(const signature of row.signatures)signatures.add(signature);}
  const unused={total:0,unsafe:0,duplicate:0,artistLimit:0,discoveryQuota:0,appendable:0,appendableKnown:0,appendableDiscovery:0};
  const goal=input.discoverySetting, upper=goal===0?0:goal===100?1:input.maximumShare;
  const cap=length=>goal===100?length:Math.floor(length*upper+1e-9);
  for(const row of input.rows){
    if(selectedIds.has(row.id))continue;unused.total++;
    if(!row.safe){unused.unsafe++;continue;}
    if(row.signatures.some(key=>signatures.has(key))){unused.duplicate++;continue;}
    if(row.artists.some(key=>(artistCounts.get(key)||0)>=2)){unused.artistLimit++;continue;}
    if((goal===0&&row.discovery)||(goal===100&&!row.discovery)||(row.discovery&&input.discovery+1>cap(chosen.length+1))){unused.discoveryQuota++;continue;}
    unused.appendable++;unused[row.discovery?'appendableDiscovery':'appendableKnown']++;
  }
  const quotaBound=goal===100?discovery.length:Math.floor((known.length+1e-9)/(1-upper));
  const artistBound=new Set(safe.flatMap(row=>row.artists)).size*2;
  const optimisticUpperBound=Math.min(input.requested,safe.length,quotaBound,artistBound);
  const scores=Object.fromEntries([...new Set(chosen.flatMap(row=>Object.keys(row.byUser)))].map(id=>{
    const values=chosen.map(row=>row.byUser[id]);return [id,{average:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),minimum:values.length?Math.min(...values):null}];
  }));
  const hardFailures={discoveryAboveMaximum:Math.max(0,input.discovery-input.maximumDiscovery),below35:chosen.filter(row=>Object.values(row.byUser).some(score=>score<35)).length,artistAboveLimit:[...artistCounts.values()].filter(n=>n>2).length,unsafeSelected:chosen.filter(row=>!row.safe).length};
  return {
    hardFailures,requested:input.requested,length:chosen.length,eligible:input.rows.length,safe:safe.length,
    knownEligible:known.length,discoveryEligible:discovery.length,distinctEligibleArtists:new Set(safe.flatMap(row=>row.artists)).size,
    discovery:input.discovery,discoveryShare:input.discovery/Math.max(1,chosen.length),maximumDiscovery:input.maximumDiscovery,
    historyKnown:chosen.filter(row=>row.historyKnown).length,distinctSelectedArtists:artistCounts.size,scores,
    bounds:{pool:safe.length,artists:artistBound,discovery:quotaBound},filters:input.filters,selectionCounters:input.selectionCounters,repair:input.repair,stop:input.stop,unused,optimisticUpperBound,
    diagnosis:Object.values(hardFailures).some(Boolean)?'hard_condition_violation':chosen.length===input.requested?'target_met':unused.appendable?'unused_appendable_candidates':quotaBound<Math.min(input.requested,safe.length,artistBound)?'insufficient_known_candidates':optimisticUpperBound<input.requested?'insufficient_safe_pool':'combination_constraints_or_selection'
  };
}
