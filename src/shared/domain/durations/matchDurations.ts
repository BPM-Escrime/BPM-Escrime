/**
 * Durées de match de référence par arme, sexe, catégorie et phase, ajustées en
 * direct avec les matchs réellement joués (#1965). Source unique pour toute
 * estimation de durée de match (simulation de formule, fin de phase, indicateurs).
 *
 * Référence : réglage du DT > historique du poste (≥ 30 matchs) > valeurs par défaut.
 * Ajustement : la référence pèse comme k matchs fictifs face à la médiane des
 * n derniers matchs mesurés ; matchs aberrants exclus (< 30 s ou > 3 × référence).
 */

export type DurationPhase = 'pool' | 'tableau' | 'team_relay';

export interface DurationKey {
  /** Code arme : E, F, S, L, C */
  weapon: string;
  gender?: string;
  category?: string;
  phase: DurationPhase;
  maxScore: number;
}

/** Valeur connue pour une clé (réglage du DT ou agrégat d'historique). */
export interface DurationRecord {
  key: DurationKey;
  medianMs: number;
  p80Ms?: number;
  /** Nombre de matchs mesurés (historique) */
  samples?: number;
}

export interface DurationSources {
  settings?: DurationRecord[];
  history?: DurationRecord[];
  /** Changement de piste (ms), défaut 1 min */
  changeoverMs?: number;
  /** Chrono du match (s) : sert aux armes sans valeur par défaut (L, C) */
  timerSeconds?: number;
}

export interface DurationEstimate {
  medianMs: number;
  p80Ms: number;
  changeoverMs: number;
  basis: 'default' | 'history' | 'setting' | 'live';
  samples: number;
}

const MIN = 60_000;
export const DEFAULT_CHANGEOVER_MS = MIN;
/** Matchs d'historique requis pour qu'une clé l'emporte sur la valeur par défaut */
export const MIN_HISTORY_SAMPLES = 30;
const P80_FACTOR = 1.25;
const MIN_VALID_MS = 30_000;
const OUTLIER_FACTOR = 3;

/** Valeurs de départ (à calibrer) : poule en 5 touches, tableau en 15 touches. */
const DEFAULTS: Record<string, { pool: number; tableau: number }> = {
  E: { pool: 3.5 * MIN, tableau: 12 * MIN },
  F: { pool: 3.5 * MIN, tableau: 11 * MIN },
  S: { pool: 2.5 * MIN, tableau: 8 * MIN },
};

/** Arme sans valeur par défaut (L, C) : depuis le score max, plafonné par le chrono. */
function timerScoreMs(maxScore: number, timerSeconds?: number): number {
  const byScore = maxScore <= 5 ? 4 * MIN : maxScore <= 10 ? 8 * MIN : 12 * MIN;
  return timerSeconds && timerSeconds > 0 ? Math.min(timerSeconds * 1000, byScore) : byScore;
}

function defaultMedianMs(key: DurationKey, timerSeconds?: number): number {
  const d = DEFAULTS[key.weapon];
  const score = key.maxScore > 0 ? key.maxScore : key.phase === 'pool' ? 5 : 15;
  if (!d) return timerScoreMs(score, timerSeconds);
  // Durée proportionnelle au score (poule en 10 touches, relais en 45)
  if (key.phase === 'pool') return (d.pool * score) / 5;
  return (d.tableau * score) / 15;
}

/** Clés de la plus précise à la plus large : sans catégorie, puis sans sexe. */
export function widenKey(key: DurationKey): DurationKey[] {
  const keys: DurationKey[] = [key];
  if (key.category != null) keys.push({ ...key, category: undefined });
  if (key.gender != null) keys.push({ ...key, category: undefined, gender: undefined });
  return keys;
}

function sameKey(a: DurationKey, b: DurationKey): boolean {
  return (
    a.weapon === b.weapon &&
    a.phase === b.phase &&
    a.maxScore === b.maxScore &&
    (a.gender ?? null) === (b.gender ?? null) &&
    (a.category ?? null) === (b.category ?? null)
  );
}

function find(records: DurationRecord[] | undefined, key: DurationKey, minSamples = 0) {
  return records?.find(
    r => sameKey(r.key, key) && r.medianMs > 0 && (r.samples ?? 0) >= minSamples
  );
}

export function referenceDuration(
  key: DurationKey,
  sources: DurationSources = {}
): DurationEstimate {
  const changeoverMs = sources.changeoverMs ?? DEFAULT_CHANGEOVER_MS;
  for (const k of widenKey(key)) {
    const setting = find(sources.settings, k);
    if (setting) return estimateFrom(setting, 'setting', changeoverMs);
    const hist = find(sources.history, k, MIN_HISTORY_SAMPLES);
    if (hist) return estimateFrom(hist, 'history', changeoverMs);
  }
  const medianMs = defaultMedianMs(key, sources.timerSeconds);
  return {
    medianMs,
    p80Ms: medianMs * P80_FACTOR,
    changeoverMs,
    basis: 'default',
    samples: 0,
  };
}

function estimateFrom(
  r: DurationRecord,
  basis: 'setting' | 'history',
  changeoverMs: number
): DurationEstimate {
  return {
    medianMs: r.medianMs,
    p80Ms: Math.max(r.medianMs, r.p80Ms ?? r.medianMs * P80_FACTOR),
    changeoverMs,
    basis,
    samples: r.samples ?? 0,
  };
}

function median(values: number[]): number {
  return percentile(values, 50);
}

/** Centile (0–100) par interpolation linéaire. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Durées valides : ni trop courtes (saisie), ni aberrantes (blessure, appel DT, panne). */
export function filterOutliers(measuredMs: number[], ref: DurationEstimate): number[] {
  const max = OUTLIER_FACTOR * ref.medianMs;
  return measuredMs.filter(d => Number.isFinite(d) && d >= MIN_VALID_MS && d <= max);
}

export function adjustedDuration(
  ref: DurationEstimate,
  measuredMs: number[],
  opts: { k?: number; window?: number } = {}
): DurationEstimate {
  const k = Math.max(0, opts.k ?? 5);
  const window = Math.max(1, opts.window ?? 20);
  const samples = filterOutliers(measuredMs, ref).slice(-window);
  const n = samples.length;
  if (n === 0) return ref;
  const blend = (refMs: number, liveMs: number) => (k * refMs + n * liveMs) / (k + n);
  const medianMs = blend(ref.medianMs, median(samples));
  return {
    medianMs,
    p80Ms: Math.max(medianMs, blend(ref.p80Ms, percentile(samples, 80))),
    changeoverMs: ref.changeoverMs,
    basis: 'live',
    samples: n,
  };
}

/** Agrégats par clé à la clôture d'une compétition : aucune donnée personnelle. */
export function aggregateDurations(
  matches: Array<{ key: DurationKey; durationMs: number }>
): DurationRecord[] {
  const groups: Array<{ key: DurationKey; values: number[] }> = [];
  for (const m of matches) {
    if (!Number.isFinite(m.durationMs) || m.durationMs < MIN_VALID_MS) continue;
    const g = groups.find(x => sameKey(x.key, m.key));
    if (g) g.values.push(m.durationMs);
    else groups.push({ key: { ...m.key }, values: [m.durationMs] });
  }
  return groups.map(g => ({
    key: g.key,
    medianMs: median(g.values),
    p80Ms: percentile(g.values, 80),
    samples: g.values.length,
  }));
}

/** Code arme (E, F, S, L, C) depuis un code ou un libellé libre. */
export function weaponCode(weapon: string | undefined | null): string {
  const w = String(weapon ?? '')
    .trim()
    .toUpperCase();
  if (w.startsWith('E') || w.startsWith('É')) return 'E';
  if (w.startsWith('F')) return 'F';
  if (w.startsWith('S')) return w.includes('LASER') ? 'L' : 'S';
  if (w.startsWith('L')) return 'L';
  return 'C';
}

// ─── Paramétrage du poste : réglages du DT et historique (#1965, lot 3) ──────

/** Durées enregistrées sur le poste (app_settings, clé matchDurations) : aucune donnée personnelle */
export interface MatchDurationConfig {
  /** Réglages du DT : l'emportent sur l'historique et les valeurs par défaut */
  overrides: DurationRecord[];
  /** Agrégats par épreuve terminée (identifiant d'épreuve → agrégats par clé) */
  history: Record<string, DurationRecord[]>;
  /** Changement de piste (ms) */
  changeoverMs: number;
}

export const DEFAULT_DURATION_CONFIG: Readonly<MatchDurationConfig> = Object.freeze({
  overrides: [],
  history: {},
  changeoverMs: DEFAULT_CHANGEOVER_MS,
});

/** Épreuves gardées dans l'historique (les plus anciennes sortent d'abord) */
export const MAX_HISTORY_COMPETITIONS = 200;
const MAX_RECORDS = 200;
const MAX_DURATION_MS = 4 * 60 * MIN;
const PHASES: readonly DurationPhase[] = ['pool', 'tableau', 'team_relay'];

/**
 * Fusion des agrégats de plusieurs épreuves : par clé, médiane et 80ᵉ centile pondérés par le
 * nombre de matchs (approximation : les durées individuelles ne sont pas gardées).
 */
export function mergeDurationRecords(lists: DurationRecord[][]): DurationRecord[] {
  const acc: Array<{ key: DurationKey; n: number; med: number; p80: number }> = [];
  for (const r of lists.flat()) {
    const n = r.samples ?? 0;
    if (n <= 0 || !(r.medianMs > 0)) continue;
    const p80 = r.p80Ms ?? r.medianMs * P80_FACTOR;
    const g = acc.find(x => sameKey(x.key, r.key));
    if (g) {
      g.med += r.medianMs * n;
      g.p80 += p80 * n;
      g.n += n;
    } else acc.push({ key: { ...r.key }, n, med: r.medianMs * n, p80: p80 * n });
  }
  return acc.map(g => ({
    key: g.key,
    medianMs: Math.round(g.med / g.n),
    p80Ms: Math.round(g.p80 / g.n),
    samples: g.n,
  }));
}

/** Sources de référence du poste (réglages du DT, historique fusionné, changement de piste) */
export function durationSources(
  config: MatchDurationConfig = DEFAULT_DURATION_CONFIG,
  timerSeconds?: number
): DurationSources {
  return {
    settings: config.overrides,
    history: mergeDurationRecords(Object.values(config.history)),
    changeoverMs: config.changeoverMs,
    timerSeconds,
  };
}

/** Historique d'une épreuve remplacé (pas de double compte), puis plafonné en nombre d'épreuves */
export function withCompetitionHistory(
  config: MatchDurationConfig,
  competitionId: string,
  records: DurationRecord[]
): MatchDurationConfig {
  const entries = Object.entries(config.history).filter(([id]) => id !== competitionId);
  if (records.length > 0) entries.push([competitionId, records]);
  return { ...config, history: Object.fromEntries(entries.slice(-MAX_HISTORY_COMPETITIONS)) };
}

/** Horodatage d'un match terminé (listMatchTimings) */
export interface DurationTiming {
  poolId: string | null;
  tableId: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Secondes (chrono de la tablette) */
  duration: number | null;
}

/**
 * Durée retenue pour le planning : occupation de la piste (début → fin) ; à défaut, secondes de
 * combat remontées par la tablette. null : non mesuré.
 */
export function occupancyMs(t: DurationTiming): number | null {
  const start = t.startTime ? Date.parse(t.startTime) : NaN;
  const end = t.endTime ? Date.parse(t.endTime) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
  return t.duration && t.duration > 0 ? t.duration * 1000 : null;
}

/** Clé de durée d'une épreuve pour une phase (arme, sexe, catégorie, score max) */
export function competitionDurationKey(
  c: {
    weapon: unknown;
    gender?: unknown;
    category?: unknown;
    settings?: { defaultPoolMaxScore?: number; defaultTableMaxScore?: number };
  },
  phase: 'pool' | 'tableau'
): DurationKey {
  const score =
    phase === 'pool' ? c.settings?.defaultPoolMaxScore : c.settings?.defaultTableMaxScore;
  return {
    weapon: weaponCode(c.weapon as string),
    gender: c.gender != null && c.gender !== '' ? String(c.gender) : undefined,
    category: c.category != null && c.category !== '' ? String(c.category) : undefined,
    phase,
    maxScore: score && score > 0 ? score : phase === 'pool' ? 5 : 15,
  };
}

/** Agrégats d'une épreuve : poules et tableau mesurés, aberrants exclus par la référence */
export function competitionDurationRecords(
  c: Parameters<typeof competitionDurationKey>[0],
  timings: DurationTiming[]
): DurationRecord[] {
  const samples: Array<{ key: DurationKey; durationMs: number }> = [];
  for (const phase of ['pool', 'tableau'] as const) {
    const key = competitionDurationKey(c, phase);
    const ref = referenceDuration(key);
    const measured = timings
      .filter(t => (phase === 'pool' ? !!t.poolId : !t.poolId && !!t.tableId))
      .map(occupancyMs)
      .filter((d): d is number => d !== null);
    for (const d of filterOutliers(measured, ref)) samples.push({ key, durationMs: d });
  }
  return aggregateDurations(samples);
}

const isRecord = (v: unknown): v is DurationRecord => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const k = r.key as Record<string, unknown> | undefined;
  const optStr = (x: unknown) => x === undefined || (typeof x === 'string' && x.length <= 32);
  const ms = (x: unknown) => typeof x === 'number' && x > 0 && x <= MAX_DURATION_MS;
  return (
    !!k &&
    typeof k.weapon === 'string' &&
    k.weapon.length <= 2 &&
    optStr(k.gender) &&
    optStr(k.category) &&
    PHASES.includes(k.phase as DurationPhase) &&
    Number.isInteger(k.maxScore) &&
    (k.maxScore as number) > 0 &&
    (k.maxScore as number) <= 100 &&
    ms(r.medianMs) &&
    (r.p80Ms === undefined || ms(r.p80Ms)) &&
    (r.samples === undefined || (Number.isInteger(r.samples) && (r.samples as number) >= 0))
  );
};

const cleanRecord = (r: DurationRecord): DurationRecord => ({
  key: {
    weapon: r.key.weapon,
    ...(r.key.gender !== undefined ? { gender: r.key.gender } : {}),
    ...(r.key.category !== undefined ? { category: r.key.category } : {}),
    phase: r.key.phase,
    maxScore: r.key.maxScore,
  },
  medianMs: r.medianMs,
  ...(r.p80Ms !== undefined ? { p80Ms: r.p80Ms } : {}),
  ...(r.samples !== undefined ? { samples: r.samples } : {}),
});

/** Valide le paramétrage enregistré ; lève une erreur au message pour l'opérateur */
export function validateDurationConfig(value: unknown): MatchDurationConfig {
  const fail = (): never => {
    throw new Error('Paramètre matchDurations invalide : durées de match attendues');
  };
  if (!value || typeof value !== 'object') fail();
  const v = value as Record<string, unknown>;
  const records = (x: unknown): DurationRecord[] =>
    Array.isArray(x) && x.length <= MAX_RECORDS && x.every(isRecord) ? x.map(cleanRecord) : fail();
  const overrides = records(v.overrides ?? []);
  const rawHistory = v.history ?? {};
  if (typeof rawHistory !== 'object' || Array.isArray(rawHistory)) fail();
  const entries = Object.entries(rawHistory as Record<string, unknown>);
  if (entries.length > MAX_HISTORY_COMPETITIONS || entries.some(([id]) => id.length > 200)) fail();
  const changeoverMs = v.changeoverMs ?? DEFAULT_CHANGEOVER_MS;
  if (typeof changeoverMs !== 'number' || changeoverMs < 0 || changeoverMs > 60 * MIN) fail();
  return {
    overrides,
    history: Object.fromEntries(entries.map(([id, list]) => [id, records(list)])),
    changeoverMs: changeoverMs as number,
  };
}

/** Ligne de l'écran « Durées de match » : référence effective, historique mesuré, réglage du DT */
export interface DurationRow {
  key: DurationKey;
  reference: DurationEstimate;
  /** Historique du poste pour cette clé exacte (même sous le seuil de 30 matchs) */
  measured: DurationRecord | null;
  override: DurationRecord | null;
}

const keyLabel = (k: DurationKey) =>
  `${k.weapon}|${k.phase}|${k.maxScore}|${k.gender ?? ''}|${k.category ?? ''}`;

/** Clés par défaut (épée, fleuret, sabre ; poule en 5, tableau en 15), puis réglages et historique */
export function durationTable(
  config: MatchDurationConfig = DEFAULT_DURATION_CONFIG
): DurationRow[] {
  const sources = durationSources(config);
  const keys: DurationKey[] = [];
  for (const weapon of Object.keys(DEFAULTS)) {
    keys.push({ weapon, phase: 'pool', maxScore: 5 }, { weapon, phase: 'tableau', maxScore: 15 });
  }
  for (const r of [...config.overrides, ...(sources.history ?? [])]) {
    if (!keys.some(k => sameKey(k, r.key))) keys.push({ ...r.key });
  }
  return keys
    .map(key => ({
      key,
      reference: referenceDuration(key, sources),
      measured: sources.history?.find(r => sameKey(r.key, key)) ?? null,
      override: config.overrides.find(r => sameKey(r.key, key)) ?? null,
    }))
    .sort((a, b) => keyLabel(a.key).localeCompare(keyLabel(b.key)));
}

/** Réglage du DT posé (medianMs) ou retiré (null) pour une clé */
export function withDurationOverride(
  config: MatchDurationConfig,
  key: DurationKey,
  medianMs: number | null
): MatchDurationConfig {
  const rest = config.overrides.filter(r => !sameKey(r.key, key));
  return { ...config, overrides: medianMs ? [...rest, { key: { ...key }, medianMs }] : rest };
}
