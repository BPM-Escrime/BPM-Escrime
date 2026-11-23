/**
 * Octets ↔ base64 (ADR-0021) : aller-retour exact, gros contenus découpés, identique à Buffer.
 */
import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './binary';

describe('base64', () => {
  it('aller-retour exact sur tous les octets, identique à Buffer', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64ToBytes(b64)).toEqual(bytes);
  });

  it('contenu de plus d’un bloc (découpage sans dépassement de pile)', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});
