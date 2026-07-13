/* ============================================================
   SAR — One-time recipe translator (Bengali -> English)
   ------------------------------------------------------------
   HOW TO RUN (on your own computer, needs Node.js 18+):
     1. Put this file in the same folder as menu.html
     2. In terminal:  set your key (same one from Netlify)
          Mac/Linux:  export ANTHROPIC_API_KEY="sk-ant-..."
          Windows:    set ANTHROPIC_API_KEY=sk-ant-...
     3. Run:  node translate-recipes.js
     4. It creates menu_en.json next to menu.html
     5. Upload menu_en.json to GitHub along with menu.html

   WHAT IT DOES:
     - Reads the STATIC_MENU array straight out of menu.html
     - Sends it to Claude in small batches (10 recipes at a time)
     - Asks for an English translation of only the display text
       (name, descriptions, benefits, herbs, ingredient names/notes)
     - Keeps all numbers, IDs, codes, prices exactly the same
     - Writes the result as menu_en.json: { "DM-1": {english fields}, ... }
   ============================================================ */

const fs = require('fs');
const path = require('path');

const MENU_HTML_PATH = path.join(__dirname, 'menu.html');
const OUTPUT_PATH = path.join(__dirname, 'menu_en.json');
const BATCH_SIZE = 8; // recipes per API call — keep small so responses stay reliable
const MODEL = 'claude-sonnet-4-6';

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
if (!API_KEY) {
  console.error('ERROR: set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in your environment first.');
  process.exit(1);
}

function extractStaticMenu(html) {
  const marker = 'const STATIC_MENU = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('Could not find STATIC_MENU in menu.html');
  const arrayStart = start + marker.length;
  // find the matching closing bracket for the array by bracket counting
  let depth = 0, i = arrayStart, end = -1;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('Could not find end of STATIC_MENU array');
  const jsonText = html.slice(arrayStart, end);
  return JSON.parse(jsonText);
}

async function translateBatch(items) {
  // Only send the fields that need translating, to save tokens
  const slim = items.map((it) => ({
    id: it.id,
    name: it.name,
    c1: it.c1, c2: it.c2, c3: it.c3,
    powders: it.powders, chutney: it.chutney,
    benefits: it.benefits,
    herbs: it.herbs,
    toppings: it.toppings,
    recipe_steps: it.recipe && it.recipe.steps,
    recipe_notes: it.recipe && it.recipe.notes,
    ingredients: (it.ingredients || []).map((ing) => ({ n: ing.n, med: ing.med })),
  }));

  const prompt = `Translate the Bengali text fields in this JSON array to natural, appetizing English,
suitable for a premium women's health & nutrition menu. Rules:
- Keep the "id" field exactly as-is (used to match back to the original).
- Translate: name, c1, c2, c3, powders, chutney, benefits, herbs (array), toppings (array),
  recipe_steps (array), recipe_notes, and ingredients[].n and ingredients[].med.
- Do NOT translate numbers, units already in metric form, or medical compound names (curcumin, silymarin, etc) — keep those as-is, just translate the surrounding Bengali words.
- Respond with ONLY a JSON array, same shape as input, same order, no markdown fences, no commentary.

Input:
${JSON.stringify(slim)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.content.map((b) => b.text || '').join('').trim();
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

async function main() {
  console.log('Reading menu.html...');
  const html = fs.readFileSync(MENU_HTML_PATH, 'utf8');
  const menu = extractStaticMenu(html);
  console.log(`Found ${menu.length} recipes. Translating in batches of ${BATCH_SIZE}...`);

  const result = {};
  for (let i = 0; i < menu.length; i += BATCH_SIZE) {
    const batch = menu.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(menu.length / BATCH_SIZE)}... `);
    try {
      const translated = await translateBatch(batch);
      translated.forEach((t) => { result[t.id] = t; });
      console.log('done');
    } catch (err) {
      console.log('FAILED:', err.message);
      console.log('  (you can re-run the script later — already-saved items are kept)');
    }
    // small delay to be gentle on rate limits
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nSaved ${Object.keys(result).length} translated recipes to ${OUTPUT_PATH}`);
  console.log('Upload menu_en.json to GitHub next to menu.html, then follow the integration guide.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
