import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadStateApi } from './helpers/state-api.mjs';
const api = await loadStateApi(), journal = OfficeArtistExclusions;
const A = '1111111111111111111111', B = '2222222222222222222222';
function value(id = A) { return { artistId: id, name: 'Days of the New', reason: 'wrong_artist', trackId: 'song', trackName: 'Song', artists: [{ id, name: 'Days of the New' }], source: 'playlist_block', updatedAt: new Date().toISOString() }; }
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_state (account_id TEXT, state_key TEXT, value_json TEXT, updated_at TEXT, PRIMARY KEY(account_id,state_key))');
  t.after(() => sqlite.close());
  return {
    sqlite, beforeBatch: null,
    prepare(sql) { return { bind(...args) { return { sql, args, all: async () => ({ results: sqlite.prepare(sql).all(...args) }) }; } }; },
    async batch(statements) {
      this.beforeBatch?.(); this.beforeBatch = null; sqlite.exec('BEGIN');
      try { const result = statements.map(({ sql, args }) => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } })); sqlite.exec('COMMIT'); return result; }
      catch (err) { sqlite.exec('ROLLBACK'); throw err; }
    }
  };
}
const request = (state, base = null, token = 'first') => new Request('https://local/api/state', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, artistExclusionsBase: base }) });
function auth(t) { t.mock.method(globalThis, 'fetch', async (_url, options) => Response.json({ account_id: options.headers.Authorization.slice(7) })); }
function read(DB, owner = 'first') { return JSON.parse(DB.sqlite.prepare('SELECT value_json FROM app_state WHERE account_id=? AND state_key=?').get(owner, journal.KEY)?.value_json || 'null'); }

test('API: rzeczywisty SQL CAS, rozdzielenie kont, kompatybilność klienta bez wyjątków', async t => {
  auth(t); const DB = database(t), a = JSON.stringify(journal.decide(null, A, value(A))), b = JSON.stringify(journal.decide(null, B, value(B)));
  assert.equal((await api.onRequestPut({ request: request({ [journal.KEY]: a }), env: { DB } })).status, 200);
  assert.equal((await api.onRequestPut({ request: request({ [journal.KEY]: b }), env: { DB } })).status, 409); assert.equal(read(DB), a);
  const merged = JSON.stringify(journal.merge(a, b));
  assert.equal((await api.onRequestPut({ request: request({ [journal.KEY]: merged }, a), env: { DB } })).status, 200);
  assert.equal((await api.onRequestPut({ request: request({ office_seed_bartek: 'Queen' }), env: { DB } })).status, 200); assert.equal(read(DB), merged);
  assert.equal((await api.onRequestPut({ request: request({ [journal.KEY]: b }, null, 'second'), env: { DB } })).status, 200); assert.equal(read(DB, 'second'), b); assert.equal(read(DB), merged);
  const get = await api.onRequestGet({ request: new Request('https://local/api/state', { headers: { Authorization: 'Bearer first' } }), env: { DB } });
  assert.equal((await get.json()).state[journal.KEY], merged);
});

test('API: wyścig pierwszego zapisu oraz zmiana między odczytem i batch nie nadpisuje decyzji', async t => {
  auth(t); const DB = database(t), a = JSON.stringify(journal.decide(null, A, value(A))), b = JSON.stringify(journal.decide(null, B, value(B)));
  DB.beforeBatch = () => DB.sqlite.prepare('INSERT INTO app_state VALUES(?,?,?,?)').run('first', journal.KEY, JSON.stringify(b), 'race');
  assert.equal((await api.onRequestPut({ request: request({ [journal.KEY]: a }), env: { DB } })).status, 409); assert.equal(read(DB), b);
  DB.beforeBatch = () => DB.sqlite.prepare('UPDATE app_state SET value_json=? WHERE account_id=? AND state_key=?').run(JSON.stringify(a), 'first', journal.KEY);
  assert.equal((await api.onRequestPut({ request: request({ [journal.KEY]: b }, b), env: { DB } })).status, 409); assert.equal(read(DB), a);
});

const invalid = [null, '{}', JSON.stringify({ version: 1, artists: { name: [] } }), JSON.stringify({ version: 1, artists: { [A]: [{ id: 'e', parents: [], value: { ...value(A), reason: 'unknown' } }] } }), JSON.stringify({ version: 1, artists: { [A]: [{ id: 'e', parents: ['missing'], value: null }] } }), JSON.stringify({ version: 1, artists: { [A]: [{ id: 'e', parents: ['e'], value: null }] } })];
for (const [i, raw] of invalid.entries()) test(`API: nieprawidłowe dane wyjątków #${i} odrzucone bez częściowych zapisów`, async t => {
  auth(t); const DB = database(t);
  assert.equal((await api.onRequestPut({ request: request({ office_seed_bartek: 'Queen', [journal.KEY]: raw }), env: { DB } })).status, 400);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM app_state').get().n, 0);
});

test('API: brak bazy synchronizacji nie zapisuje nowego klucza', async t => {
  auth(t); const DB = database(t), raw = JSON.stringify(journal.decide(null, A, value(A)));
  const missing = new Request('https://local/api/state', { method: 'PUT', headers: { Authorization: 'Bearer first' }, body: JSON.stringify({ state: { [journal.KEY]: raw } }) });
  assert.equal((await api.onRequestPut({ request: missing, env: { DB } })).status, 400); assert.equal(read(DB), null);
});
