// Ingredient-parsing vocabulary. Pure data, ported from the owner's MealPlannerPC Data/tokens.json
// (multiPhrases, brands, packagingTokens, descriptors, unitMap, approxUnitConversions, synonymMap) and extended.
//
// Deviations from the C# vocabulary (on purpose):
//  - canonical unit tokens are the short singular forms the diary uses: 'cup' (C#: "cups"), 'lb' (C#: "pounds"),
//    and '' for count/unitless (C#: "count"/"each"). 'fl oz' and several count units are added.
//  - unit keys are stored WITHOUT dots/trailing punctuation ("tbsp." -> "tbsp"); lookups strip dots first.

/** alias (lowercase, no dots) -> canonical unit token. '' means "a count / no unit". */
export const UNIT_MAP = {
  // volume
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tblsp: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  'fl oz': 'fl oz', floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz', 'fl ounce': 'fl oz', 'fl ounces': 'fl oz',
  pint: 'pt', pints: 'pt', pt: 'pt',
  quart: 'qt', quarts: 'qt', qt: 'qt',
  gallon: 'gal', gallons: 'gal', gal: 'gal',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  // weight
  gram: 'g', grams: 'g', g: 'g', gm: 'g', gms: 'g',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', kg: 'kg', kgs: 'kg',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  // plain counts
  each: '', ea: '', item: '', items: '', count: '', ct: '',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  // countable units
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package', pack: 'package', packs: 'package', packet: 'package', packets: 'package',
  bottle: 'bottle', bottles: 'bottle', jar: 'jar', jars: 'jar', bag: 'bag', bags: 'bag', box: 'box', boxes: 'box',
  container: 'container', containers: 'container',
  bunch: 'bunch', bunches: 'bunch', clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice',
  stick: 'stick', sticks: 'stick', sprig: 'sprig', sprigs: 'sprig', stalk: 'stalk', stalks: 'stalk', head: 'head', heads: 'head',
  dash: 'dash', dashes: 'dash', pinch: 'pinch', pinches: 'pinch', handful: 'handful', handfuls: 'handful',
  rack: 'rack', racks: 'rack',
};

/** C# approxUnitConversions: a rack is treated as 2 lb. */
export const APPROX_UNITS = { rack: { factor: 2, toUnit: 'lb' }, racks: { factor: 2, toUnit: 'lb' } };

/** Whole-name rewrites applied last (after normalising). */
export const SYNONYMS = {
  'kosher salt': 'salt', 'sea salt': 'salt', 'table salt': 'salt',
  molasse: 'molasses', molasses: 'molasses',
  'dry-roasted peanut': 'peanut', 'dry roasted peanut': 'peanut', 'dry roasted peanuts': 'peanut', 'dry-roasted peanuts': 'peanut',
  'prepared yellow mustard': 'yellow mustard', 'prepared pad thai sauce': 'pad thai sauce',
  'rice noodle': 'rice noodles', 'rice noodles': 'rice noodles', 'rice noodle stick': 'rice noodles',
  'baby back rib': 'baby back ribs', 'baby back ribs': 'baby back ribs',
  'ground mustard': 'mustard powder', 'mustard powder': 'mustard powder',
};

export const MULTI_PHRASES = [
  'thawed drained and squeezed dry', 'thawed, drained and squeezed dry', 'drained and squeezed dry', 'thawed drained', 'thawed and drained',
  'finely chopped', 'finely diced', 'finely minced', 'finely sliced',
];

export const BRANDS = ['goya', 'heinz', 'kraft', 'nestle', 'mccormick', 'knorr', 'del monte', 'ball'];

export const PACKAGING = [
  'package', 'packages', 'pkg', 'pkgs', 'pack', 'packs', 'can', 'cans', 'container', 'containers', 'bottle', 'bottles',
  'bag', 'bags', 'box', 'boxes', 'slice', 'slices', 'packet', 'packets',
];

/** The C# descriptor list, verbatim. The parser uses it split in two (see below). */
export const DESCRIPTORS = [
  'light', 'fresh', 'to taste', 'roughly', 'coarsely', 'thawed', 'drained', 'squeezed', 'squeezed dry', 'divided', 'freshly', 'trimmed',
  'quartered', 'chopped', 'diced', 'sliced', 'minced', 'peeled', 'grated', 'cold', 'hot', 'softened', 'room temperature',
  'dry', 'undrained', 'seeded', 'pitted', 'ripe', 'minved', 'finely',
];

/**
 * DESCRIPTORS the C# strips from the name but which change what the food IS ("light brown sugar", "hot sauce",
 * "dry white wine"). The JS parser KEEPS these in the name (deviation from the C#).
 */
export const IDENTITY_DESCRIPTORS = ['light', 'dry', 'hot', 'cold'];

/** Words that are pure noise: dropped from the name and not worth showing as a prep note. */
export const NOISE_WORDS = ['fresh', 'freshly', 'roughly', 'coarsely', 'ripe', 'minved', 'finely'];

/** Preparation words/phrases: removed from the name and moved to `prep` (C# descriptors + extras common in recipes). */
export const PREP_WORDS = [
  'to taste', 'room temperature', 'squeezed dry', 'squeezed', 'thawed', 'drained', 'undrained', 'divided', 'trimmed', 'quartered',
  'chopped', 'diced', 'sliced', 'minced', 'peeled', 'grated', 'softened', 'seeded', 'pitted',
  // extras (not in the C# list)
  'sifted', 'melted', 'beaten', 'rinsed', 'cubed', 'halved', 'shredded', 'packed', 'optional',
  'for garnish', 'for serving', 'to serve', 'for topping',
];

export const SIZE_WORDS = ['extra large', 'extra-large', 'jumbo', 'large', 'medium', 'small', 'mini'];

export const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export const UNICODE_FRACTIONS = {
  '¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅓': '1/3', '⅔': '2/3',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8',
  '⅝': '5/8', '⅞': '7/8',
};
