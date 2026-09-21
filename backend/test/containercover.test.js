const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-cover-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = 'test-password';
const db = require('../src/db');
const router = require('../src/routes/storage');
const update = router.stack.find(layer => layer.route?.path === '/locations/:id' && layer.route.methods.put).route.stack[0].handle;
(async () => {
  try {
    await db.initDb();
    const { lastID: id } = await db.run("INSERT INTO locations (name, type, user_id) VALUES ('Cover test', 'Box', 1)");
    await db.run("INSERT INTO card_cache (id, name, game, image_url) VALUES ('mtg-cover', 'Forest', 'mtg', 'https://example.com/card.jpg')");
    await db.run("INSERT INTO collection (card_id, user_id, location_id, quantity) VALUES ('mtg-cover', 1, ?, 1)", [id]);
    const request = async (cover, userId = 1) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await update({ params: { id }, user: { id: userId }, body: { cover_card_id: cover } }, res);
      return res;
    };
    assert.equal((await request('mtg-cover')).statusCode, 200);
    assert.equal((await db.get('SELECT cover_card_id FROM locations WHERE id = ?', [id])).cover_card_id, 'mtg-cover');
    assert.equal((await request('absent')).statusCode, 400);
    assert.equal((await request('mtg-cover', 999)).statusCode, 404);
    assert.equal((await db.get('SELECT cover_card_id FROM locations WHERE id = ?', [id])).cover_card_id, 'mtg-cover');
    assert.equal((await request(null)).statusCode, 200);
    assert.equal((await db.get('SELECT cover_card_id FROM locations WHERE id = ?', [id])).cover_card_id, null);
    console.log('Container cover persistence and ownership checks passed');
  } finally {
    await new Promise(resolve => db.dbConnection.close(resolve));
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + suffix, { force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
