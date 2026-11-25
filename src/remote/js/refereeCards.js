/**
 * BPM - Escrime - Arbitre : règles des cartons (extrait de referee.html #1401)
 * Pénalité d'un carton, carton selon le groupe de faute, cartons de passivité (escrime
 * olympique), vainqueur par passivité. Pur, sans DOM. Servi en /js/refereeCards.js (CSP 'self').
 * Licensed under GPL-3.0
 */
(function (root) {
  'use strict';

  /**
   * Escrime olympique : un jaune devient rouge si le tireur a déjà un jaune ou un rouge
   * (un rouge reçu avant tout jaune transforme les jaunes suivants en rouges) (#1026).
   * @param {string[]} standardCards cartons classiques du tireur (hors passivité)
   */
  function modernYellowOrRed(standardCards) {
    return standardCards.some(c => c === 'yellow' || c === 'red') ? 'red' : 'yellow';
  }

  /**
   * Carton attribué selon le groupe de faute (1/2/3) et l'historique du tireur.
   * Escrime olympique, numérotation FIE (t.165 à t.167, #2207) : 1er groupe jaune puis rouge
   * (rouge d'emblée après un rouge), 2e et 3e groupes rouge. La récidive du 3e groupe (noir,
   * t.167.2) passe par le bouton N. Parité avec determineCardType (shared/domain/penalties/cards.ts) testée.
   */
  function cardFromGroup(group, ctx) {
    if (ctx.isModern) return group === 1 ? modernYellowOrRed(ctx.standardCards) : 'red';
    const count = (ctx.history && ctx.history[group]) || 0;
    if (group === 1) return count === 0 ? 'white' : 'yellow'; // après blanc et jaune, toujours jaune
    if (group === 2) return count === 0 ? 'yellow' : 'red';
    return 'red'; // Groupe 3 : rouge direct
  }

  /**
   * Effet d'un carton donné.
   * @param {{cardType: string, isModern: boolean, whiteCount: number}} s
   * @returns {{cardType: string, secondWhite: boolean, opponentPoints: number, notify: string|null}}
   *   notify = clé i18n de la notification de pénalité
   */
  function cardEffect(s) {
    let cardType = s.cardType;
    // Conversion 2ème blanc → jaune (chemin sans sélecteur de raison)
    const secondWhite = cardType === 'white' && s.whiteCount >= 1;
    if (secondWhite) cardType = 'yellow';

    let opponentPoints = 0;
    let notify = null;
    if (s.isModern) {
      // jaune = avertissement sans point en escrime moderne
      if (cardType === 'red') {
        opponentPoints = 1;
        notify = 'referee.opp_plus1';
      }
    } else if (cardType === 'yellow') {
      opponentPoints = 3;
      notify = 'referee.opp_plus3';
    } else if (cardType === 'red') {
      opponentPoints = 5;
      notify = 'referee.opp_plus5';
    }
    return { cardType, secondWhite, opponentPoints, notify };
  }

  /** Vibration (ms ou motif) selon le carton */
  function cardVibration(cardType) {
    return cardType === 'red' ? [100, 50, 100] : cardType === 'yellow' ? 80 : 40;
  }

  /** Suite des cartons de non-combativité (FIE t.124.1 et t.124.2) : jaune P, rouge P, noir P */
  const PASSIVITY_SEQUENCE = ['p-yellow', 'p-red', 'p-black'];

  /** Prochain carton de passivité selon le nombre déjà décerné, ou rien (>= 3) */
  function nextPassivityCard(given) {
    return PASSIVITY_SEQUENCE[given] ?? null;
  }

  /**
   * Carton P permis au score (t.124.3) : aucun à une touche du score limite des deux côtés
   * (14:14 à 15 touches). Limite inconnue, nulle ou infinie : permis.
   * Copie de `passivityCardAllowed` (src/shared/domain/match/matchEndValidation.ts, #2214).
   */
  function passivityCardAllowed(s) {
    const limit = s.scoreLimit;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 1) return true;
    return !(s.scoreA === limit - 1 && s.scoreB === limit - 1);
  }

  /**
   * Points de pénalité (carton, sortie d'arène) qui portent un tireur au score limite :
   * franchissement seulement. Limite inconnue (0) : 15 au Sabre Laser, sinon rien.
   * Même règle que `crossedScoreLimit` (src/shared/domain/match/matchEndValidation.ts).
   */
  function penaltyReachesLimit(s) {
    const limit = s.scoreLimit > 0 ? s.scoreLimit : s.isLaserSabre ? 15 : 0;
    if (!Number.isFinite(limit) || limit <= 0) return false;
    return (s.scoreA >= limit && s.prevA < limit) || (s.scoreB >= limit && s.prevB < limit);
  }

  /**
   * P-noir : vainqueur = score le plus haut ; à égalité, le mieux classé au départ (rang du
   * tableau en cours `tableauSeed` s'il est fourni, FFE dès M15, sinon classement initial) ;
   * sans classement, tirage au sort.
   * Copie servie telle quelle aux tablettes de `passivityWinner`
   * (src/shared/domain/match/matchEndValidation.ts, #1829) : parité vérifiée par refereeCards.test.ts.
   * @returns {{action: 'finish', winner: 'A'|'B', reasonKey: string}|{action: 'tiebreak'}}
   */
  function passivityWinner(s) {
    if (s.scoreA !== s.scoreB) {
      return {
        action: 'finish',
        winner: s.scoreA > s.scoreB ? 'A' : 'B',
        reasonKey: 'referee.reason_passivity',
      };
    }
    const valid = v => {
      const r = Number(v);
      return Number.isFinite(r) && r > 0 ? r : null;
    };
    const bySeed = valid(s.fencerA?.tableauSeed) !== null || valid(s.fencerB?.tableauSeed) !== null;
    const rankOf = f => valid(bySeed ? f?.tableauSeed : (f?.initialRanking ?? f?.ranking));
    const rA = rankOf(s.fencerA);
    const rB = rankOf(s.fencerB);
    if (rA !== null || rB !== null) {
      const winner = rB === null || (rA !== null && rA < rB) ? 'A' : 'B';
      if (rA !== rB)
        return { action: 'finish', winner, reasonKey: 'referee.reason_passivity_seed' };
    }
    return { action: 'tiebreak' };
  }

  const api = {
    modernYellowOrRed,
    cardFromGroup,
    cardEffect,
    cardVibration,
    nextPassivityCard,
    passivityCardAllowed,
    penaltyReachesLimit,
    passivityWinner,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BPRefereeCards = api;
})(typeof window !== 'undefined' ? window : undefined);
