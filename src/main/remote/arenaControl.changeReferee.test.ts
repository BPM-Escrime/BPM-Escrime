/**
 * change_referee (#2151) : l'arbitre choisi sur la tablette passe par la commande
 * assignReferee (docs/adr/0014) ; refusée, ni la session en mémoire ni l'arène ne changent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

const assignByCommand = vi.hoisted(() => vi.fn());
vi.mock('./scoreCommand', async orig => ({
  ...(await orig<typeof import('./scoreCommand')>()),
  assignMatchRefereeByCommand: assignByCommand,
}));
vi.mock('../mainWindowRef', () => ({ getSharedMainWindow: () => null }));

import { handleArenaControl, type ArenaControlContext } from './arenaControl';

function setup(isTrainingMode = false) {
  const arena = {
    id: '1',
    status: 'in_progress',
    currentMatch: { id: 'm1', scoreA: 0, scoreB: 0 },
  };
  const db = { updateMatch: vi.fn() };
  const ctx = {
    db,
    isTrainingMode,
    session: { competitionId: 'c1' },
    getArena: () => arena,
    sessionMatches: [{ id: 'm1', refereeId: 'r0' }],
    resolveReferee: (id: string) => ({ id, name: 'MARTIN Paul' }),
    broadcastArenaUpdate: vi.fn(),
    logDiag: () => {},
  } as unknown as ArenaControlContext;
  const run = () =>
    handleArenaControl(
      ctx,
      { id: 's1', emit: vi.fn() } as unknown as Socket,
      {
        arenaId: '1',
        action: 'change_referee',
        matchId: 'm1',
        refereeId: 'r1',
      } as never
    );
  return { ctx, arena, db, run };
}

describe('arena_control change_referee (#2151)', () => {
  beforeEach(() => assignByCommand.mockReset());

  it('commande acceptée : arène et session en mémoire suivent, base laissée au moteur', () => {
    assignByCommand.mockReturnValue(true);
    const { ctx, arena, db, run } = setup();
    run();
    expect(assignByCommand).toHaveBeenCalledWith(db, 'c1', 'm1', 'r1');
    expect(db.updateMatch).not.toHaveBeenCalled();
    expect(ctx.sessionMatches[0]).toMatchObject({ refereeId: 'r1' });
    expect(arena.currentMatch).toMatchObject({ referee: { id: 'r1' } });
  });

  it('commande refusée : rien ne change', () => {
    assignByCommand.mockReturnValue(false);
    const { ctx, arena, run } = setup();
    run();
    expect(ctx.sessionMatches[0]).toMatchObject({ refereeId: 'r0' });
    expect(arena.currentMatch).not.toHaveProperty('referee');
    expect(ctx.broadcastArenaUpdate).not.toHaveBeenCalled();
  });

  it('entraînement : pas d’épreuve, l’arène seule change', () => {
    const { arena, run } = setup(true);
    run();
    expect(assignByCommand).not.toHaveBeenCalled();
    expect(arena.currentMatch).toMatchObject({ referee: { id: 'r1' } });
  });
});
