import { getSpotifyAccountId } from './state.js';
import '../../lastfm-cloud.js';
const catalog = OfficeLastFmCloud, MAX_REQUEST = 512 * 1024;
const failure = (error, status, headers) => Response.json({ ok: false, error }, { status, headers });
export async function onRequestGet({ request, env }) {
  const auth = await getSpotifyAccountId(request);
  if (!auth.ok) return failure(auth.error, auth.status, auth.headers);
  try {
    const rows = await env.DB.prepare('SELECT value_json FROM app_state WHERE account_id = ? AND state_key = ?').bind(auth.accountId, catalog.KEY).all();
    const base = rows.results?.[0]?.value_json ?? null;
    const cache = base === null ? null : JSON.parse(base);
    if (cache !== null && !catalog.valid(cache)) return failure('Unsupported or invalid Last.fm catalog; stored data preserved', 409);
    return Response.json({ ok: true, cache, base }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return failure('Last.fm catalog unavailable', 503); }
}
export async function onRequestPut({ request, env }) {
  const auth = await getSpotifyAccountId(request);
  if (!auth.ok) return failure(auth.error, auth.status, auth.headers);
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST) return failure('Catalog request too large', 413);
  if (!request.body) return failure('Missing JSON body', 400);
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let body, source = '', size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST) { await reader.cancel(); return failure('Catalog request too large', 413); }
      source += decoder.decode(value, { stream: true });
    }
    body = JSON.parse(source + decoder.decode());
  } catch { return failure('Invalid JSON body', 400); }
  finally { reader.releaseLock(); }
  if (!body || Object.keys(body).sort().join() !== 'base,cache' || !catalog.valid(body.cache) ||
      !(body.base === null || typeof body.base === 'string' && new TextEncoder().encode(body.base).length <= catalog.MAX_BYTES)) return failure('Invalid Last.fm catalog or CAS base', 400);
  try {
    const value = JSON.stringify(body.cache);
    const result = await env.DB.batch([env.DB.prepare(`
      INSERT INTO app_state (account_id, state_key, value_json, updated_at)
      SELECT ?, ?, ?, ? WHERE ? IS NULL OR EXISTS
        (SELECT 1 FROM app_state WHERE account_id = ? AND state_key = ? AND value_json IS ?)
      ON CONFLICT(account_id, state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      WHERE app_state.value_json IS ?
    `).bind(auth.accountId, catalog.KEY, value, new Date().toISOString(), body.base, auth.accountId, catalog.KEY, body.base, body.base)]);
    if (result[0]?.meta?.changes !== 1) return failure('Catalog changed; read and merge again', 409);
    return Response.json({ ok: true, saved: 1 });
  } catch { return failure('Last.fm catalog database unavailable', 503); }
}
