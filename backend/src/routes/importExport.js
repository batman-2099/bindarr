const express = require('express');
const router = express.Router();
const db = require('../db');
const { parseThirdPartyCSV, parseManaboxText } = require('../utils/csvMappers');
const scryfallApi = require('../scryfallApi');
const { generateExportCSV } = require('../utils/csvExporters');
const { resolveCardPrice } = require('../utils/priceHelpers');
const { isBinderType } = require('../utils/compartmentSort');

function parseCsvRows(data) {
  const lines = typeof data === 'string' ? data.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
  if (lines.length <= 1) throw new Error('CSV file is empty or missing headers');

  const parseLine = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        values.push(value.trim());
        value = '';
      } else value += char;
    }
    values.push(value.trim());
    return values.map(cell => cell.replace(/^"|"$/g, ''));
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine)
    .filter(values => values.length >= headers.length)
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
  return { headers, rows };
}

function parseCompleteBackup(data) {
  const backup = typeof data === 'string' ? JSON.parse(data) : data;
  const arrays = ['collection', 'card_cache', 'locations', 'compartments', 'compartment_assignments', 'decks', 'deck_cards'];
  if (!backup || backup.format !== 'bindarr-backup' || backup.version !== 1 || !arrays.every(key => Array.isArray(backup[key]))) {
    throw new Error('Invalid backup file');
  }

  const cardIds = new Set(backup.card_cache.map(card => card.id));
  const locationIds = new Set(backup.locations.map(location => location.id));
  const compartmentIds = new Set(backup.compartments.map(compartment => compartment.id));
  const deckIds = new Set(backup.decks.map(deck => deck.id));
  if (
    backup.card_cache.some(card => !card.id || !card.name)
    || backup.locations.some(location => !location.id || !location.name || !location.type)
    || backup.compartments.some(compartment => !compartment.id || !locationIds.has(compartment.location_id))
    || backup.compartment_assignments.some(assignment => !compartmentIds.has(assignment.compartment_id))
    || backup.collection.some(card => !cardIds.has(card.card_id) || (card.location_id != null && !locationIds.has(card.location_id)) || (card.compartment_id != null && !compartmentIds.has(card.compartment_id)))
    || backup.deck_cards.some(card => !cardIds.has(card.card_id) || !deckIds.has(card.deck_id))
  ) {
    throw new Error('Invalid backup references');
  }
  return backup;
}

async function restoreCompleteBackup(backup, userId) {
  const locationIds = new Map();
  const compartmentIds = new Map();
  const deckIds = new Map();

  await db.withTransaction(async () => {
    await db.run('DELETE FROM deck_cards WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?)', [userId]);
    await db.run('DELETE FROM decks WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM collection WHERE user_id = ?', [userId]);
    await db.run('DELETE FROM locations WHERE user_id = ?', [userId]);

    for (const card of backup.card_cache) {
      await db.run(`
        INSERT OR IGNORE INTO card_cache (
          id, name, supertype, subtypes, types, rarity, set_id, set_name, number, image_url,
          price_trend, price_normal, price_holofoil, price_reverse_holofoil, price_avg1, price_avg7,
          price_avg30, price_1st_edition, price_currency, price_source, cmc, color_identity, game,
          language, printed_name, tcgplayer_product_id, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        card.id, card.name, card.supertype, card.subtypes, card.types, card.rarity, card.set_id, card.set_name, card.number, card.image_url,
        card.price_trend, card.price_normal, card.price_holofoil, card.price_reverse_holofoil, card.price_avg1, card.price_avg7,
        card.price_avg30, card.price_1st_edition, card.price_currency, card.price_source, card.cmc, card.color_identity, card.game,
        card.language, card.printed_name, card.tcgplayer_product_id, card.last_updated
      ]);
    }

    for (const location of backup.locations) {
      const result = await db.run(`
        INSERT INTO locations (name, type, sort_order, foil_sorting, rule_type, rule_config, game, user_id, locked, allow_stacking)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        location.name, location.type, location.sort_order, location.foil_sorting, location.rule_type, location.rule_config,
        location.game, userId, location.locked || 0, location.allow_stacking || 0
      ]);
      locationIds.set(location.id, result.lastID);
    }

    for (const compartment of backup.compartments) {
      const result = await db.run(`
        INSERT INTO compartments (location_id, idx, label, capacity, rule_config, locked)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        locationIds.get(compartment.location_id), compartment.idx, compartment.label, compartment.capacity,
        compartment.rule_config, compartment.locked || 0
      ]);
      compartmentIds.set(compartment.id, result.lastID);
    }

    for (const assignment of backup.compartment_assignments) {
      await db.run('INSERT INTO compartment_assignments (compartment_id, filter_value) VALUES (?, ?)', [
        compartmentIds.get(assignment.compartment_id), assignment.filter_value
      ]);
    }

    for (const card of backup.collection) {
      await db.run(`
        INSERT INTO collection (
          card_id, quantity, condition, printing, language, purchase_price, location_id, compartment_id,
          position, favorite, is_trade, list_type, game, added_at, notes, grader, grade, cert_number,
          market_value, market_value_source, market_value_at, missing, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        card.card_id, card.quantity, card.condition, card.printing, card.language, card.purchase_price,
        card.location_id == null ? null : locationIds.get(card.location_id),
        card.compartment_id == null ? null : compartmentIds.get(card.compartment_id),
        card.position, card.favorite || 0, card.is_trade || 0, card.list_type, card.game, card.added_at,
        card.notes || '', card.grader || 'Raw', card.grade, card.cert_number, card.market_value,
        card.market_value_source, card.market_value_at, card.missing || 0, userId
      ]);
    }

    for (const deck of backup.decks) {
      const result = await db.run(`
        INSERT INTO decks (
          name, description, checked_out, checked_out_at, game, created_at, format, category,
          accent_color, target_size, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        deck.name, deck.description, deck.checked_out || 0, deck.checked_out_at, deck.game, deck.created_at,
        deck.format, deck.category, deck.accent_color, deck.target_size, userId
      ]);
      deckIds.set(deck.id, result.lastID);
    }

    for (const card of backup.deck_cards) {
      await db.run('INSERT INTO deck_cards (deck_id, card_id, quantity, checked_out) VALUES (?, ?, ?, ?)', [
        deckIds.get(card.deck_id), card.card_id, card.quantity, card.checked_out || 0
      ]);
    }
  });

  return { cards: backup.collection.length, locations: backup.locations.length, decks: backup.decks.length };
}

// Export endpoint
router.get('/export', async (req, res) => {
  const { format = 'csv', ecosystem = 'internal' } = req.query;
  const targetFormat = (ecosystem || format || 'internal').toLowerCase();

  try {
    if (format.toLowerCase() === 'backup') {
      const [collection, locations, compartments, compartmentAssignments, decks, deckCards, cardCache] = await Promise.all([
        db.all('SELECT * FROM collection WHERE user_id = ? ORDER BY id', [req.user.id]),
        db.all('SELECT * FROM locations WHERE user_id = ? ORDER BY id', [req.user.id]),
        db.all('SELECT cp.* FROM compartments cp JOIN locations l ON l.id = cp.location_id WHERE l.user_id = ? ORDER BY cp.location_id, cp.idx', [req.user.id]),
        db.all('SELECT ca.* FROM compartment_assignments ca JOIN compartments cp ON cp.id = ca.compartment_id JOIN locations l ON l.id = cp.location_id WHERE l.user_id = ? ORDER BY ca.compartment_id, ca.filter_value', [req.user.id]),
        db.all('SELECT * FROM decks WHERE user_id = ? ORDER BY id', [req.user.id]),
        db.all('SELECT dc.* FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id WHERE d.user_id = ? ORDER BY dc.deck_id, dc.card_id', [req.user.id]),
        db.all(`
          SELECT * FROM card_cache WHERE id IN (
            SELECT card_id FROM collection WHERE user_id = ?
            UNION
            SELECT dc.card_id FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id WHERE d.user_id = ?
          ) ORDER BY id
        `, [req.user.id, req.user.id])
      ]);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=bindarr_backup_${new Date().toISOString().slice(0, 10)}.json`);
      return res.json({
        format: 'bindarr-backup',
        version: 1,
        exported_at: new Date().toISOString(),
        collection,
        card_cache: cardCache,
        locations,
        compartments,
        compartment_assignments: compartmentAssignments,
        decks,
        deck_cards: deckCards
      });
    }

    const query = `
      SELECT 
        c.quantity,
        c.condition,
        c.printing,
        c.language,
        c.purchase_price,
        c.added_at,
        cc.id as card_id,
        cc.name as name,
        cc.supertype,
        cc.types,
        cc.rarity,
        cc.set_id as set_code,
        cc.set_name,
        cc.number as collector_number,
        cc.image_url,
        c.grader,
        c.grade,
        c.market_value,
        cc.price_trend,
        cc.price_normal,
        cc.price_holofoil,
        cc.price_reverse_holofoil,
        cc.price_1st_edition,
        l.name as location_name,
        l.type as location_type,
        cp.idx as compartment_idx,
        cp.label as compartment_label,
        c.position
      FROM collection c
      JOIN card_cache cc ON c.card_id = cc.id
      LEFT JOIN locations l ON c.location_id = l.id
      LEFT JOIN compartments cp ON c.compartment_id = cp.id
      WHERE c.user_id = ?
    `;
    const raw = await db.all(query, [req.user.id]);
    // market_price used to be cc.price_trend flat, which exported the wrong number
    // for every foil, every 1st Edition and every slab — the same three cases
    // resolveCardPrice exists to get right. An export that disagrees with the
    // dashboard is worse than no export: it is a spreadsheet someone will trust.
    // price_trend is destructured OUT along with the per-printing columns: the CSV
    // strategies read `item.price_trend || item.market_price`, so leaving it in
    // would win over the resolved number and export the raw price anyway.
    const rows = raw.map(({ price_trend, price_normal, price_holofoil, price_reverse_holofoil, price_1st_edition, ...keep }) => ({
      ...keep,
      market_price: resolveCardPrice({ price_trend, price_normal, price_holofoil, price_reverse_holofoil, price_1st_edition, ...keep }),
      // The two sub-location columns the exporters read. They used to be selected
      // straight off the collection table as sub_location_1/2 — columns db.js has
      // DROPPED the table to remove, so every export answered
      // "no such column: c.sub_location_1" and 500'd. Rebuilt from the compartment
      // the card actually lives in, the same way the collection view labels it.
      sub_location_1: keep.compartment_idx == null
        ? ''
        : (keep.compartment_label || `${isBinderType(keep.location_type) ? 'Page' : 'Row'} ${keep.compartment_idx}`),
      sub_location_2: keep.position >= 1000 ? String(Math.floor(keep.position / 1000)) : '',
    }));

    if (format.toLowerCase() === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=pokedexrr_collection_${targetFormat}.json`);
      return res.json(rows);
    }

    const csvContent = generateExportCSV(rows, targetFormat);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=pokedexrr_collection_${targetFormat}.csv`);
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ error: 'Export failed', message: error.message });
  }
});


router.post('/import/preview', (req, res) => {
  const { format = 'internal', data } = req.body;
  if (!data) return res.status(400).json({ error: 'No import data provided' });

  if (format.toLowerCase() === 'manabox') {
    const items = parseManaboxText(data);
    if (!items.length) return res.status(400).json({ error: 'No ManaBox cards found' });
    const summary = items.reduce((out, item) => {
      out.cards += item.quantity;
      if (item.printing === 'Holofoil') out.foils += item.quantity;
      else out.normal += item.quantity;
      return out;
    }, { printings: items.length, cards: 0, normal: 0, foils: 0 });
    return res.json(summary);
  }

  try {
    const { rows } = parseCsvRows(data);
    const items = parseThirdPartyCSV(rows, format);
    const errors = items.flatMap((item, index) => {
      const row = index + 2;
      const rowErrors = [];
      if (!item.card_id) rowErrors.push(`Row ${row}: Card ID is required.`);
      if (!item.name) rowErrors.push(`Row ${row}: Name is required.`);
      return rowErrors;
    });
    return res.json({
      cards: items.length,
      quantity: items.reduce((total, item) => total + item.quantity, 0),
      errors
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
// Import endpoint
router.post('/import', async (req, res) => {
  const { format = 'internal', data, list_type = 'collection' } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'No data provided' });
  }

  try {
    let rawItems = [];
    let unmatchedCount = 0;
    let manaBoxItems = null;
    const formatKey = format.toLowerCase();
    if (!['collection', 'arena'].includes(list_type)) {
      return res.status(400).json({ error: 'Invalid list_type' });
    }
    if (formatKey === 'backup') {
      const backup = parseCompleteBackup(data);
      const restored = await restoreCompleteBackup(backup, req.user.id);
      return res.json({
        success: true,
        ...restored,
        message: `Restored ${restored.cards} cards, ${restored.locations} containers, and ${restored.decks} decks.`
      });
    }

    if (formatKey === 'json') {
      rawItems = typeof data === 'string' ? JSON.parse(data) : data;
    } else if (formatKey === 'manabox') {
      rawItems = parseManaboxText(data);
      if (rawItems.length === 0) {
        return res.status(400).json({ error: 'No ManaBox cards found' });
      }
      manaBoxItems = rawItems;
    } else {
      const { headers, rows } = parseCsvRows(data);
      const manaBoxHeaders = headers.map(header => header.toLowerCase());
      const isManaBoxCsv = ['name', 'set code', 'card number'].every(header => manaBoxHeaders.includes(header));
      rawItems = parseThirdPartyCSV(rows, isManaBoxCsv ? 'manabox' : format);
      if (isManaBoxCsv) manaBoxItems = rawItems;
    }

    if (manaBoxItems) {
      const { cards, pairs } = await scryfallApi.bulkFetchByIdentifier(manaBoxItems.map(item => ({
        ...item,
        set_id: item.set_code,
        number: item.collector_number
      })));
      await scryfallApi.cacheCards(cards);

      unmatchedCount = manaBoxItems.length - pairs.length;
      rawItems = pairs.map(({ row, card }) => ({ ...row, card_id: card.id }));
      if (rawItems.length === 0) {
        return res.status(400).json({ error: 'No ManaBox cards matched Scryfall' });
      }
    }

    if (!Array.isArray(rawItems)) {
      return res.status(400).json({ error: 'Invalid data payload' });
    }

    let importedCount = 0;

    await db.withTransaction(async () => {
      for (const item of rawItems) {
        let cardId = item.card_id || item.id;
        if (!cardId && item.set_code && item.collector_number) {
          cardId = `${item.set_code.toLowerCase()}-${item.collector_number}`;
        }
        if (!cardId && item.name) {
          cardId = item.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        }

        if (!cardId) continue;

        let cached = await db.get(`SELECT id FROM card_cache WHERE id = ?`, [cardId]);
        if (!cached) {
          await db.run(
            `INSERT OR IGNORE INTO card_cache 
             (id, name, supertype, subtypes, types, rarity, set_id, set_name, number, image_url, price_trend)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cardId,
              item.name || 'Imported Card',
              item.supertype || (item.game === 'mtg' ? 'Card' : 'Pokémon'),
              '[]',
              JSON.stringify(item.types || []),
              item.rarity || 'Common',
              item.set_code || item.set_id || '',
              item.set_name || item.set_code || 'Imported Set',
              item.collector_number || item.number || '',
              item.image_url || '',
              item.market_price || item.purchase_price || 0
            ]
          );
        }

        await db.run(
          `INSERT INTO collection 
           (card_id, user_id, quantity, condition, printing, language, purchase_price, list_type, game, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            cardId,
            req.user.id,
            item.quantity || 1,
            item.condition || 'Near Mint',
            item.printing || 'Normal',
            item.language || 'English',
            item.purchase_price || 0,
            list_type,
            item.game || 'mtg'
          ]
        );
        importedCount++;
      }
    });

    const unmatched = unmatchedCount ? ` ${unmatchedCount} unmatched ManaBox printings were skipped.` : '';
    return res.json({ success: true, count: importedCount, message: `Successfully imported ${importedCount} items.${unmatched}` });
  } catch (error) {
    const status = error.message.startsWith('Invalid backup') ? 400 : 500;
    return res.status(status).json({ error: status === 400 ? error.message : 'Import failed', message: error.message });
  }
});

// Build a physical box from matching, unfiled cards the user already owns.
router.post('/import-container', async (req, res) => {
  const { data, name } = req.body;
  const containerName = String(name || '').trim();
  if (!data || !containerName) {
    return res.status(400).json({ error: 'Container name and ManaBox data are required' });
  }

  try {
    const items = parseManaboxText(data);
    if (items.length === 0) return res.status(400).json({ error: 'No ManaBox cards found' });
    const duplicate = await db.get(`SELECT id FROM locations WHERE name = ? AND user_id = ?`, [containerName, req.user.id]);
    if (duplicate) return res.status(400).json({ error: 'A location with this name already exists' });

    const { pairs } = await scryfallApi.bulkFetchByIdentifier(items.map(item => ({
      ...item,
      set_id: item.set_code,
      number: item.collector_number
    })));
    if (pairs.length === 0) return res.status(400).json({ error: 'No ManaBox cards matched Scryfall' });

    const requested = pairs.reduce((total, { row }) => total + row.quantity, 0);
    let locationId;
    let count = 0;
    await db.withTransaction(async () => {
      const entries = [];
      for (const { row, card } of pairs) {
        let remaining = row.quantity;
        const owned = await db.all(`
          SELECT * FROM collection
          WHERE user_id = ? AND card_id = ? AND printing = ? AND list_type = 'collection'
            AND location_id IS NULL AND quantity > 0
          ORDER BY id
        `, [req.user.id, card.id, row.printing || 'Normal']);
        for (const entry of owned) {
          if (remaining <= 0) break;
          const copies = Math.min(remaining, entry.quantity);
          remaining -= copies;
          const originalUsed = copies === entry.quantity;
          if (originalUsed) {
            await db.run(`UPDATE collection SET quantity = 1 WHERE id = ?`, [entry.id]);
            entries.push(entry.id);
          } else {
            await db.run(`UPDATE collection SET quantity = quantity - ? WHERE id = ?`, [copies, entry.id]);
          }
          for (let copy = originalUsed ? 1 : 0; copy < copies; copy++) {
            const added = await db.run(`
              INSERT INTO collection (
                card_id, user_id, quantity, condition, printing, language, purchase_price,
                favorite, is_trade, list_type, game, added_at, notes, grader, grade,
                cert_number, market_value, market_value_source, market_value_at, missing
              ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              entry.card_id, entry.user_id, entry.condition, entry.printing, entry.language, entry.purchase_price,
              entry.favorite, entry.is_trade, entry.list_type, entry.game, entry.added_at, entry.notes, entry.grader,
              entry.grade, entry.cert_number, entry.market_value, entry.market_value_source, entry.market_value_at, entry.missing
            ]);
            entries.push(added.lastID);
          }
        }
      }

      count = entries.length;
      const location = await db.run(`
        INSERT INTO locations (name, type, sort_order, foil_sorting, rule_type, game, user_id)
        VALUES (?, 'Box', 'custom', 'normals_first', 'any', 'mtg', ?)
      `, [containerName, req.user.id]);
      locationId = location.lastID;
      const compartment = await db.run(
        `INSERT INTO compartments (location_id, idx, capacity) VALUES (?, 1, ?)`,
        [locationId, Math.max(1, count)]
      );

      for (let index = 0; index < entries.length; index++) {
        await db.run(
          `UPDATE collection SET location_id = ?, compartment_id = ?, position = ? WHERE id = ? AND user_id = ?`,
          [locationId, compartment.lastID, (index + 1) * 1000, entries[index], req.user.id]
        );
      }
    });

    const missing = requested - count;
    const skipped = missing ? ` ${missing} card${missing === 1 ? '' : 's'} not found in Unsorted.` : '';
    res.status(201).json({ id: locationId, count, missing, message: `Created ${containerName} with ${count} cards.${skipped}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import container' });
  }
});

module.exports = router;
