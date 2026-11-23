/**
 * BPM - Escrime - Aperçu A4 de la feuille de route
 * Ce rendu est aussi le PDF : l'export reprend son HTML et les règles CSS
 * `.roadmap-doc` (roadmapPdf.ts). Variable sans valeur surlignée ; clic sur
 * une section → son éditeur.
 * Licensed under GPL-3.0
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  expandVariables,
  parseBlocks,
  splitVariables,
  type RoadmapDoc,
  type RoadmapVariables,
} from '@shared/domain/roadmap/roadmap';

interface RoadmapPreviewProps {
  doc: RoadmapDoc;
  vars: RoadmapVariables;
  onPickSection?: (id: string) => void;
}

const Inline: React.FC<{ text: string; vars: RoadmapVariables }> = ({ text, vars }) => (
  <>
    {splitVariables(text, vars).map((p, i) =>
      p.missing ? (
        <mark key={i} className="rm-missing">
          {p.text}
        </mark>
      ) : (
        <React.Fragment key={i}>{p.text}</React.Fragment>
      )
    )}
  </>
);

const Blocks: React.FC<{ text: string; vars: RoadmapVariables }> = ({ text, vars }) => {
  // Valeurs sur plusieurs lignes ({tarifs}, {adresse}) : une ligne chacune
  const blocks = parseBlocks(expandVariables(text, vars));
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`ul-${out.length}`}>{bullets}</ul>);
    bullets = [];
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'bullet') {
      bullets.push(
        <li key={i}>
          <Inline text={b.text} vars={vars} />
        </li>
      );
    } else {
      flush();
      out.push(
        <p key={i}>
          <Inline text={b.text} vars={vars} />
        </p>
      );
    }
  });
  flush();
  return <>{out}</>;
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const RoadmapPreview = forwardRef<HTMLDivElement | null, RoadmapPreviewProps>(
  ({ doc, vars, onPickSection }, ref) => {
    const root = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => root.current as HTMLDivElement);
    // Couleur des bandeaux : propriété CSS posée par le CSSOM (CSP sans style en ligne)
    useEffect(() => {
      root.current?.style.setProperty('--rm-accent', doc.accent);
    }, [doc.accent]);

    const pick = (id: string) => (onPickSection ? () => onPickSection(id) : undefined);

    return (
      <div ref={root} className="roadmap-doc">
        {doc.logos.length > 0 && (
          <div className="rm-logos">
            {doc.logos.map(l => (
              <img key={l.id} src={l.dataUrl} alt="" />
            ))}
          </div>
        )}
        <div className="rm-titlebox">
          <div className="rm-title">
            <Inline text="{titre}" vars={vars} />
          </div>
          {vars.edition && <div className="rm-edition">{vars.edition}</div>}
          <div className="rm-date">
            {vars.date ? cap(vars.date) : <Inline text="{date}" vars={vars} />}
          </div>
        </div>
        {doc.sections
          .filter(s => s.enabled)
          .map(s =>
            s.layout === 'table' ? (
              <table key={s.id} className="rm-table" data-section={s.id} onClick={pick(s.id)}>
                <thead>
                  <tr>
                    <th colSpan={2}>
                      <Inline text={s.title} vars={vars} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map(r => (
                    <tr key={r.id}>
                      <td className="rm-label">
                        <Blocks text={r.label} vars={vars} />
                      </td>
                      <td className="rm-value">
                        <Blocks text={r.value} vars={vars} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <section key={s.id} className="rm-text" data-section={s.id} onClick={pick(s.id)}>
                <div className="rm-band">
                  <Inline text={s.title} vars={vars} />
                </div>
                <div className="rm-body">
                  <Blocks text={s.text} vars={vars} />
                </div>
              </section>
            )
          )}
      </div>
    );
  }
);
RoadmapPreview.displayName = 'RoadmapPreview';
