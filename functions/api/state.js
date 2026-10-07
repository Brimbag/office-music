async function getSpotifyAccountId(request) {
  const auth = request.headers.get("Authorization") || "";

  if (!auth.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "Missing Spotify access token"
    };
  }

  const token = auth.slice("Bearer ".length);

  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    return {
      ok: false,
      status: 401,
      error: `Spotify authentication failed: ${response.status}`
    };
  }

  const user = await response.json();

  if (!user.account_id) {
    return {
      ok: false,
      status: 500,
      error: "Spotify account_id missing"
    };
  }

  return {
    ok: true,
    accountId: user.account_id
  };
}

export async function onRequestGet(context) {
  const auth = await getSpotifyAccountId(context.request);

  if (!auth.ok) {
    return Response.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const rows = await context.env.DB
    .prepare(`
      SELECT state_key, value_json, updated_at
      FROM app_state
      WHERE account_id = ?
    `)
    .bind(auth.accountId)
    .all();

  const state = {};

  for (const row of rows.results || []) {
    try {
      state[row.state_key] = JSON.parse(row.value_json);
    } catch {
      state[row.state_key] = null;
    }
  }

  return Response.json({
    ok: true,
    state
  });
}

export async function onRequestPut(context) {
  const auth = await getSpotifyAccountId(context.request);

  if (!auth.ok) {
    return Response.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body.state !== "object" || Array.isArray(body.state)) {
    return Response.json(
      { ok: false, error: "Expected { state: {...} }" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const statements = Object.entries(body.state).map(([key, value]) =>
    context.env.DB
      .prepare(`
        INSERT INTO app_state (
          account_id,
          state_key,
          value_json,
          updated_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, state_key)
        DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .bind(
        auth.accountId,
        key,
        JSON.stringify(value),
        now
      )
  );

  if (statements.length) {
    await context.env.DB.batch(statements);
  }

  return Response.json({
    ok: true,
    saved: statements.length,
    updated_at: now
  });
}
