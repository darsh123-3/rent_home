// pdfjs-dist ships only as ES modules. Node's own require loads them (Node 20.19+ / 22.12+). It is taken from
// process.getBuiltinModule so Jest's module sandbox, which cannot load ES modules, does not intercept it.
const loadPdfjs = () =>
  process.getBuiltinModule('module').createRequire(__filename)('pdfjs-dist/legacy/build/pdf.mjs') as typeof import('pdfjs-dist/legacy/build/pdf.mjs');

interface NodeCanvas {
  width: number;
  height: number;
  toBuffer(mime: 'image/jpeg', quality?: number): Buffer;
}

/**
 * The first page of a bill PDF as a JPEG, so the bill can be shared as a picture (WhatsApp shows it inline).
 * Rendered from the PDF itself, so the image always matches the PDF exactly. `scale` 2 gives about 1190 x 1684 px for A4.
 * The canvas comes from pdfjs's own factory (its bundled @napi-rs/canvas), so shapes and canvas always match.
 */
export async function pdfToJpeg(pdf: Buffer, scale = 2, quality = 88): Promise<Buffer> {
  const pdfjs = loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: NodeCanvas; context: CanvasRenderingContext2D } } }).canvasFactory;
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    context.fillStyle = '#FFFFFF'; // JPEG has no transparency: start from white paper
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    return canvas.toBuffer('image/jpeg', quality);
  } finally {
    await doc.destroy();
  }
}
