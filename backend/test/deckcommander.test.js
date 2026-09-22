const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `bindarr-deck-commander-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const db = require('../src/db');
const deckRouter = require('../src/routes/decks');
const cardApi = require('../src/utils/cardApi');

async function request(method, route, id, body = {}, userId = 1, cardId) {
  const handler = deckRouter.stack.find(layer => layer.route?.path === route && layer.route.methods[method]).route.stack[0].handle;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({ params: { id, card_id: cardId }, body, user: { id: userId } }, res);
  return res;
}

async function commander(id) {
  const res = await request('get', '/:id', id);
  assert.strictEqual(res.statusCode, 200);
  return res.body.commander_card_id;
}

async function testCommander() {
  const getCardById = cardApi.getCardById;
  cardApi.getCardById = async () => { throw new Error('Commander selection must not fetch card metadata'); };
  try {
    await db.initDb();
    await db.run(`INSERT INTO card_cache (id, name, game) VALUES ('first', 'First', 'mtg'), ('second', 'Second', 'mtg'), ('outside', 'Outside', 'mtg')`);
    const deck = (await db.run(`INSERT INTO decks (name, game, format, user_id) VALUES ('Commanders', 'mtg', 'cOmMaNdEr / eDh', 1)`)).lastID;
    const other = (await db.run(`INSERT INTO decks (name, game, format, user_id) VALUES ('Other', 'mtg', 'Standard', 1)`)).lastID;
    const legacy = (await db.run(`INSERT INTO decks (name, game, format, user_id) VALUES ('Legacy', 'pokemon', 'Commander', 1)`)).lastID;
    await db.run(`INSERT INTO deck_cards (deck_id, card_id) VALUES (?, 'first'), (?, 'second'), (?, 'outside')`, [deck, deck, other]);

    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'first' })).statusCode, 200);
    assert.strictEqual(await commander(deck), 'first');
    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'second' })).statusCode, 200);
    assert.strictEqual(await commander(deck), 'second', 'selecting another card replaces the previous commander');
    await db.initDb();
    assert.strictEqual(await commander(deck), 'second', 'initialization must preserve persisted designation');
    const listed = await request('get', '/', deck);
    assert.strictEqual(listed.body.find(row => row.id === deck).commander_card_id, 'second');

    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'outside' })).statusCode, 400);
    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'unknown' })).statusCode, 400);
    for (const body of [{}, { card_id: '' }, { card_id: 12 }, { card_id: ['first'] }]) {
      assert.strictEqual((await request('put', '/:id/commander', deck, body)).statusCode, 400);
    }
    assert.strictEqual((await request('put', '/:id/commander', other, { card_id: 'outside' })).statusCode, 400);
    assert.strictEqual((await request('put', '/:id/commander', legacy, { card_id: null })).statusCode, 404);
    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'first' }, 2)).statusCode, 404);
    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: null }, 2)).statusCode, 404);
    assert.strictEqual((await request('get', '/:id', deck, {}, 2)).statusCode, 404);
    assert.strictEqual((await request('delete', '/:id/cards/:card_id', deck, {}, 2, 'second')).statusCode, 404);
    assert.strictEqual((await request('put', '/:id', deck, { name: 'Unauthorized', format: 'Modern' }, 2)).statusCode, 404);
    assert.strictEqual(await commander(deck), 'second', 'rejected requests must not change the commander');

    const duplicate = await request('post', '/:id/duplicate', deck);
    assert.strictEqual(duplicate.statusCode, 201);
    assert.strictEqual(await commander(duplicate.body.id), 'second');
    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: null })).statusCode, 200);
    assert.strictEqual(await commander(deck), null);
    assert.strictEqual(await commander(duplicate.body.id), 'second', 'clearing the original must not change its copy');

    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'first' })).statusCode, 200);
    assert.strictEqual((await request('delete', '/:id/cards/:card_id', deck, {}, 1, 'second')).statusCode, 200);
    assert.strictEqual(await commander(deck), 'first', 'removing another card must preserve the commander');
    assert.strictEqual((await request('delete', '/:id/cards/:card_id', deck, {}, 1, 'first')).statusCode, 200);
    assert.strictEqual(await commander(deck), null);
    assert.strictEqual((await request('put', '/:id/commander', deck, { card_id: 'first' })).statusCode, 400);

    const copy = duplicate.body.id;
    assert.strictEqual((await request('put', '/:id', copy, { name: 'Renamed' })).statusCode, 200);
    assert.strictEqual(await commander(copy), 'second', 'unrelated metadata edits preserve the commander');
    assert.strictEqual((await request('put', '/:id', copy, { name: 'EDH', format: 'eDh' })).statusCode, 200);
    assert.strictEqual((await request('put', '/:id/commander', copy, { card_id: 'first' })).statusCode, 200);
    assert.strictEqual((await request('put', '/:id', copy, { name: 'Modern', format: 'Modern' })).statusCode, 200);
    assert.strictEqual(await commander(copy), null);
    assert.strictEqual((await request('put', '/:id', copy, { name: 'Commander', format: 'Commander' })).statusCode, 200);
    assert.strictEqual(await commander(copy), null, 'switching back must not resurrect a stale designation');
    assert.strictEqual((await request('put', '/:id/commander', copy, { card_id: 'first' })).statusCode, 200);
    assert.strictEqual((await request('post', '/:id/cards', copy, { card_id: 'first', quantity: 0 })).statusCode, 200);
    assert.strictEqual(await commander(copy), null);
    assert.strictEqual((await request('put', '/:id/commander', copy, { card_id: 'first' })).statusCode, 400);
  } finally {
    cardApi.getCardById = getCardById;
    await new Promise((resolve, reject) => db.dbConnection.close(error => error ? reject(error) : resolve()));
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDb + suffix); } catch { /* not present */ }
    }
  }
}

testCommander()
  .then(() => console.log('Deck commander self-check passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
