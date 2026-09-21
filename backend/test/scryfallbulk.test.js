const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tmpDb = path.join(os.tmpdir(), `bindarr-scryfall-bulk-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.SCRYFALL_GAP_SCALE = '0';

const db = require('../src/db');
const scryfallApi = require('../src/scryfallApi');

async function testDuplicateIdentifiers() {
  const originalPost = scryfallApi.client.post;
  const originalGet = scryfallApi.client.get;
  await db.initDb();
  try {
    scryfallApi.client.post = async (url, body) => {
      assert.strictEqual(url, '/cards/collection');
      assert.deepStrictEqual(body.identifiers, [{ set: 'spm', collector_number: '102' }]);
      return {
        data: {
          data: [{
            id: '11111111-1111-1111-1111-111111111111', name: 'Guy in the Chair',
            set: 'spm', collector_number: '102', lang: 'en', image_uris: {}, prices: {}
          }],
          not_found: []
        }
      };
    };
    const normal = { name: 'Guy in the Chair', set_id: 'SPM', number: '102', printing: 'Normal' };
    const foil = { name: 'Guy in the Chair', set_id: 'SPM', number: '102', printing: 'Holofoil' };
    const { cards, pairs, unmatchedRows } = await scryfallApi.bulkFetchByIdentifier([normal, foil]);
    assert.strictEqual(cards.length, 1, 'one Scryfall printing is fetched once');
    assert.deepStrictEqual(pairs.map(pair => pair.row), [normal, foil], 'every source row receives the resolved card');
    assert.deepStrictEqual(unmatchedRows, [], 'resolved rows are not reported as failed');
    scryfallApi.client.get = async (url) => {
      const set = url.includes('e%3Avow') ? 'vow' : url.includes('e%3Akhm') ? 'khm' : null;
      assert.ok(set, `set-scoped search expected, got ${url}`);
      return {
        data: {
          has_more: false,
          data: [{
            id: `${set}-forest-0000-0000-000000000000`, name: 'Forest',
            set, collector_number: '1', lang: 'en', image_uris: {}, prices: {}
          }]
        }
      };
    };
    const vowForest = { name: 'Forest', set_id: 'VOW', number: '' };
    const khmForest = { name: 'Forest', set_id: 'KHM', number: '' };
    const scoped = await scryfallApi.bulkFetchByIdentifier([vowForest, khmForest]);
    assert.deepStrictEqual(scoped.pairs.map(pair => [pair.row.set_id, pair.card.id]), [
      ['VOW', 'mtg-vow-forest-0000-0000-000000000000'],
      ['KHM', 'mtg-khm-forest-0000-0000-000000000000']
    ], 'set codes keep duplicate land names as separate printings');
  } finally {
    try { db.dbConnection.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDb + suffix); } catch { /* not present */ }
    }
    scryfallApi.client.post = originalPost;
    scryfallApi.client.get = originalGet;
  }
}

testDuplicateIdentifiers()
  .then(() => console.log('Scryfall duplicate identifier self-check passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
