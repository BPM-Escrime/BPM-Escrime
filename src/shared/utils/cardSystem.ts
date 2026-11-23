/**
 * BPM - Escrime - Card System
 * Sabre Laser et arme à la carte : règlement FFE Sabre Laser 2025-2026.
 * Épée, fleuret, sabre : règlement technique FIE (décembre 2025), t.158 à t.170 (#2207).
 * Licensed under GPL-3.0
 */

import { v4 as uuidv4 } from 'uuid';
import { Card, CardGroup, CardReason, Weapon, WeaponCardConfig } from '../types';
import { CardType } from '../domain/penalties/penalty.types';

// Sabre Laser (et arme à la carte) : groupes du règlement FFE Sabre Laser
const REASON_TO_GROUP: Partial<Record<CardReason, CardGroup>> = {
  [CardReason.EARLY_START]: CardGroup.GROUP_1,
  [CardReason.LATE_STOP]: CardGroup.GROUP_1,
  [CardReason.BODY_CONTACT]: CardGroup.GROUP_1,
  [CardReason.COUNTER_ATTACK]: CardGroup.GROUP_1,
  [CardReason.TARGET_SUBSTITUTION]: CardGroup.GROUP_1,
  [CardReason.VOLUNTARY_DROP]: CardGroup.GROUP_1,
  [CardReason.TIME_WASTING]: CardGroup.GROUP_1,
  [CardReason.NON_COMPLIANT_GEAR]: CardGroup.GROUP_1,
  [CardReason.ESTOC]: CardGroup.GROUP_2,
  [CardReason.UNARMED_HAND]: CardGroup.GROUP_2,
  [CardReason.VOLUNTARY_EXIT]: CardGroup.GROUP_2,
  [CardReason.HEAVY_HIT]: CardGroup.GROUP_2,
  [CardReason.BRUTALITY]: CardGroup.GROUP_3,
  [CardReason.DANGEROUS]: CardGroup.GROUP_3,
  [CardReason.REFUSAL]: CardGroup.GROUP_4,
  [CardReason.UNSPORTSMANLIKE]: CardGroup.GROUP_4,
  [CardReason.CHEATING]: CardGroup.GROUP_4,
};

// Motifs du Sabre Laser, figés : les motifs olympiques de CardReason n'y entrent pas
const LASER_REASONS = Object.keys(REASON_TO_GROUP) as CardReason[];

const CLASSICAL_SCORE_IMPACT = { white: 0, yellow: 1, red: 1, black: 0 };

// Escrime olympique : tableau t.170 du règlement technique FIE, motifs rangés dans leur groupe
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
    reasonToGroup: REASON_TO_GROUP,
    scoreImpact: { white: 0, yellow: 1, red: 1, black: 0 },
  },
  [Weapon.CUSTOM]: {
    availableReasons: LASER_REASONS,
    reasonToGroup: REASON_TO_GROUP,
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

export const CARD_REASON_LABELS: Record<CardReason, string> = {
  [CardReason.EARLY_START]: 'Départ anticipé',
  [CardReason.LATE_STOP]: 'Continue après "Cessez!"',
  [CardReason.BODY_CONTACT]: 'Corps à corps volontaire',
  [CardReason.COUNTER_ATTACK]: 'Contre-attaque',
  [CardReason.TARGET_SUBSTITUTION]: 'Substitution de cible',
  [CardReason.VOLUNTARY_DROP]: 'Lâcher de sabre volontaire',
  [CardReason.TIME_WASTING]: 'Perte de temps',
  [CardReason.NON_COMPLIANT_GEAR]: 'Matériel non conforme',
  [CardReason.ESTOC]: 'Coup de pointe (estoc)',
  [CardReason.UNARMED_HAND]: 'Usage main non armée',
  [CardReason.VOLUNTARY_EXIT]: 'Sortie volontaire',
  [CardReason.HEAVY_HIT]: 'Frappe lourde',
  [CardReason.BRUTALITY]: 'Brutalité',
  [CardReason.DANGEROUS]: 'Comportement dangereux',
  [CardReason.REFUSAL]: 'Refus de combattre',
  [CardReason.UNSPORTSMANLIKE]: 'Anti-sportif',
  [CardReason.CHEATING]: 'Tricherie',
  [CardReason.FIE_LEAVING_PISTE]: 'Abandon de la piste sans autorisation',
  [CardReason.FIE_BODY_CONTACT]: 'Corps à corps pour éviter une touche',
  [CardReason.FIE_TURNING_BACK]: "Tourner le dos à l'adversaire",
  [CardReason.FIE_COVERING_TARGET]: 'Couverture ou substitution de la surface valable',
  [CardReason.FIE_TOUCHING_EQUIPMENT]: 'Toucher ou saisir le matériel électrique',
  [CardReason.FIE_LATERAL_EXIT]: 'Sortie latérale de la piste pour éviter une touche',
  [CardReason.FIE_UNJUSTIFIED_STOP]: 'Interruption abusive du combat',
  [CardReason.FIE_NON_COMPLIANT_EQUIPMENT]: 'Tenue ou matériel non conformes, rechange absent',
  [CardReason.FIE_STRAIGHTENING_BLADE]: "Poser l'arme sur la piste pour la redresser",
  [CardReason.FIE_POINT_ON_PISTE]: 'Appuyer ou traîner la pointe sur la piste conductrice',
  [CardReason.FIE_SABRE_FORWARD_CROSS]:
    'Touche de coquille, passe-avant, flèche en croisant les jambes',
  [CardReason.FIE_DISOBEDIENCE]: "Refus d'obéissance",
  [CardReason.FIE_NON_COMPLIANT_HAIR]: 'Cheveux non conformes',
  [CardReason.FIE_JOSTLING]: 'Bousculade, jeu désordonné, masque retiré avant « Halte »',
  [CardReason.FIE_ABNORMAL_MOVEMENT]: 'Déplacements anormaux, coups brutaux, chute intentionnelle',
  [CardReason.FIE_UNJUSTIFIED_APPEAL]: 'Réclamation injustifiée',
  [CardReason.FIE_UNARMED_ARM]: 'Utilisation du bras ou de la main non armés',
  [CardReason.FIE_MEDICAL_PRETEXT]: 'Arrêt pour raison médicale non reconnue',
  [CardReason.FIE_MISSING_CONTROL_MARK]: 'Absence de marque de contrôle',
  [CardReason.FIE_DROPPING_WEAPON]: "Lâcher intentionnellement l'arme pendant la phrase d'armes",
  [CardReason.FIE_HIT_OFF_TARGET]: "Touche volontairement portée en dehors de l'adversaire",
  [CardReason.FIE_VIOLENT_ACT]:
    'Acte violent, dangereux ou vindicatif, coup de coquille ou de pommeau',
  [CardReason.FIE_DISORDER]: "Tireur troublant l'ordre sur la piste",
  [CardReason.FIE_UNFAIR_FIGHT]: 'Combat non loyal',
  [CardReason.FIE_ADVERTISING]: 'Faute concernant la publicité',
  [CardReason.FIE_UNSPORTING]: 'Comportement antisportif',
  [CardReason.FIE_ELECTRONIC_DEVICE]: 'Équipement électronique de communication',
  [CardReason.FIE_FRAUD]: 'Fraude sur les marques de contrôle',
  [CardReason.FIE_TAMPERED_EQUIPMENT]: "Matériel aménagé pour fausser l'appareil",
  [CardReason.FIE_REFUSAL_TO_FENCE]: 'Refus de rencontrer un tireur',
  [CardReason.FIE_SPORTING_SPIRIT]: "Faute contre l'esprit sportif",
  [CardReason.FIE_REFUSAL_TO_SALUTE]: 'Refus du salut',
  [CardReason.FIE_COLLUSION]: "Favoriser l'adversaire, collusion",
  [CardReason.FIE_VIOLENCE]: 'Violences ou actes vindicatifs graves',
};

export const CARD_GROUP_LABELS: Record<CardGroup, string> = {
  [CardGroup.GROUP_1]: 'Groupe 1 (Blanc → Jaune → Jaune)',
  [CardGroup.GROUP_2]: 'Groupe 2 (Jaune → Rouge → Rouge)',
  [CardGroup.GROUP_3]: 'Groupe 3 (Rouge → Exclusion)',
  [CardGroup.GROUP_4]: 'Groupe 4 (Exclusion immédiate)',
};

export interface CardResult {
  type: CardType;
  shouldExclude: boolean;
  points: number;
}

/** Groupe d'un motif : celui de l'arme, sinon celui du Sabre Laser (motif hors liste) */
function groupOf(reason: CardReason, config: WeaponCardConfig | null): CardGroup | undefined {
  return config?.reasonToGroup[reason] ?? REASON_TO_GROUP[reason];
}

/**
 * Règlement technique FIE, t.165 à t.169. Les cartons précédents sont ceux du tireur
 * dans le match (ou la rencontre par équipes, t.159), au choix de l'appelant.
 */
function fieCardType(
  group: CardGroup,
  previousCards: Card[],
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

export function determineCardType(
  reason: CardReason,
  previousCards: Card[],
  weapon?: Weapon
): CardResult {
  const config = weapon !== undefined ? WEAPON_CARD_CONFIGS[weapon] : null;
  const si = config?.scoreImpact ?? { white: 0, yellow: 1, red: 1, black: 0 };

  if (config?.escalation === 'fie') {
    // Jamais de blanc en escrime olympique : motif inconnu = faute du 1er groupe
    return fieCardType(groupOf(reason, config) ?? CardGroup.GROUP_1, previousCards, si);
  }

  const reasonToGroup = config?.reasonToGroup ?? REASON_TO_GROUP;
  const group = reasonToGroup[reason];
  if (group === undefined) {
    return { type: CardType.WHITE, shouldExclude: false, points: 0 };
  }

  const sameGroupCards = previousCards.filter(c => c.group === group);
  const count = sameGroupCards.length;

  switch (group) {
    case CardGroup.GROUP_1:
      if (count === 0) return { type: CardType.WHITE, shouldExclude: false, points: si.white };
      return { type: CardType.YELLOW, shouldExclude: false, points: si.yellow };

    case CardGroup.GROUP_2:
      if (count === 0) return { type: CardType.YELLOW, shouldExclude: false, points: si.yellow };
      return { type: CardType.RED, shouldExclude: false, points: si.red };

    case CardGroup.GROUP_3:
      if (count === 0) return { type: CardType.RED, shouldExclude: false, points: si.red };
      return { type: CardType.BLACK, shouldExclude: true, points: si.black };

    case CardGroup.GROUP_4:
      return { type: CardType.BLACK, shouldExclude: true, points: si.black };

    default:
      return { type: CardType.WHITE, shouldExclude: false, points: si.white };
  }
}

export function createCard(
  matchId: string,
  fencerId: string,
  reason: CardReason,
  previousCards: Card[],
  weapon?: Weapon
): Card {
  const config = weapon !== undefined ? WEAPON_CARD_CONFIGS[weapon] : null;
  const { type, shouldExclude, points } = determineCardType(reason, previousCards, weapon);
  const group =
    groupOf(reason, config) ?? (config?.escalation === 'fie' ? CardGroup.GROUP_1 : undefined);

  return {
    id: uuidv4(),
    matchId,
    fencerId,
    type,
    reason,
    group: group as CardGroup,
    timestamp: new Date(),
    pointsAwarded: points,
    resultingExclusion: shouldExclude,
  };
}

/** Motifs du Sabre Laser par groupe (sans arme) */
export function getReasonsByGroup(): Record<CardGroup, CardReason[]> {
  return getReasonsByGroupForWeapon(Weapon.LASER);
}

export function getCardsForFencer(fencerId: string, matchCards: Card[]): Card[] {
  return matchCards.filter(card => card.fencerId === fencerId);
}

export function isFencerExcluded(fencerId: string, matchCards: Card[]): boolean {
  const fencerCards = getCardsForFencer(fencerId, matchCards);
  return fencerCards.some(card => card.resultingExclusion);
}
