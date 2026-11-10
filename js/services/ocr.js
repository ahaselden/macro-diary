// Reads the text of a photo with Tesseract.js (vendored under /vendor/tesseract, Apache-2.0), entirely in the browser:
// the photo never leaves the device. ~7 MB is downloaded the first time and then kept in a persistent cache (sw.js).
import { loadScript } from './script.js';

const BASE = 'vendor/tesseract/';
const abs = p => new URL(p, document.baseURI).href;

/**
 * Greyscale + contrast stretch on a downscaled copy. Label photos are usually big (3000+ px), tilted light and glossy;
 * a ~1800 px high-contrast greyscale image is both faster and more accurate for the OCR engine.
 */
export async function prepareImage(file, maxSide = 1800) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h), d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = g; hist[g]++; }
  const n = w * h; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)) | 0; d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** @param {Blob} file an image  @param {(p:{status:string, progress:number})=>void} [onProgress]  @returns {Promise<string>} the text */
export async function readImageText(file, onProgress = () => {}) {
  onProgress({ status: 'Preparing photo', progress: 0 });
  const canvas = await prepareImage(file);
  const T = await loadScript(BASE + 'tesseract.min.js', 'Tesseract');
  const worker = await T.createWorker('eng', 1, {
    workerPath: abs(BASE + 'worker.min.js'), corePath: abs(BASE), langPath: abs(BASE), workerBlobURL: false,
    logger: m => onProgress({ status: m.status, progress: m.progress || 0 }),
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally { await worker.terminate().catch(() => {}); }
}
