import { describe, it, expect } from 'vitest';
import { validateUUID, validateMatchData } from './validation';
import type { MatchCreateData } from '../../shared/types/preload';

describe('validation IPC (#1774)', () => {
  it('validateUUID accepte un UUID, refuse le reste', () => {
    expect(() => validateUUID('123e4567-e89b-12d3-a456-426614174000', 'id')).not.toThrow();
    expect(() => validateUUID('', 'id')).toThrow('Invalid id format');
    expect(() => validateUUID('abc', 'competition ID')).toThrow('Invalid competition ID format');
  });

  it('validateMatchData exige numéro et score max positifs', () => {
    const ok = { number: 1, maxScore: 5 } as MatchCreateData;
    expect(() => validateMatchData(ok)).not.toThrow();
    expect(() => validateMatchData({ ...ok, number: -1 })).toThrow(/number/);
    expect(() => validateMatchData({ ...ok, maxScore: 'x' as unknown as number })).toThrow(
      /max score/
    );
  });
});
