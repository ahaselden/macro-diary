// A small random-access zip reader over a Blob (a file the owner picked). Nothing is uploaded and nothing is kept: the file is never read whole.
//   listEntries(blob)          -> the central directory (only the end of the file is read)
//   readEntryText(blob, entry) -> the text of ONE entry (only that entry's bytes are read, deflate goes through the browser's own DecompressionStream)
// Written for Google Takeout (D54): about 200 MB, about 11,000 entries, about 3 GB unzipped, so memory is bounded to one entry at a time.
// Not supported on purpose: zip64 (a clear message), encryption, methods other than stored (0) and deflate (8). No library is vendored.
// DecompressionStream is looked up when it is needed, so a browser without it still lists and reads stored entries.

/** An error with a machine `code` and a plain-English `message` that is shown to the owner as it is. */
export class ZipError extends Error {
  constructor(code, message) { super(message); this.name = code === 'aborted' ? 'AbortError' : 'ZipError'; this.code = code; }
}

const MSG = {
  'not-zip': 'This file is not a zip file.',
  zip64: 'This zip file is too large or uses the zip64 format, which this app cannot read. Download the export again in several smaller files.',
  encrypted: 'This zip file is protected by a password (encrypted), which this app cannot read.',
  'unsupported-method': 'This zip file uses a compression method this app cannot read.',
  corrupt: 'This zip file looks damaged and could not be read completely.',
  'too-big': 'A file inside this zip is too large to read in the browser.',
  'unsupported-browser': 'This browser cannot unpack zip files (no DecompressionStream). Try a current version of Chrome, Edge, Firefox or Safari.',
  aborted: 'Cancelled.',
};
const fail = code => new ZipError(code, MSG[code]);
const checkAbort = signal => { if (signal && signal.aborted) throw fail('aborted'); };

const EOCD_MIN = 22, MAX_COMMENT = 65535, DEFAULT_MAX = 268435456;
const bytesOf = async part => new Uint8Array(await part.arrayBuffer());
const usableBlob = b => !!b && typeof b.slice === 'function' && typeof b.size === 'number' && Number.isFinite(b.size);

/** Every central directory record: [{ name, size, compressedSize, method, offset, flags, crc }]. Names are UTF-8. */
export async function listEntries(blob, { signal } = {}) {
  checkAbort(signal);
  if (!usableBlob(blob) || blob.size < EOCD_MIN) throw fail('not-zip');
  const total = blob.size, from = Math.max(0, total - (EOCD_MIN + MAX_COMMENT));
  const tail = await bytesOf(blob.slice(from, total));
  checkAbort(signal);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let at = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {          // the signature may also sit inside the comment: accept only a record that ends exactly at the end of the file
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6 && i + EOCD_MIN + tv.getUint16(i + 20, true) === tail.length) { at = i; break; }
  }
  if (at < 0) throw fail('not-zip');
  const count = tv.getUint16(at + 10, true), cdSize = tv.getUint32(at + 12, true), cdOffset = tv.getUint32(at + 16, true);
  const locator = at >= 20 && tv.getUint32(at - 20, true) === 0x07064b50;
  if (locator || count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw fail('zip64');
  if (cdOffset + cdSize > from + at) throw fail('corrupt');
  const cd = cdSize ? await bytesOf(blob.slice(cdOffset, cdOffset + cdSize)) : new Uint8Array(0);
  checkAbort(signal);
  if (cd.length !== cdSize) throw fail('corrupt');
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength), dec = new TextDecoder('utf-8'), out = [];
  let p = 0;
  while (p < cdSize) {
    if (p + 46 > cdSize || dv.getUint32(p, true) !== 0x02014b50) throw fail('corrupt');
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > cdSize) throw fail('corrupt');
    const compressedSize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), offset = dv.getUint32(p + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw fail('zip64');
    if (offset + 30 + compressedSize > total) throw fail('corrupt');   // the data would lie outside the file
    out.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + nameLen)), size, compressedSize, method: dv.getUint16(p + 10, true), offset, flags: dv.getUint16(p + 8, true), crc: dv.getUint32(p + 16, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crcUpdate = (crc, buf) => { for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return crc; };

/**
 * The UTF-8 text of one entry. Sizes and the CRC come from the central directory (streaming zip writers leave zeros in the local header). An entry
 * whose declared size is above `maxBytes` is refused before any of its data is read; inflating more than the declared size stops at once.
 */
export async function readEntryText(blob, entry, { signal, maxBytes = DEFAULT_MAX } = {}) {
  checkAbort(signal);
  if (!usableBlob(blob) || !entry || typeof entry !== 'object' || ![entry.offset, entry.size, entry.compressedSize, entry.method, entry.crc].every(Number.isFinite)) throw fail('corrupt');
  if ((entry.flags & 1) === 1) throw fail('encrypted');
  if (entry.method !== 0 && entry.method !== 8) throw fail('unsupported-method');
  if (entry.size > maxBytes || entry.compressedSize > maxBytes) throw fail('too-big');
  if (entry.method === 8 && typeof globalThis.DecompressionStream !== 'function') throw fail('unsupported-browser');
  const head = await bytesOf(blob.slice(entry.offset, entry.offset + 30));
  checkAbort(signal);
  if (head.length < 30) throw fail('corrupt');
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (hv.getUint32(0, true) !== 0x04034b50) throw fail('corrupt');
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true), end = start + entry.compressedSize;   // lengths of the LOCAL header, they may differ from the central ones
  if (end > blob.size) throw fail('corrupt');
  const part = blob.slice(start, end);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw fail('corrupt');
    const data = await bytesOf(part);
    checkAbort(signal);
    if (data.length !== entry.size || ((crcUpdate(0xffffffff, data) ^ 0xffffffff) >>> 0) !== entry.crc) throw fail('corrupt');
    return new TextDecoder('utf-8').decode(data);
  }
  const reader = part.stream().pipeThrough(new globalThis.DecompressionStream('deflate-raw')).getReader(), dec = new TextDecoder('utf-8'), pieces = [];
  let crc = 0xffffffff, got = 0;
  try {
    for (;;) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > entry.size) throw fail('corrupt');                // a lying entry cannot fill memory
      crc = crcUpdate(crc, value);
      pieces.push(dec.decode(value, { stream: true }));
    }
  } catch (e) {
    try { await reader.cancel(); } catch { /* already closed */ }
    throw e instanceof ZipError ? e : fail('corrupt');            // anything else is invalid deflate data
  }
  pieces.push(dec.decode());
  if (got !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw fail('corrupt');
  return pieces.join('');
}
