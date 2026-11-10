# Vendored OCR engine (Tesseract.js)

Copied from npm via cdn.jsdelivr.net (hashes were NOT compared with the registry tarballs), used only for "Read a nutrition label from a photo" (`js/services/ocr.js`).
The photo is processed in the browser and never uploaded.

| File | Package | Licence |
|---|---|---|
| `tesseract.min.js`, `worker.min.js` | `tesseract.js@5.1.1` (`dist/`) | Apache-2.0 (declared in its package.json; the package ships no LICENSE file, see below) |
| `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@5.1.1` | Apache-2.0 (`tesseract.js-core-LICENSE.txt`) |
| `eng.traineddata.gz` | `@tesseract.js-data/eng@1.0.0` (`4.0.0_best_int/`) | Apache-2.0 (Tesseract `tessdata_best`; the npm package ships no LICENSE file) |

`tesseract.js-core-LICENSE.txt` is the standard Apache License 2.0 text and covers all rows above. `worker.min.js.LICENSE.txt` is the bundled-code notice that `worker.min.js` refers to.

Total ~11 MB in the repo; a device downloads only one core (~4 MB) plus the language data (~3 MB), once, then keeps it in the
`macro-diary-ocr-v1` cache (see `sw.js`). Not in the precache list on purpose. To update: replace the files, change the cache name in `sw.js`.
