/**
 * Garde-fou du nommage du contrat (docs/adr/0008-nommage-contrat.md).
 * Une nouvelle opération qui ne suit pas la règle fait échouer la CI : corriger le nom,
 * ou écrire une ADR qui change la règle.
 */
import { describe, expect, it } from 'vitest';
import { contract } from './contract';

const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Noms d'outils MCP antérieurs au contrat, conservés pour les agents existants (docs/API_CONTRACT.md) */
const MCP_LEGACY_NAMES: Record<string, string> = {
  generateTableau: 'build_bracket',
};

const toSnake = (name: string) => name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

const ops = Object.entries(contract) as [
  string,
  { kind: 'command' | 'query' | 'subscription'; mcp?: { name: string } },
][];

describe('nommage du contrat (ADR-0008)', () => {
  it.each(ops)('%s est en camelCase', name => {
    expect(name).toMatch(CAMEL);
  });

  it('une commande est un verbe + objet, sans préfixe de lecture ou d’abonnement', () => {
    const bad = ops
      .filter(([n, d]) => d.kind === 'command' && /^(get|list|on)[A-Z]/.test(n))
      .map(([n]) => n);
    expect(bad).toEqual([]);
  });

  it('une requête commence par get (un objet) ou list (une collection)', () => {
    const bad = ops
      .filter(([n, d]) => d.kind === 'query' && !/^(get|list)[A-Z]/.test(n))
      .map(([n]) => n);
    expect(bad).toEqual([]);
  });

  it('un abonnement commence par on', () => {
    const bad = ops
      .filter(([n, d]) => d.kind === 'subscription' && !/^on[A-Z]/.test(n))
      .map(([n]) => n);
    expect(bad).toEqual([]);
  });

  it('un outil MCP porte le nom de l’opération en snake_case', () => {
    const bad = ops
      .filter(([, d]) => d.mcp)
      .filter(([n, d]) => d.mcp!.name !== (MCP_LEGACY_NAMES[n] ?? toSnake(n)))
      .map(([n, d]) => `${n} → ${d.mcp!.name} (attendu ${toSnake(n)})`);
    expect(bad).toEqual([]);
  });

  it('les noms MCP hérités restent en snake_case et désignent une opération existante', () => {
    for (const [op, mcp] of Object.entries(MCP_LEGACY_NAMES)) {
      expect(contract).toHaveProperty(op);
      expect(mcp).toMatch(SNAKE);
    }
  });
});
