// Test support (not a test file: the glob only runs *.test.js). Builds tiny, valid zip files by hand, so the zip reader is tested
// against bytes that were assembled from the zip format description (APPNOTE 4.3), NOT by the code under test.
// All data in the tests that use it is made up. Independent CRC-32 (table driven), so zlib's own crc is not trusted either.
import { deflateRawSync } from 'node:zlib';

const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = T[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const asBuf = d => (Buffer.isBuffer(d) ? d : Buffer.from(d, 'utf8'));

/**
 * files: [{ name, data (string|Buffer), method: 'store' | 'deflate' | <number> (default 'deflate'), flags (extra flag bits, e.g. 1 = encrypted),
 *           crc (override the stored crc), size (override the stored uncompressed size), descriptor (true: flag bit 3, zeros in the local header,
 *           a data descriptor after the data, like streaming zip writers), localExtra (Buffer put in the LOCAL header only), badOffset (point the
 *           central record far outside the file), raw (use `data` as the already-compressed bytes, with `size` and `crc` given) }]
 * opts:  { comment (Buffer|string), zip64 (true: EOCD fields set to the 0xFFFF.. markers and a zip64 locator written),
 *          zip64Entry (true: the first central record claims size 0xFFFFFFFF, as a zip64 entry does) }
 * Returns { bytes: Buffer, entries: [{ name, localOffset, dataOffset, dataEnd }] } where the offsets let a test see which bytes were read.
 */
export function buildZip(files, opts = {}) {
  const parts = [], central = [], info = [];
  let pos = 0;
  const push = b => { parts.push(b); pos += b.length; };
  for (const f of files) {
    const raw = asBuf(f.data), nameB = Buffer.from(f.name, 'utf8');
    const m = f.method === undefined ? 'deflate' : f.method;
    const method = m === 'store' ? 0 : m === 'deflate' ? 8 : m;
    const body = f.raw ? raw : method === 8 ? deflateRawSync(raw) : raw;
    const crc = f.crc !== undefined ? f.crc : crc32(raw), size = f.size !== undefined ? f.size : raw.length;
    const flags = 0x0800 | (f.flags || 0) | (f.descriptor ? 8 : 0);
    const localExtra = f.localExtra || Buffer.alloc(0);
    const off = pos;
    push(Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(f.descriptor ? 0 : crc), u32(f.descriptor ? 0 : body.length), u32(f.descriptor ? 0 : size),
      u16(nameB.length), u16(localExtra.length), nameB, localExtra]));
    const dataOffset = pos;
    push(body);
    if (f.descriptor) push(Buffer.concat([u32(0x08074b50), u32(crc), u32(body.length), u32(size)]));
    info.push({ name: f.name, localOffset: off, dataOffset, dataEnd: dataOffset + body.length });
    central.push({ nameB, flags, method, crc, csize: body.length, size, off: f.badOffset ? 0x7ffffff0 : off });
  }
  const cdStart = pos;
  central.forEach((c, i) => {
    const big = opts.zip64Entry && i === 0;
    push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(c.flags), u16(c.method), u16(0), u16(0x21), u32(c.crc), u32(big ? 0xffffffff : c.csize), u32(big ? 0xffffffff : c.size),
      u16(c.nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off), c.nameB]));
  });
  const cdSize = pos - cdStart;
  const comment = opts.comment === undefined ? Buffer.alloc(0) : asBuf(opts.comment);
  if (opts.zip64) {
    const z64At = pos;
    push(Buffer.concat([u32(0x06064b50), Buffer.alloc(8), u16(45), u16(45), u32(0), u32(0), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]));
    push(Buffer.concat([u32(0x07064b50), u32(0), Buffer.from(new BigUint64Array([BigInt(z64At)]).buffer), u32(1)]));
  }
  push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(opts.zip64 ? 0xffff : central.length), u16(opts.zip64 ? 0xffff : central.length),
    u32(opts.zip64 ? 0xffffffff : cdSize), u32(opts.zip64 ? 0xffffffff : cdStart), u16(comment.length), comment]));
  return { bytes: Buffer.concat(parts), entries: info };
}

/** A Blob over the zip bytes. */
export const zipBlob = (files, opts) => new Blob([buildZip(files, opts).bytes], { type: 'application/zip' });

/**
 * A Blob-like wrapper that records every byte range that is asked for, and REFUSES whole-file reads (arrayBuffer/stream/text/bytes on the
 * whole thing). A reader that slices only the parts it needs works; one that loads the whole zip throws. `log` holds [start, end) pairs.
 */
export function spyBlob(bytes) {
  const real = new Blob([bytes]), log = [];
  const whole = what => () => { throw new Error('the whole file was read through ' + what + ' (must use slice)'); };
  return {
    size: real.size, type: real.type, log,
    slice(a = 0, b = real.size) {
      const s = Math.max(0, a < 0 ? real.size + a : a), e = Math.min(real.size, b < 0 ? real.size + b : b);
      log.push([s, Math.max(s, e)]);
      return real.slice(a, b);
    },
    arrayBuffer: whole('arrayBuffer()'), stream: whole('stream()'), text: whole('text()'), bytes: whole('bytes()'),
    bytesRead: () => log.reduce((n, [s, e]) => n + (e - s), 0),
    touched: (from, to) => log.some(([s, e]) => s < to && e > from),
  };
}
