const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-quantity-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const { setStackQuantity, reserveDeck } = require('../src/utils/collectionHelpers');

async function main() {
  try {
    await db.initDb();
    await db.run("INSERT INTO card_cache (id, name) VALUES ('a', 'A')");
    const location = await db.get('SELECT id FROM locations LIMIT 1');
    const compartment = await db.get('SELECT id FROM compartments WHERE location_id = ? LIMIT 1', [location.id]);
    const edited = (await db.run(`INSERT INTO collection (card_id, user_id, location_id, compartment_id, position)
      VALUES ('a', 1, ?, ?, 4000)`, [location.id, compartment.id])).lastID;
    const extra = (await db.run("INSERT INTO collection (card_id, user_id) VALUES ('a', 1)")).lastID;
    const set = quantity => db.withTransaction(() => setStackQuantity(db, 1, edited, quantity));
    const rows = () => db.all("SELECT * FROM collection WHERE printing = 'Normal' ORDER BY id");
    assert.strictEqual(await set(1), -1);
    assert.strictEqual(await db.get('SELECT id FROM collection WHERE id = ?', [extra]), undefined);
    const only = await rows();
    assert.deepStrictEqual(only.map(row => [row.id, row.quantity]), [[edited, 1]]);
    assert.strictEqual(await set(1), 0);
    assert.deepStrictEqual(await rows(), only);
    assert.strictEqual(await set(3), 2);
    assert.deepStrictEqual((await rows()).map(row => [row.quantity, row.compartment_id]), Array(3).fill([1, compartment.id]));
    const holo = (await db.run("INSERT INTO collection (card_id, user_id, printing) VALUES ('a', 1, 'Holofoil')")).lastID;
    await set(1);
    assert.strictEqual((await db.get('SELECT quantity FROM collection WHERE id = ?', [holo])).quantity, 1);
    await db.run('UPDATE collection SET quantity = 4 WHERE id = ?', [edited]);
    assert.strictEqual(await set(2), -2);
    assert.strictEqual((await rows())[0].quantity, 2);
    // The trim must skip a reserved sibling and subtract only from the edited row.
    const sibling = (await db.run("INSERT INTO collection (card_id, user_id) VALUES ('a', 1)")).lastID;
    const deck = (await db.run("INSERT INTO decks (name, user_id) VALUES ('Reserved', 1)")).lastID;
    await db.run("INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, 'a', 1)", [deck]);
    await db.withTransaction(() => reserveDeck(1, deck, [{ card_id: 'a', entry_id: sibling, quantity: 1 }]));
    await set(2);
    assert.deepStrictEqual((await rows()).map(row => [row.id, row.quantity]), [[edited, 1], [sibling, 1]]);
    const before = await rows();
    await assert.rejects(set(1), error => error.status === 409);
    assert.deepStrictEqual(await rows(), before);
    console.log('stackquantity.test.js passed');
  } finally {
    await new Promise(resolve => db.dbConnection.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
