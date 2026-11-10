// DOM-free barcode scanner. The UI supplies the <video> element and shows any errors.
let scanStream = null, scanTimer = null;

export const canScan = () => 'BarcodeDetector' in window;

export function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}

/** Throws if the camera is unavailable. Calls onCode(rawValue) once, after stopping the scan. */
export async function startScan(video, onCode) {
  scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = scanStream; await video.play();
  const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  scanTimer = setInterval(async () => {
    try { const codes = await det.detect(video); if (codes.length) { const c = codes[0].rawValue; stopScan(); onCode(c); } } catch {}
  }, 400);
}
