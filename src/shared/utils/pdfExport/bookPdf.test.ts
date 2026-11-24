// @vitest-environment jsdom
/**
 * Dossier PDF (#1325) : sommaire avec numéros de page quand le bureau sait compter les pages,
 * sommaire sans numéros sinon (navigateur, préload sans comptage, échec) — #2252.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const savePDF = vi.hoisted(() => vi.fn(async (_html: string, _name: string) => {}));
vi.mock('./core', async orig => ({ ...(await orig<typeof import('./core')>()), savePDF }));

import { countSectionPages, exportBookPDF, type BookInput } from './bookPdf';

const input = (): BookInput => ({
  items: [
    { kind: 'pools', title: 'Poules', html: '<html><body>P</body></html>' },
    { kind: 'ranking', title: 'Classement', html: '<html><body>C</body></html>' },
  ],
  competitionTitle: 'Épreuve',
  bookTitle: 'Dossier',
  filename: 'dossier.pdf',
});

const setPreload = (file: Record<string, unknown>) => {
  (window as { electronAPI?: unknown }).electronAPI = { file, dialog: {} };
};

beforeEach(() => savePDF.mockClear());
afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('countSectionPages', () => {
  it('sans bureau (navigateur) : undefined', async () => {
    await expect(countSectionPages(['<p>a</p>'])).resolves.toBeUndefined();
  });

  it('préload sans comptage : undefined', async () => {
    setPreload({});
    await expect(countSectionPages(['<p>a</p>'])).resolves.toBeUndefined();
  });

  it('une valeur par section, dans l’ordre', async () => {
    const countHtmlPages = vi
      .fn()
      .mockResolvedValueOnce({ success: true, pages: 3 })
      .mockResolvedValueOnce({ success: true, pages: 1 });
    setPreload({ countHtmlPages });
    await expect(countSectionPages(['a', 'b'])).resolves.toEqual([3, 1]);
    expect(countHtmlPages).toHaveBeenNthCalledWith(1, 'a');
    expect(countHtmlPages).toHaveBeenNthCalledWith(2, 'b');
  });

  it('un échec ou une exception : undefined', async () => {
    setPreload({ countHtmlPages: vi.fn().mockResolvedValue({ success: false, error: 'x' }) });
    await expect(countSectionPages(['a'])).resolves.toBeUndefined();
    setPreload({ countHtmlPages: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(countSectionPages(['a'])).resolves.toBeUndefined();
  });
});

describe('exportBookPDF', () => {
  it('avec comptage : numéros de page au sommaire (2 pages de garde + sommaire)', async () => {
    setPreload({
      countHtmlPages: vi
        .fn()
        .mockResolvedValueOnce({ success: true, pages: 2 })
        .mockResolvedValueOnce({ success: true, pages: 1 }),
    });
    await exportBookPDF(input());
    const html = savePDF.mock.calls[0][0];
    expect(html).toContain('Poules');
    expect(html).toContain('Page 3');
    expect(html).toContain('Page 5');
    expect(savePDF.mock.calls[0][1]).toBe('dossier.pdf');
  });

  it('sans comptage : sommaire sans numéros, PDF produit quand même', async () => {
    await exportBookPDF(input());
    const html = savePDF.mock.calls[0][0];
    expect(html).toContain('Classement');
    expect(html).not.toContain('book-toc-page">');
  });

  it('sans donnée : erreur explicite', async () => {
    await expect(exportBookPDF({ ...input(), items: [] })).rejects.toThrow('Aucune donnée');
  });
});
