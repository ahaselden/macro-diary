// DOM-free-ish barcode scanner. The UI supplies the <video> element and shows any errors.
// Uses the browser's native BarcodeDetector when it exists (Chrome on Android/Mac). Everywhere else
// (Firefox, Safari/iPhone, Chrome/Edge on Windows) it falls back to ZXing (js/vendor/zxing.min.js, MIT),
// which is loaded only when a scan is started.
import { loadScript } from './script.js';
let scanStream = null, scanTimer = null;

const nativeDetector = () => 'BarcodeDetector' in window;
/** True when this device can show a camera at all (the native detector is not required any more). */
export const canScan = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}

/**
 * Builds decode(luminanceSource) -> text | null from a ZXing namespace. Pure apart from the library
 * itself, so tests can pass the Node build. Only retail product codes are read (EAN-13/8, UPC-A/E).
 */
export function makeDecoder(Z) {
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  return source => {
    try { return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(source)), hints).getText(); }
    catch { return null; }   // NotFoundException etc.: no barcode in this frame
  };
}

const loadZXing = () => loadScript('js/vendor/zxing.min.js', 'ZXing');

/** Throws if the camera is unavailable. Calls onCode(rawValue) once, after stopping the scan. */
export async function startScan(video, onCode) {
  const stream = scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream; await video.play();
  const found = c => { stopScan(); onCode(c); };
  if (nativeDetector()) {
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    scanTimer = setInterval(async () => {
      try { const codes = await det.detect(video); if (codes.length) found(codes[0].rawValue); } catch {}
    }, 400);
    return;
  }
  const Z = await loadZXing();
  if (scanStream !== stream) return;                         // the user closed the scanner while the library loaded
  const decode = makeDecoder(Z), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  let busy = false;
  scanTimer = setInterval(() => {
    if (busy || !video.videoWidth) return; busy = true;
    try {
      const w = Math.min(video.videoWidth, 960), h = Math.round(video.videoHeight * w / video.videoWidth);
      canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
      const text = decode(new Z.HTMLCanvasElementLuminanceSource(canvas));
      if (text) found(text);
    } finally { busy = false; }
  }, 250);
}
