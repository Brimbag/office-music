/* LOG1 aggregate diagnostics: explicit fields only, no queries, tracks or credentials. */
(function(root) {
  const MAX_BYTES = 16384, VERSION = 'v43.40.S1';
  const PEOPLE = ['bartek','edyta','asia','monika'];
  const FILTERS = ['rawPool','invalid','feedbackTrack','unwantedVariant','explicitBlockedArtist','feedbackBlockedArtist','artistIdExcluded','strongNegativeArtistFeedback','artistCooldown','recentTrack','recognizability','lowGroupFit','lowIndividualFit','discoveryModeExcluded','eligible','artistLimitDuringSelection','duplicateDuringSelection','fallbackSelections','lowFinalScoreStop'];
  const STOP = ['remaining','duplicateBlocked','artistLimitBlocked','discoveryQuotaBlockedCurrent','discoveryQuotaBlockedTarget','selectableAtTargetQuota','base44Plus','base40to43','base35to39','baseBelow35','fallbackRange','fallbackFailMinUser','fallbackStrongNegativeFeedback','fallbackSafe','targetQuotaMax'];
  const COUNTERS = ['queries','skipped','cachePages','cacheContributed','searches','budget','pool','artists','tracks','coverageHits','searchRequests','cacheReadHits','cacheReadMisses','oauthAttempts','oauthSuccess','oauthFailure'];
  const METRICS = ['localPool','coverage','coverageCheck','qualification','searchCache','spotifyApi','lastfmApi','throttle','retryWait','oauth','evidenceIndex','model','acquisitionModel','retention','lastfmRetention','poolWrite','cacheReuse','historyBlocks','queryArtists','historyView','selection','sequencing','candidateQueries','lastfmArtistsWrite','lastfmTracksWrite','tasteQueries'];
  const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k=>allowed.includes(k));
  const exact = (value, allowed) => keys(value,allowed) && Object.keys(value).length === allowed.length;
  const number = (v,max=10000000) => typeof v === 'number' && Number.isFinite(v) && v>=0 && v<=max;
  const count = (v,max=10000000) => number(v,max) && Number.isInteger(v);
  const counts = (v,allowed) => keys(v,allowed) && Object.values(v).every(x=>count(x));
  const rounded = v => Number.isFinite(v) && v>=0 ? Math.round(v*100)/100 : 0;
  const pickCounts = (value,fields) => Object.fromEntries(fields.filter(k=>count(value?.[k])).map(k=>[k,value[k]]));
  function valid(v) {
    if (!exact(v,['schema','id','version','finishedAt','outcome','requested','length','playlistCreated','profiles','totalMs','accounting','stages','counters','metrics','selection','cloud']) || v.schema!==1 ||
      typeof v.id!=='string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.id) ||
      typeof v.version!=='string' || !/^v\d{1,3}\.\d{1,3}\.[A-Z0-9]{1,12}$/.test(v.version) ||
      typeof v.finishedAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.finishedAt) || !Number.isFinite(Date.parse(v.finishedAt)) || new Date(v.finishedAt).toISOString()!==v.finishedAt ||
      !['success','error'].includes(v.outcome) || !count(v.requested,1000) || !count(v.length,v.requested) || typeof v.playlistCreated!=='boolean' ||
      !Array.isArray(v.profiles) || v.profiles.length>4 || new Set(v.profiles).size!==v.profiles.length || !v.profiles.every(id=>PEOPLE.includes(id)) ||
      !number(v.totalMs,86400000) || !exact(v.accounting,['syncMs','waitMs','otherMs','hiddenMs','maxTimerGapMs']) || !Object.values(v.accounting).every(x=>number(x,86400000)) || !Array.isArray(v.stages) || v.stages.length!==11 || !counts(v.counters,COUNTERS) || !keys(v.metrics,METRICS)) return false;
    if (!v.stages.every(s=>exact(s,['status','ms']) && ['waiting','done','error'].includes(s.status) && number(s.ms,86400000))) return false;
    if (!Object.values(v.metrics).every(m=>exact(m,['calls','inclusiveMs','exclusiveMs']) && count(m.calls) && number(m.inclusiveMs,86400000) && number(m.exclusiveMs,m.inclusiveMs))) return false;
    if (v.selection!==null) {
      const s=v.selection;
      if (!exact(s,['discovery','maximumDiscovery','distinctArtists','profiles','filters','stop','acquisition']) || !count(s.discovery,v.length) || !count(s.maximumDiscovery,v.length) || !count(s.distinctArtists,1000) || !keys(s.profiles,PEOPLE) ||
        !Object.keys(s.profiles).every(id=>v.profiles.includes(id)) || !Object.values(s.profiles).every(p=>exact(p,['average','strong','weak']) && number(p.average,100) && count(p.strong,v.length) && count(p.weak,v.length)) ||
        !counts(s.filters,FILTERS) || !(s.stop===null || counts(s.stop,STOP)) || !(s.acquisition===null || exact(s.acquisition,['before','after','cachedPages','newSearches']) && Object.values(s.acquisition).every(x=>count(x)))) return false;
    }
    if (!exact(v.cloud,['state','lastfm']) || !['not_run','success','error'].includes(v.cloud.state)) return false;
    const lf=v.cloud.lastfm;
    if (!exact(lf,['status','artists','tracks','bytes','written']) || !['not_run','success','skipped','error'].includes(lf.status) || typeof lf.written!=='boolean' ||
      ![[lf.artists,1800],[lf.tracks,3000],[lf.bytes,131072]].every(([x,max])=>x===null || count(x,max))) return false;
    if (['not_run','error'].includes(lf.status) && (lf.written || [lf.artists,lf.tracks,lf.bytes].some(x=>x!==null))) return false;
    return new TextEncoder().encode(JSON.stringify(v)).length<=MAX_BYTES;
  }
  const emptyLastfm = (status='not_run') => ({status,artists:null,tracks:null,bytes:null,written:false});
  function cloudResult(result, failed=false) {
    if (failed) return {state:'error',lastfm:emptyLastfm()};
    const c=result?.catalog;
    return {state:'success',lastfm:!c?emptyLastfm():c.error?emptyLastfm('error'):{status:c.skipped?'skipped':'success',artists:count(c.artists,1800)?c.artists:null,tracks:count(c.tracks,3000)?c.tracks:null,bytes:count(c.bytes,131072)?c.bytes:null,written:c.written===true}};
  }
  function build(report,context) {
    const group=context.group;
    const entry={schema:1,id:context.id,version:VERSION,finishedAt:new Date().toISOString(),outcome:report.outcome,requested:context.requested,length:report.length,playlistCreated:report.playlistCreated,
      profiles:context.profiles,totalMs:rounded(report.totalMs),accounting:Object.fromEntries(['syncMs','waitMs','otherMs','hiddenMs','maxTimerGapMs'].map(k=>[k,rounded(report.accounting?.[k])])),stages:report.stages.map(s=>({status:s.status,ms:rounded(s.ms)})),counters:pickCounts(report.counters,COUNTERS),
      metrics:Object.fromEntries(METRICS.filter(k=>report.metrics[k]).map(k=>[k,{calls:report.metrics[k].calls,inclusiveMs:rounded(report.metrics[k].inclusiveMs),exclusiveMs:rounded(report.metrics[k].exclusiveMs)}])),selection:null,cloud:context.cloud};
    if (group && report.outcome==='success') entry.selection={discovery:group.discoveryCount,maximumDiscovery:group.discoveryQuota.max,distinctArtists:new Set(group.tracks.flatMap(t=>(t.artists||[]).map(a=>a.id).filter(Boolean))).size,
      profiles:Object.fromEntries(context.profiles.filter(id=>group.satisfaction[id]).map(id=>[id,{average:rounded(group.satisfaction[id].average),strong:group.satisfaction[id].strong,weak:group.satisfaction[id].weak}])),
      filters:pickCounts(group.rejectionStats,FILTERS),stop:group.rejectionStats?.selectionStopDiagnostics?pickCounts(group.rejectionStats.selectionStopDiagnostics,STOP):null,
      acquisition:group.acquisition?pickCounts(group.acquisition,['before','after','cachedPages','newSearches']):null};
    return entry;
  }
  root.OfficeGenerationLog=Object.freeze({MAX_BYTES,VERSION,valid,build,cloudResult,emptyLastfm});
})(globalThis);
