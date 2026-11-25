import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

// #1213 : libellés envoyés en français par le serveur, traduits côté page
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

function loadLocale(lang: string): Record<string, string> {
  const win: { BP_REMOTE_I18N?: Record<string, Record<string, string>> } = {};
  new Function('window', read(`i18n/${lang}.js`))(win);
  return win.BP_REMOTE_I18N![lang];
}

describe('kiosk.html : noms de poule traduits (#1213)', () => {
  it('cartes de poule : nom construit depuis le numéro', () => {
    expect(read('js/kioskRender.js')).toContain("tk('kiosk.pool_n', { n: pool.number })");
  });
  it('prochains matchs : regroupement par numéro de poule traduit', () => {
    expect(read('js/kioskLists.js')).toContain("tk('kiosk.pool_n', { n: m.poolNumber })");
  });
});

describe('referee.html : raisons de carton avancé traduites (#1213)', () => {
  const html = read('referee.html') + read('js/refereeApp.js') + read('js/refereeAppBase.js'); // page + script extrait (#1600)
  // données extraites de referee.html (#1401) ; motifs olympiques FIE (#2207)
  const F = createRequire(import.meta.url)('./js/refereeFaults.js');
  type Group = { labelKey: string; faults: { key: string; fr: string }[] };
  const groups: Group[] = [...F.FAULT_REASONS, ...F.FAULT_REASONS_OLYMPIC];
  const faults = groups.flatMap(g => g.faults);
  const keys = faults.map(f => f.key);
  const groupKeys = groups.map(g => g.labelKey);

  it('chaque raison a une clé et la valeur enregistrée reste en français', () => {
    expect(keys.length).toBe(50);
    expect(groupKeys.length).toBe(6);
    expect(html).toContain('btn.textContent = window.T(fault.key)');
    expect(html).toContain('this.confirmReasonSelector(fault.fr, group, fencer)');
  });

  it('le texte français de la clé = valeur enregistrée', () => {
    const fr = loadLocale('fr');
    for (const f of faults) expect(fr[f.key], f.key).toBe(f.fr);
  });

  it.each(['en', 'de', 'es', 'ca', 'br', 'zh-HK'])('%s : toutes les raisons traduites', lang => {
    const dict = loadLocale(lang);
    const fr = loadLocale('fr');
    for (const k of [...keys, ...groupKeys]) {
      expect(dict[k], k).toBeTruthy();
      expect(dict[k], k).not.toBe(fr[k]);
    }
  });
});
