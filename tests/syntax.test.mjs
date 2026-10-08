import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';

for (const file of ['index.html', 'taste.html']) {
  test(`składnia skryptów ${file}`, () => {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0);
    for (const [, attributes, inline] of scripts) {
      const external = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
      const script = external ? readFileSync(new URL(`../${external}`, import.meta.url), 'utf8') : inline;
      new Script(script, { filename: external || file });
    }
  });
}

test('składnia funkcji Pages jako modułu ESM', () => {
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: readFileSync(new URL('../functions/api/state.js', import.meta.url), 'utf8'), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
});
