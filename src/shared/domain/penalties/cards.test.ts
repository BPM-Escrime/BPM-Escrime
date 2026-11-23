/**
 * Tests unitaires des cartons individuels (docs/adr/0028, lot D) : Sabre Laser (FFE) et
 * escrime olympique (FIE), `buildCard` à identifiant et heure injectés.
 * BPM - Escrime
 */

import { describe, it, expect } from 'vitest';
import {
  determineCardType,
  buildCard,
  getCardsForFencer,
  isFencerExcluded,
  getWeaponCardConfig,
  getAvailableReasons,
  getReasonsByGroupForWeapon,
  WEAPON_CARD_CONFIGS,
} from './cards';
import { CARD_REASON_LABELS } from '../../utils/cardSystem';
import { Card, CardGroup, CardReason, Weapon } from '../../types';
import { CardType } from './penalty.types';

const AT = new Date('2026-11-23T10:00:00Z');
let seq = 0;
/** Carton construit avec un identifiant et une heure fixes (le domaine ne tire rien) */
const createCard = (
  matchId: string,
  fencerId: string,
  reason: CardReason,
  previousCards: Card[],
  weapon?: Weapon
): Card => buildCard({ id: `c${++seq}`, at: AT, matchId, fencerId, reason, previousCards, weapon });

// ============================================================================
// Helper pour créer des cartons de test
// ============================================================================

const createMockCard = (
  group: CardGroup,
  type: CardType = CardType.YELLOW,
  fencerId: string = 'f1'
): Card => ({
  id: `card-${++seq}`,
  matchId: 'm1',
  fencerId,
  type,
  reason: CardReason.EARLY_START,
  group,
  timestamp: AT,
  pointsAwarded: type === CardType.RED ? 1 : 0,
  resultingExclusion: type === CardType.BLACK,
});

// ============================================================================
// Tests pour determineCardType - Escalade FFE
// ============================================================================

describe("determineCardType - Système d'escalade FFE", () => {
  describe('Groupe 1: Blanc → Jaune → Jaune', () => {
    it('1ère faute Groupe 1 = Carton BLANC (0 point)', () => {
      const result = determineCardType(CardReason.EARLY_START, []);

      expect(result.type).toBe(CardType.WHITE);
      expect(result.points).toBe(0);
      expect(result.shouldExclude).toBe(false);
    });

    it('2ème faute Groupe 1 = Carton JAUNE (+1 point)', () => {
      const previousCards = [createMockCard(CardGroup.GROUP_1, CardType.WHITE)];

      const result = determineCardType(CardReason.LATE_STOP, previousCards);

      expect(result.type).toBe(CardType.YELLOW);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });

    it('3ème faute Groupe 1 = Carton JAUNE (+1 point)', () => {
      const previousCards = [
        createMockCard(CardGroup.GROUP_1, CardType.WHITE),
        createMockCard(CardGroup.GROUP_1, CardType.YELLOW),
      ];

      const result = determineCardType(CardReason.BODY_CONTACT, previousCards);

      expect(result.type).toBe(CardType.YELLOW);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });

    it('4ème faute Groupe 1 = Carton JAUNE (+1 point, pas de Noir)', () => {
      const previousCards = [
        createMockCard(CardGroup.GROUP_1, CardType.WHITE),
        createMockCard(CardGroup.GROUP_1, CardType.YELLOW),
        createMockCard(CardGroup.GROUP_1, CardType.YELLOW),
      ];

      const result = determineCardType(CardReason.COUNTER_ATTACK, previousCards);

      expect(result.type).toBe(CardType.YELLOW);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });
  });

  describe('Groupe 2: Jaune → Rouge → Rouge', () => {
    it('1ère faute Groupe 2 = Carton JAUNE (+1 point)', () => {
      const result = determineCardType(CardReason.ESTOC, []);

      expect(result.type).toBe(CardType.YELLOW);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });

    it('2ème faute Groupe 2 = Carton ROUGE (+1 point)', () => {
      const previousCards = [createMockCard(CardGroup.GROUP_2, CardType.YELLOW)];

      const result = determineCardType(CardReason.VOLUNTARY_EXIT, previousCards);

      expect(result.type).toBe(CardType.RED);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });

    it('3ème faute Groupe 2 = Carton ROUGE (+1 point, pas de Noir)', () => {
      const previousCards = [
        createMockCard(CardGroup.GROUP_2, CardType.YELLOW),
        createMockCard(CardGroup.GROUP_2, CardType.RED),
      ];

      const result = determineCardType(CardReason.HEAVY_HIT, previousCards);

      expect(result.type).toBe(CardType.RED);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });
  });

  describe('Groupe 3: Rouge → Exclusion', () => {
    it('1ère faute Groupe 3 = Carton ROUGE (+1 point)', () => {
      const result = determineCardType(CardReason.BRUTALITY, []);

      expect(result.type).toBe(CardType.RED);
      expect(result.points).toBe(1);
      expect(result.shouldExclude).toBe(false);
    });

    it('2ème faute Groupe 3 = Carton NOIR (exclusion)', () => {
      const previousCards = [createMockCard(CardGroup.GROUP_3, CardType.RED)];

      const result = determineCardType(CardReason.DANGEROUS, previousCards);

      expect(result.type).toBe(CardType.BLACK);
      expect(result.shouldExclude).toBe(true);
    });
  });

  describe('Groupe 4: Exclusion immédiate', () => {
    it('Refus de combattre = Carton NOIR direct', () => {
      const result = determineCardType(CardReason.REFUSAL, []);

      expect(result.type).toBe(CardType.BLACK);
      expect(result.shouldExclude).toBe(true);
      expect(result.points).toBe(0);
    });

    it('Tricherie = Carton NOIR direct', () => {
      const result = determineCardType(CardReason.CHEATING, []);

      expect(result.type).toBe(CardType.BLACK);
      expect(result.shouldExclude).toBe(true);
    });

    it('Anti-sportif = Carton NOIR direct', () => {
      const result = determineCardType(CardReason.UNSPORTSMANLIKE, []);

      expect(result.type).toBe(CardType.BLACK);
      expect(result.shouldExclude).toBe(true);
    });
  });

  describe('Isolation entre groupes', () => {
    it("Les cartons d'un groupe n'affectent pas les autres groupes", () => {
      // 3 cartons Groupe 1 (séquence complète B→J→R)
      const previousCards = [
        createMockCard(CardGroup.GROUP_1, CardType.WHITE),
        createMockCard(CardGroup.GROUP_1, CardType.YELLOW),
        createMockCard(CardGroup.GROUP_1, CardType.RED),
      ];

      // Faute Groupe 2 = Jaune (pas noir, pas rouge)
      const result = determineCardType(CardReason.ESTOC, previousCards);

      expect(result.type).toBe(CardType.YELLOW);
      expect(result.shouldExclude).toBe(false);
    });
  });
});

// ============================================================================
// Tests pour buildCard
// ============================================================================

describe('buildCard', () => {
  it('déterministe : identifiant et heure injectés, rien de tiré', () => {
    const input = {
      id: 'card-1',
      at: AT,
      matchId: 'm1',
      fencerId: 'f1',
      reason: CardReason.EARLY_START,
      previousCards: [],
    };
    const card = buildCard(input);
    expect(card).toEqual(buildCard(input));
    expect(card.id).toBe('card-1');
    expect(card.timestamp).toBe(AT);
  });

  it('associe correctement le match et le tireur', () => {
    const card = createCard('match-123', 'fencer-456', CardReason.ESTOC, []);

    expect(card.matchId).toBe('match-123');
    expect(card.fencerId).toBe('fencer-456');
  });

  it('définit le groupe correct pour chaque raison', () => {
    const cardG1 = createCard('m1', 'f1', CardReason.EARLY_START, []);
    const cardG2 = createCard('m1', 'f1', CardReason.ESTOC, []);
    const cardG3 = createCard('m1', 'f1', CardReason.BRUTALITY, []);
    const cardG4 = createCard('m1', 'f1', CardReason.CHEATING, []);

    expect(cardG1.group).toBe(CardGroup.GROUP_1);
    expect(cardG2.group).toBe(CardGroup.GROUP_2);
    expect(cardG3.group).toBe(CardGroup.GROUP_3);
    expect(cardG4.group).toBe(CardGroup.GROUP_4);
  });

  it('carton sans groupe (appareil de piste) : ignoré par l’escalade du groupe', () => {
    const device = [{ type: CardType.YELLOW, group: null }];
    expect(determineCardType(CardReason.FIE_BODY_CONTACT, device, Weapon.EPEE).type).toBe(
      CardType.YELLOW
    );
    expect(determineCardType(CardReason.EARLY_START, device, Weapon.LASER).type).toBe(
      CardType.WHITE
    );
  });
});

// ============================================================================
// Tests pour getReasonsByGroupForWeapon (Sabre Laser)
// ============================================================================

describe('getReasonsByGroupForWeapon (Sabre Laser)', () => {
  it('retourne les 4 groupes', () => {
    const groups = getReasonsByGroupForWeapon(Weapon.LASER);

    expect(Object.keys(groups)).toHaveLength(4);
    expect(groups[CardGroup.GROUP_1]).toBeDefined();
    expect(groups[CardGroup.GROUP_2]).toBeDefined();
    expect(groups[CardGroup.GROUP_3]).toBeDefined();
    expect(groups[CardGroup.GROUP_4]).toBeDefined();
  });

  it('Groupe 1 contient les bonnes raisons', () => {
    const groups = getReasonsByGroupForWeapon(Weapon.LASER);

    expect(groups[CardGroup.GROUP_1]).toContain(CardReason.EARLY_START);
    expect(groups[CardGroup.GROUP_1]).toContain(CardReason.LATE_STOP);
    expect(groups[CardGroup.GROUP_1]).toContain(CardReason.BODY_CONTACT);
    expect(groups[CardGroup.GROUP_1]).toContain(CardReason.TIME_WASTING);
  });

  it('Groupe 4 contient les exclusions directes', () => {
    const groups = getReasonsByGroupForWeapon(Weapon.LASER);

    expect(groups[CardGroup.GROUP_4]).toContain(CardReason.REFUSAL);
    expect(groups[CardGroup.GROUP_4]).toContain(CardReason.CHEATING);
    expect(groups[CardGroup.GROUP_4]).toContain(CardReason.UNSPORTSMANLIKE);
  });
});

// ============================================================================
// Tests pour getCardsForFencer
// ============================================================================

describe('getCardsForFencer', () => {
  it('filtre correctement les cartons par tireur', () => {
    const allCards: Card[] = [
      { ...createMockCard(CardGroup.GROUP_1), fencerId: 'f1', id: 'c1' },
      { ...createMockCard(CardGroup.GROUP_1), fencerId: 'f2', id: 'c2' },
      { ...createMockCard(CardGroup.GROUP_2), fencerId: 'f1', id: 'c3' },
    ];

    const f1Cards = getCardsForFencer('f1', allCards);
    const f2Cards = getCardsForFencer('f2', allCards);

    expect(f1Cards).toHaveLength(2);
    expect(f2Cards).toHaveLength(1);
  });

  it('retourne un tableau vide si pas de cartons', () => {
    const cards = getCardsForFencer('f999', []);

    expect(cards).toHaveLength(0);
  });
});

// ============================================================================
// Tests pour isFencerExcluded
// ============================================================================

describe('isFencerExcluded', () => {
  it('retourne true si carton noir reçu', () => {
    const cards: Card[] = [
      {
        ...createMockCard(CardGroup.GROUP_4, CardType.BLACK),
        fencerId: 'f1',
        resultingExclusion: true,
      },
    ];

    expect(isFencerExcluded('f1', cards)).toBe(true);
  });

  it('retourne false si pas de carton noir', () => {
    const cards: Card[] = [
      { ...createMockCard(CardGroup.GROUP_1, CardType.YELLOW), fencerId: 'f1' },
      { ...createMockCard(CardGroup.GROUP_2, CardType.RED), fencerId: 'f1' },
    ];

    expect(isFencerExcluded('f1', cards)).toBe(false);
  });

  it('retourne false pour un tireur sans cartons', () => {
    expect(isFencerExcluded('f1', [])).toBe(false);
  });
});

// ============================================================================
// Tests pour les labels français
// ============================================================================

describe('Labels français', () => {
  it('toutes les raisons ont un label', () => {
    const reasons = Object.values(CardReason);

    reasons.forEach(reason => {
      expect(CARD_REASON_LABELS[reason]).toBeDefined();
      expect(CARD_REASON_LABELS[reason].length).toBeGreaterThan(0);
    });
  });

  it('les labels sont en français', () => {
    expect(CARD_REASON_LABELS[CardReason.EARLY_START]).toBe('Départ anticipé');
    expect(CARD_REASON_LABELS[CardReason.CHEATING]).toBe('Tricherie');
  });
});

// ============================================================================
// Tests dissociation par arme
// ============================================================================

describe('Dissociation par arme', () => {
  describe('getWeaponCardConfig', () => {
    it('retourne une config pour chaque arme', () => {
      for (const weapon of Object.values(Weapon)) {
        const config = getWeaponCardConfig(weapon);
        expect(config).toBeDefined();
        expect(config.availableReasons.length).toBeGreaterThan(0);
        expect(config.scoreImpact).toBeDefined();
      }
    });

    it('chaque arme a une config indépendante (pas de référence partagée)', () => {
      const laserConfig = getWeaponCardConfig(Weapon.LASER);
      const epeeConfig = getWeaponCardConfig(Weapon.EPEE);
      expect(laserConfig).not.toBe(epeeConfig);
    });
  });

  describe('getAvailableReasons', () => {
    it('retourne toutes les raisons pour le Sabre Laser', () => {
      const reasons = getAvailableReasons(Weapon.LASER);
      expect(reasons).toContain(CardReason.EARLY_START);
      expect(reasons).toContain(CardReason.CHEATING);
      // Les 17 motifs du Sabre Laser, sans les motifs olympiques (#2207)
      expect(reasons.length).toBe(17);
      expect(reasons.some(r => r.startsWith('fie_'))).toBe(false);
    });

    it("retourne des raisons pour l'épée", () => {
      const reasons = getAvailableReasons(Weapon.EPEE);
      expect(reasons.length).toBeGreaterThan(0);
    });
  });

  describe('getReasonsByGroupForWeapon', () => {
    it('retourne les 4 groupes pour le Laser', () => {
      const groups = getReasonsByGroupForWeapon(Weapon.LASER);
      expect(groups[CardGroup.GROUP_1].length).toBeGreaterThan(0);
      expect(groups[CardGroup.GROUP_4]).toContain(CardReason.CHEATING);
    });

    it("retourne les 4 groupes pour l'épée", () => {
      const groups = getReasonsByGroupForWeapon(Weapon.EPEE);
      expect(Object.keys(groups)).toHaveLength(4);
    });
  });

  describe('determineCardType avec weapon param', () => {
    it('comportement identique avec ou sans weapon (config actuelle identique)', () => {
      const withoutWeapon = determineCardType(CardReason.EARLY_START, []);
      const withLaser = determineCardType(CardReason.EARLY_START, [], Weapon.LASER);
      expect(withoutWeapon.type).toBe(withLaser.type);
      expect(withoutWeapon.points).toBe(withLaser.points);
    });

    it('scoreImpact yellow reflète la config arme', () => {
      const result = determineCardType(CardReason.ESTOC, [], Weapon.LASER);
      expect(result.type).toBe(CardType.YELLOW);
      expect(result.points).toBe(WEAPON_CARD_CONFIGS[Weapon.LASER].scoreImpact.yellow);
    });

    it('scoreImpact personnalisable par arme', () => {
      // Simule une config épée avec impact yellow différent
      const originalConfig = { ...WEAPON_CARD_CONFIGS[Weapon.EPEE] };
      WEAPON_CARD_CONFIGS[Weapon.EPEE] = {
        ...originalConfig,
        scoreImpact: { white: 0, yellow: 2, red: 2, black: 0 },
      };

      const result = determineCardType(CardReason.ESTOC, [], Weapon.EPEE);
      expect(result.points).toBe(2);

      // Restore
      WEAPON_CARD_CONFIGS[Weapon.EPEE] = originalConfig;
    });

    it('raison non applicable retourne BLANC (0 point)', () => {
      // Simule une arme dont COUNTER_ATTACK n'est pas dans le reasonToGroup (escalade Sabre Laser)
      const originalConfig = { ...WEAPON_CARD_CONFIGS[Weapon.LASER] };
      const reasonToGroupWithout: Partial<Record<CardReason, CardGroup>> = {
        ...originalConfig.reasonToGroup,
      };
      delete reasonToGroupWithout[CardReason.COUNTER_ATTACK];

      WEAPON_CARD_CONFIGS[Weapon.LASER] = {
        ...originalConfig,
        availableReasons: originalConfig.availableReasons.filter(
          r => r !== CardReason.COUNTER_ATTACK
        ),
        reasonToGroup: reasonToGroupWithout,
      };

      const result = determineCardType(CardReason.COUNTER_ATTACK, [], Weapon.LASER);
      expect(result.type).toBe(CardType.WHITE);
      expect(result.points).toBe(0);
      expect(result.shouldExclude).toBe(false);

      // Restore
      WEAPON_CARD_CONFIGS[Weapon.LASER] = originalConfig;
    });
  });

  describe('buildCard avec weapon param', () => {
    it("crée un carton avec l'arme courante", () => {
      const card = createCard('m1', 'f1', CardReason.ESTOC, [], Weapon.LASER);
      expect(card.group).toBe(CardGroup.GROUP_2);
    });

    it('reste compatible sans weapon param', () => {
      const card = createCard('m1', 'f1', CardReason.ESTOC, []);
      expect(card.group).toBe(CardGroup.GROUP_2);
    });
  });
});

// ============================================================================
// Escrime olympique : règlement technique FIE, t.162 à t.170 (#2207)
// ============================================================================

const OLYMPIC = [Weapon.EPEE, Weapon.FOIL, Weapon.SABRE];

/** Rejoue une suite de fautes d'un même tireur et rend les cartons obtenus */
const replay = (weapon: Weapon, reasons: CardReason[]): Card[] => {
  const cards: Card[] = [];
  for (const reason of reasons) cards.push(createCard('m1', 'f1', reason, cards, weapon));
  return cards;
};

const G1 = CardReason.FIE_BODY_CONTACT;
const G1b = CardReason.FIE_TURNING_BACK;
const G2 = CardReason.FIE_UNARMED_ARM;
const G3 = CardReason.FIE_UNFAIR_FIGHT;
const G3b = CardReason.FIE_UNSPORTING;
const G4 = CardReason.FIE_REFUSAL_TO_SALUTE;

describe.each(OLYMPIC)('Escrime olympique (%s) : cartons FIE', weapon => {
  it('jaune = avertissement, 0 point (t.162.1)', () => {
    const r = determineCardType(G1, [], weapon);
    expect(r).toEqual({ type: CardType.YELLOW, shouldExclude: false, points: 0 });
  });

  it('1er groupe : jaune, puis rouge (+1) à chaque nouvelle faute du groupe (t.165)', () => {
    const cards = replay(weapon, [G1, G1b, G1, CardReason.FIE_DISOBEDIENCE]);
    expect(cards.map(c => c.type)).toEqual([
      CardType.YELLOW,
      CardType.RED,
      CardType.RED,
      CardType.RED,
    ]);
    expect(cards.map(c => c.pointsAwarded)).toEqual([0, 1, 1, 1]);
    expect(cards.every(c => c.group === CardGroup.GROUP_1)).toBe(true);
  });

  it("1er groupe : rouge d'emblée après un rouge du 2e groupe (t.165)", () => {
    const cards = replay(weapon, [G2, G1]);
    expect(cards.map(c => c.type)).toEqual([CardType.RED, CardType.RED]);
    expect(cards[1].group).toBe(CardGroup.GROUP_1);
    expect(cards[1].pointsAwarded).toBe(1);
  });

  it("1er groupe : rouge d'emblée après un rouge du 3e groupe (t.165)", () => {
    expect(replay(weapon, [G3, G1]).map(c => c.type)).toEqual([CardType.RED, CardType.RED]);
  });

  it('2e groupe : rouge dès la 1re faute, puis rouge (t.166)', () => {
    const cards = replay(weapon, [G2, CardReason.FIE_HIT_OFF_TARGET, G2]);
    expect(cards.map(c => c.type)).toEqual([CardType.RED, CardType.RED, CardType.RED]);
    expect(cards.map(c => c.pointsAwarded)).toEqual([1, 1, 1]);
    expect(cards.every(c => c.group === CardGroup.GROUP_2 && !c.resultingExclusion)).toBe(true);
  });

  it('2e groupe : rouge même après un jaune du 1er groupe', () => {
    expect(replay(weapon, [G1, G2]).map(c => c.type)).toEqual([CardType.YELLOW, CardType.RED]);
  });

  it('3e groupe : rouge, puis noir à la récidive (t.167)', () => {
    const cards = replay(weapon, [G3, G3b]);
    expect(cards.map(c => c.type)).toEqual([CardType.RED, CardType.BLACK]);
    expect(cards[0].pointsAwarded).toBe(1);
    expect(cards[1].resultingExclusion).toBe(true);
    expect(cards[1].pointsAwarded).toBe(0);
  });

  it('3e groupe : rouge à la 1re faute même après des rouges du 1er ou du 2e groupe (t.167.1)', () => {
    expect(replay(weapon, [G1, G1, G2, G3]).map(c => c.type)).toEqual([
      CardType.YELLOW,
      CardType.RED,
      CardType.RED,
      CardType.RED,
    ]);
  });

  it('4e groupe : noir dès la 1re faute (t.169)', () => {
    const r = determineCardType(G4, [], weapon);
    expect(r).toEqual({ type: CardType.BLACK, shouldExclude: true, points: 0 });
  });

  it('aucun carton blanc, quel que soit le motif ou l’historique', () => {
    const reasons = Object.values(CardReason);
    for (const reason of reasons) {
      for (const history of [[], replay(weapon, [G1]), replay(weapon, [G2, G3])]) {
        expect(determineCardType(reason, history, weapon).type).not.toBe(CardType.WHITE);
      }
    }
  });

  it('motifs du tableau t.170 seulement, ni motif du Sabre Laser', () => {
    const reasons = getAvailableReasons(weapon);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every(r => r.startsWith('fie_'))).toBe(true);
    const groups = getReasonsByGroupForWeapon(weapon);
    for (const g of [CardGroup.GROUP_1, CardGroup.GROUP_2, CardGroup.GROUP_3, CardGroup.GROUP_4]) {
      expect(groups[g].length).toBeGreaterThan(0);
    }
    expect(groups[CardGroup.GROUP_1]).toContain(CardReason.FIE_LEAVING_PISTE);
    expect(groups[CardGroup.GROUP_1]).toContain(CardReason.FIE_BODY_CONTACT);
    expect(groups[CardGroup.GROUP_2]).toContain(CardReason.FIE_VIOLENT_ACT);
    expect(groups[CardGroup.GROUP_3]).toContain(CardReason.FIE_UNSPORTING);
    expect(groups[CardGroup.GROUP_4]).toContain(CardReason.FIE_COLLUSION);
  });

  it('chaque motif olympique a un libellé français', () => {
    for (const r of getAvailableReasons(weapon)) expect(CARD_REASON_LABELS[r]).toBeTruthy();
  });
});

describe('Escrime olympique : motifs propres à une arme (t.170 1.10 et 1.12)', () => {
  it('pointe sur la piste : fleuret et épée ; coquille et croisement : sabre', () => {
    expect(getAvailableReasons(Weapon.EPEE)).toContain(CardReason.FIE_POINT_ON_PISTE);
    expect(getAvailableReasons(Weapon.FOIL)).toContain(CardReason.FIE_POINT_ON_PISTE);
    expect(getAvailableReasons(Weapon.SABRE)).not.toContain(CardReason.FIE_POINT_ON_PISTE);
    expect(getAvailableReasons(Weapon.SABRE)).toContain(CardReason.FIE_SABRE_FORWARD_CROSS);
    expect(getAvailableReasons(Weapon.EPEE)).not.toContain(CardReason.FIE_SABRE_FORWARD_CROSS);
  });

  it("motif hors liste (ancien motif du Sabre Laser) : groupe d'origine, escalade FIE, jamais de blanc", () => {
    const card = createCard('m1', 'f1', CardReason.EARLY_START, [], Weapon.EPEE);
    expect(card.type).toBe(CardType.YELLOW);
    expect(card.group).toBe(CardGroup.GROUP_1);
    expect(card.pointsAwarded).toBe(0);
  });
});

// ============================================================================
// Sabre Laser et arme à la carte : non-régression (#2207, hors périmètre : #2208, #2209)
// ============================================================================

describe('Sabre Laser et arme à la carte inchangés', () => {
  const LASER_GROUPS: Record<string, CardGroup> = {
    early_start: CardGroup.GROUP_1,
    late_stop: CardGroup.GROUP_1,
    body_contact: CardGroup.GROUP_1,
    counter_attack: CardGroup.GROUP_1,
    target_substitution: CardGroup.GROUP_1,
    voluntary_drop: CardGroup.GROUP_1,
    time_wasting: CardGroup.GROUP_1,
    non_compliant_gear: CardGroup.GROUP_1,
    estoc: CardGroup.GROUP_2,
    unarmed_hand: CardGroup.GROUP_2,
    voluntary_exit: CardGroup.GROUP_2,
    heavy_hit: CardGroup.GROUP_2,
    brutality: CardGroup.GROUP_3,
    dangerous: CardGroup.GROUP_3,
    refusal: CardGroup.GROUP_4,
    unsportsmanlike: CardGroup.GROUP_4,
    cheating: CardGroup.GROUP_4,
  };

  it.each([Weapon.LASER, Weapon.CUSTOM])('%s : motifs, groupes, barème', weapon => {
    const config = getWeaponCardConfig(weapon);
    expect(config.availableReasons).toEqual(Object.keys(LASER_GROUPS));
    expect(config.reasonToGroup).toEqual(LASER_GROUPS);
    expect(config.scoreImpact).toEqual({ white: 0, yellow: 1, red: 1, black: 0 });
    expect(config.escalation).toBeUndefined();
  });

  it.each([Weapon.LASER, Weapon.CUSTOM, undefined])(
    '%s : escalade blanc → jaune, jaune → rouge, rouge → noir',
    weapon => {
      const seq = (reasons: CardReason[]) => {
        const cards: Card[] = [];
        for (const r of reasons) cards.push(createCard('m1', 'f1', r, cards, weapon));
        return cards.map(c => `${c.type.toLowerCase()}:${c.pointsAwarded}`);
      };
      expect(seq([CardReason.EARLY_START, CardReason.LATE_STOP, CardReason.BODY_CONTACT])).toEqual([
        'white:0',
        'yellow:1',
        'yellow:1',
      ]);
      expect(seq([CardReason.ESTOC, CardReason.HEAVY_HIT, CardReason.ESTOC])).toEqual([
        'yellow:1',
        'red:1',
        'red:1',
      ]);
      expect(seq([CardReason.BRUTALITY, CardReason.DANGEROUS])).toEqual(['red:1', 'black:0']);
      expect(seq([CardReason.CHEATING])).toEqual(['black:0']);
    }
  );
});
