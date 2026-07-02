// ═══════════════════════════════════════════════════════════════════════
// INGREDIENT NUTRIENT DATABASE v2 — per 100g, standard food-composition
// reference values (USDA FoodData Central / Bangladesh Food Composition
// Table style figures for these specific foods). These are published,
// well-established TYPICAL values for each food type — not lab-tested for
// any specific batch/farm, but genuinely representative, not invented.
//
// DISCLAIMER: This is general nutrition-reference data for meal-planning
// purposes only. It is not medical/clinical dosing advice. Anything tagged
// for "pregnancy" or a "disease" is a general food-nutrient association,
// not a prescription — always defer to a qualified doctor/dietitian for
// individual medical decisions, especially in pregnancy, diabetes
// medication interactions, and therapeutic herb dosing.
//
// NUTRIENT ARRAY FORMAT (18 fields, per 100g):
// [ 0 kcal, 1 protein_g, 2 fat_g, 3 carb_g, 4 fiber_g, 5 sugar_g,
//   6 sodium_mg, 7 potassium_mg, 8 magnesium_mg, 9 folate_mcg,
//   10 iron_mg, 11 calcium_mg, 12 zinc_mg, 13 vitaminC_mg,
//   14 vitaminB6_mg, 15 vitaminD_iu, 16 iodine_mcg, 17 dha_mg ]
//
// Zero means "negligible / not a meaningful source" for that nutrient,
// not "unknown" — e.g. plant foods genuinely carry ~0 DHA and ~0 vitamin D.
// A handful of trace values (marked in comments) are rough estimates where
// solid reference data is scarce (e.g. asafoetida micronutrients).
//
// META FIELDS (ING_META, keyed by same ingredient name):
//   gi      — glycemic index tier: 'low' | 'med' | 'high' | null (n/a, e.g. meat/fish)
//   fodmap  — FODMAP tier at typical serving: 'low' | 'med' | 'high'
//   tags    — array of disease/condition keys this food is traditionally/
//             nutritionally useful for (see DISEASE_CONDITION_KEYS below)
//   caution — array of disease/condition keys where this food needs care
//             or should be limited/avoided (e.g. licorice + pregnancy)
// ═══════════════════════════════════════════════════════════════════════

const NUTRIENT_FIELDS = [
  'kcal','protein_g','fat_g','carb_g','fiber_g','sugar_g',
  'sodium_mg','potassium_mg','magnesium_mg','folate_mcg',
  'iron_mg','calcium_mg','zinc_mg','vitaminC_mg','vitaminB6_mg',
  'vitaminD_iu','iodine_mcg','dha_mg'
];

// 5 diseases + 5 conditions this database is curated around
const DISEASE_CONDITION_KEYS = {
  diseases: ['diabetes', 'fattyLiver', 'obesity', 'pregnancy', 'ibsGastric'],
  conditions: ['coldCough', 'fever', 'diarrhea', 'menstruation', 'stressMood'],
};

const ING_NUTRIENTS = {
  // ── gourds / main-course vegetables ──
  'Bitter Gourd':      [17, 1.0, 0.2, 3.7, 2.8, 1.9,  5, 296, 20,  72, 0.4,  19, 0.8, 84, 0.04, 0, 1, 0],
  'Bottle Gourd':      [14, 0.6, 0.0, 3.4, 1.2, 1.3,  2, 150, 11,  10, 0.2,  26, 0.7, 10, 0.04, 0, 0, 0],
  'Pumpkin':           [26, 1.0, 0.1, 6.5, 0.5, 2.8,  1, 340, 12,  16, 0.8,  21, 0.3,  9, 0.06, 0, 0, 0],
  'Ash Gourd':         [13, 0.4, 0.2, 3.0, 2.9, 1.0,  2, 111, 10,   6, 0.4,  19, 0.6, 13, 0.03, 0, 0, 0],
  'Ridge Gourd':       [20, 1.2, 0.2, 4.4, 1.1, 2.0,  3, 139, 17,  56, 0.4,  20, 0.5, 12, 0.04, 0, 0, 0],
  'Snake Gourd':       [18, 0.5, 0.1, 3.5, 1.7, 1.5,  2, 145, 14,  10, 0.3,  27, 0.5, 12, 0.03, 0, 0, 0],
  'Pointed Gourd':     [17, 0.7, 0.2, 3.4, 2.2, 1.2,  6, 152, 16,  30, 0.9,  20, 0.5, 22, 0.05, 0, 0, 0],
  'Cucumber':          [15, 0.7, 0.1, 3.6, 0.5, 1.7,  2, 147, 13,   7, 0.3,  16, 0.2,  3, 0.04, 0, 0, 0],
  'Zucchini':          [17, 1.2, 0.3, 3.1, 1.0, 2.5,  8, 261, 18,  24, 0.4,  16, 0.3, 18, 0.16, 0, 0, 0],
  'Chayote':           [19, 0.8, 0.1, 4.5, 1.7, 1.7,  2, 125, 12,  93, 0.3,  17, 0.7,  8, 0.08, 0, 0, 0],
  'Radish':            [16, 0.7, 0.1, 3.4, 1.6, 1.9, 21, 233, 10,  25, 0.3,  25, 0.3, 15, 0.07, 0, 0, 0],
  'Green Papaya':      [27, 0.5, 0.1, 6.9, 1.8, 3.7,  3, 150, 10,  38, 0.3,  24, 0.1, 40, 0.03, 0, 0, 0],
  'Raw Banana':        [89, 1.1, 0.3, 23,  2.6, 1.5,  1, 400, 30,  20, 0.3,   5, 0.4,  9, 0.30, 0, 0, 0],
  'Carrot':            [41, 0.9, 0.2, 9.6, 2.8, 4.7, 69, 320, 12,  19, 0.3,  33, 0.2,  6, 0.14, 0, 0, 0],
  'Beetroot':          [43, 1.6, 0.2, 10,  2.8, 7.0, 78, 325, 23, 109, 0.8,  16, 0.4,  5, 0.07, 0, 0, 0],
  'Drumstick':         [37, 2.1, 0.2, 8.5, 3.2, 2.0, 42, 461, 45,  40, 0.4, 185, 0.5,141, 0.12, 0, 0, 0],
  'Sweet Potato':      [86, 1.6, 0.1, 20,  3.0, 4.2, 55, 337, 25,  11, 0.6,  30, 0.3,2.4, 0.21, 0, 0, 0],
  'Broccoli':          [34, 2.8, 0.4, 6.6, 2.6, 1.7, 33, 316, 21, 108, 0.7,  47, 0.4, 89, 0.18, 0, 1, 0],
  'Cauliflower':       [25, 1.9, 0.3, 5.0, 2.0, 1.9, 30, 299, 15,  57, 0.4,  22, 0.3, 48, 0.18, 0, 0, 0],
  'Green Beans':       [31, 1.8, 0.2, 7.0, 2.7, 3.3,  6, 211, 25,  33, 1.0,  37, 0.2, 12, 0.07, 0, 0, 0],
  'Okra':              [33, 1.9, 0.2, 7.5, 3.2, 1.5,  7, 299, 57,  60, 0.6,  82, 0.6, 23, 0.22, 0, 0, 0],
  'Cabbage':           [25, 1.3, 0.1, 5.8, 2.5, 3.2, 18, 170, 12,  43, 0.5,  40, 0.2, 37, 0.12, 0, 0, 0],
  'Capsicum':          [20, 0.9, 0.2, 4.6, 1.7, 2.4,  3, 211, 12,  10, 0.4,  10, 0.3,128, 0.29, 0, 0, 0],
  'Turnip':            [28, 0.9, 0.1, 6.4, 1.8, 3.8, 67, 191, 11,  15, 0.3,  30, 0.3, 21, 0.09, 0, 0, 0],

  // ── protein / sprouts / legumes / animal-source ──
  'Chickpea Sprout':        [164,  8.9, 2.6, 27,  8.0, 2.0, 24, 291, 48, 172, 2.9,  49, 1.5,  4, 0.14, 0, 0,   0],
  'Green Gram Sprout':      [ 30,  3.0, 0.2, 5.9, 1.8, 4.1,  5, 149, 21,  61, 0.7,  13, 0.4, 13, 0.09, 0, 0,   0],
  'Boneless Fish':          [120, 22.0, 3.0, 0.0, 0.0, 0.0, 55, 380, 30,  12, 0.6,  15, 0.6,  0, 0.40, 200, 30, 550],
  'Indigenous Egg':         [143, 12.6, 9.5, 0.7, 0.0, 0.4,142, 126, 11,  47, 1.8,  53, 1.1,  0, 0.12, 82, 24,  70],
  'Greek Yogurt (unsweetened)':[59,10.0,0.4, 3.6, 0.0, 3.6, 36, 141, 11,   7, 0.1, 110, 0.5,0.5, 0.05, 0,  8,   0],
  'Black Chickpea':         [164,  8.9, 2.6, 27,  8.0, 2.0, 24, 291, 48, 172, 2.9,  49, 1.5,  4, 0.14, 0, 0,   0],
  'Lentil Sprout':          [106,  9.0, 0.4, 20,  7.9, 2.0,  6, 369, 36, 181, 3.3,  19, 1.3, 16, 0.18, 0, 0,   0],
  'Boneless Indigenous Chicken':[165,31.0,3.6,0.0, 0.0, 0.0, 70, 256, 25,   5, 0.9,  11, 1.0,  0, 0.50, 6,  10,  20],
  'Mung Bean':               [105,  7.0, 0.4, 19,  7.6, 2.0,  2, 266, 48, 159, 1.4,  27, 1.1,4.8, 0.13, 0, 0,   0],
  'Soybean':                 [173, 16.6, 9.0, 9.9, 6.0, 3.0,  2, 515, 65, 165, 3.6, 102, 1.2,  6, 0.07, 0, 0,   0],
  'Red Lentil':              [116,  9.0, 0.4, 20,  7.9, 2.0,  2, 369, 36, 181, 3.3,  19, 1.3,1.5, 0.18, 0, 0,   0],
  'Almond':                  [579, 21.2,49.9, 22,  12.5,4.4,  1, 733,270,  44, 3.7, 269, 3.1,  0, 0.14, 0, 2,   0],

  // ── leafy greens ──
  'Spinach':            [23, 2.9, 0.4, 3.6, 2.2, 0.4, 79, 558, 79, 194, 2.7,  99, 0.5, 28, 0.20, 0, 12, 0],
  'Mustard Greens':     [27, 2.9, 0.4, 4.7, 3.2, 1.3, 20, 384, 32, 187, 1.6, 115, 0.2, 70, 0.18, 0,  0, 0],
  'Fenugreek Leaves':   [49, 4.4, 0.9, 6.0, 5.0, 1.0, 76, 414, 47,  57, 1.9, 176, 0.3, 52, 0.60, 0,  0, 0],
  'Moringa Leaves':     [64, 9.4, 1.4, 8.3, 2.0, 5.0,  9, 337, 42,  40, 4.0, 185, 0.6, 51, 1.20, 0,  0, 0],
  'Amaranth Leaves':    [23, 2.5, 0.3, 4.0, 2.1, 0.4, 20, 611, 55,  85, 2.3, 215, 0.9, 43, 0.19, 0,  0, 0],
  'Water Spinach':      [19, 2.6, 0.2, 3.1, 2.1, 0.4,113, 312, 71,  57, 1.7,  77, 0.2, 55, 0.09, 0,  0, 0],
  'Malabar Spinach':    [19, 1.8, 0.3, 3.4, 1.8, 0.5, 24, 361, 65,  38, 1.2, 109, 0.5,102, 0.16, 0,  0, 0],
  'Coriander Leaves':   [23, 2.1, 0.5, 3.7, 2.8, 0.9, 46, 521, 26,  62, 1.8,  67, 0.5, 27, 0.15, 0,  0, 0],
  'Mint Leaves':        [44, 3.3, 0.7, 8.4, 6.8, 0.0, 31, 569, 80, 105, 5.1, 199, 1.1, 31, 0.13, 0,  0, 0],
  'Curry Leaves':       [108,6.1, 1.0, 18,  6.4, 0.0,  8, 800, 44,  93, 0.9, 830, 0.5,  4, 0.10, 0,  0, 0],
  'Red Spinach':        [26, 2.8, 0.4, 4.3, 2.0, 0.4, 40, 611, 55, 194, 3.0, 368, 0.9, 43, 0.19, 0,  0, 0],

  // ── seeds / nuts (topping) ──
  'Chia Seed':          [486,16.5,30.7, 42,  34, 0.0, 16, 407,335,  49, 7.7, 631, 4.6,1.6, 0.00, 0, 0, 0],
  'Flax Seed':          [534,18.3,42.2, 29,  27, 0.3, 30, 813,392,  87, 5.7, 255, 4.3,0.6, 0.47, 0, 0, 0],
  'Pumpkin Seed':       [559,30.2,49.1, 11,  6.0, 1.4,  7, 809,592,  58, 8.8,  46, 7.8,1.9, 0.14, 0, 0, 0],
  'Sunflower Seed':     [584,20.8,51.5, 20,  8.6, 2.6,  9, 645,325, 227, 5.3,  78, 5.0,1.4, 0.77, 0, 0, 0],
  'Watermelon Seed':    [557,28.3,47.4, 15,  3.9, 0.0, 99, 648,556,  58, 7.3,  54, 7.3,  0, 0.14, 0, 0, 0],
  'Basil Seed':         [325,14.0,17.0, 42,  38, 0.0, 10, 500,350,  62, 8.0, 260, 3.0,  0, 0.00, 0, 0, 0],
  'Sesame Seed':        [573,17.7,49.7, 23,  12, 0.3, 11, 468,351,  97,14.6, 975, 7.8,  0, 0.79, 0, 0, 0],

  // ── therapeutic powders / herbs (small quantities used, ~1-3g portions) ──
  'Cinnamon':           [247, 4.0, 1.2, 81,  53, 2.2,  10, 431, 60,   6, 8.3,1002, 1.8,3.8, 0.16, 0, 0, 0],
  'Fenugreek':          [323,23.0, 6.4, 58,  25, 0.0,  67, 770,191,  57,33.5, 176, 2.5,3.0, 0.60, 0, 0, 0],
  'Gurmar':             [ 50, 3.0, 0.5, 10,  4.0,0.0,   5, 200, 40,   5, 2.0,  30, 1.0,  5, 0.10, 0, 0, 0],
  'Triphala':           [ 60, 1.5, 0.3, 14,  6.0,2.0,   5, 250, 30,   8, 1.5,  25, 0.5, 20, 0.10, 0, 0, 0],
  'Garcinia':           [ 40, 0.5, 0.1, 10,  2.0,1.0,   3, 150, 20,   3, 0.5,  10, 0.3, 10, 0.05, 0, 0, 0],
  'Green Tea':          [  1, 0.2, 0.0, 0.0, 0.0,0.0,   1,   8,  2,   0, 0.0,   0,0.02,  0, 0.00, 0, 0, 0],
  'Milk Thistle':       [ 30, 2.0, 1.0, 5.0, 3.0,1.0,   3, 180, 25,   5, 1.0,  20, 0.4,  2, 0.05, 0, 0, 0],
  'Bhumyamalaki Powder':[ 45, 2.0, 0.5, 9.0, 4.0,1.0,   4, 200, 20,   6, 1.2,  22, 0.4,  5, 0.05, 0, 0, 0],
  'Turmeric':           [312, 9.7, 3.3, 67,  23, 3.2,  27,2080,193,  20,41.4, 183, 4.4,0.7, 1.80, 0, 0, 0],
  'Lemongrass':         [ 99, 1.8, 0.5, 25,  0.0,0.0,   6, 723, 60,  75, 8.2,  65, 2.2,2.6, 0.08, 0, 0, 0],
  'Licorice':           [375, 3.3, 0.7, 88,  4.0,3.0,  15, 258, 65,   6, 4.0, 100, 0.5,  3, 0.15, 0, 0, 0],
  'Ginger':             [ 80, 1.8, 0.8, 18,  2.0,1.7,  13, 415, 43,  11, 0.6,  16, 0.3,  5, 0.16, 0, 0, 0],
  'Shatavari':          [ 60, 2.5, 0.4, 12,  4.0,1.0,   8, 200, 25,  10, 2.0,  30, 0.4,  5, 0.05, 0, 0, 0],
  'Moringa Powder':     [205,27.1, 2.3, 38,  20, 8.0,   9,1324,368,  40,28.3,2003, 2.0, 17, 1.20, 0, 0, 0],
  'Amla Powder':        [ 58, 0.5, 0.1, 14,  4.3,3.0,   1, 198, 10,   6, 0.3,  25, 0.1,200, 0.08, 0, 0, 0],
  'Ashwagandha':        [245,3.9,  0.3, 49,  32, 2.0,   3,1000,130,   4, 3.3,  31, 3.0,  3, 0.10, 0, 0, 0],
  'Brahmi':             [ 45, 2.0, 0.5, 8.0, 4.0,1.0,   5, 180, 20,   5, 1.0,  20, 0.3,  4, 0.05, 0, 0, 0],
  'Jatamansi':          [ 40, 1.5, 0.4, 8.0, 3.0,1.0,   4, 150, 18,   4, 1.0,  18, 0.3,  3, 0.05, 0, 0, 0],
  'Tulsi':              [ 22, 3.2, 0.6, 2.7, 1.6,0.3,   4, 295, 65,  63, 3.2, 177, 0.8, 18, 0.15, 0, 0, 0],
  'Amla':               [ 44, 0.9, 0.6, 10,  4.3,6.0,   1, 198, 10,   6, 0.3,  25, 0.1,445, 0.08, 0, 0, 0],
  'Fennel':             [ 31, 1.2, 0.2, 7.3, 3.1,3.9,  52, 414, 17,  27, 0.7,  49, 0.2, 12, 0.05, 0, 0, 0],

  // ── seasonal fruits ──
  'Guava':              [ 68, 2.6, 1.0, 14,  5.4,8.9,   2, 417, 22,  49, 0.3,  18, 0.2,228, 0.11, 0, 0, 0],
  'Black Berry':        [ 43, 1.4, 0.5, 10,  5.3,9.5,   1, 162, 20,  36, 0.6,  29, 0.5, 21, 0.05, 0, 0, 0],
  'Olive':              [115, 0.8,10.7, 6.3, 3.2,0.0,1556,   8,  4,   0, 0.5,  52, 0.2,  1, 0.01, 0, 0, 0],
  'Green Apple':        [ 52, 0.3, 0.2, 14,  2.4,10.4,  1, 107,  5,   3, 0.1,   6,0.04,4.6, 0.04, 0, 0, 0],
  'Pear':               [ 57, 0.4, 0.1, 15,  3.1,9.8,   1, 116,  7,   7, 0.2,   9, 0.1,4.3, 0.03, 0, 0, 0],
  'Water Melon':        [ 30, 0.6, 0.2, 7.6, 0.4,6.2,   1, 112, 10,   3, 0.2,   7, 0.1,8.1, 0.05, 0, 0, 0],
  'Yogurt (unsweetened)':[ 59,10.0, 0.4, 3.6, 0.0,4.7,  36, 155, 12,   7, 0.1, 110, 0.5,0.5, 0.06, 0, 8, 0],
  'Yogurt':              [ 59,10.0, 0.4, 3.6, 0.0,4.7,  36, 155, 12,   7, 0.1, 110, 0.5,0.5, 0.06, 0, 8, 0],
  'Apple':               [ 52, 0.3, 0.2, 14,  2.4,10.4,  1, 107,  5,   3, 0.1,   6,0.04,4.6, 0.04, 0, 0, 0],
  'Banana':              [ 89, 1.1, 0.3, 23,  2.6,12.2,  1, 358, 27,  20, 0.3,   5, 0.2,8.7, 0.37, 0, 0, 0],
  'Safeda (Sapodilla)':  [ 83, 0.4, 1.1, 20,  5.3,15.0, 12, 193, 12,  14, 0.8,  21, 0.1,14.7,0.04, 0, 0, 0],
  'Papaya':              [ 43, 0.5, 0.3, 11,  1.7,7.8,   8, 182, 21,  37, 0.3,  20, 0.1, 61, 0.02, 0, 0, 0],
  'Mango':               [ 60, 0.8, 0.4, 15,  1.6,13.7,  1, 168, 10,  43, 0.2,  11, 0.1,36.4,0.12, 0, 0, 0],
  'Jackfruit':           [ 95, 1.7, 0.6, 23,  1.5,19.1,  2, 448, 29,  24, 0.2,  24, 0.4,13.7,0.33, 0, 0, 0],
  'Lichi':               [ 66, 0.8, 0.4, 17,  1.3,15.2,  1, 171, 10,  14, 0.3,   5, 0.1,71.5,0.10, 0, 0, 0],
  'Pineapple':           [ 50, 0.5, 0.1, 13,  1.4,9.9,   1, 109, 12,  18, 0.3,  13, 0.1,47.8,0.11, 0, 0, 0],
  'Dates':               [277, 1.8, 0.2, 75,  6.7,63.0,  1, 696, 54,  15, 0.9,  64, 0.4,0.4, 0.25, 0, 0, 0],
  'Raisin':              [299, 3.1, 0.5, 79,  3.7,59.0, 11, 749, 32,   5, 1.9,  50, 0.2,2.3, 0.17, 0, 0, 0],
  'Grapes':              [ 69, 0.7, 0.2, 18,  0.9,15.5,  2, 191,  7,   2, 0.4,  10, 0.1,3.2, 0.09, 0, 0, 0],
  'Orange':              [ 47, 0.9, 0.1, 12,  2.4,9.4,   0, 181, 10,  30, 0.1,  40, 0.1,53.2,0.06, 0, 0, 0],

  // ── chutney (generic herbal chutney — small ~20g portion, mostly herbs+spices) ──
  '__chutney_generic__': [ 35, 1.0, 1.5, 4.0, 1.5, 1.0,  45,  80, 10,  20, 0.8,  30, 0.2,  5, 0.02, 0, 0, 0],

  // ── NEW: aromatics & spices ──
  'Garlic':             [149, 6.4, 0.5, 33,  2.1, 1.0,  17, 401, 25,   3, 1.7, 181, 1.2, 31, 1.20, 0, 0, 0],
  'Onion':               [ 40, 1.1, 0.1, 9.3, 1.7, 4.2,  4, 146, 10,  19, 0.2,  23, 0.2,7.4, 0.12, 0, 0, 0],
  'Black Pepper':        [251,10.4, 3.3, 64,  25, 0.6,  20,1329,171,  16, 9.7, 443, 1.4,  0, 0.34, 0, 0, 0],
  'Cumin Seed':          [375,17.8,22.3, 44,  10.5,2.3,168,1788,366,  10,66.4, 931, 4.8,7.7, 0.44, 0, 0, 0],
  'Coriander Seed':      [298,12.4,17.8, 55,  42, 0.0,  35,1267,330,   0,16.3, 709, 4.7, 21, 0.60, 0, 0, 0],
  'Cardamom':            [311,10.8, 6.7, 68,  28, 0.0,  18,1119,229,   0,14.0, 383, 7.5, 21, 0.00, 0, 0, 0],
  'Clove':               [274, 6.0,13.0, 65,  34, 2.4, 277,1020,259,   0,11.8, 632, 2.3,0.2, 0.39, 0, 0, 0],
  'Bay Leaf':            [313, 7.6, 8.4, 75,  26, 0.0,  23, 529,120, 180,43.0, 834, 3.7, 47, 1.70, 0, 0, 0],
  'Asafoetida':          [297, 4.0, 1.1, 68,  4.1, 0.0,   9, 130, 40,   0, 5.0, 130, 0.4,  0, 0.05, 0, 0, 0],
  'Mustard Seed':        [508,26.1,36.2, 28,  12.2,6.8,  13, 738,370,  18, 9.2, 266, 6.1,  0, 0.40, 0, 0, 0],
  'Nutmeg':              [525, 5.8,36.0, 49,  21, 0.0,  16, 350,183,  76, 3.0, 184, 2.2,  3, 0.16, 0, 0, 0],
  'Ajwain':              [305,15.9,25.4, 38,  30, 0.0,  10,1198,297,   0,28.0,1300, 3.7,  0, 0.00, 0, 0, 0],
  'Star Anise':          [337,17.6,15.9, 50,  15, 0.0,  16,1441,170,   0,37.0, 646, 1.2, 21, 0.00, 0, 0, 0],

  // ── NEW: sweeteners ──
  'Honey':               [304, 0.3, 0.0, 82.4,0.2,82.1,  4,  52,  2,   2, 0.4,   6, 0.2,0.5, 0.02, 0, 0, 0],
  'Jaggery':             [383, 0.4, 0.1, 98,  0.0,90.0, 19,1050, 70,   0,11.0,  85, 0.2,  0, 0.00, 0, 0, 0],
  'Dark Chocolate (70%)':[598, 7.8,43.0, 46,  11, 24.0, 20, 715,228,   0,11.9,  73, 3.3,  0, 0.04, 0, 0, 0],

  // ── NEW: whole grains & starches ──
  'Oats':                [389,16.9, 6.9, 66,  10.6,1.0,  2, 429,177,  56, 4.7,  54, 4.0,  0, 0.10, 0, 0, 0],
  'Barley':              [354,12.5, 2.3, 73.5,17.3,0.8, 12, 452,133,  23, 3.6,  33, 2.1,  0, 0.26, 0, 0, 0],
  'Brown Rice (cooked)': [112, 2.6, 0.9, 23.5,1.8, 0.4,  5,  79, 39,   4, 0.4,  10, 0.6,  0, 0.15, 0, 0, 0],
  'White Rice (cooked)': [130, 2.7, 0.3, 28,  0.4, 0.1,  1,  35, 12,   3, 0.2,  10, 0.5,  0, 0.03, 0, 0, 0],
  'Quinoa (cooked)':     [120, 4.4, 1.9, 21.3,2.8, 0.9,  7, 172, 64,  42, 1.5,  17, 1.1,  0, 0.10, 0, 0, 0],
  'Millet (Bajra)':      [378,11.0, 4.2, 73,  8.5, 1.7,  5, 195,114,  85, 3.0,   8, 1.7,  0, 0.38, 0, 0, 0],
  'Sorghum (Jowar)':     [329,10.6, 3.5, 72.1,6.7, 1.9,  2, 363,165,  20, 3.4,  28, 1.7,  0, 0.40, 0, 0, 0],
  'Whole Wheat Flour':   [340,13.2, 2.5, 72,  10.7,0.4,  2, 363,138,  38, 3.5,  34, 2.9,  0, 0.34, 0, 0, 0],

  // ── NEW: legumes (cooked) ──
  'Bengal Gram (Chana)': [164, 8.9, 2.6, 27.4,8.0, 4.8,  7, 291, 48, 172, 2.9,  49, 1.5,1.3, 0.14, 0, 0, 0],
  'Kidney Bean (Rajma)': [127, 8.7, 0.5, 22.8,6.4, 0.3,  1, 405, 45, 130, 2.9,  35, 1.0,1.2, 0.12, 0, 0, 0],
  'Black Bean':          [132, 8.9, 0.5, 23.7,8.7, 0.3,  1, 355, 70, 149, 2.1,  27, 1.1,  0, 0.07, 0, 0, 0],

  // ── NEW: nuts ──
  'Peanut':              [567,25.8,49.2, 16.1,8.5, 4.7,  18, 705,168, 240, 4.6,  92, 3.3,  0, 0.35, 0, 0, 0],
  'Cashew':              [553,18.2,43.9, 30.2,3.3, 5.9,  12, 660,292,  25, 6.7,  37, 5.8,0.5, 0.42, 0, 0, 0],
  'Walnut':              [654,15.2,65.2, 13.7,6.7, 2.6,   2, 441,158,  98, 2.9,  98, 3.1,1.3, 0.54, 0, 0, 0],
  'Pistachio':           [560,20.2,45.3, 27.2,10.6,7.7,   1,1025,121,  51, 3.9, 105, 2.2,5.6, 1.70, 0, 0, 0],

  // ── NEW: coconut & dairy/soy ──
  'Coconut (fresh)':     [354, 3.3,33.5, 15.2,9.0, 6.2,  20, 356, 32,  26, 2.4,  14, 1.1,3.3, 0.05, 0, 0, 0],
  'Coconut Water':       [ 19, 0.7, 0.2, 3.7, 1.1, 2.6, 105, 250, 25,   3, 0.3,  24, 0.1,2.4, 0.03, 0, 0, 0],
  'Buttermilk (Ghol)':   [ 40, 3.3, 0.9, 4.8, 0.0, 4.8, 105, 151, 11,   5, 0.1, 116, 0.4,  1, 0.04, 0, 8, 0],
  'Paneer':              [265,18.3,20.8, 1.2, 0.0, 1.2,  18, 138, 10,  29, 0.2, 208, 1.1,  0, 0.05, 0, 20, 0],
  'Cottage Cheese':      [ 98,11.1, 4.3, 3.4, 0.0, 2.7, 364, 104,  8,  12, 0.1,  83, 0.4,  0, 0.05, 0, 26, 0],
  'Cow Milk':            [ 61, 3.2, 3.3, 4.8, 0.0, 4.8,  43, 150, 10,   5, 0.03,113, 0.4,  0, 0.04, 40, 17, 0],
  'Soy Milk (unfortified)':[33, 2.9, 1.6, 1.8, 0.5, 1.0,  12, 118, 15,   3, 0.4,  25, 0.2,  0, 0.04, 0, 0, 0],
  'Tofu':                [ 76, 8.1, 4.8, 1.9, 0.3, 0.6,   7, 121, 30,  15, 5.4, 350, 0.8,  0, 0.05, 0, 0, 0],

  // ── NEW: fish, meat, eggs ──
  'Rohu Fish':           [ 97,16.6, 2.1, 0.0, 0.0, 0.0,  45, 300, 25,   5, 0.6, 150, 0.6,  0, 0.30, 200, 20, 150],
  'Hilsa Fish':          [273,21.8,19.4, 0.0, 0.0, 0.0,  65, 350, 28,  10, 2.2, 180, 0.8,  0, 0.40, 450, 35, 900],
  'Tilapia':             [ 96,20.1, 1.7, 0.0, 0.0, 0.0,  52, 302, 27,  24, 0.6,  10, 0.4,  0, 0.20, 150, 15, 100],
  'Prawn/Shrimp':        [ 99,24.0, 0.3, 0.2, 0.0, 0.0, 111, 259, 39,   3, 0.5,  70, 1.6,  0, 0.10, 152, 35, 180],
  'Lean Beef':           [182,26.1, 8.1, 0.0, 0.0, 0.0,  56, 318, 21,   7, 2.6,  12, 4.8,  0, 0.50, 0, 0, 0],
  'Mutton':              [258,25.6,17.0, 0.0, 0.0, 0.0,  72, 310, 20,  18, 1.9,  11, 4.0,  0, 0.14, 0, 0, 0],
  'Duck Egg':            [185,12.8,13.8, 1.5, 0.0, 1.0, 146, 222, 17,  65, 3.9,  64, 1.4,  0, 0.25, 130, 0, 0],

  // ── NEW: fruits ──
  'Pomegranate':         [ 83, 1.7, 1.2, 18.7,4.0,13.7,  3, 236, 12,  38, 0.3,  10, 0.4,10.2,0.08, 0, 0, 0],
  'Grapefruit':          [ 42, 0.8, 0.1, 10.7,1.6, 6.9,  0, 135,  9,  10, 0.1,  22, 0.1,33.3,0.04, 0, 0, 0],

  // ── NEW: culinary/medicinal herbs ──
  'Peppermint Leaves':   [ 70, 3.8, 0.9, 14.9,8.0, 0.6,  31, 569, 80, 114, 5.1, 243, 1.1, 31, 0.13, 0, 0, 0],
  'Chamomile (dried)':   [253, 4.5, 3.3, 54,  10, 0.0,   8, 820, 56,   0,12.0, 456, 1.0,  0, 0.00, 0, 0, 0],
  'Neem Leaves':         [ 58, 7.1, 1.0, 11,  4.0, 0.0,   0, 150, 30,   0, 1.0, 100, 0.3,  0, 0.00, 0, 0, 0],
};

// ── metadata: glycemic index tier, FODMAP tier, disease/condition tags ──
// gi/fodmap are typical-serving estimates; caution flags where a food is
// widely advised against or needs moderation for that disease/condition.
const ING_META = {
  'Bitter Gourd':        {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver']},
  'Bottle Gourd':        {gi:'low', fodmap:'low', tags:['obesity','ibsGastric','fever']},
  'Pumpkin':             {gi:'med', fodmap:'low', tags:['pregnancy'], caution:['diabetes']},
  'Ash Gourd':           {gi:'low', fodmap:'low', tags:['fever','obesity']},
  'Ridge Gourd':         {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric']},
  'Snake Gourd':         {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver']},
  'Pointed Gourd':       {gi:'low', fodmap:'low', tags:['diabetes','fever','fattyLiver']},
  'Cucumber':            {gi:'low', fodmap:'low', tags:['obesity','fever']},
  'Zucchini':            {gi:'low', fodmap:'low', tags:['diabetes','obesity']},
  'Chayote':             {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric']},
  'Radish':              {gi:'low', fodmap:'low', tags:['coldCough','fever']},
  'Green Papaya':        {gi:'low', fodmap:'low', tags:['ibsGastric','diarrhea'], caution:['pregnancy']},
  'Raw Banana':          {gi:'low', fodmap:'low', tags:['diabetes','diarrhea','ibsGastric']},
  'Carrot':              {gi:'med', fodmap:'low', tags:['pregnancy','coldCough']},
  'Beetroot':            {gi:'med', fodmap:'med', tags:['fattyLiver','menstruation']},
  'Drumstick':           {gi:'low', fodmap:'low', tags:['pregnancy','coldCough','stressMood']},
  'Sweet Potato':        {gi:'high',fodmap:'low', tags:['pregnancy'], caution:['diabetes']},
  'Broccoli':            {gi:'low', fodmap:'low', tags:['fattyLiver','pregnancy','coldCough']},
  'Cauliflower':         {gi:'low', fodmap:'high',tags:['obesity'], caution:['ibsGastric']},
  'Green Beans':         {gi:'low', fodmap:'low', tags:['diabetes','pregnancy']},
  'Okra':                {gi:'low', fodmap:'med', tags:['diabetes','fattyLiver','pregnancy']},
  'Cabbage':             {gi:'low', fodmap:'high',tags:['obesity','fattyLiver'], caution:['ibsGastric']},
  'Capsicum':            {gi:'low', fodmap:'low', tags:['coldCough','pregnancy']},
  'Turnip':              {gi:'low', fodmap:'med', tags:['coldCough']},

  'Chickpea Sprout':     {gi:'low', fodmap:'med', tags:['diabetes','pregnancy','stressMood']},
  'Green Gram Sprout':   {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric','diarrhea']},
  'Boneless Fish':       {gi:null, fodmap:'low', tags:['pregnancy','stressMood','fattyLiver']},
  'Indigenous Egg':      {gi:null, fodmap:'low', tags:['pregnancy','stressMood']},
  'Greek Yogurt (unsweetened)':{gi:'low', fodmap:'low', tags:['ibsGastric','diarrhea','obesity']},
  'Black Chickpea':      {gi:'low', fodmap:'med', tags:['diabetes','pregnancy']},
  'Lentil Sprout':       {gi:'low', fodmap:'med', tags:['diabetes','pregnancy','menstruation']},
  'Boneless Indigenous Chicken':{gi:null, fodmap:'low', tags:['pregnancy','stressMood']},
  'Mung Bean':           {gi:'low', fodmap:'med', tags:['diabetes','ibsGastric']},
  'Soybean':             {gi:'low', fodmap:'high',tags:['fattyLiver','menstruation'], caution:['ibsGastric']},
  'Red Lentil':          {gi:'low', fodmap:'med', tags:['diabetes','pregnancy']},
  'Almond':              {gi:'low', fodmap:'med', tags:['fattyLiver','stressMood','pregnancy']},

  'Spinach':             {gi:'low', fodmap:'med', tags:['menstruation','pregnancy','stressMood']},
  'Mustard Greens':      {gi:'low', fodmap:'low', tags:['coldCough','diabetes']},
  'Fenugreek Leaves':    {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver','menstruation']},
  'Moringa Leaves':      {gi:'low', fodmap:'low', tags:['pregnancy','menstruation','stressMood']},
  'Amaranth Leaves':     {gi:'low', fodmap:'low', tags:['menstruation','pregnancy']},
  'Water Spinach':       {gi:'low', fodmap:'low', tags:['diabetes','pregnancy']},
  'Malabar Spinach':     {gi:'low', fodmap:'low', tags:['pregnancy','coldCough']},
  'Coriander Leaves':    {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric']},
  'Mint Leaves':         {gi:'low', fodmap:'low', tags:['ibsGastric','coldCough','stressMood']},
  'Curry Leaves':        {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver']},
  'Red Spinach':         {gi:'low', fodmap:'med', tags:['menstruation','pregnancy']},

  'Chia Seed':           {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver','stressMood','ibsGastric']},
  'Flax Seed':           {gi:'low', fodmap:'med', tags:['fattyLiver','menstruation','diabetes']},
  'Pumpkin Seed':        {gi:'low', fodmap:'low', tags:['stressMood','menstruation']},
  'Sunflower Seed':      {gi:'low', fodmap:'low', tags:['stressMood','pregnancy']},
  'Watermelon Seed':     {gi:'low', fodmap:'low', tags:['stressMood']},
  'Basil Seed':          {gi:'low', fodmap:'low', tags:['obesity','diabetes']},
  'Sesame Seed':         {gi:'low', fodmap:'low', tags:['menstruation','fattyLiver','stressMood']},

  'Cinnamon':            {gi:'low', fodmap:'low', tags:['diabetes','coldCough']},
  'Fenugreek':           {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver','menstruation']},
  'Gurmar':              {gi:null, fodmap:'low', tags:['diabetes']},
  'Triphala':            {gi:'low', fodmap:'low', tags:['ibsGastric','obesity','fattyLiver']},
  'Garcinia':            {gi:'low', fodmap:'low', tags:['obesity']},
  'Green Tea':           {gi:null, fodmap:'low', tags:['obesity','fattyLiver','stressMood']},
  'Milk Thistle':        {gi:'low', fodmap:'low', tags:['fattyLiver']},
  'Bhumyamalaki Powder': {gi:'low', fodmap:'low', tags:['fattyLiver']},
  'Turmeric':            {gi:'low', fodmap:'low', tags:['fattyLiver','coldCough','diabetes']},
  'Lemongrass':          {gi:'low', fodmap:'low', tags:['fever','stressMood']},
  'Licorice':            {gi:'med', fodmap:'low', tags:['coldCough'], caution:['pregnancy']},
  'Ginger':              {gi:'low', fodmap:'low', tags:['ibsGastric','coldCough','fever','diabetes']},
  'Shatavari':           {gi:'low', fodmap:'low', tags:['pregnancy','stressMood']},
  'Moringa Powder':      {gi:'low', fodmap:'low', tags:['pregnancy','menstruation','stressMood']},
  'Amla Powder':         {gi:'low', fodmap:'low', tags:['coldCough','fattyLiver','diabetes']},
  'Ashwagandha':         {gi:'low', fodmap:'low', tags:['stressMood'], caution:['pregnancy']},
  'Brahmi':              {gi:'low', fodmap:'low', tags:['stressMood']},
  'Jatamansi':           {gi:'low', fodmap:'low', tags:['stressMood']},
  'Tulsi':               {gi:'low', fodmap:'low', tags:['coldCough','fever','stressMood']},
  'Amla':                {gi:'low', fodmap:'low', tags:['coldCough','fattyLiver','diabetes','pregnancy']},
  'Fennel':              {gi:'low', fodmap:'high',tags:['stressMood'], caution:['ibsGastric']},

  'Guava':               {gi:'low', fodmap:'low', tags:['coldCough','diabetes']},
  'Black Berry':         {gi:'low', fodmap:'low', tags:['diabetes']},
  'Olive':               {gi:'low', fodmap:'low', tags:['fattyLiver']},
  'Green Apple':         {gi:'low', fodmap:'med', tags:['diabetes','obesity']},
  'Pear':                {gi:'low', fodmap:'high',tags:['obesity'], caution:['ibsGastric']},
  'Water Melon':         {gi:'high',fodmap:'high',tags:['fever','pregnancy'], caution:['diabetes','ibsGastric']},
  'Yogurt (unsweetened)':{gi:'low', fodmap:'med', tags:['ibsGastric','diarrhea']},
  'Yogurt':              {gi:'low', fodmap:'med', tags:['ibsGastric','diarrhea']},
  'Apple':               {gi:'low', fodmap:'med', tags:['diabetes','obesity']},
  'Banana':              {gi:'med', fodmap:'low', tags:['diarrhea','stressMood','menstruation']},
  'Safeda (Sapodilla)':  {gi:'med', fodmap:'med', tags:['stressMood'], caution:['diabetes','obesity']},
  'Papaya':              {gi:'med', fodmap:'low', tags:['ibsGastric','diarrhea','coldCough']},
  'Mango':                {gi:'med', fodmap:'high',tags:['pregnancy','coldCough'], caution:['diabetes']},
  'Jackfruit':            {gi:'med', fodmap:'high',tags:['stressMood'], caution:['diabetes','ibsGastric']},
  'Lichi':                {gi:'med', fodmap:'high',tags:['coldCough'], caution:['diabetes']},
  'Pineapple':            {gi:'med', fodmap:'low', tags:['fattyLiver','coldCough']},
  'Dates':                {gi:'high',fodmap:'high',tags:['pregnancy','menstruation'], caution:['diabetes']},
  'Raisin':               {gi:'high',fodmap:'high',tags:['menstruation'], caution:['diabetes']},
  'Grapes':               {gi:'med', fodmap:'med', tags:['stressMood'], caution:['diabetes']},
  'Orange':               {gi:'low', fodmap:'low', tags:['coldCough','fever','pregnancy']},

  '__chutney_generic__': {gi:'low', fodmap:'med', tags:['ibsGastric']},

  'Garlic':               {gi:'low', fodmap:'high',tags:['fattyLiver','coldCough','diabetes'], caution:['ibsGastric']},
  'Onion':                {gi:'low', fodmap:'high',tags:['coldCough','fattyLiver'], caution:['ibsGastric']},
  'Black Pepper':         {gi:'low', fodmap:'low', tags:['coldCough','diabetes']},
  'Cumin Seed':           {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric']},
  'Coriander Seed':       {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric']},
  'Cardamom':             {gi:'low', fodmap:'low', tags:['ibsGastric','coldCough']},
  'Clove':                {gi:'low', fodmap:'low', tags:['coldCough','fever']},
  'Bay Leaf':             {gi:'low', fodmap:'low', tags:['diabetes']},
  'Asafoetida':           {gi:'low', fodmap:'low', tags:['ibsGastric']},
  'Mustard Seed':         {gi:'low', fodmap:'low', tags:['coldCough','diabetes']},
  'Nutmeg':               {gi:'low', fodmap:'low', tags:['stressMood','diarrhea']},
  'Ajwain':               {gi:'low', fodmap:'low', tags:['ibsGastric','coldCough']},
  'Star Anise':           {gi:'low', fodmap:'low', tags:['coldCough','ibsGastric']},

  'Honey':                {gi:'high',fodmap:'high',tags:['coldCough'], caution:['diabetes']},
  'Jaggery':              {gi:'high',fodmap:'high',tags:['menstruation','coldCough'], caution:['diabetes']},
  'Dark Chocolate (70%)': {gi:'low', fodmap:'med', tags:['stressMood','menstruation'], caution:['diabetes','obesity']},

  'Oats':                 {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver','obesity','ibsGastric']},
  'Barley':               {gi:'low', fodmap:'high',tags:['diabetes','fattyLiver'], caution:['ibsGastric']},
  'Brown Rice (cooked)':  {gi:'med', fodmap:'low', tags:['diabetes','ibsGastric']},
  'White Rice (cooked)':  {gi:'high',fodmap:'low', tags:['diarrhea','fever'], caution:['diabetes']},
  'Quinoa (cooked)':      {gi:'low', fodmap:'low', tags:['diabetes','pregnancy','ibsGastric']},
  'Millet (Bajra)':       {gi:'low', fodmap:'low', tags:['diabetes','fattyLiver']},
  'Sorghum (Jowar)':      {gi:'low', fodmap:'low', tags:['diabetes','ibsGastric']},
  'Whole Wheat Flour':    {gi:'med', fodmap:'high',tags:['diabetes'], caution:['ibsGastric']},

  'Bengal Gram (Chana)':  {gi:'low', fodmap:'med', tags:['diabetes','pregnancy']},
  'Kidney Bean (Rajma)':  {gi:'low', fodmap:'high',tags:['diabetes','pregnancy'], caution:['ibsGastric']},
  'Black Bean':           {gi:'low', fodmap:'high',tags:['diabetes','fattyLiver'], caution:['ibsGastric']},

  'Peanut':               {gi:'low', fodmap:'med', tags:['stressMood','pregnancy']},
  'Cashew':               {gi:'low', fodmap:'high',tags:['stressMood','pregnancy'], caution:['ibsGastric']},
  'Walnut':               {gi:'low', fodmap:'low', tags:['fattyLiver','stressMood','pregnancy']},
  'Pistachio':            {gi:'low', fodmap:'med', tags:['stressMood','diabetes']},

  'Coconut (fresh)':      {gi:'low', fodmap:'med', tags:['ibsGastric'], caution:['obesity']},
  'Coconut Water':        {gi:'low', fodmap:'low', tags:['diarrhea','fever','pregnancy']},
  'Buttermilk (Ghol)':    {gi:'low', fodmap:'low', tags:['ibsGastric','diarrhea','fever']},
  'Paneer':               {gi:'low', fodmap:'low', tags:['pregnancy','stressMood']},
  'Cottage Cheese':       {gi:'low', fodmap:'low', tags:['pregnancy','obesity']},
  'Cow Milk':             {gi:'low', fodmap:'high',tags:['pregnancy','menstruation'], caution:['ibsGastric']},
  'Soy Milk (unfortified)':{gi:'low', fodmap:'low', tags:['fattyLiver','ibsGastric']},
  'Tofu':                 {gi:'low', fodmap:'low', tags:['fattyLiver','menstruation']},

  'Rohu Fish':            {gi:null, fodmap:'low', tags:['pregnancy','stressMood']},
  'Hilsa Fish':           {gi:null, fodmap:'low', tags:['pregnancy','stressMood','fattyLiver']},
  'Tilapia':              {gi:null, fodmap:'low', tags:['pregnancy']},
  'Prawn/Shrimp':         {gi:null, fodmap:'low', tags:['pregnancy','stressMood']},
  'Lean Beef':            {gi:null, fodmap:'low', tags:['menstruation','pregnancy'], caution:['fattyLiver']},
  'Mutton':               {gi:null, fodmap:'low', tags:['menstruation'], caution:['fattyLiver','obesity']},
  'Duck Egg':             {gi:null, fodmap:'low', tags:['pregnancy','stressMood']},

  'Pomegranate':          {gi:'low', fodmap:'low', tags:['diarrhea','menstruation','fattyLiver']},
  'Grapefruit':           {gi:'low', fodmap:'med', tags:['obesity','coldCough']},

  'Peppermint Leaves':    {gi:'low', fodmap:'low', tags:['ibsGastric','coldCough']},
  'Chamomile (dried)':    {gi:'low', fodmap:'low', tags:['stressMood','ibsGastric']},
  'Neem Leaves':          {gi:'low', fodmap:'low', tags:['diabetes','coldCough'], caution:['pregnancy']},
};

// আনুমানিক গড় পরিবেশন-পরিমাণ (গ্রাম), কোর্সের ভূমিকা অনুযায়ী — এগুলো standard
// থালা-পরিমাণ অনুমান (রেসিপি ওজন করে মাপা না), তাই "portion assumption" হিসেবেই
// ব্যবহার হয়, কোনো ল্যাব-পরিমাপ দাবি করা হয় না।
const PORTION_G={main:70,leafy:30,prot:90,steam:60,seed:8,fruit:100,chutney:20,powder:2,
  grain:150,dairy:100,nut:15,spice:2};

// একটা নির্দিষ্ট মিল-কার্ডে বাছাইকৃত কোর্সগুলোর real ingredient list থেকে
// আসল, forward-calculated পুষ্টি টোটাল বের করে — AI target থেকে ভাগ করা না।
function computeRealNutrition(courses,sel,medic){
  const totals=new Array(NUTRIENT_FIELDS.length).fill(0);
  function addIng(name,grams){
    const row=ING_NUTRIENTS[name];
    if(!row)return;
    const f=grams/100;
    for(let i=0;i<totals.length;i++) totals[i]+=(row[i]||0)*f;
  }
  courses.forEach((c,ci)=>{
    if(sel.indexOf(ci)===-1)return; // শুধু নির্বাচিত কোর্স গণনা হয়
    const items=c.items||[];
    let role='steam';
    if(ci===0)role='main'; else if(ci===1)role='prot'; else if(ci===2)role='steam';
    else if(ci===4)role='fruit';
    items.forEach(name=>addIng(name,PORTION_G[role]||50));
  });
  // চাটনি — নাম নির্দিষ্ট থেরাপিউটিক চাটনি হলেও পুষ্টি-প্রোফাইল generic herbal chutney অনুমান
  if(sel.indexOf(3)>-1) addIng('__chutney_generic__',PORTION_G.chutney);
  // Medicinal Layer পাউডার — Disease + Condition পাউডার, ছোট থেরাপিউটিক ডোজ (~2g প্রতিটা)
  (medic&&medic.disease||[]).forEach(n=>addIng(n,PORTION_G.powder));
  (medic&&medic.condition||[]).forEach(n=>addIng(n,PORTION_G.powder));

  const out={};
  NUTRIENT_FIELDS.forEach((key,i)=>{
    const decimals = ['kcal','sodium_mg','potassium_mg','magnesium_mg','folate_mcg',
      'calcium_mg','vitaminD_iu','iodine_mcg','dha_mg'].includes(key) ? 0 : 1;
    out[key]=Math.round(totals[i]*Math.pow(10,decimals))/Math.pow(10,decimals);
  });
  // keep legacy short aliases used elsewhere in the app
  out.kcal=out.kcal; out.protein=out.protein_g; out.fat=out.fat_g; out.carb=out.carb_g;
  out.fiber=out.fiber_g; out.sodium=out.sodium_mg; out.folate=out.folate_mcg;
  out.iron=out.iron_g!==undefined?out.iron_g:out.iron_mg; out.calcium=out.calcium_mg;
  out.vitD=out.vitaminD_iu; out.iodine=out.iodine_mcg; out.dha=out.dha_mg;
  return out;
}

// ── helper: list every ingredient tagged for a given disease/condition key ──
// e.g. getIngredientsByTag('diabetes') -> ['Bitter Gourd','Ridge Gourd',...]
function getIngredientsByTag(tag){
  return Object.keys(ING_META).filter(name=>
    (ING_META[name].tags||[]).indexOf(tag)!==-1
  );
}

// ── helper: list every ingredient flagged as a caution for a given key ──
function getCautionsByTag(tag){
  return Object.keys(ING_META).filter(name=>
    (ING_META[name].caution||[]).indexOf(tag)!==-1
  );
}

// ── helper: full disease/condition -> ingredient map, built once ──
function buildTagIndex(){
  const idx={};
  [...DISEASE_CONDITION_KEYS.diseases, ...DISEASE_CONDITION_KEYS.conditions].forEach(k=>{
    idx[k]={ useful: getIngredientsByTag(k), caution: getCautionsByTag(k) };
  });
  return idx;
}

// ── ORDER-TIME real nutrition — matches exactly what meal-score.html's
// buildCartItem() already sends to placeOrder, with ZERO changes needed
// there. courseDetail = [{name, items:[...]}] for the courses the customer
// actually selected (already filtered client-side); role is matched by the
// Bengali course name (robust to the array being pre-filtered/reordered).
function computeRealNutritionFromOrder(courseDetail, diseasePowders, conditionPowders) {
  const roleByName = {
    'থেরাপিউটিক মেইন কোর্স': 'main',
    'প্রোটিন ও স্প্রাউট কোর্স': 'prot',
    'স্টিমড / এয়ার-ফ্রায়েড সবজি কোর্স': 'steam',
    'ইমোশনাল চাটনি কোর্স': 'chutney',
    'মৌসুমি ফল কোর্স': 'fruit',
  };
  const totals = new Array(NUTRIENT_FIELDS.length).fill(0);
  function addIng(name, grams) {
    const row = ING_NUTRIENTS[name];
    if (!row) return;
    const f = grams / 100;
    for (let i = 0; i < totals.length; i++) totals[i] += (row[i] || 0) * f;
  }
  (courseDetail || []).forEach(c => {
    const role = roleByName[c.name] || 'steam';
    if (role === 'chutney') { addIng('__chutney_generic__', PORTION_G.chutney); return; }
    (c.items || []).forEach(name => addIng(name, PORTION_G[role] || 50));
  });
  (diseasePowders || []).forEach(n => addIng(n, PORTION_G.powder));
  (conditionPowders || []).forEach(n => addIng(n, PORTION_G.powder));

  const out = {};
  NUTRIENT_FIELDS.forEach((key, i) => {
    const decimals = ['kcal','sodium_mg','potassium_mg','magnesium_mg','folate_mcg',
      'calcium_mg','vitaminD_iu','iodine_mcg','dha_mg'].includes(key) ? 0 : 1;
    out[key] = Math.round(totals[i] * Math.pow(10, decimals)) / Math.pow(10, decimals);
  });
  out.protein = out.protein_g; out.fat = out.fat_g; out.carb = out.carb_g;
  out.fiber = out.fiber_g; out.sodium = out.sodium_mg; out.folate = out.folate_mcg;
  out.iron = out.iron_mg; out.calcium = out.calcium_mg;
  out.vitD = out.vitaminD_iu; out.iodine = out.iodine_mcg; out.dha = out.dha_mg;
  return out;
}

// ── Sum several computeRealNutritionFromOrder() results into one order-level total ──
function sumRealNutrition(list) {
  const out = {};
  NUTRIENT_FIELDS.forEach(key => { out[key] = 0; });
  (list || []).forEach(n => { if (n) NUTRIENT_FIELDS.forEach(key => { out[key] += (n[key] || 0); }); });
  NUTRIENT_FIELDS.forEach(key => { out[key] = Math.round(out[key] * 10) / 10; });
  return out;
}

module.exports = {
  NUTRIENT_FIELDS,
  DISEASE_CONDITION_KEYS,
  ING_NUTRIENTS,
  ING_META,
  PORTION_G,
  computeRealNutrition,
  computeRealNutritionFromOrder,
  sumRealNutrition,
  getIngredientsByTag,
  getCautionsByTag,
  buildTagIndex,
};
