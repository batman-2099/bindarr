const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-stats-analytics-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const router = require('../src/routes/stats');
const handler = router.stack.find(layer => layer.route?.path === '/stats').route.stack[0].handle;

async function stats(userId, inventory = 'all') {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({ user: { id: userId }, query: { inventory } }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.analytics;
}

async function main() {
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 8, 23);
  try {
    await db.initDb();
    const users = [];
    for (const name of ['owner', 'other', 'empty']) {
      users.push((await db.run('INSERT INTO users (username, password_hash, share_token) VALUES (?, ?, ?)', [name, 'test', `stats-${name}`])).lastID);
    }
    const [owner, other, empty] = users;
    const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const blankGrowth = months.map(month => ({ month, physical: 0, arena: 0 }));
    const colorNames = ['White', 'Blue', 'Black', 'Red', 'Green', 'Colorless', 'Unknown'];
    const manaNames = ['0', '1', '2', '3', '4', '5', '6', '7+', 'Unknown'];
    const distribution = (names, owned = {}, decks = {}) => names.map(name => ({ name, owned: owned[name] || 0, decks: decks[name] || 0 }));
    const blank = {
      growth: blankGrowth, deckPerformance: [],
      colors: distribution(colorNames), mana: distribution(manaNames)
    };
    assert.deepStrictEqual(await stats(owner), blank);

    for (const [id, name, identity, cmc, types, subtypes, game] of [
      ['multi', 'Multicolor', '["W","Green","W"]', 2, '["Creature"]', '[]', 'mtg'],
      ['zero', 'Zero Artifact', '[]', 0, '["Artifact"]', '[]', 'mtg'],
      ['unknown', 'Unknown Card', null, null, null, null, 'mtg'],
      ['land', 'Island', null, 0, '["Land"]', '["Island"]', 'mtg'],
      ['high', 'Expensive Spell', '["R"]', 9, '["Sorcery"]', '[]', 'mtg'],
      ['legacy', 'Legacy Card', '["White"]', 2, '[]', '[]', 'pokemon']
    ]) {
      await db.run('INSERT INTO card_cache (id, name, color_identity, cmc, types, subtypes, game) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, name, identity, cmc, types, subtypes, game]);
    }
    for (const [card, quantity, inventory, added, user = owner] of [
      ['multi', 2, 'collection', '2025-09-30T23:30:00-01:00'],
      ['multi', 3, 'collection', '2026-09-01T00:30:00+01:00'],
      ['zero', 4, 'collection', '2026-09-02 12:00:00'],
      ['unknown', 5, 'collection', '2026-09-02 12:00:00'],
      ['land', 6, 'collection', '2026-09-02 12:00:00'],
      ['high', 7, 'arena', '2026-09-02 12:00:00'],
      ['zero', 1, 'collection', '2025-09-30 23:59:59'],
      ['multi', 100, 'wishlist', '2026-09-02 12:00:00'],
      ['multi', 100, 'collection', '2026-09-02 12:00:00', other],
      ['legacy', 100, 'collection', '2026-09-02 12:00:00']
    ]) {
      await db.run('INSERT INTO collection (user_id, card_id, quantity, list_type, added_at) VALUES (?, ?, ?, ?, ?)', [user, card, quantity, inventory, added]);
    }
    const decks = {};
    for (const [name, user, inventory, wins, losses, game = 'mtg'] of [
      ['Physical', owner, 'collection', 3, 1], ['Shared slots', owner, 'collection', 0, 0],
      ['Arena', owner, 'arena', 0, 2], ['Other user', other, 'collection', 99, 1],
      ['Legacy', owner, 'collection', 99, 1, 'pokemon'], ['Empty deck', empty, 'collection', 0, 0]
    ]) {
      decks[name] = (await db.run('INSERT INTO decks (name, user_id, inventory_type, wins, losses, game) VALUES (?, ?, ?, ?, ?, ?)', [name, user, inventory, wins, losses, game])).lastID;
    }
    for (const [deck, card, quantity] of [
      ['Physical', 'multi', 2], ['Physical', 'zero', 1], ['Physical', 'land', 4],
      ['Physical', 'uncached', 3], ['Shared slots', 'multi', 4], ['Arena', 'high', 2],
      ['Other user', 'multi', 99], ['Legacy', 'multi', 99]
    ]) {
      await db.run('INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)', [decks[deck], card, quantity]);
    }
    const performance = [
      { id: decks.Arena, name: 'Arena', inventory_type: 'arena', wins: 0, losses: 2, games: 2, winRate: 0 },
      { id: decks['Shared slots'], name: 'Shared slots', inventory_type: 'collection', wins: 0, losses: 0, games: 0, winRate: null },
      { id: decks.Physical, name: 'Physical', inventory_type: 'collection', wins: 3, losses: 1, games: 4, winRate: 75 }
    ];
    for (const inventory of ['all', 'collection', 'arena']) {
      const physical = inventory !== 'arena';
      const arena = inventory !== 'collection';
      const result = await stats(owner, inventory);
      assert.deepStrictEqual(result.growth, months.map((month, i) => ({
        month, physical: physical ? ({ 0: 2, 10: 3, 11: 15 }[i] || 0) : 0,
        arena: arena && i === 11 ? 7 : 0
      })));
      assert.deepStrictEqual(result.deckPerformance, performance.filter(deck => inventory === 'all' || deck.inventory_type === inventory));
      assert.deepStrictEqual(result.colors, distribution(colorNames,
        { ...(physical ? { White: 5, Green: 5, Blue: 6, Colorless: 5, Unknown: 5 } : {}), ...(arena ? { Red: 7 } : {}) },
        { ...(physical ? { White: 6, Green: 6, Blue: 4, Colorless: 1, Unknown: 3 } : {}), ...(arena ? { Red: 2 } : {}) }
      ));
      assert.deepStrictEqual(result.mana, distribution(manaNames,
        { ...(physical ? { 0: 5, 2: 5, Unknown: 5 } : {}), ...(arena ? { '7+': 7 } : {}) },
        { ...(physical ? { 0: 1, 2: 6, Unknown: 3 } : {}), ...(arena ? { '7+': 2 } : {}) }
      ));
    }
    assert.deepStrictEqual(await stats(empty), {
      ...blank,
      deckPerformance: [{ id: decks['Empty deck'], name: 'Empty deck', inventory_type: 'collection', wins: 0, losses: 0, games: 0, winRate: null }]
    });
    assert.deepStrictEqual(await stats(empty, 'arena'), blank);
  } finally {
    Date.now = realNow;
    await new Promise(resolve => db.dbConnection.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log('Stats analytics regression passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
