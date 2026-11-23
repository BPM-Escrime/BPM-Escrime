/**
 * Export Word de la feuille de route : paquet OOXML valide, contenu, logos
 * Licensed under GPL-3.0
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { roadmapVariables } from '@shared/domain/roadmap/roadmap';
import { createRoadmap } from '@shared/domain/roadmap/presets';
import { buildDocxParts, buildRoadmapDocx, xmlEscape } from './roadmapDocx';

// PNG 1×1 transparent
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const doc = () => {
  const d = createRoadmap('laser', {
    title: 'Open <Briva> & Isara',
    edition: 'Édition 2026',
    date: '2026-12-20',
    venue: "Salle des fêtes d'Emy",
  });
  d.logos = [{ id: 'logo-1', dataUrl: PNG, width: 2, height: 1 }];
  return d;
};

describe('roadmapDocx', () => {
  it('échappe le XML et retire les caractères interdits', () => {
    expect(xmlEscape('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
  });

  it('parties du paquet, texte résolu, bandeau coloré, section masquée absente', () => {
    const d = doc();
    d.sections[2].enabled = false; // RESTAURATION
    const parts = buildDocxParts(
      d,
      roadmapVariables(d.info, iso => `le ${iso}`)
    );
    expect(Object.keys(parts)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'word/styles.xml',
        'word/header1.xml',
        'word/_rels/header1.xml.rels',
        'word/media/logo1.png',
      ])
    );
    const body = parts['word/document.xml'] as string;
    expect(body).toContain('Open &lt;Briva&gt; &amp; Isara');
    expect(body).toContain('Salle des fêtes d&apos;Emy'.replace('&apos;', "'"));
    expect(body).toContain('le 2026-12-20');
    expect(body).toContain('w:fill="C6E0B4"');
    expect(body).toContain('LIEU &amp; HORAIRES');
    expect(body).not.toContain('RESTAURATION');
    expect(body).toContain('•\tMasque d’escrime 350N');
    expect(parts['word/header1.xml']).toContain('r:embed="rIdLogo1"');
    expect(parts['word/_rels/header1.xml.rels']).toContain('media/logo1.png');
    expect((parts['word/media/logo1.png'] as Uint8Array)[1]).toBe(0x50); // « P » de PNG
  });

  it('fichier zip relisible', async () => {
    const d = doc();
    const bytes = await buildRoadmapDocx(
      d,
      roadmapVariables(d.info, iso => iso)
    );
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('word/document.xml')).not.toBeNull();
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('</w:document>');
  });
});
