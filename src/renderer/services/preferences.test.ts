// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPref, PREFS, removePref, safeStorage, setPref } from './preferences';

describe('preferences (#2203)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('valeurs par défaut sans clé enregistrée', () => {
    expect(getPref('auditLog')).toBe(true);
    expect(getPref('quickMouseScoring')).toBe(false);
    expect(getPref('chainedInput')).toBe(true);
    expect(getPref('webhookUrl')).toBe('');
    expect(getPref('logo')).toBeNull();
  });

  it('écrit et relit sous les clés existantes', () => {
    setPref('poolPdfLandscape', true);
    expect(localStorage.getItem('bellepoule-pool-pdf-landscape')).toBe('true');
    expect(getPref('poolPdfLandscape')).toBe(true);
    setPref('auditLog', false);
    expect(localStorage.getItem(PREFS.auditLog.key)).toBe('false');
    expect(getPref('auditLog')).toBe(false);
  });

  it('logo null → clé retirée', () => {
    setPref('logo', 'data:image/png;base64,AA');
    expect(getPref('logo')).toBe('data:image/png;base64,AA');
    setPref('logo', null);
    expect(localStorage.getItem('bellepoule-logo')).toBeNull();
    setPref('webhookUrl', 'https://x');
    removePref('webhookUrl');
    expect(getPref('webhookUrl')).toBe('');
  });

  it('stockage qui lève (navigation privée) : défauts, aucune exception', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    expect(getPref('auditLog')).toBe(true);
    expect(getPref('logo')).toBeNull();
    expect(() => setPref('quickMouseScoring', true)).not.toThrow();
    expect(() => setPref('logo', null)).not.toThrow();
    expect(() => removePref('ttsConfig')).not.toThrow();
    expect(safeStorage.getItem('x')).toBeNull();
  });
});
