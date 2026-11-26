/**
 * BellePoule Modern - Sous-pistes (#1118, #2300) : plusieurs tablettes arbitrent en même temps
 * des matchs différents d'une même piste (vagues des rapières, poule de la piste sinon).
 * Chaque tablette réclame une sous-piste (`arena3`, `arena3s2`, `arena3s3`…), arène à part
 * entière (score, chrono, cartons) qui partage le mot de passe et la poule de la piste.
 * Licensed under GPL-3.0
 */
import type { Arena } from '../../shared/types/remote';

/** Sous-pistes au plus par piste (piste comprise) : 5 duels simultanés en poule de 10. */
export const MAX_SLOTS_PER_ARENA = 10;

const SLOT_RE = /^(arena\d+)s(\d+)$/;

/** Piste d'une sous-piste (`arena3s2` → `arena3`), identité sinon. */
export function baseArenaId(arenaId: string): string {
  const m = SLOT_RE.exec(arenaId);
  return m ? m[1] : arenaId;
}

export function isSlotArenaId(arenaId: string): boolean {
  return SLOT_RE.test(arenaId);
}

/** Arènes de la même piste (piste et sous-pistes), sauf `arenaId` lui-même. */
export function siblingArenas(arenas: Map<string, Arena>, arenaId: string): Arena[] {
  const base = baseArenaId(arenaId);
  return [...arenas.values()].filter(a => a.id !== arenaId && baseArenaId(a.id) === base);
}

/**
 * Matchs ouverts (non terminés) sur les autres sous-pistes : à ne pas proposer ici.
 * Un match seulement préchargé (premier de la liste) reste proposé : il n'est pris
 * qu'une fois ouvert par une tablette (`isOpened`) ou son chrono lancé.
 */
export function matchesTakenBySiblings(
  arenas: Map<string, Arena>,
  arenaId: string,
  isOpened: (arenaId: string) => boolean
): Set<string> {
  const taken = new Set<string>();
  for (const a of siblingArenas(arenas, arenaId)) {
    if (!a.currentMatch || a.status === 'finished') continue;
    if (a.status === 'in_progress' || a.currentMatch.startTime || isOpened(a.id)) {
      taken.add(a.currentMatch.id);
    }
  }
  return taken;
}

/** Match ouvert par une tablette ou lancé, non terminé : l'arène est occupée. */
export function isArenaBusy(
  arena: Arena | undefined,
  opened: { get(arenaId: string): boolean | undefined }
): boolean {
  if (!arena?.currentMatch || arena.status === 'finished') return false;
  return (
    arena.status === 'in_progress' ||
    !!arena.currentMatch.startTime ||
    opened.get(arena.id) === true
  );
}

/**
 * Hors vagues (#2300) : sous-pistes seulement pour une piste de poule (matchs partagés par la
 * poule, comme les vagues). Ni tableau (un match à la fois sur la piste, file propre à la
 * piste), ni entraînement ou Mode Club.
 */
export function sharesPool(parent: Arena, trainingMode: boolean): boolean {
  if (trainingMode) return false;
  const cur = parent.currentMatch;
  if (cur?.isTableau) return false;
  const poolId = cur?.poolId ?? parent.activePoolId;
  return !!poolId && poolId !== '__training__';
}

/** Copie vierge de la piste pour une sous-piste (même numéro, mot de passe, réglages). */
export function createSlotArena(parent: Arena, slot: number): Arena {
  return {
    id: `${parent.id}s${slot}`,
    name: `${parent.name} · ${slot}`,
    number: parent.number,
    currentMatch: null,
    activePoolId: parent.activePoolId,
    status: 'idle',
    startTime: null,
    settings: { ...parent.settings },
    password: parent.password,
  };
}

/** Attribution des sous-pistes aux tablettes (clé persistante de l'appareil). */
export class ArenaSlotRegistry {
  /** arène (piste ou sous-piste) → clé de la tablette qui l'occupe */
  private owners = new Map<string, string>();

  /**
   * Sous-piste de la tablette `deviceKey` sur la piste `baseId` : la sienne si elle en a
   * déjà une (rechargement), sinon la première libre (sans tablette, aucun match en cours),
   * créée au besoin via `create`, en préférant `preferred` (sous-piste actuelle de la
   * tablette, pour éviter un changement à chaque vague). `null` si piste inconnue ou pleine.
   */
  claim(
    arenas: Map<string, Arena>,
    baseId: string,
    deviceKey: string,
    create: (parent: Arena, slot: number) => Arena,
    preferred?: string
  ): string | null {
    const parent = arenas.get(baseId);
    if (!parent) return null;
    for (const [id, key] of this.owners) {
      if (key === deviceKey && baseArenaId(id) === baseId && arenas.has(id)) return id;
    }
    const free = (id: string) => !this.owners.has(id) && arenas.get(id)?.status !== 'in_progress';
    if (preferred && preferred !== baseId && baseArenaId(preferred) === baseId) {
      if (arenas.has(preferred) && free(preferred)) {
        this.owners.set(preferred, deviceKey);
        return preferred;
      }
    }
    for (let slot = 1; slot <= MAX_SLOTS_PER_ARENA; slot++) {
      const id = slot === 1 ? baseId : `${baseId}s${slot}`;
      if (!free(id)) continue;
      if (!arenas.has(id)) create(parent, slot);
      this.owners.set(id, deviceKey);
      return id;
    }
    return null;
  }

  /**
   * Hors vagues (#2300) : plusieurs tablettes arbitrent les matchs de la poule d'une piste.
   * La piste d'abord ; une sous-piste seulement si la piste est tenue par une autre tablette
   * encore connectée (`present`). Une tablette absente ne bloque rien : sa remplaçante reprend
   * la piste et son match. La tablette garde sa sous-piste tant qu'elle y a un match ouvert ou
   * lancé (`busy`), sinon elle revient sur la piste dès qu'elle est libre. Les sous-pistes
   * sans tablette connectée ni match ouvert sont supprimées (`drop`). `null` si piste inconnue
   * ou pleine.
   */
  claimShared(
    arenas: Map<string, Arena>,
    baseId: string,
    deviceKey: string,
    create: (parent: Arena, slot: number) => Arena,
    present: (arenaId: string) => boolean,
    busy: (arenaId: string) => boolean,
    drop: (arenaId: string) => void
  ): string | null {
    const parent = arenas.get(baseId);
    if (!parent) return null;
    const mine = (id: string) => this.owners.get(id) === deviceKey;
    const heldByOther = (id: string) => this.owners.has(id) && !mine(id) && present(id);
    let claimed: string | null = null;
    const own = [...this.owners.keys()].find(
      id => mine(id) && id !== baseId && baseArenaId(id) === baseId && arenas.has(id)
    );
    if (own && busy(own)) claimed = own;
    for (let slot = 1; !claimed && slot <= MAX_SLOTS_PER_ARENA; slot++) {
      const id = slot === 1 ? baseId : `${baseId}s${slot}`;
      if (heldByOther(id)) continue;
      if (!arenas.has(id)) create(parent, slot);
      claimed = id;
    }
    if (!claimed) return null;
    for (const [id, key] of [...this.owners]) {
      if (key !== deviceKey || id === claimed || baseArenaId(id) !== baseId) continue;
      this.owners.delete(id);
      // Sous-piste quittée par sa tablette, sans match ouvert : supprimée
      if (isSlotArenaId(id) && arenas.has(id) && !busy(id)) drop(id);
    }
    this.owners.set(claimed, deviceKey);
    for (const a of siblingArenas(arenas, claimed)) {
      if (!isSlotArenaId(a.id) || present(a.id) || busy(a.id)) continue;
      this.owners.delete(a.id);
      drop(a.id);
    }
    return claimed;
  }

  /**
   * Nouvelle vague / fin des vagues : libère les sous-pistes sans match en cours, les
   * tablettes concernées sont réattribuées à leur prochaine demande.
   */
  release(arenas: Map<string, Arena>): void {
    for (const id of [...this.owners.keys()]) {
      const a = arenas.get(id);
      if (!a?.currentMatch || a.status === 'finished') this.owners.delete(id);
    }
  }
}

/** Socket.IO du serveur, pour savoir quelles tablettes arbitre sont connectées */
interface RefereeSockets {
  sockets?: {
    sockets?: Map<string, { connected: boolean; data?: { refereeArenaId?: string } }>;
  };
}

/** Tablette arbitre connectée sur l'arène (`join_arena` en rôle `referee`, #2300) */
export function isRefereeConnected(io: RefereeSockets | undefined, arenaId: string): boolean {
  const sockets = [...(io?.sockets?.sockets?.values() ?? [])];
  return sockets.some(s => s.connected && s.data?.refereeArenaId === arenaId);
}

/** État du serveur lu par `claimArenaSlot` (accesseurs : valeurs toujours à jour) */
export interface SlotClaimContext {
  readonly arenas: Map<string, Arena>;
  readonly arenaMatchQueue: Map<string, unknown[]>;
  /** Match ouvert par la tablette de l'arène */
  readonly arenaRefereeSelected: Map<string, boolean>;
  readonly arenaSlots: ArenaSlotRegistry;
  /** Vagues des rapières : matchs de la vague active, `null` hors vagues */
  readonly activeWaveMatchIds: Set<string> | null;
  readonly isTrainingMode: boolean;
  readonly io: RefereeSockets | undefined;
}

/** Champs du serveur exposés à `SlotClaimContext` via liveContext */
export const SLOT_CLAIM_CONTEXT_KEYS = {
  state: [
    'arenas',
    'arenaMatchQueue',
    'arenaRefereeSelected',
    'arenaSlots',
    'activeWaveMatchIds',
    'isTrainingMode',
    'io',
  ],
  methods: [],
} as const;

/**
 * Sous-piste attribuée à une tablette arbitre : pendant les vagues des rapières (#1118), et
 * hors vagues quand la piste arbitre une poule (#2300) ; sinon la piste elle-même.
 */
export function claimArenaSlot(
  ctx: SlotClaimContext,
  req: { arenaId: string; deviceKey: string; current?: string }
): string {
  const { arenaId, deviceKey, current } = req;
  const { arenas, arenaMatchQueue: queues, arenaRefereeSelected: opened, arenaSlots } = ctx;
  const base = baseArenaId(arenaId.startsWith('arena') ? arenaId : `arena${arenaId}`);
  if (!deviceKey) return base;
  const create = (parent: Arena, slot: number) => {
    const arena = createSlotArena(parent, slot);
    arenas.set(arena.id, arena);
    queues.set(arena.id, []);
    return arena;
  };
  if (ctx.activeWaveMatchIds !== null) {
    return arenaSlots.claim(arenas, base, deviceKey, create, current) ?? base;
  }
  const parent = arenas.get(base);
  if (!parent || !sharesPool(parent, ctx.isTrainingMode)) return base;
  const present = (id: string) => isRefereeConnected(ctx.io, id);
  const busy = (id: string) => isArenaBusy(arenas.get(id), opened);
  const drop = (id: string) => {
    arenas.delete(id);
    queues.delete(id);
    opened.delete(id);
  };
  return arenaSlots.claimShared(arenas, base, deviceKey, create, present, busy, drop) ?? base;
}
