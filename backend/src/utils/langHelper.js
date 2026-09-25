const { translateLorcanaName, LORCANA_TRANSLATIONS } = require('./lorcanaHelper');
const { translatePokemonName } = require('./pokemonHelper');
const { toCode } = require('./languages');

const getCardDisplayName = (englishName, language, printedName, game) => {
  if (printedName) return printedName;
  if (!englishName) return '';
  const code = toCode(language);
  if (!code || code === 'en') return englishName;

  // Lorcana translation check
  if (game === 'lorcana' || englishName.includes(' - ') || (LORCANA_TRANSLATIONS.characters && LORCANA_TRANSLATIONS.characters[englishName])) {
    const translated = translateLorcanaName(englishName, language);
    if (translated !== englishName) return translated;
  }

  // Pokemon translation check
  const pkmTranslated = translatePokemonName(englishName, language);
  if (pkmTranslated && pkmTranslated !== englishName) return pkmTranslated;

  return englishName;
};

module.exports = {
  getCardDisplayName,
};
