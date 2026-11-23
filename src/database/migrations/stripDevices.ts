/**
 * BPM - Escrime - Migration 47 : appareils de piste déclarés sur la salle
 * (docs/adr/0023, docs/adr/0019 décision 2). SQL seul (le moteur de migration n'exécute que du
 * SQL) ; la liste des conflits est relue après coup par `stripDeviceDiagnostics`.
 * - `competitions.venue_id` : salle propre de l'épreuve ;
 * - `venue_strips.cyrano_config` renommée `device_config` ; anciennes configurations Cyrano
 *   normalisées (`protocol: 'cyrano'`, ancienne version EFP1 / EFP1.1 / auto dans `version`) ;
 * - reprise de `cyrano_pistes` : clé `day:<id>` → salle de la journée, clé = épreuve → salle de
 *   la journée de l'épreuve, sinon salle par défaut (créée s'il n'y en a aucune) ; pistes de
 *   salle manquantes créées ; une piste qui déclare déjà un appareil n'est jamais écrasée.
 *   Plusieurs candidates : journée d'abord, puis la plus récente. `cyrano_pistes` reste en
 *   lecture seule jusqu'à la 3.0.
 * Licensed under GPL-3.0
 */

/** Ancienne configuration Cyrano (objet JSON) → déclaration normalisée ; invalide : NULL */
const normalized = (c: string) => `CASE
  WHEN ${c} IS NULL OR NOT json_valid(${c}) OR json_type(${c}) <> 'object' THEN NULL
  WHEN json_extract(${c}, '$.protocol') IN ('cyrano', 'opp2') THEN json(${c})
  WHEN COALESCE(json_type(${c}, '$.ip'), '') <> 'text' OR trim(json_extract(${c}, '$.ip')) = '' THEN NULL
  ELSE json_set(json_remove(${c}, '$.protocol', '$.piste'), '$.protocol', 'cyrano', '$.version',
    CASE WHEN json_extract(${c}, '$.protocol') IN ('EFP1', 'EFP1.1')
      THEN json_extract(${c}, '$.protocol') ELSE 'auto' END)
END`;

/** Lignes de cyrano_pistes, salle cible, numéro de piste de salle et déclaration normalisée */
const CANDIDATES = `
WITH def AS (SELECT id FROM venues WHERE is_default = 1 LIMIT 1),
src AS (
  SELECT cp.competition_id AS source, cp.piste, cp.position, cp.config AS raw,
    CASE WHEN cp.competition_id LIKE 'day:%' THEN 0 ELSE 1 END AS rank,
    CASE WHEN cp.competition_id LIKE 'day:%'
      THEN (SELECT d.venue_id FROM event_days d JOIN venues v ON v.id = d.venue_id
            WHERE d.id = substr(cp.competition_id, 5))
      ELSE (SELECT d.venue_id FROM competitions c JOIN event_days d ON d.id = c.event_day_id
            JOIN venues v ON v.id = d.venue_id WHERE c.id = cp.competition_id)
    END AS day_venue,
    CASE WHEN cp.competition_id LIKE 'day:%'
      THEN (SELECT date FROM event_days WHERE id = substr(cp.competition_id, 5))
      ELSE (SELECT date FROM competitions WHERE id = cp.competition_id)
    END AS sort_date
  FROM cyrano_pistes cp
),
cand AS (
  SELECT source, piste, position, rank, sort_date,
    COALESCE(day_venue, (SELECT id FROM def)) AS venue_id,
    CASE WHEN piste <> '' AND piste NOT GLOB '*[^0-9]*' AND CAST(piste AS INTEGER) BETWEEN 1 AND 100
      THEN CAST(piste AS INTEGER) END AS number,
    ${normalized('raw')} AS config
  FROM src
)`;

/** Ordre des candidates d'une même piste : journée, puis la plus récente */
const ORDER = 'ORDER BY c.rank, c.sort_date DESC, c.source, c.position';

/** Instructions de la migration 47, dans l'ordre */
export const STRIP_DEVICES_MIGRATION: readonly string[] = [
  `ALTER TABLE competitions ADD COLUMN venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL`,
  `ALTER TABLE venue_strips RENAME COLUMN cyrano_config TO device_config`,
  // Déclarations de salle existantes (Cyrano, #1880) : protocole explicite
  `UPDATE venue_strips SET device_config = ${normalized('device_config')}
   WHERE device_config IS NOT NULL AND ${normalized('device_config')} IS NOT NULL`,
  // Aucune salle par défaut et des appareils sans journée à reprendre : salle par défaut créée
  `${CANDIDATES}
   INSERT INTO venues (id, name, is_default, created_at, updated_at)
   SELECT lower(hex(randomblob(16))), 'Salle principale', 1, datetime('now'), datetime('now')
   WHERE NOT EXISTS (SELECT 1 FROM venues WHERE is_default = 1)
     AND EXISTS (SELECT 1 FROM cand WHERE venue_id IS NULL AND number IS NOT NULL AND config IS NOT NULL)`,
  `${CANDIDATES}
   INSERT OR IGNORE INTO venue_strips (venue_id, number, label, device_config)
   SELECT DISTINCT venue_id, number, NULL, NULL FROM cand
   WHERE venue_id IS NOT NULL AND number IS NOT NULL AND config IS NOT NULL`,
  `${CANDIDATES}
   UPDATE venue_strips SET device_config = (
     SELECT c.config FROM cand c
     WHERE c.venue_id = venue_strips.venue_id AND c.number = venue_strips.number
       AND c.config IS NOT NULL ${ORDER} LIMIT 1)
   WHERE device_config IS NULL AND EXISTS (
     SELECT 1 FROM cand c WHERE c.venue_id = venue_strips.venue_id
       AND c.number = venue_strips.number AND c.config IS NOT NULL)`,
];

const FIELDS = ['protocol', 'ip', 'port', 'arena', 'mode', 'version', 'opp2Id'];

/** Lignes de cyrano_pistes non reprises telles quelles : hors salle, invalides ou en conflit */
export const STRIP_DEVICE_CONFLICTS_SQL = `${CANDIDATES}
SELECT c.source, c.piste, c.venue_id AS venueId, c.number, c.config,
  s.device_config AS kept
FROM cand c
LEFT JOIN venue_strips s ON s.venue_id = c.venue_id AND s.number = c.number
WHERE c.number IS NULL OR c.config IS NULL OR c.venue_id IS NULL OR s.device_config IS NULL
  OR NOT json_valid(s.device_config)
  OR ${FIELDS.map(f => `json_extract(c.config, '$.${f}') IS NOT json_extract(s.device_config, '$.${f}')`).join('\n  OR ')}
ORDER BY c.source, c.position`;

export interface StripDeviceConflictRow {
  source: string;
  piste: string;
  venueId: string | null;
  number: number | null;
  config: string | null;
  kept: string | null;
}

/** Message du journal de diagnostic pour une ligne non reprise */
export function describeStripDeviceConflict(row: StripDeviceConflictRow): string {
  const where = `${row.source.startsWith('day:') ? 'journée' : 'épreuve'} ${row.source.replace(/^day:/, '')}, piste « ${row.piste} »`;
  if (row.number === null)
    return `Appareil de piste non repris (${where}) : numéro hors salle (1 à 100)`;
  if (row.config === null)
    return `Appareil de piste non repris (${where}) : configuration invalide`;
  if (row.venueId === null) return `Appareil de piste non repris (${where}) : aucune salle`;
  return `Appareil de piste en conflit (${where}) : salle ${row.venueId}, piste ${row.number} garde ${row.kept ?? '—'}, ignoré ${row.config}`;
}

/** Conflits de la reprise, en clair (journal de diagnostic au démarrage) */
export function stripDeviceDiagnostics(db: { all<T>(sql: string): T[] }): string[] {
  return db
    .all<StripDeviceConflictRow>(STRIP_DEVICE_CONFLICTS_SQL)
    .map(describeStripDeviceConflict);
}
