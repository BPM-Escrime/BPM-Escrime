/**
 * BPM - Escrime - Feuille de route d'une compétition (outil « Outils », #roadmap)
 * Modèle du document, variables ({date}, {debut}…), horaires suggérés, saison,
 * complétude et relecture d'un fichier. Pur : la date et la mise en forme sont injectées.
 * Les modèles préremplis (texte français, règlements FFE) sont dans ./presets.
 * Licensed under GPL-3.0
 */

export type RoadmapPresetId = 'laser' | 'fencing' | 'blank';
export type RoadmapLayout = 'table' | 'text';

export interface RoadmapRow {
  id: string;
  label: string;
  /** Texte libre, plusieurs lignes ; « - » ou « • » en tête de ligne = puce */
  value: string;
}

export interface RoadmapSection {
  id: string;
  title: string;
  layout: RoadmapLayout;
  rows: RoadmapRow[];
  text: string;
  enabled: boolean;
}

/** Logo rastérisé en PNG (data URL) : même rendu dans l'aperçu, le PDF et le DOCX */
export interface RoadmapLogo {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** L'essentiel : chaque champ alimente une variable reprise dans toutes les sections */
export interface RoadmapInfo {
  title: string;
  edition: string;
  /** AAAA-MM-JJ */
  date: string;
  venue: string;
  address: string;
  /** HH:MM */
  openTime: string;
  scratchTime: string;
  startTime: string;
  fees: string;
  /** Clôture des inscriptions : jours avant la date */
  deadlineDays: number;
  organizer: string;
  contactName: string;
  contactEmail: string;
  contact2Name: string;
  contact2Email: string;
}

export interface RoadmapDoc {
  version: 1;
  preset: RoadmapPresetId;
  /** Couleur des bandeaux (#rrggbb) */
  accent: string;
  logos: RoadmapLogo[];
  info: RoadmapInfo;
  sections: RoadmapSection[];
}

export const ROADMAP_ACCENTS = ['#c6e0b4', '#bdd7ee', '#f8cbad', '#ffe699', '#d9d2e9', '#d9d9d9'];

export const ROADMAP_VARIABLES = [
  'titre',
  'edition',
  'date',
  'lieu',
  'adresse',
  'ouverture',
  'scratch',
  'debut',
  'tarifs',
  'date_limite',
  'saison',
  'organisateur',
  'contact',
] as const;
export type RoadmapVariable = (typeof ROADMAP_VARIABLES)[number];
export type RoadmapVariables = Record<RoadmapVariable, string>;

/** Champ de l'essentiel qui donne sa valeur à chaque variable */
export const VARIABLE_SOURCE: Record<RoadmapVariable, keyof RoadmapInfo> = {
  titre: 'title',
  edition: 'edition',
  date: 'date',
  lieu: 'venue',
  adresse: 'address',
  ouverture: 'openTime',
  scratch: 'scratchTime',
  debut: 'startTime',
  tarifs: 'fees',
  // Calculées depuis la date
  date_limite: 'date',
  saison: 'date',
  organisateur: 'organizer',
  contact: 'contactName',
};

export const emptyInfo = (): RoadmapInfo => ({
  title: '',
  edition: '',
  date: '',
  venue: '',
  address: '',
  openTime: '',
  scratchTime: '',
  startTime: '',
  fees: '',
  deadlineDays: 7,
  organizer: '',
  contactName: '',
  contactEmail: '',
  contact2Name: '',
  contact2Email: '',
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HH_MM = /^(\d{1,2}):(\d{2})$/;

const parseIsoDate = (iso: string): Date | null => {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Saison sportive (1er septembre → 31 août) : « 2026-2027 » */
export function seasonOf(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return '';
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 8 ? y : y - 1;
  return `${start}-${start + 1}`;
}

/** Date limite d'inscription (AAAA-MM-JJ) ; '' si la date est absente */
export function deadlineOf(iso: string, daysBefore: number): string {
  const d = parseIsoDate(iso);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() - Math.max(0, Math.round(daysBefore)));
  return toIso(d);
}

const toMinutes = (hhmm: string): number | null => {
  const m = HH_MM.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};

const fromMinutes = (total: number): string => {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Horaires usuels à partir du début : ouverture 45 min avant, scratch 10 min avant */
export function suggestSchedule(
  startTime: string,
  openBefore = 45,
  scratchBefore = 10
): { openTime: string; scratchTime: string } | null {
  const start = toMinutes(startTime);
  if (start === null) return null;
  return {
    openTime: fromMinutes(start - openBefore),
    scratchTime: fromMinutes(start - scratchBefore),
  };
}

/** « 09:15 » → « 9h15 » (usage des feuilles de route FFE) */
export function frenchTime(hhmm: string): string {
  const m = toMinutes(hhmm);
  if (m === null) return hhmm.trim();
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/** Valeurs des variables ; formatDate met en forme une date AAAA-MM-JJ (langue du document) */
export function roadmapVariables(
  info: RoadmapInfo,
  formatDate: (iso: string) => string
): RoadmapVariables {
  const deadline = deadlineOf(info.date, info.deadlineDays);
  const contacts = [
    [info.contactName, info.contactEmail],
    [info.contact2Name, info.contact2Email],
  ]
    .map(([n, e]) => [n.trim(), e.trim()].filter(Boolean).join(' : '))
    .filter(Boolean)
    .join(' ou ');
  return {
    titre: info.title.trim(),
    edition: info.edition.trim(),
    date: info.date ? formatDate(info.date) : '',
    lieu: info.venue.trim(),
    adresse: info.address.trim(),
    ouverture: info.openTime ? frenchTime(info.openTime) : '',
    scratch: info.scratchTime ? frenchTime(info.scratchTime) : '',
    debut: info.startTime ? frenchTime(info.startTime) : '',
    tarifs: info.fees.trim(),
    date_limite: deadline ? formatDate(deadline) : '',
    saison: seasonOf(info.date),
    organisateur: info.organizer.trim(),
    contact: contacts,
  };
}

/** Morceau de texte : littéral, ou variable connue (missing = valeur vide) */
export interface TextPiece {
  text: string;
  variable?: RoadmapVariable;
  missing?: boolean;
}

const VAR_RE = /\{([a-z_]+)\}/g;
export const isRoadmapVariable = (name: string): name is RoadmapVariable =>
  (ROADMAP_VARIABLES as readonly string[]).includes(name);

/** Découpe le texte autour des variables connues ; les inconnues restent du texte */
export function splitVariables(text: string, vars: RoadmapVariables): TextPiece[] {
  const out: TextPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1];
    if (!isRoadmapVariable(name)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const value = vars[name];
    out.push(
      value ? { text: value, variable: name } : { text: m[0], variable: name, missing: true }
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Remplace les variables qui ont une valeur, laisse les vides en « {nom} » (aperçu : lignes des valeurs) */
export function expandVariables(text: string, vars: RoadmapVariables): string {
  return splitVariables(text, vars)
    .map(p => p.text)
    .join('');
}

/** Texte avec les variables remplacées ; valeur absente → « … » */
export function resolveText(text: string, vars: RoadmapVariables): string {
  return splitVariables(text, vars)
    .map(p => (p.missing ? '…' : p.text))
    .join('');
}

export interface TextBlock {
  kind: 'para' | 'bullet';
  text: string;
}

const BULLET = /^\s*(?:[-•*])\s+/;

/** Lignes du texte : puces (« - », « • », « * ») ou paragraphes ; lignes vides ignorées */
export function parseBlocks(text: string): TextBlock[] {
  return text
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .map(l =>
      BULLET.test(l)
        ? { kind: 'bullet' as const, text: l.replace(BULLET, '').trim() }
        : { kind: 'para' as const, text: l.trim() }
    );
}

/** Champs de l'essentiel suivis par la jauge de complétude */
export const REQUIRED_INFO: (keyof RoadmapInfo)[] = [
  'title',
  'date',
  'venue',
  'startTime',
  'fees',
  'contactName',
  'contactEmail',
];

export interface RoadmapCompleteness {
  done: number;
  total: number;
  /** Champs de l'essentiel vides */
  missingInfo: (keyof RoadmapInfo)[];
  /** Lignes vides (titre de section → libellés) */
  emptyRows: { section: string; label: string }[];
  /** Variables utilisées mais sans valeur */
  missingVariables: RoadmapVariable[];
}

export function completeness(doc: RoadmapDoc, vars: RoadmapVariables): RoadmapCompleteness {
  const missingInfo = REQUIRED_INFO.filter(k => String(doc.info[k]).trim() === '');
  const emptyRows: RoadmapCompleteness['emptyRows'] = [];
  const used = new Set<RoadmapVariable>();
  let rowCount = 0;
  for (const s of doc.sections) {
    if (!s.enabled) continue;
    const texts = s.layout === 'table' ? s.rows.map(r => r.value) : [s.text];
    if (s.layout === 'table') {
      for (const r of s.rows) {
        rowCount++;
        if (r.value.trim() === '') emptyRows.push({ section: s.title, label: r.label });
      }
    }
    for (const t of [s.title, ...texts]) {
      for (const p of splitVariables(t, vars)) if (p.missing && p.variable) used.add(p.variable);
    }
  }
  const missingVariables = [...used];
  const total = REQUIRED_INFO.length + rowCount;
  const done = total - missingInfo.length - emptyRows.length;
  return { done, total, missingInfo, emptyRows, missingVariables };
}

/** Identifiant suivant « prefix-N » (déterministe, sans hasard) */
export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

/** Tous les identifiants de lignes du document */
export const rowIds = (sections: RoadmapSection[]) => sections.flatMap(s => s.rows.map(r => r.id));

/** Déplace un élément d'une position (delta -1 / +1), borné */
export function moveItem<T extends { id: string }>(items: T[], id: string, delta: number): T[] {
  const from = items.findIndex(i => i.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

// ─── Relecture (fichier ouvert, brouillon du poste) ──────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

const normRow = (v: unknown, i: number): RoadmapRow | null =>
  isObj(v)
    ? { id: str(v.id, 64) || `row-${i + 1}`, label: str(v.label, 200), value: str(v.value) }
    : null;

const normSection = (v: unknown, i: number): RoadmapSection | null => {
  if (!isObj(v)) return null;
  const rows = Array.isArray(v.rows)
    ? v.rows.map(normRow).filter((r): r is RoadmapRow => r !== null)
    : [];
  return {
    id: str(v.id, 64) || `sec-${i + 1}`,
    title: str(v.title, 200),
    layout: v.layout === 'text' ? 'text' : 'table',
    rows,
    text: str(v.text),
    enabled: v.enabled !== false,
  };
};

const DATA_PNG = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

const normLogo = (v: unknown, i: number): RoadmapLogo | null => {
  if (!isObj(v) || typeof v.dataUrl !== 'string' || !DATA_PNG.test(v.dataUrl)) return null;
  const width = Number(v.width);
  const height = Number(v.height);
  if (!(width > 0 && height > 0)) return null;
  return { id: str(v.id, 64) || `logo-${i + 1}`, dataUrl: v.dataUrl, width, height };
};

/** Document relu depuis un JSON inconnu ; null si ce n'est pas une feuille de route */
export function normalizeRoadmap(raw: unknown): RoadmapDoc | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.info) || !Array.isArray(raw.sections)) {
    return null;
  }
  const base = emptyInfo();
  const rawInfo = raw.info;
  const info = Object.fromEntries(
    Object.entries(base).map(([k, def]) => {
      const v = rawInfo[k];
      if (typeof def === 'number') {
        const n = Number(v);
        return [k, Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n) : def];
      }
      return [k, str(v, 2000)];
    })
  ) as unknown as RoadmapInfo;
  const preset: RoadmapPresetId =
    raw.preset === 'laser' || raw.preset === 'fencing' ? raw.preset : 'blank';
  const accent =
    typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent)
      ? raw.accent.toLowerCase()
      : ROADMAP_ACCENTS[0];
  return {
    version: 1,
    preset,
    accent,
    logos: Array.isArray(raw.logos)
      ? raw.logos
          .map(normLogo)
          .filter((l): l is RoadmapLogo => l !== null)
          .slice(0, 6)
      : [],
    info,
    sections: raw.sections.map(normSection).filter((s): s is RoadmapSection => s !== null),
  };
}
