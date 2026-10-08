import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const source = readFileSync(new URL('../functions/api/state.js', import.meta.url), 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const KEY = 'office_artist_identity_v2';
const journal = id => JSON.stringify({ version: 2, cells: { 'link:seed:bartek:days of the new': [{ id, parents: [], value: { id: '1111111111111111111111' } }] } });
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_state (account_id TEXT, state_key TEXT, value_json TEXT, updated_at TEXT, PRIMARY KEY(account_id,state_key))');
  t.after(() => sqlite.close());
  return {
    sqlite, beforeBatch: null,
    prepare(sql) { return { bind(...args) { return { sql, args, all: async () => ({ results: sqlite.prepare(sql).all(...args) }) }; } }; },
    async batch(statements) {
      this.beforeBatch?.(); this.beforeBatch = null;
      sqlite.exec('BEGIN');
      try { const results = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } })); sqlite.exec('COMMIT'); return results; }
      catch (err) { sqlite.exec('ROLLBACK'); throw err; }
    }
  };
}
const request = (state, identityBase = null, token = 'first') => new Request('https://local/api/state', {
  method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, identityBase })
});
function auth(t) { t.mock.method(globalThis, 'fetch', async (_url, options) => Response.json({ account_id: options.headers.Authorization.slice(7) })); }
function raw(DB, token = 'first') { return JSON.parse(DB.sqlite.prepare('SELECT value_json FROM app_state WHERE account_id=? AND state_key=?').get(token, KEY)?.value_json || 'null'); }

test('API F: rzeczywisty SQL CAS chroni drugi zapis, nie miesza kont i ignoruje klienta v1', async t => {
  auth(t); const DB = database(t), a = journal('a'), b = journal('b');
  assert.equal((await api.onRequestPut({ request: request({ [KEY]: a }), env: { DB } })).status, 200);
  assert.equal((await api.onRequestPut({ request: request({ [KEY]: b }), env: { DB } })).status, 409);
  assert.equal(raw(DB), a);
  assert.equal((await api.onRequestPut({ request: request({ [KEY]: b }, a), env: { DB } })).status, 200);
  assert.equal(raw(DB), b);
  assert.equal((await api.onRequestPut({ request: request({ office_seed_bartek: 'Queen' }), env: { DB } })).status, 200);
  assert.equal(raw(DB), b);
  assert.equal((await api.onRequestPut({ request: request({ [KEY]: a }, null, 'second'), env: { DB } })).status, 200);
  assert.equal(raw(DB, 'second'), a); assert.equal(raw(DB), b);
});

test('API F: SQL wykrywa zmianę między GET a batch; także równoczesny pierwszy zapis', async t => {
  auth(t); const DB = database(t), a = journal('a'), b = journal('b');
  DB.beforeBatch = () => DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('first', KEY, JSON.stringify(b), 'race');
  assert.equal((await api.onRequestPut({ request: request({ [KEY]: a }), env: { DB } })).status, 409);
  assert.equal(raw(DB), b);
  DB.beforeBatch = () => DB.sqlite.prepare('UPDATE app_state SET value_json=? WHERE account_id=? AND state_key=?').run(JSON.stringify(a), 'first', KEY);
  assert.equal((await api.onRequestPut({ request: request({ [KEY]: b }, b), env: { DB } })).status, 409);
  assert.equal(raw(DB), a);
});

for (const value of [null, '{}', '{"version":1,"cells":{}}', '{"version":2,"cells":{"broken":{}}}']) {
  test(`API F: nieprawidłowy rejestr ${value} jest odrzucany przed zapisem`, async t => {
    auth(t); const DB = database(t);
    assert.equal((await api.onRequestPut({ request: request({ [KEY]: value }), env: { DB } })).status, 400);
    assert.equal(raw(DB), null);
  });
}

test('API F: baza synchronizacji jest obowiązkowa, odpowiedź GET zachowuje rejestr', async t => {
  auth(t); const DB = database(t), a = journal('a');
  const missing = new Request('https://local/api/state', { method: 'PUT', headers: { Authorization: 'Bearer first' }, body: JSON.stringify({ state: { [KEY]: a } }) });
  assert.equal((await api.onRequestPut({ request: missing, env: { DB } })).status, 400);
  await api.onRequestPut({ request: request({ [KEY]: a }), env: { DB } });
  const response = await api.onRequestGet({ request: new Request('https://local/api/state', { headers: { Authorization: 'Bearer first' } }), env: { DB } });
  assert.equal((await response.json()).state[KEY], a);
});
