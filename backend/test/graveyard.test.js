const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-graveyard-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const { inventory } = require('../src/utils/aiDecks');

async function testGraveyard() {
  let server;
  try {
    await db.initDb();
    await db.run(`INSERT INTO users (id, username, password_hash, share_token) VALUES (2, 'other', 'unused', 'other-token')`);
    await db.run(`INSERT INTO card_cache (id, name, game, price_trend) VALUES ('archive-card', 'Archive Card', 'mtg', 10), ('spare-card', 'Spare Card', 'mtg', 1)`);
    const location = (await db.run(`INSERT INTO locations (name, type, user_id) VALUES ('Archive Box', 'Box', 1)`)).lastID;
    const compartment = (await db.run(`INSERT INTO compartments (location_id, idx, capacity) VALUES (?, 1, 100)`, [location])).lastID;
    const physical = (await db.run(`INSERT INTO collection
      (card_id, user_id, quantity, location_id, compartment_id, position, printing, language, condition,
       purchase_price, favorite, is_trade, notes, grader, grade, cert_number, market_value, market_value_source, added_at)
      VALUES ('archive-card', 1, 3, ?, ?, 1000, 'Holofoil', 'German', 'Lightly Played',
        5, 1, 1, 'Keep provenance', 'PSA', 9, 'archive-cert', 30, 'manual', '2025-01-01 00:00:00')`, [location, compartment])).lastID;
    const arena = (await db.run(`INSERT INTO collection (card_id, user_id, quantity, list_type) VALUES ('archive-card', 1, 2, 'arena')`)).lastID;
    const foreign = (await db.run(`INSERT INTO collection (card_id, user_id, quantity) VALUES ('archive-card', 2, 9)`)).lastID;
    const deck = (await db.run(`INSERT INTO decks (name, user_id) VALUES ('Physical Deck', 1)`)).lastID;
    await db.run(`INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, 'archive-card', 1)`, [deck]);
    const original = await db.get('SELECT * FROM collection WHERE id = ?', [physical]);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: Number(req.headers['x-test-user'] || 1) }; next(); });
    app.use('/api', require('../src/routes/collection'));
    app.use('/api', require('../src/routes/storage'));
    app.use('/api', require('../src/routes/importExport'));
    app.use('/api', require('../src/routes/stats'));
    app.use('/api/decks', require('../src/routes/decks'));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(url, method = 'GET', body, user = 1, status = 200) {
      const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.strictEqual(response.status, status, JSON.stringify(data));
      return data;
    }
    const change = (id, list_type, user = 1, status = 200) => request(`/collection/${id}`, 'PUT', { list_type }, user, status);
    const bulk = (entry_ids, value, status = 200) => request('/collection/bulk', 'POST', { entry_ids, action: 'list_type', value }, 1, status);

    await change(foreign, 'graveyard', 1, 404);
    await change(physical, 'invalid', 1, 400);
    await request('/collection?list_type=invalid', 'GET', undefined, 1, 400);
    await change(physical, 'graveyard');
    const archived = { ...original, list_type: 'graveyard', location_id: null, compartment_id: null, position: 0 };
    assert.deepStrictEqual(await db.get('SELECT * FROM collection WHERE id = ?', [physical]), archived, 'archive preserves quantity and every non-placement field');
    assert.deepStrictEqual((await request('/collection?list_type=graveyard')).map(row => [row.entry_id, row.quantity, row.notes]), [[physical, 3, 'Keep provenance']]);
    assert.deepStrictEqual(await request('/collection'), []);
    assert.deepStrictEqual(await request('/collection?list_type=graveyard', 'GET', undefined, 2), []);
    assert.deepStrictEqual((await request('/collection', 'GET', undefined, 2)).map(row => row.quantity), [9]);
    assert.strictEqual((await request('/locations')).find(row => row.id === location).total_cards, 0);
    assert.strictEqual((await request(`/locations/${location}/compartments`))[0].count, 0);
    await request(`/collection/${physical}`, 'PUT', { location_id: location }, 1, 400);
    await request(`/collection/${physical}/place`, 'POST', { compartment_id: compartment, slot: 0 }, 1, 400);
    assert.strictEqual((await request('/collection/bulk', 'POST', { entry_ids: [physical], action: 'move', value: location })).affected, 0);
    await request(`/locations/${location}/apply-all`, 'POST', { entry_ids: [physical] });
    assert.deepStrictEqual(await db.get('SELECT * FROM collection WHERE id = ?', [physical]), archived);
    const stats = await request('/stats');
    assert.strictEqual(stats.summary.totalCards, 2);
    assert.deepStrictEqual(stats.topValuable.map(row => row.entry_id), [arena]);
    assert.strictEqual((await request(`/decks/${deck}`)).cards[0].owned_qty, 0);
    assert.deepStrictEqual(await inventory(1, 'collection'), []);
    assert.strictEqual((await inventory(1, 'arena'))[0].available_qty, 2);
    assert.strictEqual((await request('/collection/bulk', 'POST', { entry_ids: [physical], action: 'add_to_deck', value: deck })).affected, 0);

    const backup = await request('/export?format=backup');
    assert.deepStrictEqual(backup.collection.find(row => row.id === physical), archived);
    await request('/import', 'POST', { format: 'backup', data: backup });
    const restoredArchive = await db.get(`SELECT * FROM collection WHERE user_id = 1 AND list_type = 'graveyard'`);
    assert.deepStrictEqual({ ...restoredArchive, id: physical }, archived, 'complete backup preserves archive state and metadata');
    assert.strictEqual((await db.get('SELECT quantity FROM collection WHERE id = ?', [foreign])).quantity, 9);
    const restoredArena = await db.get(`SELECT id FROM collection WHERE user_id = 1 AND list_type = 'arena'`);
    await change(restoredArchive.id, 'collection');
    assert.deepStrictEqual((await request('/collection')).map(row => [row.quantity, row.location_id]), [[3, null]]);
    await bulk([restoredArchive.id, restoredArena.id, foreign], 'graveyard');
    assert.strictEqual((await request('/stats')).summary.totalCards, 0);
    assert.strictEqual((await db.get('SELECT list_type FROM collection WHERE id = ?', [foreign])).list_type, 'collection');
    await bulk([restoredArchive.id, restoredArena.id], 'arena');
    assert.strictEqual((await inventory(1, 'arena'))[0].available_qty, 5);
    assert.deepStrictEqual(await inventory(1, 'collection'), []);

    await change(restoredArchive.id, 'collection');
    const restoredDeck = await db.get('SELECT id FROM decks WHERE user_id = 1');
    await db.run('UPDATE decks SET checked_out = 1 WHERE id = ?', [restoredDeck.id]);
    const spare = (await db.run(`INSERT INTO collection (card_id, user_id) VALUES ('spare-card', 1)`)).lastID;
    const beforeGuard = await db.all('SELECT * FROM collection WHERE user_id = 1 ORDER BY id');
    await change(restoredArchive.id, 'graveyard', 1, 409);
    await bulk([spare, restoredArchive.id], 'graveyard', 409);
    assert.deepStrictEqual(await db.all('SELECT * FROM collection WHERE user_id = 1 ORDER BY id'), beforeGuard, 'checked-out guard rejects the whole batch without mutation');
    assert.strictEqual((await db.get('SELECT checked_out FROM decks WHERE id = ?', [restoredDeck.id])).checked_out, 1);
    await db.run('UPDATE decks SET checked_out = 0 WHERE id = ?', [restoredDeck.id]);
    await change(restoredArchive.id, 'graveyard');
    assert.deepStrictEqual((await request('/collection?list_type=graveyard')).map(row => row.quantity), [3]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => db.dbConnection.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

testGraveyard().then(() => console.log('Graveyard archive HTTP/database self-check passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
