import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { startBrowserHarness } from './helpers/browser.mjs';

const source = readFileSync(new URL('../taste-state.js', import.meta.url), 'utf8');
const upgrade = runInNewContext(`${source}\nupgradeTasteProfileDb`);
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

for (const rating of ['like', 'ok', 'no']) {
  test(`migracja zachowuje ocenę ${rating}, pozostałe dane i jest idempotentna`, () => {
    const db = { version: 1, updatedAt: 'unchanged', custom: 'preserve', people: {
      Bartek: { genres: { folk: rating, reggae: rating, classical: rating, 'folk-rock': 'like' }, custom: 'preserve' }
    } };
    assert.equal(upgrade(db).changed, true);
    for (const family of ['folk', 'reggae', 'classical']) {
      assert.equal(db.people.Bartek.genres[family], rating);
      assert.equal(db.people.Bartek.genres[`${family}-general`], rating);
    }
    assert.equal(db.people.Bartek.genres['folk-rock'], 'like');
    assert.equal(db.updatedAt, 'unchanged'); assert.equal(db.custom, 'preserve');
    assert.equal(db.people.Bartek.custom, 'preserve'); assert.equal(db.version, 1);
    assert.equal(db.taxonomyVersion, 2);
    delete db.people.Bartek.genres['folk-general'];
    assert.equal(upgrade(db).changed, false);
    assert.ok(!Object.hasOwn(db.people.Bartek.genres, 'folk-general'));
  });
}

test('migracja nie nadpisuje niezależnej oceny dziecka ani nowszego schematu', () => {
  const db = { version: 1, people: { Bartek: { genres: { folk: 'like', 'folk-general': 'no' } } } };
  upgrade(db); assert.equal(db.people.Bartek.genres['folk-general'], 'no');
  const future = { version: 1, taxonomyVersion: 3, people: { Bartek: { genres: { folk: 'like' } } } };
  assert.equal(upgrade(future).changed, false); assert.ok(!Object.hasOwn(future.people.Bartek.genres, 'folk-general'));
});

test('definicje generatora i wyrenderowana ankieta mają unikalne zgodne ID i rodziców', async () => {
  const generator = await harness.page(); const survey = await harness.page('/taste.html');
  try {
    const defs = await generator.page.evaluate(() => TASTE_GENRE_DEFS);
    await survey.page.locator('[data-person="Bartek"]').click();
    const entries = await survey.page.evaluate(() => [...document.querySelectorAll('.family')].flatMap(family => [
      [family.dataset.family, null],
      ...[...family.querySelectorAll('.branch .choices')].map(child => [child.dataset.id, family.dataset.family])
    ]));
    assert.equal(new Set(entries.map(([id]) => id)).size, entries.length);
    assert.equal(Object.keys(defs).length, entries.length);
    for (const [id, parent] of entries) assert.equal(defs[id].parent, parent, id);
    assert.deepEqual(generator.errors, []); assert.deepEqual(survey.errors, []);
  } finally { await generator.close(); await survey.close(); }
});

for (const [family, child, label] of [['folk', 'folk-rock', 'Folk Rock'], ['reggae', 'roots-reggae', 'Roots Reggae'], ['classical', 'film-score', 'Film Score']]) {
  test(`blokada rodziny ${family} wyłącza wcześniej polubione dziecko i zachowuje ocenę`, async () => {
    const db = { version: 1, people: { Bartek: { genres: { [family]: 'no', [child]: 'like' } } } };
    const session = await harness.page('/', { office_taste_profile_v1: JSON.stringify(db) });
    try {
      const result = await session.page.evaluate(() => ({ taste: tasteStateForPerson('Bartek'), db: JSON.parse(localStorage.getItem(TASTE_STORAGE_KEY)) }));
      assert.ok(!result.taste.likedGenres.includes(label)); assert.ok(result.taste.blockedGenres.includes(label));
      assert.equal(result.db.people.Bartek.genres[child], 'like');
      assert.equal(result.db.taxonomyVersion, 2); assert.deepEqual(session.errors, []);
    } finally { await session.close(); }
  });
}

test('ankieta pozwala niezależnie ocenić rodzinę i dziecko po migracji', async () => {
  const db = { version: 1, people: { Bartek: { genres: { folk: 'like' } } } };
  const session = await harness.page('/taste.html', { office_taste_profile_v1: JSON.stringify(db) });
  try {
    await session.page.locator('[data-person="Bartek"]').click();
    await session.page.locator('[data-toggle="folk"]').click();
    await session.page.locator('.choices[data-id="folk-general"] .choice[data-val="ok"]').click();
    await session.page.reload();
    const ratings = await session.page.evaluate(() => JSON.parse(localStorage.getItem('office_taste_profile_v1')).people.Bartek.genres);
    assert.equal(ratings.folk, 'like'); assert.equal(ratings['folk-general'], 'ok');
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

for (const path of ['/', '/taste.html']) {
  test(`quota przy migracji ${path} nie zamienia ankiety w pustą`, async () => {
    const db = { version: 1, people: { Bartek: { genres: { folk: 'like' } } } };
    const session = await harness.page('/', { office_taste_profile_v1: JSON.stringify(db) });
    try {
      // Install the failure before the target document reads/migrates the survey.
      await session.page.context().addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'office_taste_profile_v1') throw new DOMException('Full', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      await session.page.goto(new URL(path, session.page.url()).href);
      if (path === '/') {
        const taste = await session.page.evaluate(() => tasteStateForPerson('Bartek'));
        assert.ok(taste.likedGenres.includes('Folk'));
      } else {
        await session.page.locator('[data-person="Bartek"]').click();
        assert.equal(await session.page.locator('.choices[data-id="folk-general"] .choice[data-val="like"]').getAttribute('data-active'), 'like');
      }
      const old = await session.page.evaluate(() => JSON.parse(localStorage.getItem('office_taste_profile_v1')));
      assert.equal(old.people.Bartek.genres.folk, 'like');
      assert.equal(old.taxonomyVersion, undefined); assert.deepEqual(session.errors, []);
    } finally { await session.close(); }
  });
}
