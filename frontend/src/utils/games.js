// Bindarr supports Magic: The Gathering only. Existing non-Magic records are
// retained in SQLite rather than destroyed, but the application no longer shows
// or creates them.
export const GAMES = [
  { value: 'mtg', label: 'Magic: The Gathering', short: 'MTG' },
];

export const enabledGames = () => ['mtg'];
export const isGameEnabled = (game) => String(game || '').toLowerCase() === 'mtg';
export const showGamePicker = () => false;
export const gameOptions = () => GAMES;
export const setGameEnabled = () => false;
export const defaultGame = () => 'mtg';
export const defaultGameFilter = () => 'mtg';
export const gameLabel = (_game, short = false) => short ? 'MTG' : 'Magic: The Gathering';
