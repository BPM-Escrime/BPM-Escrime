/**
 * Tablette équipe (/equipe{N}/arbitre) : verrou appareil de piste maître et en ligne (#1829).
 * Ajout de touche, cartons, relais suivant et remise à zéro bloqués avec notification ;
 * retrait d'une touche toujours permis. Page chargée dans jsdom avec un socket factice.
 * Cartons P (#2227) : bouton en relais FIE seulement, noir P confirmé, cartons affichés.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

type Handler = (data: unknown) => void;

async function loadTeamReferee() {
  const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8');
  const prep = new JSDOM(read('teamReferee.html'));
  for (const s of Array.from(prep.window.document.querySelectorAll('script[src]'))) {
    const name = /^\/((?:js\/)?[A-Za-z0-9]+)\.js$/.exec(s.getAttribute('src') ?? '')?.[1];
    if (name && /^(common|js\/)/.test(name)) {
      const inline = prep.window.document.createElement('script');
      inline.textContent = read(`${name}.js`).split('</script').join('<\\/script');
      s.replaceWith(inline);
    } else {
      s.remove();
    }
  }
  const handlers: Record<string, Handler> = {};
  const emitted: [string, Record<string, unknown>][] = [];
  const socket = {
    on(event: string, cb: Handler) {
      handlers[event] = cb;
      return socket;
    },
    emit(event: string, data: Record<string, unknown>) {
      emitted.push([event, data]);
      return socket;
    },
  };
  const dom = new JSDOM(prep.serialize(), {
    url: 'http://localhost/equipe1/arbitre',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>;
      w.io = () => socket;
      // Traduction : la clé elle-même (vérifie la clé affichée)
      w.T = (key: string) => key;
      w.confirm = () => true;
    },
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  return { dom, handlers, emitted };
}

const bout = {
  id: 'bout1',
  boutOrder: 1,
  fencerAId: 'a1',
  fencerAName: 'A1',
  fencerBId: 'b1',
  fencerBName: 'B1',
  scoreA: 0,
  scoreB: 0,
  maxScore: 45,
  status: 'not_started',
  winnerId: null,
};
const state = (cyrano: unknown) => ({
  format: 'fie-relay',
  cumulA: 3,
  cumulB: 1,
  target: 45,
  fencerCards: [],
  cardReasons: ['early_start'],
  matchId: 'tm1',
  teamAId: 'tA',
  teamAName: 'Lyon',
  teamBId: 'tB',
  teamBName: 'Gand',
  isLaserPoints: false,
  bouts: [bout],
  currentBoutIndex: 0,
  currentBout: bout,
  liveScoreA: 3,
  liveScoreB: 1,
  elapsedSec: 0,
  timerRunning: false,
  cap: { maxTouches: 5, maxDurationSec: 180 },
  boutComplete: false,
  matchComplete: false,
  cards: [],
  deviceCards: {},
  blackCardEnabled: false,
  cyrano,
});

describe('tablette équipe — verrou appareil maître', () => {
  it('maître et en ligne : bandeau, ajouts bloqués avec notification, retrait permis', async () => {
    const { dom, handlers, emitted } = await loadTeamReferee();
    const doc = dom.window.document;
    handlers.team_arena_state(state({ piste: '1', mode: 'master', online: true }));
    expect((doc.getElementById('device-lock') as HTMLElement).style.display).toBe('block');
    const before = emitted.length;
    (doc.querySelector('#zones-a .touch-btn') as HTMLButtonElement).click();
    const toast = doc.getElementById('team-toast') as HTMLElement;
    expect(toast.textContent).toBe('referee.cyrano_master_lock');
    (doc.querySelector('#card-buttons-a .card-btn') as HTMLButtonElement)?.click();
    (doc.getElementById('advance-bout') as HTMLButtonElement).click();
    expect(toast.textContent).toBe('team.cyrano_master_relay_lock');
    (doc.getElementById('reset-bout') as HTMLButtonElement).click();
    expect(emitted.slice(before)).toEqual([]);
    (doc.querySelector('#zones-a .remove-btn') as HTMLButtonElement).click();
    expect(emitted.slice(before)).toEqual([
      ['team_touch', { arenaId: '1', side: 'A', points: -1 }],
    ]);
  });

  it('afficheur ou hors ligne : tablette libre', async () => {
    const { dom, handlers, emitted } = await loadTeamReferee();
    const doc = dom.window.document;
    handlers.team_arena_state(state({ piste: '1', mode: 'master', online: false }));
    expect((doc.getElementById('device-lock') as HTMLElement).style.display).toBe('none');
    (doc.querySelector('#zones-b .touch-btn') as HTMLButtonElement).click();
    (doc.getElementById('advance-bout') as HTMLButtonElement).click();
    expect(emitted.map(([e]) => e)).toEqual(
      expect.arrayContaining(['team_touch', 'team_advance_bout'])
    );
  });
});

describe('tablette équipe — cartons P (relais FIE, #2227)', () => {
  const fie = (over: Record<string, unknown> = {}) => ({
    ...state(null),
    passivityEnabled: true,
    passivityCards: [],
    ...over,
  });
  const section = (doc: Document) => doc.getElementById('passivity-section') as HTMLElement;
  const button = (doc: Document) => doc.getElementById('passivity-btn') as HTMLButtonElement;

  it('relais FIE : bouton qui envoie la commande, cartons P affichés', async () => {
    const { dom, handlers, emitted } = await loadTeamReferee();
    const doc = dom.window.document;
    handlers.team_arena_state(fie({ passivityCards: [{ id: 'p1', type: 'yellow' }] }));
    expect(section(doc).hidden).toBe(false);
    expect(doc.querySelectorAll('#passivity-log .p-card')).toHaveLength(1);
    expect(doc.querySelector('#passivity-log .bp-card-yellow')).not.toBeNull();
    button(doc).click();
    expect(emitted).toContainEqual(['team_passivity_card', { arenaId: '1' }]);
    // Noir P déjà donné : rencontre décidée, plus de bouton actif
    handlers.team_arena_state(
      fie({
        passivityCards: [
          { id: 'p1', type: 'yellow' },
          { id: 'p2', type: 'red' },
          { id: 'p3', type: 'black' },
        ],
      })
    );
    expect(button(doc).disabled).toBe(true);
  });

  it('Sabre Laser (passivityEnabled faux) : pas de bouton carton P', async () => {
    const { dom, handlers } = await loadTeamReferee();
    const doc = dom.window.document;
    handlers.team_arena_state({ ...state(null), format: 'laser-arena', passivityEnabled: false });
    expect(section(doc).hidden).toBe(true);
    handlers.team_arena_state(fie({ passivityEnabled: false }));
    expect(section(doc).hidden).toBe(true);
  });

  it('noir P : confirmation explicite avant envoi, annulable', async () => {
    const { dom, handlers, emitted } = await loadTeamReferee();
    const doc = dom.window.document;
    handlers.team_arena_state(fie());
    handlers.team_passivity_black({ winnerTeamId: 'tA' });
    const box = doc.getElementById('passivity-confirm') as HTMLElement;
    expect(box.hidden).toBe(false);
    expect(doc.getElementById('passivity-confirm-text')?.textContent).toContain(
      'team.passivity_black_confirm'
    );
    (doc.getElementById('passivity-confirm-cancel') as HTMLButtonElement).click();
    expect(box.hidden).toBe(true);
    expect(emitted.filter(([e]) => e === 'team_passivity_card')).toEqual([]);
    handlers.team_passivity_black({ winnerTeamId: 'tA' });
    (doc.getElementById('passivity-confirm-ok') as HTMLButtonElement).click();
    expect(emitted).toContainEqual(['team_passivity_card', { arenaId: '1', confirmBlack: true }]);
    expect(box.hidden).toBe(true);
  });

  it('appareil maître et en ligne : carton P bloqué avec notification', async () => {
    const { dom, handlers, emitted } = await loadTeamReferee();
    const doc = dom.window.document;
    handlers.team_arena_state(fie({ cyrano: { piste: '1', mode: 'master', online: true } }));
    button(doc).click();
    expect((doc.getElementById('team-toast') as HTMLElement).textContent).toBe(
      'referee.cyrano_master_card_lock'
    );
    expect(emitted.filter(([e]) => e === 'team_passivity_card')).toEqual([]);
  });
});
