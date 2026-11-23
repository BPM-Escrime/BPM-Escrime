/**
 * BPM - Escrime - Export du plan de salle d'arène (PNG et PDF, #2075)
 * Sérialise l'aperçu SVG affiché et le rastérise dans un canvas. Le PDF est
 * une page A4 paysage composée dans le même canvas (plan + résumé + matériel),
 * encodée en JPEG et embarquée directement (filtre DCTDecode) : aucune
 * dépendance PDF ajoutée au bundle, et tous les alphabets s'affichent.
 * Licensed under GPL-3.0
 */

const EXPORT_WIDTH_PX = 1600;
/** Page A4 paysage à 200 dpi */
const PAGE_W = 2339;
const PAGE_H = 1654;
/** Dimensions A4 paysage en points PDF */
const PAGE_W_PT = 841.89;
const PAGE_H_PT = 595.28;

export interface ArenaPlanExportText {
  title: string;
  summary: string[];
  legend: string[];
  itemsTitle: string;
  items: string[];
  note: string;
}

/** Propriétés SVG recopiées dans les attributs : l'image rastérisée n'a pas accès aux feuilles de style de la page. */
const INLINED_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'font-size',
  'font-weight',
  'font-family',
  'opacity',
];

/** Copie les styles calculés de chaque élément de la source dans son clone (même ordre de parcours). */
const inlineSvgStyles = (source: SVGSVGElement, clone: SVGSVGElement) => {
  const from = [source, ...Array.from(source.querySelectorAll('*'))];
  const to = [clone, ...Array.from(clone.querySelectorAll('*'))];
  from.forEach((src, i) => {
    const dst = to[i];
    if (!dst) return;
    const cs = getComputedStyle(src);
    for (const prop of INLINED_PROPS) {
      const value = cs.getPropertyValue(prop);
      if (value) dst.setAttribute(prop, value);
    }
  });
};

const svgToImage = (
  svg: SVGSVGElement,
  width: number
): Promise<{ img: HTMLImageElement; height: number }> => {
  const vb = svg.viewBox.baseVal;
  const height = Math.round(width * (vb.height / vb.width));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineSvgStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('class');
  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ img, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('rastérisation du plan impossible'));
    };
    img.src = url;
  });
};

const newCanvas = (w: number, h: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return ctx;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('encodage image impossible'))),
      type,
      quality
    )
  );

export const exportArenaPlanPng = async (svg: SVGSVGElement, filename: string): Promise<void> => {
  const { img, height } = await svgToImage(svg, EXPORT_WIDTH_PX);
  const ctx = newCanvas(EXPORT_WIDTH_PX, height);
  ctx.drawImage(img, 0, 0, EXPORT_WIDTH_PX, height);
  const blob = await canvasToBlob(ctx.canvas, 'image/png');
  downloadBlob(blob, filename);
};

/** Retour à la ligne sur la largeur donnée ; renvoie la hauteur utilisée. */
const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number
): number => {
  const words = text.split(/\s+/);
  let line = '';
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
  return cy - y;
};

export const exportArenaPlanPdf = async (
  svg: SVGSVGElement,
  text: ArenaPlanExportText,
  filename: string
): Promise<void> => {
  const ctx = newCanvas(PAGE_W, PAGE_H);
  const margin = 80;
  const planMaxW = 1400;
  const planMaxH = PAGE_H - 2 * margin - 120;
  const { img, height } = await svgToImage(svg, planMaxW * 2);
  const aspect = height / (planMaxW * 2);
  let planW = planMaxW;
  let planH = planW * aspect;
  if (planH > planMaxH) {
    planH = planMaxH;
    planW = planH / aspect;
  }
  const planTop = margin + 110;
  ctx.drawImage(img, margin, planTop, planW, planH);

  const colX = margin + planMaxW + 60;
  const colW = PAGE_W - colX - margin;
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText(text.title, margin, margin);
  let y = margin + 110;

  const block = (lines: string[], font: string, lineH: number) => {
    ctx.font = font;
    for (const line of lines) {
      y += wrapText(ctx, line, colX, y, colW, lineH);
    }
    y += 24;
  };
  block(text.summary, '36px sans-serif', 46);
  block(text.legend, '32px sans-serif', 42);
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(text.itemsTitle, colX, y);
  y += 56;
  block(text.items.length > 0 ? text.items : ['—'], '30px sans-serif', 40);
  block([text.note], '26px sans-serif', 36);

  const jpeg = await canvasToBlob(ctx.canvas, 'image/jpeg', 0.92);
  const bytes = await buildPdfWithJpeg(new Uint8Array(await jpeg.arrayBuffer()));
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename);
};

/** PDF minimal : une page A4 paysage contenant une image JPEG plein format. */
const buildPdfWithJpeg = async (jpeg: Uint8Array): Promise<Uint8Array> => {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: Uint8Array | string) => {
    const bin = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bin);
    size += bin.length;
  };
  const obj = (n: number, body: string | Uint8Array, tail = '') => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    push(body);
    push(`${tail}\nendobj\n`);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${PAGE_H_PT}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  offsets[4] = size;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${PAGE_W} /Height ${PAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${PAGE_W_PT} 0 0 ${PAGE_H_PT} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xrefPos = size;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(new ArrayBuffer(size));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
};
