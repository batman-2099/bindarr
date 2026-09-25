const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-checkout-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const { checkedOutAllocation, splitStackedEntries } = require('../src/utils/collectionHelpers');
const { inventory } = require('../src/utils/aiDecks');

async function main() {
  let server;
  try {
    await db.initDb();
    await db.run("INSERT INTO users (id, username, password_hash, share_token) VALUES (2, 'other', 'unused', 'other-token')");
    await db.run("INSERT INTO card_cache (id, name, game) VALUES ('card', 'Chosen Card', 'mtg'), ('printing', 'Chosen Card', 'mtg')");
    const box = async name => {
      const id = (await db.run("INSERT INTO locations (name, type, user_id) VALUES (?, 'Box', 1)", [name])).lastID;
      const compartment = (await db.run('INSERT INTO compartments (location_id, idx, capacity) VALUES (?, 1, 100)', [id])).lastID;
      return { id, compartment };
    };
    const a = await box('Box A');
    const b = await box('Box B');
    const entry = async (quantity, location, { user = 1, card = 'card', list = 'collection', missing = 0 } = {}) =>
      (await db.run(`INSERT INTO collection (card_id, user_id, quantity, location_id, compartment_id, position, list_type, missing, added_at)
        VALUES (?, ?, ?, ?, ?, 1000, ?, ?, ?)`, [card, user, quantity, location?.id ?? null, location?.compartment ?? null, list, missing,
        location === a ? '2026-09-25' : '2026-09-24'])).lastID;
    const ea = await entry(3, a);
    const eb = await entry(3, b);
    const unassigned = await entry(1);
    const foreign = await entry(3, null, { user: 2 });
    const printing = await entry(3, null, { card: 'printing' });
    const arena = await entry(3, null, { list: 'arena' });
    const wishlist = await entry(3, null, { list: 'wishlist' });
    const graveyard = await entry(3, null, { list: 'graveyard' });
    const missing = await entry(3, null, { missing: 1 });
    const deck = async (name, quantity, type = 'collection') => {
      const id = (await db.run('INSERT INTO decks (name, user_id, inventory_type) VALUES (?, 1, ?)', [name, type])).lastID;
      await db.run("INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, 'card', ?)", [id, quantity]);
      return id;
    };
    const first = await deck('Choose B', 3);
    const second = await deck('Choose A', 3);
    const third = await deck('Unassigned', 1);
    const digital = await deck('Arena', 1, 'arena');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: Number(req.headers['x-test-user'] || 1) }; next(); });
    app.use('/api', require('../src/routes/collection'));
    app.use('/api', require('../src/routes/storage'));
    app.use('/api', require('../src/routes/importExport'));
    app.use('/api/decks', require('../src/routes/decks'));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const request = async (url, method = 'GET', body, status = 200, user = 1) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
        method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const data = await response.json();
      assert.strictEqual(response.status, status, JSON.stringify(data));
      return data;
    };
    const pick = (entry_id, quantity, card_id = 'card') => ({ card_id, entry_id, quantity });
    const checkout = (id, allocations, status = 200) => request(`/decks/${id}/checkout`, 'PUT', allocations === undefined ? {} : { allocations }, status);
    const locations = id => request(`/decks/${id}/locations`);
    const pins = () => db.all('SELECT * FROM deck_allocations ORDER BY deck_id, entry_id');
    const copies = () => db.all('SELECT * FROM collection ORDER BY id');
    const options = await request(`/decks/${first}/checkout-options`);
    assert.deepStrictEqual(options.cards.map(card => [card.card_id, card.quantity]), [['card', 3]]);
    assert.deepStrictEqual(options.cards[0].choices.map(choice => [choice.entry_id, choice.available_qty, choice.location_name]),
      [[ea, 3, 'Box A'], [eb, 3, 'Box B'], [unassigned, 1, 'Unassigned Pile']]);
    await request(`/decks/${first}/checkout-options`, 'GET', undefined, 404, 2);
    await request(`/decks/${first}/checkout`, 'PUT', {}, 404, 2);
    await request(`/decks/${digital}/checkout-options`, 'GET', undefined, 400);
    await checkout(digital, undefined, 400);
    const before = await copies();
    for (const selected of [
      [pick(foreign, 3)], [pick(printing, 3)], [pick(arena, 3)], [pick(wishlist, 3)], [pick(graveyard, 3)], [pick(missing, 3)],
      [pick(ea, 2)], [pick(ea, 4)], [pick(ea, 1.5)], [pick(ea, -1)], [pick(ea, 1), pick(ea, 2)],
      [pick(ea, 3, 'printing')], [pick(ea, 3), pick(printing, 1, 'printing')], [pick(999999, 3)], [], null
    ]) {
      await checkout(first, selected, 400);
      assert.deepStrictEqual(await pins(), []);
      assert.strictEqual((await db.get('SELECT checked_out FROM decks WHERE id = ?', [first])).checked_out, 0);
      assert.deepStrictEqual(await copies(), before, 'invalid selection is atomic');
    }
    await checkout(first, [pick(eb, 3)]);
    assert.deepStrictEqual((await locations(first))[0].locations.map(row => [row.entry_id, row.take, row.location_name]), [[eb, 3, 'Box B']]);
    assert.deepStrictEqual([...await checkedOutAllocation(1)], [[eb, 3]]);
    assert.deepStrictEqual(await copies(), before, 'checkout does not move or consume owned cards');
    const collection = await request('/collection');
    assert.strictEqual(collection.find(row => row.entry_id === ea).checked_out_qty, 0);
    assert.strictEqual(collection.find(row => row.entry_id === ea).deck_names, null);
    assert.strictEqual(collection.find(row => row.entry_id === eb).deck_names, 'Choose B');
    assert.strictEqual((await inventory(1, 'collection', { container_ids: [b.id] })).find(row => row.id === 'card').available_qty, 0);
    assert.strictEqual((await inventory(1, 'collection', { container_ids: [a.id] })).find(row => row.id === 'card').available_qty, 3);
    await checkout(first);
    await checkout(first, [pick(ea, 3)], 409);
    await checkout(second, [pick(eb, 3)], 400);
    await checkout(second);
    assert.deepStrictEqual((await locations(second))[0].locations.map(row => [row.entry_id, row.take]), [[ea, 3]]);
    await checkout(third, [pick(unassigned, 1)]);
    assert.strictEqual((await locations(third))[0].locations[0].location_name, 'Unassigned Pile');
    const pinned = await pins();
    await db.initDb();
    assert.deepStrictEqual(await pins(), pinned, 'startup cannot reassign persisted choices');
    await request(`/decks/${first}/cards`, 'POST', { card_id: 'card', quantity: 2 }, 409);
    await request(`/decks/${first}/cards/card`, 'DELETE', undefined, 409);
    await request('/collection/bulk', 'POST', { entry_ids: [ea], action: 'add_to_deck', value: first }, 409);
    await request(`/collection/${eb}`, 'DELETE', undefined, 409);
    await request('/collection/bulk', 'POST', { entry_ids: [printing, eb], action: 'delete' }, 409);
    for (const list_type of ['graveyard', 'arena', 'wishlist']) await request(`/collection/${eb}`, 'PUT', { list_type }, 409);
    await request(`/collection/${eb}`, 'PUT', { quantity: 1, notes: 'must rollback' }, 409);
    assert.deepStrictEqual(await copies(), before);
    await request(`/collection/${eb}`, 'PUT', { missing: true });
    assert.deepStrictEqual((await locations(first))[0].locations.map(row => [row.entry_id, row.take]), [[eb, 3]], 'missing cannot redirect an existing reservation');
    await request(`/collection/${eb}`, 'PUT', { missing: false, location_id: a.id, compartment_id: a.compartment });
    assert.strictEqual((await locations(first))[0].locations[0].location_name, 'Box A', 'moving the selected entry preserves its reservation');
    assert.deepStrictEqual(await pins(), pinned);
    await request(`/collection/${eb}`, 'PUT', { location_id: b.id, compartment_id: b.compartment });
    await request(`/decks/${first}/return`, 'PUT', {});
    await request(`/decks/${second}/return`, 'PUT', {});
    await request(`/decks/${third}`, 'DELETE');
    assert.deepStrictEqual(await pins(), []);
    await checkout(first, [pick(ea, 1), pick(eb, 2)]);
    assert.deepStrictEqual((await locations(first))[0].locations.map(row => [row.entry_id, row.take, row.location_name]).sort(),
      [[ea, 1, 'Box A'], [eb, 2, 'Box B']]);
    // A stale preview cannot overbook the last source copy, even across concurrent requests.
    const racer1 = await deck('Racer 1', 1);
    const racer2 = await deck('Racer 2', 1);
    const raced = await Promise.all([racer1, racer2].map(id => fetch(`http://127.0.0.1:${server.address().port}/api/decks/${id}/checkout`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allocations: [pick(eb, 1)] })
    })));
    assert.deepStrictEqual(raced.map(response => response.status).sort(), [200, 400]);
    assert.strictEqual((await checkedOutAllocation(1)).get(eb), 3);
    const backup = await request('/export?format=backup');
    const backupPins = backup.deck_allocations;
    const foreignBefore = await db.get('SELECT * FROM collection WHERE id = ?', [foreign]);
    for (const bad of [
      { ...backupPins[0], entry_id: foreign },
      { ...backupPins[0], entry_id: printing },
      { ...backupPins[0], quantity: 999 },
      { ...backupPins[0], deck_id: digital }
    ]) {
      await request('/import', 'POST', { format: 'backup', data: { ...backup, deck_allocations: [bad] } }, 400);
      assert.deepStrictEqual(await pins(), backupPins);
    }
    await request('/import', 'POST', { format: 'backup', data: backup });
    const restored = await db.get("SELECT id FROM decks WHERE name = 'Choose B' AND user_id = 1");
    const restoredLocations = (await locations(restored.id))[0].locations;
    assert.deepStrictEqual(restoredLocations.map(row => [row.take, row.location_name]).sort(), [[1, 'Box A'], [2, 'Box B']]);
    assert.ok(restoredLocations.every(row => row.entry_id !== ea && row.entry_id !== eb), 'restore remaps entry IDs');
    assert.deepStrictEqual(await db.get('SELECT * FROM collection WHERE id = ?', [foreign]), foreignBefore);
    assert.strictEqual((await db.get('SELECT SUM(quantity) AS count FROM deck_allocations')).count, 4);
    // Startup's single-copy migration preserves the selected counts and placement.
    await splitStackedEntries(db);
    assert.strictEqual((await db.get('SELECT SUM(quantity) AS count FROM deck_allocations')).count, 4);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS count FROM deck_allocations a JOIN collection c ON c.id = a.entry_id WHERE a.quantity > c.quantity')).count, 0);
    assert.deepStrictEqual((await locations(restored.id))[0].locations.map(row => row.location_name).sort(), ['Box A', 'Box B', 'Box B']);
    await request(`/decks/${restored.id}/return`, 'PUT', {});
    assert.strictEqual((await db.get('SELECT SUM(quantity) AS count FROM deck_allocations')).count, 1);
    // Old backups and old SQLite checkouts get the same one-time conservative assignment.
    const legacy = { ...backup, version: 1 };
    delete legacy.deck_allocations;
    await request('/import', 'POST', { format: 'backup', data: legacy });
    const legacyPins = await pins();
    await db.run('DROP TABLE deck_allocations');
    await db.initDb();
    assert.deepStrictEqual(await pins(), legacyPins);
    console.log('Checkout allocation HTTP/SQLite regressions passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => db.dbConnection.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
