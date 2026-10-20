// Offline only. Uses the repository's actual history reader and identity rules.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import '../play-cooldown.js';

const HISTORY='office_music_history_v1',RECENT='office_recent_playlists_v1',WINDOW=14*86400000;
const decode=value=>typeof value==='string'?JSON.parse(value):value;
const storageOf=backup=>backup.storage??backup;
function instant(value,label){
  if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))
    throw new Error(`${label}: wymagany ISO timestamp z Z lub jawnym offsetem.`);
  return Date.parse(value);
}
function section(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  if(a<0||b<0)throw new Error('Nie rozpoznano funkcji historii w kodzie aplikacji.');
  return source.slice(a,b);
}
export function loadRules(source,history,at,sharedBlocks=null){
  const warnings=[];
  const context=vm.createContext({Date:class extends Date{static now(){return at;}},
    localStorage:{getItem:key=>key===HISTORY?JSON.stringify(history):null},
    HISTORY_KEY:HISTORY,HISTORY_MAX_AGE_DAYS:90,OfficeTrackCooldown:{WINDOW},artistCooldownHours:{value:0},
    playCooldown:sharedBlocks?{blocked:()=>sharedBlocks}:null,
    console:{warn:()=>warnings.push('history_reader_warning')}});
  // Execute only trusted functions from the local application revision, never
  // JavaScript from a backup or playlist. No fetch/network globals are exposed.
  vm.runInContext(section(source,'function normalizeForSignature(','function selectedBlockedArtistNames(')+
    section(source,'function compactPlayedHistoryItem(','function saveHistory(')+
    section(source,'function buildHistoryBlocklists(','function renderHistorySummary('),context,{timeout:1000});
  return {context,warnings,blocks:context.buildHistoryBlocklists(),loaded:context.loadHistory()};
}
function polishTime(day,month,year,hour,minute,second){
  const values=[year,month,day,hour,minute,second].map(Number);
  const utc=Date.UTC(values[0],values[1]-1,...values.slice(2));
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const candidates=[60,120].map(offset=>utc-offset*60000).filter(at=>{
    const p=Object.fromEntries(format.formatToParts(at).map(p=>[p.type,p.value]));
    return ['year','month','day','hour','minute','second'].every((key,i)=>Number(p[key])===values[i]);
  });
  if(candidates.length!==1)throw new Error('Niejednoznaczny czas PL w raporcie. Podaj --generated-at z offsetem.');
  return new Date(candidates[0]).toISOString();
}
export function parsePlaylistText(text,backup,{generatedAt}={}){
  const lines=text.split(/\r?\n/),tracks=[],pool=decode(storageOf(backup).office_candidate_pool_v1??'[]');
  const byDisplay=new Map();
  for(const row of Array.isArray(pool)?pool:[]){
    const t=row?.track;if(!t?.name||!Array.isArray(t.artists))continue;
    byDisplay.set(t.artists.map(a=>a.name).join(', ')+' - '+t.name,t);
  }
  for(let i=1;i<lines.length;i++)if(lines[i].startsWith('Spotify:')){
    const display=lines[i-1].trim(),catalog=byDisplay.get(display),split=display.indexOf(' - ');
    if(split<1)throw new Error('Nie rozpoznano nagłówka utworu przed diagnostyką Spotify.');
    // Text exports have no verified playlist Track IDs. Do not substitute a
    // catalog candidate's ID and claim it was the ID selected for the playlist.
    tracks.push({id:'',name:catalog?.name??display.slice(split+3),
      artists:catalog?.artists.map(a=>({name:a.name}))??[{name:display.slice(0,split)}],
      identitySource:catalog?'text_with_backup_artist_credits':'text',display});
  }
  const expected=text.match(/·\s*(\d+)\/\d+ utworów/);
  if(!tracks.length||expected&&Number(expected[1])!==tracks.length)throw new Error('Liczba odczytanych utworów nie zgadza się z raportem.');
  const time=text.match(/koniec:\s*(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})/);
  let reportAt=null;
  if(time){try{reportAt=polishTime(...time.slice(1));}catch(error){if(!generatedAt)throw error;}}
  const historyCounts=text.match(/Historia lokalna:\s*(\d+) wpisów \((\d+) z Last\.fm, (\d+) ze Spotify/);
  return {tracks,generatedAt:generatedAt??reportAt,reportedGeneratedAt:reportAt,
    timeSource:generatedAt?'explicit_override':'report_completion_time',
    reportedHistory:historyCounts?{total:Number(historyCounts[1]),lastfm:Number(historyCounts[2]),spotify:Number(historyCounts[3])}:null,
    version:text.match(/\b(1\.0\.\d+)\s*·/)?.[1]??null};
}
export function selectPlaylist(value,{playlistId,generatedAt}={}){
  if(value?.storage||value?.[RECENT]){
    const rows=decode(storageOf(value)[RECENT]??'[]');
    const found=playlistId==='latest'?rows[0]:playlistId?rows.find(r=>r.id===playlistId):rows.length===1?rows[0]:null;
    if(!found)throw new Error('Wskaż --playlist-id (albo latest); backup nie identyfikuje jednoznacznie playlisty.');
    return selectPlaylist(found,{generatedAt});
  }
  const items=Array.isArray(value)?value:value?.tracks?.items??value?.tracks??value?.items;
  if(!Array.isArray(items))throw new Error('Brak listy utworów w eksporcie playlisty.');
  return {tracks:items.map(row=>{
    const t=row?.track??row;
    if(!t||typeof t!=='object')throw new Error('Nieprawidłowy rekord playlisty.');
    return {...t,artists:(t.artists??[]).map(a=>typeof a==='string'?{name:a}:a)};
  }),id:value?.id??null,generatedAt:generatedAt??value?.generatedAt,
    reportedGeneratedAt:value?.generatedAt??null,timeSource:generatedAt?'explicit_override':'snapshot_completion_time'};
}
const signatures=(rules,track)=>[rules.context.trackSignature(track),...rules.context.trackDuplicateSignatures(track)].filter(Boolean);
const excludes=(rules,track)=>Boolean(track.id&&rules.blocks.blockedTracks.has(track.id))||signatures(rules,track).some(s=>rules.blocks.blockedTrackSignatures.has(s));
function safeHistoryRow(raw,rules){
  if(!raw||!['spotify','lastfm'].includes(raw.source))return null;
  // Sanitize fields for analysis independently of legacy reader failure. Keep
  // the exact same production normalization for every string identity.
  const names=Array.isArray(raw.artistNames)?raw.artistNames.filter(n=>typeof n==='string'):[];
  const name=typeof raw.trackName==='string'?raw.trackName:'';
  const signature=typeof raw.trackSignature==='string'&&raw.trackSignature||rules.context.trackSignatureFromParts(name,names);
  const at=new Date(typeof raw.playedAt==='string'||typeof raw.playedAt==='number'?raw.playedAt:0).getTime();
  if(!Number.isFinite(at)||at<=0)return null;
  return {trackId:typeof raw.trackId==='string'?raw.trackId:'',trackName:name,artistNames:names,
    trackSignature:signature,source:raw.source,playedAt:new Date(at).toISOString(),at};
}
export function auditBackup({backup,playlist,rulesHtml,baselineHtml}){
  const raw=decode(storageOf(backup)[HISTORY]??'[]');
  if(!Array.isArray(raw))throw new Error('Historia w backupie nie jest tablicą.');
  const at=instant(playlist.generatedAt,'Czas generowania');
  const registers=Object.entries(storageOf(backup)).filter(([key])=>key.startsWith(OfficePlayCooldown.KEY+':'))
    .map(([key,value])=>OfficePlayCooldown.parse(value,decodeURIComponent(key.slice(OfficePlayCooldown.KEY.length+1))));
  if(registers.length>1)throw new Error('Backup zawiera rejestry wielu kont; audyt wymaga kopii dla jednego konta.');
  const sharedBlocks={tracks:new Set(),signatures:new Set()};
  for(const register of registers){
    const blocked=OfficePlayCooldown.blocked(register,at);
    for(const key of blocked.tracks)sharedBlocks.tracks.add(key);
    for(const key of blocked.signatures)sharedBlocks.signatures.add(key);
  }
  const rules=loadRules(rulesHtml,raw,at,sharedBlocks);
  const baseline=baselineHtml?loadRules(baselineHtml,raw,at,sharedBlocks):null;
  const history=raw.map(r=>safeHistoryRow(r,rules)).filter(Boolean);
  const warnings=[...rules.warnings];
  const backupHistoryCounts={total:raw.length,lastfm:raw.filter(r=>r?.source==='lastfm').length,spotify:raw.filter(r=>r?.source==='spotify').length};
  if(playlist.reportedHistory&&JSON.stringify(backupHistoryCounts)!==JSON.stringify(playlist.reportedHistory))warnings.push('reported_history_counts_differ_from_backup');
  if(backup.exportedAt&&Date.parse(backup.exportedAt)<at)warnings.push('backup_precedes_generation_and_is_not_its_input_snapshot');
  if(playlist.timeSource?.includes('completion'))warnings.push('completion_time_is_not_exact_selection_time');
  if(playlist.tracks.some(t=>!t.id))warnings.push('some_playlist_track_ids_missing_signature_matching_used');
  if(registers.length)warnings.push('play_registry_included_skip_registry_not_audited');
  if(registers.some(r=>[...Object.values(r.tracks),...Object.values(r.signatures)].some(time=>time>at)))
    warnings.push('registry_contains_later_timestamps_earlier_plays_cannot_be_reconstructed');
  const rows=playlist.tracks.map((track,index)=>{
    const sigs=signatures(rules,track);
    const matches=history.flatMap(h=>{
      const methods=[];
      if(track.id&&h.trackId===track.id)methods.push('id');
      if(sigs.some(s=>s===h.trackSignature||rules.context.historyDuplicateSignatures(h).includes(s)))methods.push('signature');
      return methods.length?[{...h,methods}]:[];
    });
    const past=matches.filter(h=>h.at<=at).sort((a,b)=>b.at-a.at),active=past.filter(h=>h.at>at-WINDOW);
    const relevant=active.length?active:past;
    const registryMethods=[];
    if(track.id&&sharedBlocks.tracks.has(track.id))registryMethods.push('id');
    if(sigs.some(s=>sharedBlocks.signatures.has(s)))registryMethods.push('signature');
    const live=excludes(rules,track),old=baseline?excludes(baseline,track):null;
    return {position:index+1,trackId:track.id??'',artists:track.artists.map(a=>a.name).join(', '),title:track.name,
      lastPlayBeforeGeneration:past[0]?.playedAt??null,
      lastPlayPL:past[0]?new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',dateStyle:'short',timeStyle:'medium'}).format(past[0].at):null,
      sources:[...new Set(relevant.map(h=>h.source))].sort(),methods:[...new Set(relevant.flatMap(h=>h.methods))].sort(),
      registryMethods,shouldExclude:active.length>0||registryMethods.length>0,currentFilterExcludes:live,baselineFilterExcludes:old,
      laterPlaysIgnored:matches.filter(h=>h.at>at).length,
      finding:registryMethods.length&&!active.length?'active_play_registry_block':active.length?old===false&&live?'legacy_history_reader_rejection':
        'prior_play_confirmed_generation_input_or_availability_unknown':past.length?'outside_14_day_window':
        matches.length?'only_later_plays':'no_prior_play_found_in_supplied_backup'};
  });
  const violations=rows.filter(r=>r.shouldExclude);
  return {schemaVersion:1,generatedAt:new Date(at).toISOString(),timeSource:playlist.timeSource,
    backupExportedAt:backup.exportedAt??null,backupVersion:backup.source??null,playlistVersion:playlist.version??null,
    backupHistoryCounts,reportedHistoryCounts:playlist.reportedHistory??null,
    summary:{tracks:rows.length,rawHistory:raw.length,loadedHistory:rules.loaded.length,playRegisters:registers.length,
      baselineLoadedHistory:baseline?.loaded.length??null,expectedExclusions:violations.length,
      sharePercent:rows.length?100*violations.length/rows.length:0,
      excludedByCurrentFilter:rows.filter(r=>r.currentFilterExcludes).length,
      excludedByBaselineFilter:baseline?rows.filter(r=>r.baselineFilterExcludes).length:null,
      confirmedGenerationBypassCause:null},warnings,rows};
}
export function csv(rows){
  const columns=['position','artists','title','trackId','lastPlayBeforeGeneration','lastPlayPL','sources','methods','registryMethods','shouldExclude','currentFilterExcludes','baselineFilterExcludes','laterPlaysIgnored','finding'];
  const cell=v=>'"'+String(Array.isArray(v)?v.join('+'):v??'').replaceAll('"','""')+'"';
  return '\ufeff'+[columns.map(cell).join(','),...rows.map(r=>columns.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
}
async function jsonFile(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{throw new Error(`Nie można odczytać JSON: ${basename(path)}.`);}}
async function main(){
  const args=process.argv.slice(2),options={};
  if(args.includes('--help')){console.log('node scripts/audit-play-history.mjs --backup BACKUP.json [--playlist PLAYLIST.json|REPORT.txt] [--playlist-id ID|latest] [--generated-at ISO_WITH_OFFSET] [--baseline-rules TRUSTED_INDEX.html] [--out PREFIX]');return;}
  for(let i=0;i<args.length;i+=2){
    if(!['--backup','--playlist','--playlist-id','--generated-at','--baseline-rules','--out'].includes(args[i])||!args[i+1])throw new Error('Nieprawidłowe argumenty; użyj --help.');
    options[args[i].slice(2)]=args[i+1];
  }
  if(!options.backup)throw new Error('Wskaż --backup.');
  const backup=await jsonFile(options.backup),text=options.playlist?await readFile(options.playlist,'utf8'):null;
  let playlist;
  if(text){
    let parsed;try{parsed=JSON.parse(text);}catch{}
    playlist=parsed?selectPlaylist(parsed,{playlistId:options['playlist-id'],generatedAt:options['generated-at']}):
      parsePlaylistText(text,backup,{generatedAt:options['generated-at']});
  }else playlist=selectPlaylist(backup,{playlistId:options['playlist-id'],generatedAt:options['generated-at']});
  const rulesHtml=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const baselineHtml=options['baseline-rules']?await readFile(options['baseline-rules'],'utf8'):null;
  const report=auditBackup({backup,playlist,rulesHtml,baselineHtml});
  if(options.out){
    const prefix=resolve(options.out);await mkdir(dirname(prefix),{recursive:true});
    await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n');
    await writeFile(prefix+'.csv',csv(report.rows));
    await writeFile(prefix+'.violations.csv',csv(report.rows.filter(r=>r.shouldExclude)));
    console.log(JSON.stringify({generatedAt:report.generatedAt,summary:report.summary,warnings:report.warnings,outputPrefix:prefix},null,2));
  }else console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
