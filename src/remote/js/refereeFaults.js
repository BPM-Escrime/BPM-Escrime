/**
 * BPM - Escrime - Arbitre : motifs de faute et constantes de cartons, extraits de referee.html (#1401)
 * Script classique (constantes globales pour referee.html). Servi en /js/refereeFaults.js (CSP 'self').
 * Licensed under GPL-3.0
 */
const FAULT_REASONS = [
  {
    group: 1,
    labelKey: 'referee.fault_group_laser_1',
    faults: [
      { key: 'referee.fault_laser_1_01', fr: "Abandon de l'aire de combat sans autorisation" },
      { key: 'referee.fault_laser_1_02', fr: 'Contre-attaque' },
      { key: 'referee.fault_laser_1_03', fr: 'Corps à corps pour éviter une touche' },
      { key: 'referee.fault_laser_1_04', fr: 'Couverture ou substitution de cible' },
      { key: 'referee.fault_laser_1_05', fr: 'Touche lourde' },
      { key: 'referee.fault_laser_1_06', fr: 'Interruption abusive du combat' },
      { key: 'referee.fault_laser_1_07', fr: 'Matériel non conforme' },
      { key: 'referee.fault_laser_1_08', fr: "Non-présentation sur l'aire de combat" },
      { key: 'referee.fault_laser_1_09', fr: 'Réclamation injustifiée' },
      {
        key: 'referee.fault_laser_1_10',
        fr: 'Bousculade / jeu désordonné / enlèvement du masque avant « Cessez ! »',
      },
      { key: 'referee.fault_laser_1_11', fr: 'Commencer avant le « Combattez ! »' },
      { key: 'referee.fault_laser_1_12', fr: 'Poursuivre après le « Cessez ! »' },
    ],
  },
  {
    group: 2,
    labelKey: 'referee.fault_group_laser_2',
    faults: [
      { key: 'referee.fault_laser_2_01', fr: 'Acte violent, vindicatif ou dangereux' },
      { key: 'referee.fault_laser_2_02', fr: "Refus d'obéissance" },
      { key: 'referee.fault_laser_2_03', fr: "Demande d'arrêt pour traumatisme non reconnu" },
      { key: 'referee.fault_laser_2_04', fr: "Touche d'estoc" },
      { key: 'referee.fault_laser_2_05', fr: 'Touche portée très brutalement' },
      {
        key: 'referee.fault_laser_2_06',
        fr: 'Touche pendant / après une chute ou déplacement non maîtrisé',
      },
      {
        key: 'referee.fault_laser_2_07',
        fr: "Sortie volontaire de l'arène pour éviter une touche",
      },
      { key: 'referee.fault_laser_2_08', fr: 'Utilisation du bras ou de la main non armée' },
      { key: 'referee.fault_laser_2_09', fr: 'Absence de marque de contrôle sur le matériel' },
    ],
  },
  {
    group: 3,
    labelKey: 'referee.fault_group_laser_3',
    faults: [
      { key: 'referee.fault_laser_3_01', fr: 'Combat non loyal' },
      { key: 'referee.fault_laser_3_02', fr: "Combattant troublant l'ordre sur l'arène" },
      { key: 'referee.fault_laser_3_03', fr: "Toute personne troublant l'ordre hors de l'arène" },
      { key: 'referee.fault_laser_3_04', fr: 'Comportement antisportif' },
    ],
  },
];

// Olympique (épée, fleuret, sabre) : pas de carton blanc (#1026). key traduite, fr enregistré (#1213).
// Groupes et motifs du tableau t.170 du règlement technique FIE, numérotation FIE portée sur la
// feuille (t.163) ; reason = CardReason du domaine (src/shared/domain/penalties/cards.ts), parité testée
// (#2207). Le 4e groupe (noir direct) passe par le bouton N. weapons : motif propre à ces armes.
const FAULT_REASONS_OLYMPIC = [
  {
    group: 1,
    labelKey: 'referee.fault_group_olympic_1',
    faults: [
      {
        reason: 'fie_leaving_piste',
        key: 'referee.fault_fie_leaving_piste',
        fr: 'Abandon de la piste sans autorisation',
      },
      {
        reason: 'fie_body_contact',
        key: 'referee.fault_fie_body_contact',
        fr: 'Corps à corps pour éviter une touche',
      },
      {
        reason: 'fie_turning_back',
        key: 'referee.fault_fie_turning_back',
        fr: "Tourner le dos à l'adversaire",
      },
      {
        reason: 'fie_covering_target',
        key: 'referee.fault_fie_covering_target',
        fr: 'Couverture ou substitution de la surface valable',
      },
      {
        reason: 'fie_touching_equipment',
        key: 'referee.fault_fie_touching_equipment',
        fr: 'Toucher ou saisir le matériel électrique',
      },
      {
        reason: 'fie_lateral_exit',
        key: 'referee.fault_fie_lateral_exit',
        fr: 'Sortie latérale de la piste pour éviter une touche',
      },
      {
        reason: 'fie_unjustified_stop',
        key: 'referee.fault_fie_unjustified_stop',
        fr: 'Interruption abusive du combat',
      },
      {
        reason: 'fie_non_compliant_equipment',
        key: 'referee.fault_fie_non_compliant_equipment',
        fr: 'Tenue ou matériel non conformes, rechange absent',
      },
      {
        reason: 'fie_straightening_blade',
        key: 'referee.fault_fie_straightening_blade',
        fr: "Poser l'arme sur la piste pour la redresser",
      },
      {
        reason: 'fie_point_on_piste',
        key: 'referee.fault_fie_point_on_piste',
        fr: 'Appuyer ou traîner la pointe sur la piste conductrice',
        weapons: ['E', 'F'],
      },
      {
        reason: 'fie_sabre_forward_cross',
        key: 'referee.fault_fie_sabre_forward_cross',
        fr: 'Touche de coquille, passe-avant, flèche en croisant les jambes',
        weapons: ['S'],
      },
      {
        reason: 'fie_disobedience',
        key: 'referee.fault_fie_disobedience',
        fr: "Refus d'obéissance",
      },
      {
        reason: 'fie_non_compliant_hair',
        key: 'referee.fault_fie_non_compliant_hair',
        fr: 'Cheveux non conformes',
      },
      {
        reason: 'fie_jostling',
        key: 'referee.fault_fie_jostling',
        fr: 'Bousculade, jeu désordonné, masque retiré avant « Halte »',
      },
      {
        reason: 'fie_abnormal_movement',
        key: 'referee.fault_fie_abnormal_movement',
        fr: 'Déplacements anormaux, coups brutaux, chute intentionnelle',
      },
      {
        reason: 'fie_unjustified_appeal',
        key: 'referee.fault_fie_unjustified_appeal',
        fr: 'Réclamation injustifiée',
      },
    ],
  },
  {
    group: 2,
    labelKey: 'referee.fault_group_olympic_2',
    faults: [
      {
        reason: 'fie_unarmed_arm',
        key: 'referee.fault_fie_unarmed_arm',
        fr: 'Utilisation du bras ou de la main non armés',
      },
      {
        reason: 'fie_medical_pretext',
        key: 'referee.fault_fie_medical_pretext',
        fr: 'Arrêt pour raison médicale non reconnue',
      },
      {
        reason: 'fie_missing_control_mark',
        key: 'referee.fault_fie_missing_control_mark',
        fr: 'Absence de marque de contrôle',
      },
      {
        reason: 'fie_dropping_weapon',
        key: 'referee.fault_fie_dropping_weapon',
        fr: "Lâcher intentionnellement l'arme pendant la phrase d'armes",
      },
      {
        reason: 'fie_hit_off_target',
        key: 'referee.fault_fie_hit_off_target',
        fr: "Touche volontairement portée en dehors de l'adversaire",
      },
      {
        reason: 'fie_violent_act',
        key: 'referee.fault_fie_violent_act',
        fr: 'Acte violent, dangereux ou vindicatif, coup de coquille ou de pommeau',
      },
    ],
  },
  {
    group: 3,
    labelKey: 'referee.fault_group_olympic_3',
    faults: [
      {
        reason: 'fie_disorder',
        key: 'referee.fault_fie_disorder',
        fr: "Tireur troublant l'ordre sur la piste",
      },
      { reason: 'fie_unfair_fight', key: 'referee.fault_fie_unfair_fight', fr: 'Combat non loyal' },
      {
        reason: 'fie_advertising',
        key: 'referee.fault_fie_advertising',
        fr: 'Faute concernant la publicité',
      },
      {
        reason: 'fie_unsporting',
        key: 'referee.fault_fie_unsporting',
        fr: 'Comportement antisportif',
      },
    ],
  },
];

const PASSIVITY_CARDS = ['p-yellow', 'p-red', 'p-black'];
const isStandardCard = c => !PASSIVITY_CARDS.includes(c);
// Array.prototype.findLastIndex absent des tablettes anciennes
const lastIndexWhere = (arr, pred) => {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FAULT_REASONS,
    FAULT_REASONS_OLYMPIC,
    PASSIVITY_CARDS,
    isStandardCard,
    lastIndexWhere,
  };
}
