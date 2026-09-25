const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-split-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const { splitStackedEntries } = require('../src/utils/collectionHelpers');

async function main() {
  try {
    await db.initDb();
    await db.run("INSERT INTO card_cache (id, name) VALUES ('a', 'A'), ('b', 'B')");
    const location = await db.get('SELECT id FROM locations LIMIT 1');
    const compartment = await db.get('SELECT id FROM compartments WHERE location_id = ? LIMIT 1', [location.id]);
    await db.run(`INSERT INTO collection (card_id, user_id, quantity, location_id, compartment_id, position, notes, missing)
      VALUES ('a', 1, 3, ?, ?, 4000, 'Preserved', 1)`, [location.id, compartment.id]);
    await db.run("INSERT INTO collection (card_id, user_id) VALUES ('b', 1)");
    const other = await db.get("SELECT * FROM collection WHERE card_id = 'b'");
    assert.strictEqual(await splitStackedEntries(db), 2);
    const copies = await db.all("SELECT * FROM collection WHERE card_id = 'a'");
    assert.deepStrictEqual(copies.map(row => [row.quantity, row.compartment_id, row.notes, row.missing]),
      Array(3).fill([1, compartment.id, 'Preserved', 1]));
    assert.strictEqual(new Set(copies.map(row => row.position)).size, 3);
    assert.deepStrictEqual(await db.get("SELECT * FROM collection WHERE card_id = 'b'"), other);
    assert.strictEqual(await splitStackedEntries(db), 0);
    assert.deepStrictEqual(await db.all("SELECT * FROM collection WHERE card_id = 'a'"), copies);
    console.log('split.test.js passed');
  } finally {
    await new Promise(resolve => db.dbConnection.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
