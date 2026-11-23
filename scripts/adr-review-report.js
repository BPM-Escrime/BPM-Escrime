#!/usr/bin/env node
/**
 * Rapport de revue des ADR (a posteriori, non bloquant) : ce qui a pu relâcher un garde-fou
 * ou contourner une règle depuis une date. Publié chaque semaine en commentaire de l'issue
 * « Revue ADR hebdomadaire » par .github/workflows/adr-review.yml.
 *
 *   node scripts/adr-review-report.js                    → 7 derniers jours, branche courante
 *   node scripts/adr-review-report.js --since="2026-11-01"
 *
 * Sortie : Markdown sur stdout. Heuristique : chaque ligne est « à vérifier », pas une faute.
 */
const { execFileSync } = require('child_process');

const arg = name => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const since = arg('since') || '7 days ago';

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Fichiers dont la modification peut relâcher un garde-fou des ADR (#2090) */
const GUARD_FILES = [
  ['scripts/check-quality-ratchet.js', 'cliquet qualité'],
  ['eslint.config.js', 'règles de couches (ADR-0002, 0004)'],
  ['src/shared/api/contractNaming.test.ts', 'nommage du contrat (ADR-0008)'],
  ['src/shared/api/errors.ts', 'catalogue des codes d’erreur (ADR-0009)'],
  ['src/shared/api/errors.test.ts', 'contrôle du catalogue (ADR-0009)'],
  ['src/database/migrations/migrationsAdr.test.ts', 'migrations sous ADR (ADR-0011)'],
  ['docs/adr', 'ADR'],
  ['.github/workflows', 'CI'],
];

/** Motifs de lignes ajoutées à signaler : [libellé, test(fichier, ligne)] */
const LINE_RULES = [
  ['`eslint-disable`', (f, l) => /eslint-disable/.test(l)],
  ['`@ts-ignore` / `@ts-expect-error`', (f, l) => /@ts-(ignore|expect-error)/.test(l)],
  ['`any`', (f, l) => /\.tsx?$/.test(f) && /(:\s*any\b|\bas any\b|<any>)/.test(l)],
  [
    'écriture directe en base hors commande (ADR-0005)',
    (f, l) =>
      /^src\/main\/(remote|mcp)\//.test(f) &&
      /\bdb\w*\??\.(\w+\??\.)?(create|update|delete|set|save|insert|upsert|remove|add|start|close|reopen|finish|record|clear|mark)[A-Z]\w*\(/.test(
        l
      ),
  ],
  [
    'nouveau canal IPC (ADR-0005, 0018)',
    (f, l) =>
      /^src\/main\//.test(f) &&
      f !== 'src/main/engine/api/ipcAdapter.ts' && // canal du contrat lui-même
      /ipcMain\.(handle|on|handleOnce)\(/.test(l),
  ],
  [
    '`window.electronAPI` / `useElectronDB()` dans l’interface',
    (f, l) =>
      /^src\/(renderer|features)\//.test(f) &&
      !/^src\/renderer\/api\//.test(f) &&
      /(window\.electronAPI|useElectronDB\()/.test(l),
  ],
  [
    'nom MCP hérité (ADR-0008)',
    (f, l) => f === 'src/shared/api/contractNaming.test.ts' && /^\s+\w+: '[a-z_]+',/.test(l),
  ],
];

const TEST_RE = /(\.test\.tsx?$|\.spec\.tsx?$|[\\/]__tests__[\\/]|[\\/]testUtils[\\/]|^e2e\/)/;

/** Ligne de commentaire (JSDoc, //, /*) : pas un appel */
const COMMENT_RE = /^\s*(\*|\/\/|\/\*)/;

/** Première migration soumise à ADR-0011 (src/database/migrations/migrationsAdr.test.ts) */
const FIRST_UNDER_ADR = 46;

/** Commit de masse (renommage, formatage) : trop de fichiers pour désigner l'auteur d'une ligne */
const MASS_COMMIT_FILES = 200;

/** Références du cliquet relevées (une baisse est un gain, pas un signal) */
function baselineRaises() {
  const path = 'scripts/quality-baseline.json';
  const commits = git([
    'log',
    '--no-merges',
    `--since=${since}`,
    '--format=%h\t%an\t%s',
    '--',
    path,
  ])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => l.split('\t'));
  const read = rev => {
    try {
      return JSON.parse(git(['show', `${rev}:${path}`]));
    } catch {
      return {};
    }
  };
  const out = [];
  for (const c of commits) {
    const before = read(`${c[0]}^`);
    const after = read(c[0]);
    const flat = o => ({
      ...Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number')),
      ...Object.fromEntries(
        Object.entries(o.lineExceptions || {}).map(([f, n]) => [`lignes ${f}`, n])
      ),
    });
    const b = flat(before);
    const a = flat(after);
    for (const [key, value] of Object.entries(a)) {
      if (b[key] === undefined && !key.startsWith('lignes ')) continue; // nouveau compteur
      if (b[key] === undefined || value > b[key]) {
        out.push({ key, from: b[key] ?? '—', to: value, commit: c });
      }
    }
  }
  return out;
}

function guardChanges() {
  const out = [];
  for (const [path, label] of GUARD_FILES) {
    const log = git(['log', '--no-merges', `--since=${since}`, '--format=%h\t%an\t%s', '--', path])
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter(l => !/\tgithub-actions(\[bot\])?\t/.test(l));
    if (log.length) out.push({ path, label, commits: log.map(l => l.split('\t')) });
  }
  return out;
}

/** Révision de départ : dernier commit avant `since` (racine du dépôt à défaut) */
function baseRev() {
  const rev = git(['rev-list', '-1', `--before=${since}`, 'HEAD']).trim();
  return rev || git(['rev-list', '--max-parents=0', 'HEAD']).trim().split('\n')[0];
}

const PREFILTER =
  "eslint-disable|@ts-(ignore|expect-error)|any\\b|ipcMain\\.|electronAPI|useElectronDB|db[A-Za-z]*\\??\\.|: '[a-z_]+',";

/** Occurrences des motifs à une révision : Map(règle → Map(fichier → textes)) */
function occurrences(rev) {
  let raw = '';
  try {
    raw = git(['grep', '-I', '-n', '-E', PREFILTER, rev, '--', 'src']);
  } catch (e) {
    if (e.status !== 1) throw e; // 1 : aucune correspondance
  }
  const map = new Map(LINE_RULES.map(([label]) => [label, new Map()]));
  for (const line of raw.split('\n')) {
    const m = /^[^:]+:([^:]+):\d+:(.*)$/.exec(line);
    if (!m) continue;
    const [, file, text] = m;
    if (TEST_RE.test(file) && !file.endsWith('contractNaming.test.ts')) continue;
    if (COMMENT_RE.test(text) && !/eslint-disable|@ts-(ignore|expect-error)/.test(text)) continue;
    for (const [label, test] of LINE_RULES) {
      if (!test(file, text)) continue;
      const byFile = map.get(label);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(text.trim());
    }
  }
  return map;
}

/**
 * Lignes apparues entre la base et HEAD, par différence d'occurrences (pas par patch) :
 * un code déplacé dans un fichier ou d'un fichier à l'autre ne compte pas.
 */
function newLines(base) {
  const before = occurrences(base);
  const after = occurrences('HEAD');
  const hits = new Map(LINE_RULES.map(([label]) => [label, []]));
  const massCommits = new Set(
    git(['log', '--no-merges', '--format=@@C %h', '--name-only', `${base}..HEAD`])
      .split('@@C ')
      .filter(Boolean)
      .map(chunk => chunk.trim().split('\n'))
      .filter(([, ...files]) => files.filter(Boolean).length > MASS_COMMIT_FILES)
      .map(([h]) => h)
  );
  const parse = out =>
    out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => l.split('\t'))
      .filter(c => !massCommits.has(c[0]));
  /** Commit qui a fait apparaître la ligne (pickaxe), à défaut les derniers commits du fichier */
  const commitsOf = (file, text) => {
    const fmt = '--format=%h\t%an\t%s';
    const introduced = parse(
      git(['log', '--no-merges', '-S', text, `${base}..HEAD`, fmt, '--', file])
    ).slice(-1);
    if (introduced.length) return introduced;
    return parse(git(['log', '--no-merges', '--follow', `${base}..HEAD`, fmt, '--', file])).slice(
      0,
      3
    );
  };
  // 1) Même fichier d'abord : seul l'excédent d'un fichier est nouveau (une ligne commune comme
  //    « eslint-disable-next-line react-hooks/exhaustive-deps » reste attribuée au bon fichier)
  // 2) Puis l'excédent consomme ce qui a disparu ailleurs : un déplacement entre fichiers s'annule
  const count = texts => {
    const m = new Map();
    for (const t of texts) m.set(t, (m.get(t) || 0) + 1);
    return m;
  };
  for (const [label, byFile] of after) {
    const beforeByFile = before.get(label);
    const pool = new Map(); // occurrences disparues de leur fichier
    const excess = []; // [fichier, texte] en plus dans leur fichier
    const files = new Set([...beforeByFile.keys(), ...byFile.keys()]);
    for (const file of files) {
      const b = count(beforeByFile.get(file) || []);
      const a = count(byFile.get(file) || []);
      for (const t of new Set([...b.keys(), ...a.keys()])) {
        const diff = (a.get(t) || 0) - (b.get(t) || 0);
        if (diff < 0) pool.set(t, (pool.get(t) || 0) - diff);
        for (let i = 0; i < diff; i++) excess.push([file, t]);
      }
    }
    for (const [file, text] of excess) {
      const left = pool.get(text) || 0;
      if (left > 0) pool.set(text, left - 1);
      else hits.get(label).push({ file, text, commits: commitsOf(file, text) });
    }
  }
  return hits;
}

function addedMigrations() {
  const raw = git([
    'log',
    '--no-merges',
    `--since=${since}`,
    '-p',
    '-U0',
    '--format=@@C %h\t%an\t%s',
    '--',
    'src/database/migrations/migrations.ts',
  ]);
  const migrations = [];
  let commit = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@C ')) commit = line.slice(4).split('\t');
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      const v = /^\s*version:\s*(\d+)/.exec(line.slice(1));
      if (v) migrations.push({ version: Number(v[1]), commit });
      const d = /docs\/adr\/(\d{4})/.exec(line);
      if (d && migrations.length) migrations[migrations.length - 1].adr = d[1];
    }
  }
  return migrations;
}

const ref = c => `${c[0]} (${c[1]}) ${c[2]}`;
const code = s => '`' + s.replace(/`/g, "'").slice(0, 140) + '`';

function main() {
  const guards = guardChanges();
  const hits = newLines(baseRev());
  const migrations = addedMigrations();
  const raises = baselineRaises();
  const lines = [`## Revue ADR — depuis ${since}`, ''];
  let total = 0;

  if (raises.length) {
    lines.push('### Références du cliquet relevées', '');
    for (const r of raises) lines.push(`- **${r.key}** : ${r.from} → ${r.to} — ${ref(r.commit)}`);
    lines.push('');
    total += raises.length;
  }

  if (guards.length) {
    lines.push('### Fichiers garde-fous modifiés', '');
    for (const g of guards) {
      lines.push(`- **${g.path}** — ${g.label}`);
      for (const c of g.commits) lines.push(`  - ${ref(c)}`);
      total += g.commits.length;
    }
    lines.push('');
  }

  if (migrations.length) {
    lines.push('### Migrations ajoutées (ADR-0011)', '');
    for (const m of migrations) {
      const adr = m.adr
        ? `ADR-${m.adr}`
        : m.version < FIRST_UNDER_ADR
          ? 'antérieure à la règle'
          : '**aucune ADR citée**';
      lines.push(`- ${m.version} : ${adr} — ${ref(m.commit)}`);
    }
    lines.push('');
    total += migrations.filter(m => !m.adr && m.version >= FIRST_UNDER_ADR).length;
  }

  const lineHits = [...hits].filter(([, list]) => list.length);
  if (lineHits.length) {
    lines.push('### Lignes ajoutées à vérifier (hors tests)', '');
    for (const [label, list] of lineHits) {
      lines.push(`<details><summary>${label} : ${list.length}</summary>`, '');
      for (const h of list.slice(0, 50))
        lines.push(
          `- ${h.file} — ${code(h.text)} — ${h.commits.map(c => c[0]).join(', ') || 'commit de masse'}`
        );
      if (list.length > 50) lines.push(`- … ${list.length - 50} de plus`);
      lines.push('', '</details>', '');
      total += list.length;
    }
  }

  if (!total) lines.push('Rien à signaler.');
  else
    lines.push(
      '---',
      'Heuristique : une ligne n’est pas une faute. En cas de doute, relire la PR (revue IA possible) au regard de docs/adr/.'
    );
  process.stdout.write(lines.join('\n') + '\n');
}

main();
