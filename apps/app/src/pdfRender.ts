/** Rendu d'une page de PDF en image (pdf.js, Apache-2.0), entièrement sur l'appareil. Chargé à la demande : hors du chargement initial. */

/** Échelle de rendu : 2 px par point PDF (A4 ≈ 1190 × 1684 px). Les points de calage sont exprimés dans ce repère. */
export const RENDER_SCALE = 2;

export interface RenderedPage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly pages: number;
}

export async function renderPdfPage(data: Blob, pageNo: number): Promise<RenderedPage> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await data.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const n = Math.min(Math.max(1, pageNo), doc.numPages);
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas vide"))), "image/png"));
    return { blob, width: canvas.width, height: canvas.height, pages: doc.numPages };
  } finally {
    void task.destroy();
  }
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("image illisible"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
