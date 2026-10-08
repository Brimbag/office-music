// Keep this allowlist aligned with cloudStateKeys() in index.html.
const IDENTITY_KEY = "office_artist_identity_v2";
const STATE_KEYS = new Set([
  IDENTITY_KEY,
  "office_taste_profile_v1", "office_music_feedback_v1",
  "office_music_feedback_blocked_artists_v1", "office_seed_artist_rotation_v1",
  "office_rmf_settings_v2", "office_recent_playlists_v1", "office_lastfm_user_v1",
  "office_lastfm_tag_rotation_v1", "office_polish_tag_rotation_v1",
  "office_candidate_pool_v1", "office_genre_prime_state_v1",
  ...["bartek", "edyta", "asia", "monika"].flatMap(id =>
    [`office_genres_${id}`, `office_seed_${id}`, `office_blocked_${id}`]
  )
]);
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_VALUE_BYTES = 1536 * 1024;
const MAX_STATE_KEYS = 32;

function errorResponse(error, status, headers) {
  return Response.json({ ok: false, error }, { status, headers });
}

function validAccountId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !/[\s\p{Control}]/u.test(value);
}

async function getSpotifyAccountId(request) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, status: 401, error: "Missing Spotify access token" };

  let response;
  try {
    response = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${match[1]}` }
    });
  } catch {
    return { ok: false, status: 502, error: "Spotify authentication unavailable" };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, error: "Spotify authentication failed" };
    }
    const retryAfter = response.headers.get("Retry-After");
    return {
      ok: false,
      status: response.status === 429 ? 503 : 502,
      error: "Spotify authentication unavailable",
      headers: response.status === 429 && /^\d{1,6}$/.test(retryAfter || "")
        ? { "Retry-After": retryAfter } : undefined
    };
  }

  let user;
  try { user = await response.json(); }
  catch { return { ok: false, status: 502, error: "Invalid Spotify profile response" }; }

  // Spotify's current /me contract requires immutable account_id for account
  // linking and explicitly forbids using the mutable public id for that purpose.
  // Never fall back to id or accept an identity supplied by the browser.
  const accountId = user?.account_id;
  if (!validAccountId(accountId)) {
    return { ok: false, status: 502, error: "Spotify account identifier missing" };
  }
  return { ok: true, accountId };
}

async function readStateBody(request) {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (declaredLength > MAX_STATE_BYTES) return { status: 413, error: "State payload too large" };
  if (!request.body) return { status: 400, error: "Invalid JSON body" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_STATE_BYTES) {
        await reader.cancel();
        return { status: 413, error: "State payload too large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { body: JSON.parse(text) };
  } catch { return { status: 400, error: "Invalid JSON body" }; }
  finally { reader.releaseLock(); }
}

export async function onRequestGet(context) {
  const auth = await getSpotifyAccountId(context.request);
  if (!auth.ok) return errorResponse(auth.error, auth.status, auth.headers);

  try {
    const rows = await context.env.DB.prepare(`
      SELECT state_key, value_json, updated_at
      FROM app_state
      WHERE account_id = ?
    `).bind(auth.accountId).all();
    const state = Object.create(null);
    for (const row of rows.results || []) {
      if (!STATE_KEYS.has(row.state_key)) continue;
      try { state[row.state_key] = JSON.parse(row.value_json); }
      catch { state[row.state_key] = null; }
    }
    return Response.json({ ok: true, state });
  } catch { return errorResponse("State database unavailable", 503); }
}

export async function onRequestPut(context) {
  const auth = await getSpotifyAccountId(context.request);
  if (!auth.ok) return errorResponse(auth.error, auth.status, auth.headers);

  const parsed = await readStateBody(context.request);
  if (parsed.error) return errorResponse(parsed.error, parsed.status);
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    return errorResponse("Expected { state: {...} }", 400);
  }
  const entries = Object.entries(body.state);
  if (entries.length > MAX_STATE_KEYS) return errorResponse("Too many state keys", 400);
  const serialized = [];
  for (const [key, value] of entries) {
    if (!STATE_KEYS.has(key)) return errorResponse("Unsupported state key", 400);
    let valueJson;
    try { valueJson = JSON.stringify(value); }
    catch { return errorResponse("State value is too deeply nested", 400); }
    if (new TextEncoder().encode(valueJson).byteLength > MAX_VALUE_BYTES) {
      return errorResponse("State value too large", 413);
    }
    serialized.push([key, valueJson]);
  }

  const identityPresent = Object.hasOwn(body.state, IDENTITY_KEY);
  if (identityPresent) {
    if (!Object.hasOwn(body, "identityBase") || (body.identityBase !== null && typeof body.identityBase !== "string")) {
      return errorResponse("Identity state requires a synchronization base", 400);
    }
    try {
      const value = JSON.parse(body.state[IDENTITY_KEY]);
      if (typeof body.state[IDENTITY_KEY] !== "string" || value.version !== 2 || !value.cells || typeof value.cells !== "object" || Array.isArray(value.cells)) throw new Error();
      for (const events of Object.values(value.cells)) {
        if (!Array.isArray(events) || events.some(e => !e || typeof e.id !== "string" || !Array.isArray(e.parents) || e.parents.some(p => typeof p !== "string") || !Object.hasOwn(e, "value"))) throw new Error();
      }
    } catch { return errorResponse("Invalid artist identity state", 400); }
  }
  const now = new Date().toISOString();
  try {
    // Optimistic concurrency only for the additive identity journal. Old clients
    // omit this key and cannot erase it. The SQL predicate closes the GET/PUT race.
    if (identityPresent) {
      const rows = await context.env.DB.prepare(`SELECT state_key, value_json FROM app_state WHERE account_id = ?`).bind(auth.accountId).all();
      const current = (rows.results || []).find(row => row.state_key === IDENTITY_KEY);
      const expected = JSON.stringify(body.identityBase);
      if (current && current.value_json !== expected || !current && body.identityBase !== null) return errorResponse("Artist identity state changed; merge and retry", 409);
    }
    const statements = serialized.map(([key, valueJson]) => {
      const conditional = key === IDENTITY_KEY;
      const statement = context.env.DB.prepare(`
        INSERT INTO app_state (account_id, state_key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, state_key)
        DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        ${conditional ? "WHERE app_state.value_json IS ?" : ""}
      `);
      return statement.bind(auth.accountId, key, valueJson, now, ...(conditional ? [JSON.stringify(body.identityBase)] : []));
    });
    const results = statements.length ? await context.env.DB.batch(statements) : [];
    const identityIndex = serialized.findIndex(([key]) => key === IDENTITY_KEY);
    if (identityIndex >= 0 && results[identityIndex]?.meta?.changes !== 1) return errorResponse("Artist identity state changed; merge and retry", 409);
    return Response.json({ ok: true, saved: statements.length, updated_at: now });
  } catch { return errorResponse("State database unavailable", 503); }
}
