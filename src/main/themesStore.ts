/**
 * BellePoule Modern - Bibliothèque de thèmes d'écrans (<userData>/themes.json)
 * (extraite de main.ts, #1341 ; port `themes` du poste, docs/adr/0022).
 * Licensed under GPL-3.0
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CustomTheme } from '../shared/types/remote';

export interface ThemesStore {
  list(): Promise<CustomTheme[]>;
  save(theme: CustomTheme): Promise<void>;
  remove(themeId: string): Promise<void>;
}

/**
 * E/S asynchrones : le process principal sert aussi le serveur distant en direct (#1776).
 * Lecture-modification-écriture sérialisées : deux sauvegardes concurrentes ne s'écrasent pas.
 */
export function createThemesStore(userDataDir: () => string): ThemesStore {
  const file = () => path.join(userDataDir(), 'themes.json');

  const read = async (): Promise<CustomTheme[]> => {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(file(), 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (themes: CustomTheme[]): Promise<void> =>
    fs.promises.writeFile(file(), JSON.stringify(themes, null, 2), 'utf-8');

  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    list: () => serialized(read),
    save: theme =>
      serialized(async () => {
        const themes = await read();
        const idx = themes.findIndex(x => x.id === theme.id);
        if (idx >= 0) themes[idx] = theme;
        else themes.push(theme);
        await write(themes);
      }),
    remove: themeId =>
      serialized(async () => {
        await write((await read()).filter(x => x.id !== themeId));
      }),
  };
}
