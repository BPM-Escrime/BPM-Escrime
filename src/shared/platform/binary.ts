/**
 * BPM - Escrime - Octets ↔ base64 (#1981, ADR-0021) : le contrat échange les fichiers de
 * données en base64 (transport neutre : IPC, JSON, Socket.IO) ; PlatformServices les enregistre
 * ou les lit en octets. Sans Buffer : marche dans l'écran, le navigateur et Node.
 * Licensed under GPL-3.0
 */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
