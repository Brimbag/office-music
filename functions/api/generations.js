import { getSpotifyAccountId } from './state.js';
import '../../generation-log.js';
const journal=OfficeGenerationLog;
const failure=(error,status,headers)=>Response.json({ok:false,error},{status,headers});
export async function onRequestGet({request,env}) {
  const auth=await getSpotifyAccountId(request);
  if(!auth.ok)return failure(auth.error,auth.status,auth.headers);
  const url=new URL(request.url),raw=url.searchParams.get('limit')||'20';
  if([...url.searchParams.keys()].some(k=>k!=='limit') || url.searchParams.getAll('limit').length>1 || !/^\d{1,3}$/.test(raw) || Number(raw)<1 || Number(raw)>100)return failure('Invalid log limit',400);
  try {
    const rows=await env.DB.prepare('SELECT payload_json, created_at FROM generation_logs WHERE account_id = ? ORDER BY record_order DESC LIMIT ?').bind(auth.accountId,Number(raw)).all();
    const entries=[];
    for(const row of rows.results||[]) {
      const entry=JSON.parse(row.payload_json);
      if(!journal.valid(entry))return failure('Unsupported stored generation log; data preserved',409);
      entries.push({entry,receivedAt:row.created_at});
    }
    return Response.json({ok:true,entries},{headers:{'Cache-Control':'no-store'}});
  }catch{return failure('Generation journal unavailable; playlist is unaffected',503);}
}
export async function onRequestPost({request,env}) {
  const auth=await getSpotifyAccountId(request);
  if(!auth.ok)return failure(auth.error,auth.status,auth.headers);
  if(Number(request.headers.get('Content-Length'))>journal.MAX_BYTES)return failure('Generation log too large',413);
  if(!request.body)return failure('Missing JSON body',400);
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,source='',entry;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>journal.MAX_BYTES){await reader.cancel();return failure('Generation log too large',413);}source+=decoder.decode(value,{stream:true});}
    entry=JSON.parse(source+decoder.decode());
  }catch{return failure('Invalid generation log JSON',400);}finally{reader.releaseLock();}
  if(!journal.valid(entry))return failure('Invalid generation log schema',400);
  // Stable object-key order makes reordered equivalent payloads idempotent.
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  const serialized=JSON.stringify(canonical(entry));
  try {
    const result=await env.DB.batch([
      env.DB.prepare('INSERT INTO generation_logs(account_id,generation_id,payload_json,created_at) VALUES(?,?,?,?) ON CONFLICT(account_id,generation_id) DO NOTHING').bind(auth.accountId,entry.id,serialized,new Date().toISOString()),
      env.DB.prepare('DELETE FROM generation_logs WHERE account_id = ? AND generation_id NOT IN (SELECT generation_id FROM generation_logs WHERE account_id = ? ORDER BY record_order DESC LIMIT 100)').bind(auth.accountId,auth.accountId),
      env.DB.prepare('SELECT payload_json FROM generation_logs WHERE account_id = ? AND generation_id = ?').bind(auth.accountId,entry.id)
    ]);
    const stored=result[2]?.results?.[0]?.payload_json;
    if(stored!==undefined && stored!==serialized)return failure('Generation ID already has a different log; original preserved',409);
    return Response.json({ok:true,saved:result[0]?.meta?.changes===1,duplicate:result[0]?.meta?.changes===0},{status:stored===undefined?202:200});
  }catch{return failure('Generation journal unavailable; playlist is unaffected',503);}
}
