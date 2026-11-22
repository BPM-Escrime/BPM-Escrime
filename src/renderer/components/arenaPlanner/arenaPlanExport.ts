/**
 * BellePoule Modern - Export du plan de salle d'arène (PNG et PDF, #2075)
 * Sérialise l'aperçu SVG affiché, le rastérise en PNG via un canvas, puis le
 * place sur une page A4 paysage avec la légende et la liste du matériel.
 * Licensed under GPL-3.0
 */

import jsPDF from 'jspdf';

const EXPORT_WIDTH_PX = 1600;

export interface ArenaPlanExportText {
  title: string;
  summary: string[];
  legend: string[];
  itemsTitle: string;
  items: string[];
  note: string;
}

const svgToPngDataUrl = (svg: SVGSVGElement): Promise<{ dataUrl: string; aspect: number }> => {
  const vb = svg.viewBox.baseVal;
  const aspect = vb.height / vb.width;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const width = EXPORT_WIDTH_PX;
  const height = Math.round(width * aspect);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('style');
  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2D indisponible');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL('image/png'), aspect });
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('rastérisation du plan impossible'));
    };
    img.src = url;
  });
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

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

export const exportArenaPlanPng = async (svg: SVGSVGElement, filename: string): Promise<void> => {
  const { dataUrl } = await svgToPngDataUrl(svg);
  downloadBlob(dataUrlToBlob(dataUrl), filename);
};

export const exportArenaPlanPdf = async (
  svg: SVGSVGElement,
  text: ArenaPlanExportText,
  filename: string
): Promise<void> => {
  const { dataUrl, aspect } = await svgToPngDataUrl(svg);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 10;

  doc.setFontSize(14);
  doc.text(text.title, margin, margin + 5);

  // Plan à gauche, dimensionné pour tenir dans la page
  const planMaxW = 175;
  const planMaxH = 170;
  let planW = planMaxW;
  let planH = planW * aspect;
  if (planH > planMaxH) {
    planH = planMaxH;
    planW = planH / aspect;
  }
  doc.addImage(dataUrl, 'PNG', margin, margin + 10, planW, planH);

  // Colonne de droite : résumé, légende, matériel
  const colX = margin + planMaxW + 5;
  const colW = pageW - colX - margin;
  let y = margin + 12;
  doc.setFontSize(10);
  const block = (lines: string[]) => {
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, colW) as string[];
      doc.text(wrapped, colX, y);
      y += wrapped.length * 4.5;
    }
    y += 3;
  };
  block(text.summary);
  block(text.legend);
  doc.setFontSize(11);
  doc.text(text.itemsTitle, colX, y);
  y += 6;
  doc.setFontSize(9);
  block(text.items.length > 0 ? text.items : ['—']);
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(text.note, colW) as string[], colX, y);

  doc.save(filename);
};
