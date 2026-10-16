import {getSpotifyAccountId} from './state.js';
import '../../play-cooldown.js';
const journal=OfficePlayCooldown,fail=(error,status,headers)=>Response.json({ok:false,error},{status,headers});
export async function onRequestGet({request,env}){
  const auth=await getSpotifyAccountId(request);if(!auth.ok)return fail(auth.error,auth.status,auth.headers);
  try{
    const rows=await env.DB.prepare('SELECT value_json FROM app_state WHERE account_id = ? AND state_key = ?').bind(auth.accountId,journal.KEY).all();
    const base=rows.results?.[0]?.value_json??null;
    const state=journal.merge(base,null,auth.accountId);
    return Response.json({ok:true,state,base},{headers:{'Cache-Control':'no-store'}});
  }catch{return fail('Play cooldown unavailable; data preserved',503);}
}
export async function onRequestPut({request,env}){
  const auth=await getSpotifyAccountId(request);if(!auth.ok)return fail(auth.error,auth.status,auth.headers);
  const max=journal.MAX_BYTES*3+4096; // Include JSON escaping of the CAS predecessor.
  if(Number(request.headers.get('Content-Length'))>max)return fail('Play cooldown request too large',413);
  if(!request.body)return fail('Missing JSON body',400);
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let source='',size=0,body;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();return fail('Play cooldown request too large',413);}source+=decoder.decode(value,{stream:true});}body=JSON.parse(source+decoder.decode());}
  catch{return fail('Invalid JSON body',400);}finally{reader.releaseLock();}
  if(!body||Object.keys(body).sort().join()!=='base,state'||!journal.valid(body.state)||body.state.account!==auth.accountId||
    !(body.base===null||typeof body.base==='string'&&new TextEncoder().encode(body.base).length<=journal.MAX_BYTES))return fail('Invalid play cooldown or CAS base',400);
  const now=Date.now();if([...Object.values(body.state.tracks),...Object.values(body.state.signatures)].some(at=>at>now+300000))return fail('Future play cooldown rejected',400);
  try{
    // A valid predecessor may not be silently lost: incoming must contain its union.
    const merged=journal.merge(body.base,body.state,auth.accountId,now);
    const value=JSON.stringify(merged);
    const result=await env.DB.batch([env.DB.prepare(`
      INSERT INTO app_state (account_id, state_key, value_json, updated_at)
      SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS
        (SELECT 1 FROM app_state WHERE account_id = ? AND state_key = ? AND value_json IS ?)
      ON CONFLICT(account_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      WHERE app_state.value_json IS ?
    `).bind(auth.accountId,journal.KEY,value,new Date(now).toISOString(),body.base,auth.accountId,journal.KEY,body.base,body.base)]);
    if(result[0]?.meta?.changes!==1)return fail('Play cooldown changed; read and merge again',409);
    return Response.json({ok:true,saved:1,state:merged});
  }catch{return fail('Play cooldown write unavailable; data preserved',503);}
}
