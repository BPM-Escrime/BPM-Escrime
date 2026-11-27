/**
 * BPM - Escrime - Entrée en équipes : notification de l'écran
 * Injectée dans les hooks (lot 5 de #1979) : ils n'importent pas le Toast du renderer.
 * Licensed under GPL-3.0
 */
export type TeamNotify = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => void;
