/**
 * BPM - Escrime - Modèles préremplis de feuille de route
 * Contenu en français (règlements ASL-FFE et FFE) : l'organisateur ne remplit que
 * l'essentiel, les variables {…} reportent ses réponses dans toutes les sections.
 * Bibliothèques de lignes et de sections à ajouter d'un clic.
 * Licensed under GPL-3.0
 */

import {
  ROADMAP_ACCENTS,
  emptyInfo,
  type RoadmapDoc,
  type RoadmapInfo,
  type RoadmapLayout,
  type RoadmapPresetId,
  type RoadmapRow,
  type RoadmapSection,
} from './roadmap';

type RowSeed = [label: string, value: string];

interface SectionSeed {
  title: string;
  layout: RoadmapLayout;
  rows?: RowSeed[];
  text?: string;
}

const PLACE_TIMES: SectionSeed = {
  title: 'LIEU & HORAIRES',
  layout: 'table',
  rows: [
    ['Lieu', '{lieu}\n{adresse}'],
    ['Épreuves', ''],
    ['Date', '{date}'],
    ['Ouverture', '{ouverture}'],
    ['Scratch', '{scratch}'],
    ['Début', '{debut}'],
    ["Frais d'inscription", '{tarifs}'],
  ],
};

const REGISTRATION: RowSeed = [
  'Inscriptions',
  "Inscription via l'extranet FFE avant le {date_limite}.\nIl n'y aura pas d'inscription sur place.",
];

const FOOD: SectionSeed = {
  title: 'RESTAURATION',
  layout: 'text',
  text: 'Présence d’une buvette sur place.',
};

const PAYMENT: SectionSeed = {
  title: 'PAIEMENT',
  layout: 'text',
  text: 'Sur place, merci de prévoir l’appoint.',
};

const DIRECTOIRE = (sport: string): SectionSeed => ({
  title: 'DIRECTOIRE TECHNIQUE ET COURTOISIE',
  layout: 'text',
  text: [
    'Les responsables de l’organisation assurent le bon déroulement technique de la compétition avec les arbitres inscrits.',
    'Le Directoire technique sera composé sur place et affiché avant le début de la compétition. Il pourra être amené à prendre toutes décisions utiles en conformité avec les règlements de la F.F.E pour le bon déroulement de l’épreuve. Celui-ci se réserve le droit de modifier le présent règlement, si nécessaire.',
    `Rappel courtoisie : toutes les personnes qui participent ou assistent à une épreuve ${sport} doivent respecter l'ordre et ne pas troubler le bon déroulement de l'épreuve. Au cours des matchs, personne n'est autorisé à s'approcher de l'aire de combat, à donner des conseils aux tireurs, à critiquer l'arbitre ou à l'importuner de quelque façon que ce soit.`,
    'En cas de non-respect de ces règles, les personnes incriminées seront averties (carton jaune) puis sanctionnées en cas de récidive par un carton noir. Il leur sera alors demandé de quitter la salle.',
  ].join('\n'),
});

const CONTACT: SectionSeed = {
  title: 'CONTACT',
  layout: 'text',
  text: 'Pour toute demande d’information (matériel, déroulement de la compétition…) ou pour vous signaler en tant qu’arbitre en formation, merci de contacter :\n{contact}',
};

const LASER: SectionSeed[] = [
  {
    ...PLACE_TIMES,
    rows: PLACE_TIMES.rows!.map(([l, v]): RowSeed =>
      l === 'Épreuves'
        ? [
            l,
            '- Épreuve mixte à partir de 18 ans (M20)\n- Championnat régional M17 (surclassement pour les M15)',
          ]
        : [l, v]
    ),
  },
  {
    title: 'RÈGLEMENT & FORMULE',
    layout: 'table',
    rows: [
      ['Règlement', 'Règlement sportif ASL-FFE'],
      [
        'Licence',
        'Compétition ouverte à tous les tireurs licenciés à la Fédération Française d’Escrime (FFE).\nNe seront acceptés que les tireurs en possession d’une licence {saison} validée par la FFE.',
      ],
      [
        'Catégories',
        'Les combats sportifs individuels sont ouverts aux catégories :\n• M20 surclassés - Seniors - Vétérans (à partir de 18 ans)\n• M17 et M15 surclassés\nLe certificat médical doit autoriser le surclassement pour les catégories ciblées.',
      ],
      REGISTRATION,
      [
        'Arbitrage',
        '- Les arbitres resteront à disposition de l’organisation du début à la fin de la compétition.\n- Les clubs devront prévoir un arbitre pour 4 combattants inscrits.\n- Indemnisation des arbitres selon le barème en vigueur.\n- Arbitres en formation régionale {saison} acceptés (merci de nous le signaler).',
      ],
      [
        'Contrôle matériel',
        'Le matériel utilisé doit être conforme au règlement ASL-FFE pour les compétitions. Il comprend :\n- Masque d’escrime 350N\n- Couvre-masque ou protection occipitale\n- Épaulières de hockey ou plastron coqué homologué\n- Gants d’AMHE ou de hockey (voir matériel homologué)\n- Genouillères et coudières coquées\n- Protège-tibias mousse ou coqués\n- Coquille anatomique pour tous\n- Bustier pour les femmes (type escrime ou brassière de sport coquée)\n- Pantalon (jambes longues)\n- Haut manches longues (aucun combattant ne pourra combattre en tee-shirt)\nLe contrôle du matériel aura lieu au début de la journée et peut avoir lieu à tout moment pendant la compétition. L’organisateur pourra refuser l’accès à la compétition à tout combattant n’ayant pas le matériel réglementaire.',
      ],
      ['Récompenses', 'Un trophée sera remis aux 3 premiers.'],
    ],
  },
  FOOD,
  PAYMENT,
  DIRECTOIRE('de sabre laser'),
  CONTACT,
];

const FENCING: SectionSeed[] = [
  {
    ...PLACE_TIMES,
    rows: PLACE_TIMES.rows!.map(([l, v]): RowSeed =>
      l === 'Épreuves' ? [l, '- Épée individuelle\n- Catégories : M15, M17, Seniors'] : [l, v]
    ),
  },
  {
    title: 'RÈGLEMENT & FORMULE',
    layout: 'table',
    rows: [
      ['Règlement', 'Règlements sportifs de la FFE en vigueur pour la saison {saison}.'],
      ['Licence', 'Compétition ouverte aux tireurs titulaires d’une licence FFE {saison} validée.'],
      ['Catégories', '• M15\n• M17\n• Seniors (M20 surclassés acceptés)'],
      REGISTRATION,
      [
        'Formule',
        '- Un tour de poules sans éliminé\n- Tableau d’élimination directe\n- Pas de match pour la 3e place (deux médailles de bronze)',
      ],
      [
        'Arbitrage',
        '- Chaque club présente un arbitre à partir de 4 tireurs engagés.\n- Les arbitres restent à disposition jusqu’à la fin de la compétition.\n- Indemnisation selon le barème régional en vigueur.',
      ],
      [
        'Tenue',
        'Tenue conforme au règlement FFE :\n- Masque, veste, pantalon et sous-cuirasse (350 N minimum)\n- Protège-poitrine obligatoire pour les tireuses\n- Bas blancs et gant\n- Deux armes et deux fils de corps en état de fonctionnement\nLe contrôle du matériel peut avoir lieu à tout moment.',
      ],
      ['Récompenses', 'Coupes ou médailles aux 4 premiers de chaque catégorie.'],
    ],
  },
  FOOD,
  PAYMENT,
  DIRECTOIRE("d'escrime"),
  CONTACT,
];

const BLANK: SectionSeed[] = [
  PLACE_TIMES,
  {
    title: 'RÈGLEMENT & FORMULE',
    layout: 'table',
    rows: [
      ['Règlement', ''],
      ['Licence', ''],
      ['Catégories', ''],
      REGISTRATION,
      ['Arbitrage', ''],
      ['Récompenses', ''],
    ],
  },
  CONTACT,
];

const SEEDS: Record<RoadmapPresetId, SectionSeed[]> = {
  laser: LASER,
  fencing: FENCING,
  blank: BLANK,
};

/** Construit les sections ; rowStart évite les doublons d'identifiants */
const buildSections = (seeds: SectionSeed[], secStart = 0, rowStart = 0): RoadmapSection[] => {
  let r = rowStart;
  return seeds.map((s, i) => ({
    id: `sec-${secStart + i + 1}`,
    title: s.title,
    layout: s.layout,
    rows: (s.rows ?? []).map(([label, value]): RoadmapRow => ({
      id: `row-${++r}`,
      label,
      value,
    })),
    text: s.text ?? '',
    enabled: true,
  }));
};

/** Nouvelle feuille de route à partir d'un modèle ; info : l'essentiel déjà connu */
export function createRoadmap(
  preset: RoadmapPresetId,
  info: Partial<RoadmapInfo> = {}
): RoadmapDoc {
  const base = emptyInfo();
  const fees =
    preset === 'laser'
      ? '15 € (open senior) : non qualificatif\n25 € (championnat régional M17) : qualificatif'
      : '';
  return {
    version: 1,
    preset,
    accent: ROADMAP_ACCENTS[preset === 'fencing' ? 1 : 0],
    logos: [],
    info: { ...base, fees, ...info },
    sections: buildSections(SEEDS[preset]),
  };
}

// ─── Bibliothèques ───────────────────────────────────────────────────────────

/** Lignes prêtes à ajouter à une section en tableau */
export const SUGGESTED_ROWS: RowSeed[] = [
  ['Accès', 'Parking gratuit à proximité.\nTransports : …'],
  ['Accès PMR', 'Salle accessible aux personnes à mobilité réduite.'],
  ['Vestiaires', 'Vestiaires et douches à disposition.'],
  ['Hébergement', 'Liste d’hébergements à proximité disponible sur demande.'],
  ['Droit à l’image', 'Des photos et vidéos pourront être prises et diffusées par l’organisateur.'],
  ['Stand matériel', 'Un stand de vente et de réparation de matériel sera présent.'],
  ['Secours', 'Un poste de secours sera présent pendant toute la compétition.'],
  ['Formule', '- Poules\n- Tableau d’élimination directe'],
  ['Récompenses', 'Un trophée sera remis aux 3 premiers.'],
  ['Arbitrage', 'Les clubs devront prévoir un arbitre pour 4 tireurs inscrits.'],
];

/** Sections prêtes à ajouter */
export const SUGGESTED_SECTIONS: SectionSeed[] = [
  FOOD,
  PAYMENT,
  DIRECTOIRE("d'escrime"),
  CONTACT,
  {
    title: 'PROGRAMME DE LA JOURNÉE',
    layout: 'table',
    rows: [
      ['{ouverture}', 'Ouverture de la salle, contrôle du matériel'],
      ['{scratch}', 'Scratch (clôture de l’appel)'],
      ['{debut}', 'Début des poules'],
      ['', 'Tableau d’élimination directe'],
      ['', 'Remise des récompenses'],
    ],
  },
  {
    title: 'ACCÈS & STATIONNEMENT',
    layout: 'text',
    text: '{lieu}\n{adresse}\nParking à proximité. Accès en transports en commun : …',
  },
  {
    title: 'HÉBERGEMENT',
    layout: 'text',
    text: 'Hôtels partenaires à proximité :\n- …\n- …',
  },
  {
    title: 'PARTENAIRES',
    layout: 'text',
    text: 'Merci à nos partenaires : …',
  },
];

/** Section de la bibliothèque, identifiants libres à partir des existants */
export function sectionFromSeed(
  seed: SectionSeed,
  sectionId: string,
  nextRowId: () => string
): RoadmapSection {
  return {
    id: sectionId,
    title: seed.title,
    layout: seed.layout,
    rows: (seed.rows ?? []).map(([label, value]) => ({ id: nextRowId(), label, value })),
    text: seed.text ?? '',
    enabled: true,
  };
}

export type { SectionSeed, RowSeed };
