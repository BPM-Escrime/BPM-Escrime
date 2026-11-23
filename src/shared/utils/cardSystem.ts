/**
 * BPM - Escrime - Libellés des cartons. Règles (motifs, groupes, escalade, `buildCard`) :
 * `shared/domain/penalties/cards.ts` (docs/adr/0028, lot D).
 * Licensed under GPL-3.0
 */

import { CardReason } from '../types';

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
