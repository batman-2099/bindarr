import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) || null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

const {
  enabledGames, isGameEnabled, showGamePicker, gameOptions,
  setGameEnabled, defaultGame, defaultGameFilter, gameLabel,
} = await import('./games.js');

assert.deepStrictEqual(enabledGames(), ['mtg']);
assert.ok(isGameEnabled('mtg'));
assert.ok(!isGameEnabled('pokemon'));
assert.ok(!isGameEnabled('lorcana'));
assert.ok(!showGamePicker());
assert.deepStrictEqual(gameOptions().map(game => game.value), ['mtg']);
assert.strictEqual(defaultGame(), 'mtg');
assert.strictEqual(defaultGameFilter(), 'mtg');
assert.strictEqual(gameLabel('pokemon'), 'Magic: The Gathering');
assert.strictEqual(gameLabel('mtg', true), 'MTG');
assert.strictEqual(setGameEnabled('mtg', false), false);

console.log('Magic-only game configuration self-check passed');
