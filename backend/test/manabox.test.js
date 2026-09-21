// ManaBox plaintext must preserve the exact set/collector printing needed for Scryfall.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseManaboxText } = require('../src/utils/csvMappers');

const cards = parseManaboxText(fs.readFileSync(path.join(__dirname, '..', '..', 'Patrick.txt'), 'utf8'));
const card = (set, number, printing = 'Normal') => cards.find(c =>
  c.set_code === set && c.collector_number === number && c.printing === printing
);

assert.deepStrictEqual(card('PLS', '58'), {
  name: 'Caldera Kavu',
  set_code: 'PLS',
  collector_number: '58',
  quantity: 2,
  condition: 'Near Mint',
  printing: 'Normal',
  game: 'mtg'
});
assert.strictEqual(card('POR', '118').printing, 'Normal', 'non-foil annotation must not make a card foil');
assert.strictEqual(card('7ED', '339', 'Holofoil').quantity, 1, 'ManaBox foil markers must be retained');
assert.ok(cards.length > 0, 'the supplied ManaBox export must yield cards');
assert.deepStrictEqual(
  parseManaboxText('1 Spider-Suit (SPM) 176\n1 Spider-Suit (SPM) 176 *F*').map(item => item.printing),
  ['Normal', 'Holofoil'],
  'mixed foil copies must remain separate'
);

async function testImportRoute() {
  const os = require('os');
  const tmpDb = path.join(os.tmpdir(), `bindarr-manabox-test-${process.pid}.db`);
  process.env.DB_PATH = tmpDb;
  process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

  const db = require('../src/db');
  const scryfallApi = require('../src/scryfallApi');
  const importRouter = require('../src/routes/importExport');
  const previewHandler = importRouter.stack.find(layer => layer.route?.path === '/import/preview').route.stack[0].handle;
  const originalBulkFetch = scryfallApi.bulkFetchByIdentifier;
  const originalCacheCards = scryfallApi.cacheCards;
  const handler = importRouter.stack.find(layer => layer.route?.path === '/import').route.stack[0].handle;

  try {
    await db.initDb();
    await db.run(`INSERT INTO card_cache (id, name, game) VALUES (?, ?, ?)`, ['mtg-caldera', 'Caldera Kavu', 'mtg']);
    await db.run(`INSERT INTO card_cache (id, name, game) VALUES (?, ?, ?)`, ['mtg-mountain', 'Mountain', 'mtg']);
    await db.run(`INSERT INTO card_cache (id, name, game) VALUES (?, ?, ?)`, ['mtg-spider', 'Spider-Suit', 'mtg']);

    let cachedCards = [];
    let bulkCalls = [];
    const resolvedCard = (row) => ({
      id: row.name === 'Caldera Kavu' ? 'mtg-caldera'
        : row.name === 'Spider-Suit' ? 'mtg-spider'
          : row.name === 'Mountain' ? 'mtg-mountain'
            : `mtg-${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      name: row.name,
      game: 'mtg',
      image_url: `https://images.example/${row.name.toLowerCase().replace(/\s+/g, '-')}.jpg`
    });
    scryfallApi.bulkFetchByIdentifier = async (rows) => {
      bulkCalls.push(rows);
      return { cards: rows.map(resolvedCard), pairs: rows.map(row => ({ row, card: resolvedCard(row) })) };
    };
    scryfallApi.cacheCards = async (cards) => {
      cachedCards = cards;
      for (const card of cards) {
        await db.run(`INSERT OR IGNORE INTO card_cache (id, name, game, image_url) VALUES (?, ?, ?, ?)`, [card.id, card.name, card.game, card.image_url]);
        await db.run('UPDATE card_cache SET image_url = ? WHERE id = ?', [card.image_url, card.id]);
      }
    };

    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    const preview = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    const data = '2 Caldera Kavu (PLS) 58\n1 Mountain (7ED) 339★ *F*\n1 Spider-Suit (SPM) 176\n1 Spider-Suit (SPM) 176 *F*';
    await previewHandler({ body: { format: 'manabox', data } }, preview);
    assert.deepStrictEqual(preview.body, { printings: 4, cards: 5, normal: 3, foils: 2 });
    await handler({
      body: { format: 'manabox', data },
      user: { id: 1 }
    }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.count, 4);
    assert.deepStrictEqual(await db.all(
      `SELECT card_id, quantity, printing, game FROM collection ORDER BY card_id, printing`
    ), [
      { card_id: 'mtg-caldera', quantity: 2, printing: 'Normal', game: 'mtg' },
      { card_id: 'mtg-mountain', quantity: 1, printing: 'Holofoil', game: 'mtg' },
      { card_id: 'mtg-spider', quantity: 1, printing: 'Holofoil', game: 'mtg' },
      { card_id: 'mtg-spider', quantity: 1, printing: 'Normal', game: 'mtg' }
    ]);
    const csvRes = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({
      body: { format: 'csv', data: 'Name,Set code,Card number,Quantity,Condition,Foil\nCaldera Kavu,PLS,58,1,near_mint,false' },
      user: { id: 1 }
    }, csvRes);
    assert.strictEqual(csvRes.statusCode, 200);
    assert.strictEqual(csvRes.body.count, 1);
    assert.deepStrictEqual(cachedCards, [{ id: 'mtg-caldera', name: 'Caldera Kavu', game: 'mtg', image_url: 'https://images.example/caldera-kavu.jpg' }]);
    assert.strictEqual((await db.get('SELECT image_url FROM card_cache WHERE id = ?', ['mtg-caldera'])).image_url, 'https://images.example/caldera-kavu.jpg');
    const arenaRes = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({
      body: { format: 'manabox', data: '1 Caldera Kavu (PLS) 58', list_type: 'arena' },
      user: { id: 1 }
    }, arenaRes);
    assert.strictEqual(arenaRes.statusCode, 200);
    assert.strictEqual((await db.get(`SELECT list_type FROM collection WHERE card_id = ? ORDER BY id DESC LIMIT 1`, ['mtg-caldera'])).list_type, 'arena');
    const bindarrCsv = fs.readFileSync(path.join(__dirname, '..', '..', 'bindarr_mtg_import.csv'), 'utf8')
      .split(/\r?\n/).slice(0, 4).join('\n');
    await db.run(`INSERT INTO card_cache (id, name, game) VALUES (?, ?, ?)`, ['mtg-a-brine-comber', 'Stale CSV card', 'pokemon']);
    const bindarrCsvRes = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({
      body: { format: 'internal', data: bindarrCsv, list_type: 'collection' },
      user: { id: 1 }
    }, bindarrCsvRes);
    assert.strictEqual(bindarrCsvRes.statusCode, 200);
    assert.strictEqual(bindarrCsvRes.body.count, 3);
    assert.deepStrictEqual(await db.get(
      `SELECT card_id, quantity, list_type, game FROM collection WHERE card_id = ?`,
      ['mtg-a-brine-comber']
    ), {
      card_id: 'mtg-a-brine-comber',
      quantity: 1,
      list_type: 'collection',
      game: 'mtg'
    });
    assert.strictEqual((await db.get(`SELECT game FROM card_cache WHERE id = ?`, ['mtg-a-brine-comber'])).game, 'mtg');
    assert.deepStrictEqual(bulkCalls.at(-1).map(row => [row.name, row.set_id, row.number]), [
      ['A-Brine Comber', 'VOW', undefined],
      ['A-Cobbled Lancer', 'VOW', undefined],
      ['A-Cosmos Charger', 'KHM', undefined]
    ]);
    await db.run(`UPDATE card_cache SET game = 'pokemon' WHERE id = ?`, ['mtg-a-brine-comber']);
    await db.initDb();
    assert.strictEqual((await db.get(`SELECT game FROM card_cache WHERE id = ?`, ['mtg-a-brine-comber'])).game, 'mtg');
    const csvPreview = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await previewHandler({ body: { format: 'internal', data: bindarrCsv } }, csvPreview);
    assert.deepStrictEqual(csvPreview.body, { cards: 3, quantity: 3, errors: [] });
    const invalidPreview = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await previewHandler({ body: { format: 'internal', data: 'Card ID,Name,Quantity\n,,1' } }, invalidPreview);
    assert.deepStrictEqual(invalidPreview.body.errors, ['Row 2: Card ID is required.', 'Row 2: Name is required.']);
  } finally {
    scryfallApi.bulkFetchByIdentifier = originalBulkFetch;
    scryfallApi.cacheCards = originalCacheCards;
    try { db.dbConnection.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDb + suffix); } catch { /* not present */ }
    }
  }
}

testImportRoute()
  .then(() => console.log('ManaBox parser and import self-check passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
