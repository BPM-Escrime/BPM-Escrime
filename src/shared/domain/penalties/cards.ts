/**
 * BPM - Escrime - Cartons individuels, règles pures (docs/adr/0028 lot D, 0002). Deux règlements :
 * FIE pour épée, fleuret, sabre (#2207) ; Sabre Laser, barème provisoire (#2208).
 * Licensed under GPL-3.0
 */

import { Card, CardGroup, CardReason, Weapon, WeaponCardConfig } from '../../types';
import { CardType } from './penalty.types';

// Sabre Laser (ASL-FFE) : groupes du règlement FFE Sabre Laser
const LASER_REASON_TO_GROUP: Partial<Record<CardReason, CardGroup>> = {
  [CardReason.EARLY_START]: CardGroup.GROUP_1,
  [CardReason.LATE_STOP]: CardGroup.GROUP_1,
  [CardReason.BODY_CONTACT]: CardGroup.GROUP_1,
  [CardReason.COUNTER_ATTACK]: CardGroup.GROUP_1,
  [CardReason.TARGET_SUBSTITUTION]: CardGroup.GROUP_1,
  [CardReason.VOLUNTARY_DROP]: CardGroup.GROUP_1,
  [CardReason.TIME_WASTING]: CardGroup.GROUP_1,
  [CardReason.NON_COMPLIANT_GEAR]: CardGroup.GROUP_1,
  // Livret 2 VI.14, VII.2.5 : touche lourde = 1er groupe (#2209)
  [CardReason.HEAVY_HIT]: CardGroup.GROUP_1,
  [CardReason.ESTOC]: CardGroup.GROUP_2,
  [CardReason.UNARMED_HAND]: CardGroup.GROUP_2,
  [CardReason.VOLUNTARY_EXIT]: CardGroup.GROUP_2,
  [CardReason.BRUTALITY]: CardGroup.GROUP_3,
  [CardReason.DANGEROUS]: CardGroup.GROUP_3,
  [CardReason.REFUSAL]: CardGroup.GROUP_4,
  [CardReason.UNSPORTSMANLIKE]: CardGroup.GROUP_4,
  [CardReason.CHEATING]: CardGroup.GROUP_4,
};

// Motifs du Sabre Laser, figés : les motifs olympiques de CardReason n'y entrent pas
const LASER_REASONS = Object.keys(LASER_REASON_TO_GROUP) as CardReason[];

const CLASSICAL_SCORE_IMPACT = { white: 0, yellow: 1, red: 1, black: 0 };

// Provisoire (#2208) : barème de la tablette (docs/ARBITRAGE.md § 3.4), parité testée
const LASER_SCORE_IMPACT = { white: 0, yellow: 3, red: 5, black: 0 };

// Escrime olympique (FIE) : tableau t.170 du règlement technique FIE, motifs rangés dans leur groupe
const FIE_REASON_TO_GROUP: Partial<Record<CardReason, CardGroup>> = {
  [CardReason.FIE_LEAVING_PISTE]: CardGroup.GROUP_1,
  [CardReason.FIE_BODY_CONTACT]: CardGroup.GROUP_1,
  [CardReason.FIE_TURNING_BACK]: CardGroup.GROUP_1,
  [CardReason.FIE_COVERING_TARGET]: CardGroup.GROUP_1,
  [CardReason.FIE_TOUCHING_EQUIPMENT]: CardGroup.GROUP_1,
  [CardReason.FIE_LATERAL_EXIT]: CardGroup.GROUP_1,
  [CardReason.FIE_UNJUSTIFIED_STOP]: CardGroup.GROUP_1,
  [CardReason.FIE_NON_COMPLIANT_EQUIPMENT]: CardGroup.GROUP_1,
  [CardReason.FIE_STRAIGHTENING_BLADE]: CardGroup.GROUP_1,
  [CardReason.FIE_POINT_ON_PISTE]: CardGroup.GROUP_1,
  [CardReason.FIE_SABRE_FORWARD_CROSS]: CardGroup.GROUP_1,
  [CardReason.FIE_DISOBEDIENCE]: CardGroup.GROUP_1,
  [CardReason.FIE_NON_COMPLIANT_HAIR]: CardGroup.GROUP_1,
  [CardReason.FIE_JOSTLING]: CardGroup.GROUP_1,
  [CardReason.FIE_ABNORMAL_MOVEMENT]: CardGroup.GROUP_1,
  [CardReason.FIE_UNJUSTIFIED_APPEAL]: CardGroup.GROUP_1,
  [CardReason.FIE_UNARMED_ARM]: CardGroup.GROUP_2,
  [CardReason.FIE_MEDICAL_PRETEXT]: CardGroup.GROUP_2,
  [CardReason.FIE_MISSING_CONTROL_MARK]: CardGroup.GROUP_2,
  [CardReason.FIE_DROPPING_WEAPON]: CardGroup.GROUP_2,
  [CardReason.FIE_HIT_OFF_TARGET]: CardGroup.GROUP_2,
  [CardReason.FIE_VIOLENT_ACT]: CardGroup.GROUP_2,
  [CardReason.FIE_DISORDER]: CardGroup.GROUP_3,
  [CardReason.FIE_UNFAIR_FIGHT]: CardGroup.GROUP_3,
  [CardReason.FIE_ADVERTISING]: CardGroup.GROUP_3,
  [CardReason.FIE_UNSPORTING]: CardGroup.GROUP_3,
  [CardReason.FIE_ELECTRONIC_DEVICE]: CardGroup.GROUP_4,
  [CardReason.FIE_FRAUD]: CardGroup.GROUP_4,
  [CardReason.FIE_TAMPERED_EQUIPMENT]: CardGroup.GROUP_4,
  [CardReason.FIE_REFUSAL_TO_FENCE]: CardGroup.GROUP_4,
  [CardReason.FIE_SPORTING_SPIRIT]: CardGroup.GROUP_4,
  [CardReason.FIE_REFUSAL_TO_SALUTE]: CardGroup.GROUP_4,
  [CardReason.FIE_COLLUSION]: CardGroup.GROUP_4,
  [CardReason.FIE_VIOLENCE]: CardGroup.GROUP_4,
};

// Motifs propres à une arme (t.170 1.10 : fleuret et épée ; 1.12 : sabre)
const FIE_FOIL_EPEE_ONLY: CardReason[] = [CardReason.FIE_POINT_ON_PISTE];
const FIE_SABRE_ONLY: CardReason[] = [CardReason.FIE_SABRE_FORWARD_CROSS];

const fieReasons = (excluded: CardReason[]): CardReason[] =>
  (Object.keys(FIE_REASON_TO_GROUP) as CardReason[]).filter(r => !excluded.includes(r));

// Jaune = avertissement sans point (t.162.1), rouge = une touche à l'adversaire (t.162.2)
const FIE_SCORE_IMPACT = { white: 0, yellow: 0, red: 1, black: 0 };

export const WEAPON_CARD_CONFIGS: Record<Weapon, WeaponCardConfig> = {
  [Weapon.EPEE]: {
    availableReasons: fieReasons(FIE_SABRE_ONLY),
    reasonToGroup: FIE_REASON_TO_GROUP,
    scoreImpact: FIE_SCORE_IMPACT,
    escalation: 'fie',
  },
  [Weapon.FOIL]: {
    availableReasons: fieReasons(FIE_SABRE_ONLY),
    reasonToGroup: FIE_REASON_TO_GROUP,
    scoreImpact: FIE_SCORE_IMPACT,
    escalation: 'fie',
  },
  [Weapon.SABRE]: {
    availableReasons: fieReasons(FIE_FOIL_EPEE_ONLY),
    reasonToGroup: FIE_REASON_TO_GROUP,
    scoreImpact: FIE_SCORE_IMPACT,
    escalation: 'fie',
  },
  [Weapon.LASER]: {
    availableReasons: LASER_REASONS,
    reasonToGroup: LASER_REASON_TO_GROUP,
    scoreImpact: LASER_SCORE_IMPACT,
  },
  [Weapon.CUSTOM]: {
    availableReasons: LASER_REASONS,
    reasonToGroup: LASER_REASON_TO_GROUP,
    scoreImpact: CLASSICAL_SCORE_IMPACT,
  },
};

export function getWeaponCardConfig(weapon: Weapon): WeaponCardConfig {
  return WEAPON_CARD_CONFIGS[weapon];
}

export function getAvailableReasons(weapon: Weapon): CardReason[] {
  return WEAPON_CARD_CONFIGS[weapon].availableReasons;
}

export function getReasonsByGroupForWeapon(weapon: Weapon): Record<CardGroup, CardReason[]> {
  const config = WEAPON_CARD_CONFIGS[weapon];
  const grouped: Record<CardGroup, CardReason[]> = {
    [CardGroup.GROUP_1]: [],
    [CardGroup.GROUP_2]: [],
    [CardGroup.GROUP_3]: [],
    [CardGroup.GROUP_4]: [],
  };
  for (const reason of config.availableReasons) {
    const group = config.reasonToGroup[reason];
    if (group !== undefined) grouped[group].push(reason);
  }
  return grouped;
}

export interface CardResult {
  type: CardType;
  shouldExclude: boolean;
  points: number;
}

/** Carton déjà reçu ; groupe nul : carton d'appareil de piste (ADR-0028 q. 6) */
export interface PriorCard {
  type: string;
  group?: CardGroup | null;
}

/** Groupe d'un motif : celui de l'arme, sinon celui du Sabre Laser (motif hors liste) */
function groupOf(reason: CardReason, config: WeaponCardConfig | null): CardGroup | undefined {
  return config?.reasonToGroup[reason] ?? LASER_REASON_TO_GROUP[reason];
}

/**
 * Règlement technique FIE, t.165 à t.169. Les cartons précédents sont ceux du tireur
 * dans le match (ou la rencontre par équipes, t.159), au choix de l'appelant.
 */
function fieCardType(
  group: CardGroup,
  previousCards: readonly PriorCard[],
  si: WeaponCardConfig['scoreImpact']
): CardResult {
  const red: CardResult = { type: CardType.RED, shouldExclude: false, points: si.red };
  const black: CardResult = { type: CardType.BLACK, shouldExclude: true, points: si.black };
  switch (group) {
    case CardGroup.GROUP_1: {
      // t.165 : jaune à la 1re faute du groupe, rouge à chaque nouvelle ; rouge d'emblée
      // si le tireur a déjà un rouge reçu au titre du 2e ou du 3e groupe
      const repeat = previousCards.some(c => c.group === CardGroup.GROUP_1);
      const redBefore = previousCards.some(
        c =>
          c.type === CardType.RED &&
          (c.group === CardGroup.GROUP_2 || c.group === CardGroup.GROUP_3)
      );
      if (repeat || redBefore) return red;
      return { type: CardType.YELLOW, shouldExclude: false, points: si.yellow };
    }
    case CardGroup.GROUP_2:
      return red; // t.166
    case CardGroup.GROUP_3:
      // t.167 : rouge, puis noir à la récidive dans le groupe
      return previousCards.some(c => c.group === CardGroup.GROUP_3) ? black : red;
    default:
      return black; // t.169
  }
}

// Sabre Laser et arme à la carte, inchangé (#2209) : [1re faute du groupe, récidive]
const LASER_STEPS: Record<CardGroup, [CardType, CardType]> = {
  [CardGroup.GROUP_1]: [CardType.WHITE, CardType.YELLOW],
  [CardGroup.GROUP_2]: [CardType.YELLOW, CardType.RED],
  [CardGroup.GROUP_3]: [CardType.RED, CardType.BLACK],
  [CardGroup.GROUP_4]: [CardType.BLACK, CardType.BLACK],
};

/** Type du carton dû, d'après les cartons du tireur (match, ou rencontre par équipes) */
export function determineCardType(
  reason: CardReason,
  previousCards: readonly PriorCard[],
  weapon?: Weapon
): CardResult {
  const config = weapon !== undefined ? WEAPON_CARD_CONFIGS[weapon] : null;
  const si = config?.scoreImpact ?? { white: 0, yellow: 1, red: 1, black: 0 };

  if (config?.escalation === 'fie') {
    // Jamais de blanc en escrime olympique : motif inconnu = faute du 1er groupe
    return fieCardType(groupOf(reason, config) ?? CardGroup.GROUP_1, previousCards, si);
  }

  const group = (config?.reasonToGroup ?? LASER_REASON_TO_GROUP)[reason];
  if (group === undefined) return { type: CardType.WHITE, shouldExclude: false, points: 0 };
  const type = LASER_STEPS[group][previousCards.some(c => c.group === group) ? 1 : 0];
  const points = si[type.toLowerCase() as keyof typeof si];
  return { type, shouldExclude: type === CardType.BLACK, points };
}

/** `id` et `at` : tirés par l'appelant (ADR-0002) */
export interface BuildCardInput {
  id: string;
  at: Date;
  matchId: string;
  fencerId: string;
  reason: CardReason;
  previousCards: readonly PriorCard[];
  weapon?: Weapon;
}

/** Carton individuel : type, groupe, points et exclusion calculés ; id et heure injectés */
export function buildCard({
  id,
  at,
  matchId,
  fencerId,
  reason,
  previousCards,
  weapon,
}: BuildCardInput): Card {
  const { type, shouldExclude, points } = determineCardType(reason, previousCards, weapon);
  const config = weapon !== undefined ? WEAPON_CARD_CONFIGS[weapon] : null;
  // Groupe du motif ; en escrime olympique, 1er groupe à défaut
  const group =
    groupOf(reason, config) ?? (config?.escalation === 'fie' ? CardGroup.GROUP_1 : undefined);
  return {
    id,
    matchId,
    fencerId,
    type,
    reason,
    group: group as CardGroup,
    timestamp: at,
    pointsAwarded: points,
    resultingExclusion: shouldExclude,
  };
}

export function getCardsForFencer(fencerId: string, matchCards: Card[]): Card[] {
  return matchCards.filter(card => card.fencerId === fencerId);
}

export function isFencerExcluded(fencerId: string, matchCards: Card[]): boolean {
  return getCardsForFencer(fencerId, matchCards).some(card => card.resultingExclusion);
}
