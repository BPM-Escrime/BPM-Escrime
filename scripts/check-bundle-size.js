#!/usr/bin/env node
/**
 * Garde-fou taille bundle renderer (JS hors sourcemaps). Trois budgets :
 *   - initial : chunks chargés au démarrage (runtime, react, vendors, main)
 *   - chunk   : plus gros chunk chargé à la demande (React.lazy / import())
 *   - total   : somme de tous les fichiers JS
 *
 * Seuils calés avec ~25-35 % de marge sur les tailles mesurées en octobre 2026
 * (build dev : initial ≈ 2.06 MiB, plus gros chunk CompetitionView ≈ 0.78 MiB,
 * total ≈ 4.49 MiB).
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist', 'renderer');
const MiB = 1024 * 1024;
const INITIAL_CHUNKS = new Set(['runtime.js', 'react.js', 'vendors.js', 'main.js']);
const DT_DIR = path.join(__dirname, '..', 'dist', 'remote', 'dt');
const BUDGETS = {
  // Vue DT dans un navigateur (ADR-0020, webpack.dt.config.js) : dt.js ≈ 1.65 MiB en build dev (nov. 2026)
  dt: 2.25 * MiB,
  // Relevé de 2.75 à 2.85 MiB (27 nov. 2026, accord du mainteneur) : G0 de #1948, ADR-0044
  // (règle de rencontre des équipes, éditeur et écran des équipes ; ≈ 2.83 MiB).
  initial: 2.85 * MiB,
  chunk: 1.25 * MiB, // CompetitionView ≈ 1.23 MiB en build dev (25 nov. 2026, modales rares en React.lazy)
  // ≈ 9.25 MiB en build dev (25 nov. 2026 ; 9.00 MiB avec ADR-0028 lots C1-C3, 8.51 MiB avec #1981).
  // Relevé de 9.50 à 9.60 MiB (26 nov. 2026) : F2 de #2013, ADR-0041 (contrôles S1 à S6, remarques
  // situées, mode expert de l'éditeur ; ≈ 9.54 MiB). Le build dev n'est pas minifié : le code et ses
  // commentaires comptent en entier.
  // Relevé de 9.60 à 9.75 MiB (27 nov. 2026, accord du mainteneur) : F4 de #2013, ADR-0043
  // (vagues, têtes de poule, binômes ; ≈ 9.61 MiB). F4e retire le code du mode spécial.
  total: 9.75 * MiB,
};

function walkJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    // pdf.js (boîte d'impression, #1214) : ressource statique chargée à la demande, hors bundle
    if (entry.isDirectory() && entry.name === 'pdfjs') continue;
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.map.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

if (!fs.existsSync(DIST_DIR)) {
  console.error(
    `Dossier introuvable: ${DIST_DIR}. Lancer "npm run build:renderer" avant ce script.`
  );
  process.exit(1);
}

const sizes = walkJsFiles(DIST_DIR)
  .map(f => ({ file: path.relative(DIST_DIR, f), bytes: fs.statSync(f).size }))
  .sort((a, b) => b.bytes - a.bytes);

const toMiB = b => (b / MiB).toFixed(2);
const initial = sizes.filter(s => INITIAL_CHUNKS.has(s.file));
const lazy = sizes.filter(s => !INITIAL_CHUNKS.has(s.file));
const sum = list => list.reduce((acc, s) => acc + s.bytes, 0);

console.log('Chunks initiaux :');
for (const { file, bytes } of initial) console.log(`  ${toMiB(bytes)} MiB  ${file}`);
console.log(`\nChunks à la demande (${lazy.length}, 10 plus lourds) :`);
for (const { file, bytes } of lazy.slice(0, 10)) console.log(`  ${toMiB(bytes)} MiB  ${file}`);

const results = [
  { name: 'initial', value: sum(initial), label: 'chargement initial' },
  { name: 'chunk', value: lazy.length ? lazy[0].bytes : 0, label: `plus gros chunk (${lazy[0]?.file ?? '—'})` },
  { name: 'total', value: sum(sizes), label: 'total JS' },
];
// Bundle de la vue DT (sans les chunks de langue, chargés à la demande)
const dtMain = path.join(DT_DIR, 'dt.js');
if (fs.existsSync(dtMain)) {
  results.push({ name: 'dt', value: fs.statSync(dtMain).size, label: 'vue DT (dt.js)' });
} else {
  console.warn(`\n(vue DT absente : ${path.relative(process.cwd(), dtMain)}, lancer npm run build:dt)`);
}

console.log('');
let failed = false;
for (const { name, value, label } of results) {
  const budget = BUDGETS[name];
  const ok = value <= budget;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${label} : ${toMiB(value)} MiB (budget ${toMiB(budget)} MiB)`);
}

if (lazy.length === 0) {
  // Sans chunk séparé, React.lazy ne découpe plus rien (ex. ts-loader en module commonjs)
  failed = true;
  console.error('✗ Aucun chunk à la demande : le découpage du code est cassé.');
}

if (failed) {
  console.error('\n✗ Bundle hors budget.');
  process.exit(1);
}

console.log('\n✓ Bundle dans le budget.');
