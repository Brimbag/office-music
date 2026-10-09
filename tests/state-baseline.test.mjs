import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStateApi } from './helpers/state-api.mjs';

const api = await loadStateApi();

test('API: brak tokenu odrzuca GET i PUT przed dostępem do DB', async () => {
  for (const [method, handler] of [['GET', api.onRequestGet], ['PUT', api.onRequestPut]]) {
    const response = await handler({ request: new Request('https://local/api/state', { method }), env: {} });
    assert.equal(response.status, 401);
  }
});

test('API: odczyt jest ograniczony do konta zweryfikowanego przez Spotify', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.spotify.com/v1/me');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    return Response.json({ account_id: 'verified' });
  });
  const DB = { prepare(sql) {
    assert.match(sql, /WHERE account_id = \?/);
    return { bind(account) {
      assert.equal(account, 'verified');
      return { all: async () => ({ results: [{ state_key: 'office_seed_bartek', value_json: '"Queen"' }] }) };
    } };
  } };
  const response = await api.onRequestGet({ request: new Request('https://local/api/state', { headers: { Authorization: 'Bearer test-only' } }), env: { DB } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).state, { office_seed_bartek: 'Queen' });
});
