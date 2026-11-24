// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { keyValueStore, setKeyValueStore, type KeyValueStore } from './keyValueStore';
import { getCustomFormulaTemplates, saveCustomFormulaTemplate } from '../utils/tournamentTemplates';
import type { CustomFormulaConfig } from '../types';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: k => void data.delete(k),
  };
};

describe('keyValueStore (#2203)', () => {
  afterEach(() => setKeyValueStore(null));

  it('localStorage du navigateur par défaut', () => {
    expect(keyValueStore()).toBe(localStorage);
  });

  it('stockage injecté : le code partagé écrit dedans, pas dans localStorage', () => {
    const store = memory();
    setKeyValueStore(store);
    localStorage.clear();
    expect(saveCustomFormulaTemplate('F1', {} as CustomFormulaConfig)).toBe(true);
    expect(getCustomFormulaTemplates().map(t => t.name)).toEqual(['F1']);
    expect(store.data.size).toBe(1);
    expect(localStorage.length).toBe(0);
  });
});
