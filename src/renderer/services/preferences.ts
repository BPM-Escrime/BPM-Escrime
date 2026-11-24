/**
 * BPM - Escrime - Préférences du poste dans le stockage du navigateur (#2203)
 * Un seul point d'accès à localStorage : clés et types déclarés dans PREFS, try/catch interne
 * (navigation privée, données de site bloquées, quota), valeur par défaut si la lecture échoue.
 * Réservé aux préférences par visionneuse : rien d'autre n'y va.
 * Licensed under GPL-3.0
 */
import { keyValueStore } from '../../shared/services/keyValueStore';

/** Accès sûr au stockage : ne lève jamais (lecture → null, écriture ignorée) */
export const safeStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem(key) {
    try {
      return keyValueStore().getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      keyValueStore().setItem(key, value);
    } catch {
      /* stockage indisponible ou plein : la préférence n'est pas retenue */
    }
  },
  removeItem(key) {
    try {
      keyValueStore().removeItem(key);
    } catch {
      /* stockage indisponible */
    }
  },
};

interface PrefDef<T> {
  /** Clé dans localStorage (inchangée : les valeurs déjà enregistrées restent lues) */
  key: string;
  read(raw: string | null): T;
  /** null → la clé est retirée */
  write(value: T): string | null;
}

const bool = (key: string, fallback: boolean): PrefDef<boolean> => ({
  key,
  read: raw => (raw === null ? fallback : raw === 'true'),
  write: v => String(v),
});

const text = (key: string, fallback: string): PrefDef<string> => ({
  key,
  read: raw => raw ?? fallback,
  write: v => v,
});

/** Table unique des préférences : clé de stockage, type et défaut */
export const PREFS = {
  /** Logo actif (data URL) : PDF, kiosque */
  logo: {
    key: 'bellepoule-logo',
    read: raw => raw,
    write: v => v,
  } as PrefDef<string | null>,
  webhookUrl: text('bellepoule-webhook-url', ''),
  /** Journal d'audit : actif sauf « false » enregistré */
  auditLog: {
    key: 'bellepoule-audit-log-enabled',
    read: raw => raw !== 'false',
    write: v => String(v),
  } as PrefDef<boolean>,
  quickMouseScoring: bool('bellepoule-quick-mouse-scoring', false),
  confettiDisabled: bool('bellepoule-confetti-disabled', false),
  simplifiedInput: bool('bellepoule-simplified-input-mode', false),
  chainedInput: bool('bellepoule-chained-input-mode', true),
  poolPdfHideStats: bool('bellepoule-pool-pdf-hide-stats', false),
  poolPdfLandscape: bool('bellepoule-pool-pdf-landscape', false),
  ttsConfig: text('bellepoule-tts-config', ''),
} satisfies Record<string, PrefDef<unknown>>;

type Prefs = typeof PREFS;
export type PrefName = keyof Prefs;
export type PrefValue<K extends PrefName> = ReturnType<Prefs[K]['read']>;

export function getPref<K extends PrefName>(name: K): PrefValue<K> {
  const def = PREFS[name] as PrefDef<PrefValue<K>>;
  return def.read(safeStorage.getItem(def.key));
}

export function setPref<K extends PrefName>(name: K, value: PrefValue<K>): void {
  const def = PREFS[name] as PrefDef<PrefValue<K>>;
  const raw = def.write(value);
  if (raw === null) safeStorage.removeItem(def.key);
  else safeStorage.setItem(def.key, raw);
}

export function removePref(name: PrefName): void {
  safeStorage.removeItem(PREFS[name].key);
}
