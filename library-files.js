// Adapted from OpenGP5 Launchpad 9adfaa5 (MIT, see LICENSE).
// Files in the OpenGP5 storage area (platform 0.4, docs/platform/storage.md), from the computer: list, read, write,
// delete. The pedal only reads them (platform/nds32/gp5_files.c); writing is done here with the platform's raw
// erase / program commands (7E 07 / 7E 08), header last, then read back. Byte layout and rules match the C.
import { cmd, crc32, DeviceError, flashRead } from "./library-wire.js";

export const MAGIC = 0x46355047, HDR = 64, SECTOR = 0x1000;
export const RUNS = [{ base: 0x13F000, sectors: 33 }, { base: 0x162000, sectors: 40 }];   // 0.5: run B to 0x189FFF
export const TOTAL_SECTORS = RUNS.reduce((n, r) => n + r.sectors, 0);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const le32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

export function parseHeader(h, run, sector) {
  if (h.length < HDR || u32(h, 0) !== MAGIC || crc32(h.subarray(0, 56)) !== u32(h, 56)) return null;
  const len = u32(h, 12), n = h[20] | (h[21] << 8);
  if (!n || sector + n > RUNS[run].sectors || HDR + len > n * SECTOR) return null;
  let name = ""; for (let i = 24; i < 56 && h[i]; i++) name += String.fromCharCode(h[i]);
  return { addr: RUNS[run].base + sector * SECTOR, run, sector, sectors: n, seq: u32(h, 4), owner: u32(h, 8), len, crc: u32(h, 16), name };
}

export function makeHeader({ seq, owner, name, data, sectors }) {
  const h = new Uint8Array(HDR).fill(0xFF), dv = new DataView(h.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, seq >>> 0, true); dv.setUint32(8, owner >>> 0, true);
  dv.setUint32(12, data.length, true); dv.setUint32(16, crc32(data), true);
  dv.setUint16(20, sectors, true); dv.setUint16(22, 0, true);
  const nm = new TextEncoder().encode(name);
  if (!nm.length || nm.length > 31 || [...nm].some((c) => c < 0x20 || c > 0x7E)) throw new Error(`bad file name "${name}"`);
  h.fill(0, 24, 56); h.set(nm, 24);
  dv.setUint32(56, crc32(h.subarray(0, 56)), true);
  return h;
}

// Every valid header (all copies), and the newest copy per owner + name. read(addr, len) -> Uint8Array
export async function scanFiles(read) {
  const all = [];
  for (let r = 0; r < RUNS.length; r++)
    for (let s = 0; s < RUNS[r].sectors; s++) {
      const f = parseHeader(await read(RUNS[r].base + s * SECTOR, HDR), r, s);
      if (f) all.push(f);
    }
  const newest = new Map();
  for (const f of all) { const k = f.owner + "/" + f.name; if (!newest.has(k) || f.seq > newest.get(k).seq) newest.set(k, f); }
  const used = new Set();
  for (const f of all) for (let i = 0; i < f.sectors; i++) used.add(f.run * 64 + f.sector + i);
  return { all, files: [...newest.values()], used, freeSectors: TOTAL_SECTORS - used.size, top: all.reduce((m, f) => Math.max(m, f.seq), 0) };
}

export const sectorsFor = (len) => Math.ceil((HDR + len) / SECTOR);

// Where a new file of `len` bytes goes: { run, sector, addr, sectors }, or null if it doesn't fit. Best fit: the
// smallest gap it fits (the first of those), so one-sector files fill odd gaps and leave pairs for two-sector ones
// (NAM Loader 1.3 packs 30 two-sector captures and 12 one-sector IRs into the 73 sectors).
// avoidRuns: runs not to use (e.g. run B while it still holds the NAM player's tones the old way)
export function placeFile(dir, len, { avoidRuns = [] } = {}) {
  const n = sectorsFor(len);
  let best = null;
  for (let r = 0; r < RUNS.length; r++) if (!avoidRuns.includes(r))
    for (let s = 0; s < RUNS[r].sectors;) {
      if (dir.used.has(r * 64 + s)) { s++; continue; }
      let g = 0;
      while (s + g < RUNS[r].sectors && !dir.used.has(r * 64 + s + g)) g++;
      if (g >= n && (!best || g < best.gap)) best = { run: r, sector: s, gap: g };
      s += g;
    }
  return best && { run: best.run, sector: best.sector, addr: RUNS[best.run].base + best.sector * SECTOR, sectors: n };
}

// Two free sectors side by side, made by moving one one-sector file into a free sector elsewhere: the move
// { file, to } (to: a placement), or null. For when the free sectors are all single (best fit keeps that rare).
export function planMove(dir, n, { avoidRuns = [] } = {}) {
  if (n !== 2 || dir.freeSectors < 2) return null;
  const owner = new Map();
  for (const f of dir.all) for (let i = 0; i < f.sectors; i++) owner.set(f.run * 64 + f.sector + i, f);
  const freeAt = (k) => !dir.used.has(k);
  for (let r = 0; r < RUNS.length; r++) if (!avoidRuns.includes(r))
    for (let s = 0; s + 1 < RUNS[r].sectors; s++) {
      const a = r * 64 + s, b = a + 1, k = freeAt(a) ? b : freeAt(b) ? a : -1, f = owner.get(k);
      if (k < 0 || !f || f.sectors !== 1 || !dir.files.includes(f)) continue;
      for (let r2 = 0; r2 < RUNS.length; r2++) if (!avoidRuns.includes(r2))
        for (let s2 = 0; s2 < RUNS[r2].sectors; s2++) {
          const c = r2 * 64 + s2;
          if (c !== a && c !== b && freeAt(c)) return { file: f, to: { run: r2, sector: s2, addr: RUNS[r2].base + s2 * SECTOR, sectors: 1 } };
        }
    }
  return null;
}

// ------------------------------------------------------------------ on the pedal (or anything with the link API)

const readFn = (link) => (addr, len) => flashRead(link, addr, len);

async function erase(link, addr) {
  const r = await cmd(link, [0x7E, 0x07, ...le32(addr)], 5000);
  if (!r || r.length < 3 || !r[2]) throw new DeviceError("The pedal refused to erase its storage: does it run OpenGP5 0.4 or later?");
}
async function program(link, addr, bytes) {
  for (let i = 0; i < bytes.length; i += 56) {
    const part = bytes.subarray(i, i + 56);
    if (part.every((v) => v === 0xFF)) continue;
    const r = await cmd(link, [0x7E, 0x08, ...le32(addr + i), ...part], 2000);
    if (!r || r.length < 3 || !r[2]) throw new DeviceError("The pedal refused a write to its storage.");
  }
}

export async function listFiles(link) { return scanFiles(readFn(link)); }

export async function readFile(link, f) {
  const data = await flashRead(link, f.addr + HDR, f.len);
  if (crc32(data) !== f.crc) throw new DeviceError(`The file "${f.name}" on the pedal is damaged.`);
  return data;
}

// Write (or replace) a file: new copy first, header last, read back, then the old copies go. When there's no room
// for a second copy, the old one goes first (replacing a capture in a full bank: a power cut then leaves the slot
// empty instead of keeping the old one); when the free sectors are scattered, a one-sector file moves to join them.
export async function writeFile(link, owner, name, data, progress = () => {}, opts = {}) {
  let dir = await listFiles(link), where = opts.at || placeFile(dir, data.length, opts);
  const n = sectorsFor(data.length);
  if (!where) {
    const mv = planMove(dir, n, opts);
    if (mv) {
      const f = mv.file;
      await writeFile(link, f.owner, f.name, await readFile(link, f), () => {}, { at: mv.to });
      dir = await listFiles(link); where = placeFile(dir, data.length, opts);
    }
  }
  if (!where) {
    const old = dir.all.filter((f) => f.owner === owner && f.name === name);
    if (old.length) {
      const used = new Set(dir.used);
      for (const f of old) for (let i = 0; i < f.sectors; i++) used.delete(f.run * 64 + f.sector + i);
      const without = { ...dir, all: dir.all.filter((f) => !old.includes(f)), files: dir.files.filter((f) => !old.includes(f)), used, freeSectors: TOTAL_SECTORS - used.size };
      if (placeFile(without, data.length, opts) || planMove(without, n, opts)) {
        for (const f of old) await erase(link, f.addr);
        return writeFile(link, owner, name, data, progress, opts);
      }
    }
  }
  if (!where) throw new DeviceError(`Not enough room on the pedal (needs ${n * 4} KB, ${dir.freeSectors * 4} KB free).`);
  const header = makeHeader({ seq: dir.top + 1, owner, name, data, sectors: where.sectors });
  const pad = (4 - (data.length % 4)) % 4, body = new Uint8Array(data.length + pad).fill(0xFF); body.set(data);
  for (let i = 0; i < where.sectors; i++) await erase(link, where.addr + i * SECTOR);
  progress(0.2);
  await program(link, where.addr + HDR, body);
  progress(0.75);
  await program(link, where.addr, header);
  const back = await flashRead(link, where.addr, HDR + data.length);
  if (back.subarray(0, HDR).some((v, i) => v !== header[i]) || back.subarray(HDR).some((v, i) => v !== data[i]))
    throw new DeviceError("The file did not read back correctly. The old copy is still there; try again.");
  progress(0.9);
  for (const f of dir.all) if (f.owner === owner && f.name === name) await erase(link, f.addr);   // older copies
  progress(1);
  return { ...where, name, owner, len: data.length };
}

export async function deleteFile(link, owner, name) {
  const dir = await listFiles(link);
  const copies = dir.all.filter((f) => f.owner === owner && f.name === name);
  for (const f of copies) await erase(link, f.addr);
  return copies.length;
}
