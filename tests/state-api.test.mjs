import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStateApi } from './helpers/state-api.mjs';

const api = await loadStateApi();
const request = (method = 'PUT', body = { state: {} }, token = 'test-only') => new Request('https://local/api/state', {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) })
});
function authenticate(t, profile = { id: 'verified', account_id: 'verified' }) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.spotify.com/v1/me');
    assert.match(options.headers.Authorization, /^Bearer /);
    return Response.json(profile);
  });
}
function memoryDB() {
  const rows = new Map();
  const writes = [];
  return {
    rows, writes,
    prepare(sql) {
      return { bind(...args) {
        return {
          sql, args,
          async all() {
            assert.match(sql, /WHERE account_id = \?/);
            return { results: [...rows.values()].filter(row => row.account_id === args[0]) };
          }
        };
      } };
    },
    async batch(statements) {
      for (const { sql, args: [account_id, state_key, value_json, updated_at] } of statements) {
        assert.match(sql, /ON CONFLICT\(account_id, state_key\)/);
        writes.push({ account_id, state_key });
        rows.set(`${account_id}:${state_key}`, { account_id, state_key, value_json, updated_at });
      }
    }
  };
}

for (const [name, profile, expected] of [
  ['niezmienne account_id', { account_id: 'immutable' }, 'immutable'],
  ['publiczne id nie przesłania account_id', { id: 'public', account_id: 'immutable' }, 'immutable']
]) {
  test(`API: ${name}`, async t => {
    authenticate(t, profile);
    const DB = memoryDB();
    const response = await api.onRequestPut({ request: request('PUT', { account_id: 'attacker', state: { office_seed_bartek: 'Queen' } }), env: { DB } });
    assert.equal(response.status, 200);
    assert.deepEqual(DB.writes, [{ account_id: expected, state_key: 'office_seed_bartek' }]);
  });
}

for (const profile of [{}, { id: 'public-only' }, { account_id: '' }, { account_id: {} }, { account_id: 'bad\nidentifier' }, { account_id: {}, id: 'public' }]) {
  test(`API: nieprawidłowy identyfikator ${JSON.stringify(profile)}`, async t => {
    authenticate(t, profile);
    const response = await api.onRequestGet({ request: request('GET'), env: {} });
    assert.equal(response.status, 502);
  });
}

for (const value of [null, [], 'text', 42, true]) {
  test(`API: state=${JSON.stringify(value)} daje 400 bez zapisu`, async t => {
    authenticate(t);
    const DB = memoryDB();
    const response = await api.onRequestPut({ request: request('PUT', { state: value }), env: { DB } });
    assert.equal(response.status, 400); assert.equal(DB.writes.length, 0);
  });
}

for (const key of ['spotify_access_token', 'office_unknown', '__proto__', 'office_seed_attacker']) {
  test(`API: niedozwolony klucz ${key} nie zapisuje także poprawnych kluczy`, async t => {
    authenticate(t);
    const DB = memoryDB();
    const state = Object.fromEntries([['office_seed_bartek', 'Queen'], [key, 'blocked']]);
    const response = await api.onRequestPut({ request: request('PUT', { state }), env: { DB } });
    assert.equal(response.status, 400); assert.equal(DB.writes.length, 0);
  });
}

test('API: dwa zweryfikowane konta, upsert i null nie przeciekają między kontami', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { headers }) => Response.json({ account_id: headers.Authorization === 'Bearer first' ? 'first-account' : 'second-account' }));
  const DB = memoryDB();
  for (const [token, value] of [['first', 'Queen'], ['second', 'ABBA'], ['first', null]]) {
    const response = await api.onRequestPut({ request: request('PUT', { state: { office_seed_bartek: value } }, token), env: { DB } });
    assert.equal(response.status, 200);
  }
  for (const [token, value] of [['first', null], ['second', 'ABBA']]) {
    const response = await api.onRequestGet({ request: request('GET', undefined, token), env: { DB } });
    assert.deepEqual((await response.json()).state, { office_seed_bartek: value });
  }
  assert.equal(DB.rows.size, 2);
});

test('API: puste state to bezpieczny no-op', async t => {
  authenticate(t);
  const DB = memoryDB();
  const response = await api.onRequestPut({ request: request(), env: { DB } });
  assert.equal(response.status, 200); assert.equal((await response.json()).saved, 0); assert.equal(DB.writes.length, 0);
});

test('API: odczyt pomija nieznane klucze i obsługuje uszkodzony JSON', async t => {
  authenticate(t);
  const DB = memoryDB();
  for (const [key, value] of [['office_seed_bartek', 'broken'], ['spotify_access_token', '"private"']]) {
    DB.rows.set(key, { account_id: 'verified', state_key: key, value_json: value });
  }
  const response = await api.onRequestGet({ request: request('GET'), env: { DB } });
  assert.deepEqual((await response.json()).state, { office_seed_bartek: null });
  assert.equal(DB.rows.size, 2); // Existing rows are not deleted.
});

test('API: limit całego streamu także bez Content-Length', async t => {
  authenticate(t);
  const DB = memoryDB();
  const response = await api.onRequestPut({ request: request('PUT', { state: { office_candidate_pool_v1: 'x'.repeat(2 * 1024 * 1024) } }), env: { DB } });
  assert.equal(response.status, 413); assert.equal(DB.writes.length, 0);
});

test('API: limit wartości liczony w bajtach UTF-8', async t => {
  authenticate(t);
  const DB = memoryDB();
  const response = await api.onRequestPut({ request: request('PUT', { state: { office_candidate_pool_v1: 'ą'.repeat(800 * 1024) } }), env: { DB } });
  assert.equal(response.status, 413); assert.equal(DB.writes.length, 0);
});

test('API: nieprawidłowy JSON daje 400', async t => {
  authenticate(t);
  const response = await api.onRequestPut({ request: new Request('https://local/api/state', { method: 'PUT', headers: { Authorization: 'Bearer test' }, body: '{broken' }), env: {} });
  assert.equal(response.status, 400);
});

test('API: błędy Spotify są kontrolowane i nie sięgają do DB', async t => {
  const mock = t.mock.method(globalThis, 'fetch');
  for (const [upstream, expected] of [[401, 401], [403, 401], [429, 503], [500, 502]]) {
    mock.mock.mockImplementation(async () => new Response('{}', { status: upstream, headers: { 'Retry-After': '10' } }));
    const response = await api.onRequestGet({ request: request('GET'), env: {} });
    assert.equal(response.status, expected);
    if (upstream === 429) assert.equal(response.headers.get('Retry-After'), '10');
  }
  mock.mock.mockImplementation(async () => { throw new TypeError('network'); });
  assert.equal((await api.onRequestGet({ request: request('GET'), env: {} })).status, 502);
  mock.mock.mockImplementation(async () => new Response('not-json'));
  assert.equal((await api.onRequestGet({ request: request('GET'), env: {} })).status, 502);
});

test('API: błąd DB daje kontrolowany 503 bez szczegółów SQL', async t => {
  authenticate(t);
  for (const [handler, method] of [[api.onRequestGet, 'GET'], [api.onRequestPut, 'PUT']]) {
    const response = await handler({ request: request(method, { state: { office_seed_bartek: 'Queen' } }), env: {} });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'State database unavailable');
  }
});

test('API: brak tokenu, pusty Bearer i inne schematy nie wywołują Spotify', async t => {
  const mock = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not call'); });
  for (const header of ['', 'Bearer ', 'Basic test']) {
    const response = await api.onRequestGet({ request: new Request('https://local/api/state', { headers: { Authorization: header } }), env: {} });
    assert.equal(response.status, 401);
  }
  assert.equal(mock.mock.calls.length, 0);
});


test('API: bardzo głęboki JSON daje 400 zamiast wyjątku i nic nie zapisuje', async t => {
  authenticate(t);
  const DB = memoryDB();
  const body = '{"state":{"office_seed_bartek":' + '['.repeat(12000) + '0' + ']'.repeat(12000) + '}}';
  const response = await api.onRequestPut({ request: new Request('https://local/api/state', {
    method: 'PUT', headers: { Authorization: 'Bearer test-only' }, body
  }), env: { DB } });
  assert.equal(response.status, 400); assert.equal(DB.writes.length, 0);
});
