// Adapted from OpenGP5 Launchpad 9adfaa5 (MIT, see LICENSE).
// The OpenGP5 platform store (platform/nds32/gp5_store.c), read and written from the computer, and what the
// firmwares keep in it. The store is two 4 KB flash sectors at 0x160000 holding a log of records:
//   [magic 'GP5S' u32][sequence u32][firmware id u32][length u16][CRC-16 u16][data, padded to 4 bytes with FF]
// The newest valid record per id wins. Writing appends exactly as gp5_store_save does (same sector choice,
// sequence number and padding), so the firmware reads a record written here as one of its own.

export const STORE = 0x160000, STORE_SIZE = 0x2000, SECTOR = 0x1000, MAGIC = 0x53355047, HDR = 16, STORE_MAX = 1024;

export const fourcc = (s) => (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
export const idName = (id) => String.fromCharCode(id & 255, (id >>> 8) & 255, (id >>> 16) & 255, id >>> 24);

export function crc16(bytes) {
  let c = 0xFFFF;
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return c;
}
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const recSize = (len) => HDR + ((len + 3) & ~3);
const erased = (b, off, n) => { for (let i = 0; i < n; i++) if (b[off + i] !== 0xFF) return false; return true; };

// Every valid record, and per sector where the free space starts (as scan() in gp5_store.c).
export function parseStore(img) {
  const records = [], end = [0, 0];
  let top = null;
  for (let s = 0; s < 2; s++) {
    let off = 0;
    while (off + HDR <= SECTOR) {
      const a = s * SECTOR + off, m = u32(img, a);
      if (m === 0xFFFFFFFF) break;
      const len = u32(img, a + 12) & 0xFFFF;
      if (m !== MAGIC || len > STORE_MAX || off + recSize(len) > SECTOR) { off = SECTOR; break; }
      const data = img.slice(a + HDR, a + HDR + len);
      if (crc16(data) === u32(img, a + 12) >>> 16) {
        const seq = u32(img, a + 4);
        if (top === null || seq > top) top = seq;
        records.push({ addr: a, seq, id: u32(img, a + 8), len, data });
      }
      off += recSize(len);
    }
    end[s] = off;
  }
  return { records, end, top };
}

// The newest record of each firmware id: { id: data }
export function latest(img) {
  const best = new Map();
  for (const r of parseStore(img).records) if (!best.has(r.id) || r.seq > best.get(r.id).seq) best.set(r.id, r);
  return best;
}

// What gp5_store_save(id, data) would do to this store image: { erase: [sector offsets], at, bytes } (the bytes to
// program at store offset `at`: the new record, or, on a sector switch, the other ids' newest records copied
// across followed by the new record). Byte for byte what platform/nds32/gp5_store.c writes.
export function planSave(img, id, data) {
  if (data.length > STORE_MAX) throw new Error("record too large");
  const { records, end, top } = parseStore(img), size = recSize(data.length);
  let newest = null;
  for (const r of records) if (!newest || r.seq > newest.seq) newest = r;
  let seq = newest ? (top + 1) >>> 0 : 1;
  let s = newest ? (newest.addr >= SECTOR ? 1 : 0) : 0;
  if (newest && end[s] + size <= SECTOR && erased(img, s * SECTOR + end[s], size))
    return { erase: [], at: s * SECTOR + end[s], bytes: record(seq, id, data) };
  // sector switch: the newest record of every other id, oldest first, as many as leave room for the new one
  const keep = [];
  for (const r of records) {                       // (records are in walk order: sector 0, then sector 1)
    if (r.id === id) continue;
    const k = keep.findIndex((x) => x.id === r.id);
    if (k < 0) { if (keep.length < 16) keep.push(r); } else if (r.seq > keep[k].seq) keep[k] = r;
  }
  for (let k = 1; k < keep.length; k++) for (let i = k; i > 0 && keep[i - 1].seq > keep[i].seq; i--) [keep[i - 1], keep[i]] = [keep[i], keep[i - 1]];
  let used = keep.reduce((n, r) => n + recSize(r.len), 0);
  while (keep.length && used + size > SECTOR) used -= recSize(keep.shift().len);
  s = newest ? 1 - s : 0;
  const erase = erased(img, s * SECTOR, SECTOR) ? [] : [s * SECTOR];
  const parts = keep.map((r) => record(seq++, r.id, r.data));
  parts.push(record(seq, id, data));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { erase, at: s * SECTOR, bytes };
}

function record(seq, id, data) {
  const rec = new Uint8Array(recSize(data.length)).fill(0xFF), dv = new DataView(rec.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, seq >>> 0, true); dv.setUint32(8, id, true);
  rec.set(data, HDR);
  dv.setUint32(12, (data.length | (crc16(data) << 16)) >>> 0, true);
  return rec;
}

// Apply a plan to an image (to check it, or to simulate)
export function applyPlan(img, plan) {
  const out = img.slice();
  for (const e of plan.erase) out.fill(0xFF, e, e + SECTOR);
  for (let i = 0; i < plan.bytes.length; i++) out[plan.at + i] &= plan.bytes[i];
  return out;
}
