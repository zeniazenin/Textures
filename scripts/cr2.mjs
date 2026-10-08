// Minimal Canon CR2 reader: pulls the full-size embedded JPEG out of IFD0 and
// reads the orientation / capture-date tags. No RAW demosaicing is attempted —
// the camera's own JPEG rendering is what gets published.
import fs from 'node:fs/promises';

const T_WIDTH = 0x100, T_HEIGHT = 0x101, T_ORIENT = 0x112, T_STRIP = 0x111, T_STRIPLEN = 0x117, T_DATETIME = 0x132;

export async function readCr2(file) {
  const buf = await fs.readFile(file);
  const le = buf.toString('ascii', 0, 2) === 'II';
  if (!le && buf.toString('ascii', 0, 2) !== 'MM') throw new Error('Not a TIFF/CR2 file');
  const r16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const r32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = r32(4);
  const n = r16(ifd);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type] ?? 1;
    const total = size * count;
    const valOff = total <= 4 ? e + 8 : r32(e + 8);
    let value;
    if (type === 2) value = buf.toString('ascii', valOff, valOff + count).replace(/\0+$/, '');
    else if (type === 3) value = r16(valOff);
    else value = r32(valOff);
    tags.set(tag, value);
  }
  const off = tags.get(T_STRIP), len = tags.get(T_STRIPLEN);
  if (!off || !len || buf[off] !== 0xff || buf[off + 1] !== 0xd8) throw new Error('No embedded JPEG found in IFD0');
  return {
    jpeg: buf.subarray(off, off + len),
    orientation: tags.get(T_ORIENT) ?? 1,
    width: tags.get(T_WIDTH), height: tags.get(T_HEIGHT),
    dateTime: tags.get(T_DATETIME) ?? null, // "YYYY:MM:DD HH:MM:SS"
  };
}

/** sharp operations that realise an EXIF orientation value (1–8). */
export function orientationOps(o) {
  switch (o) {
    case 2: return { flop: true };
    case 3: return { rotate: 180 };
    case 4: return { flip: true };
    case 5: return { rotate: 90, flop: true };
    case 6: return { rotate: 90 };
    case 7: return { rotate: 270, flop: true };
    case 8: return { rotate: 270 };
    default: return {};
  }
}
