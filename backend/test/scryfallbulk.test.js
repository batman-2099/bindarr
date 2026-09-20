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
    const { cards, pairs } = await scryfallApi.bulkFetchByIdentifier([normal, foil]);
    assert.strictEqual(cards.length, 1, 'one Scryfall printing is fetched once');
    assert.deepStrictEqual(pairs.map(pair => pair.row), [normal, foil], 'every source row receives the resolved card');
  } finally {
    try { db.dbConnection.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDb + suffix); } catch { /* not present */ }
    }
    scryfallApi.client.post = originalPost;
  }
}

testDuplicateIdentifiers()
  .then(() => console.log('Scryfall duplicate identifier self-check passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
