// Adapted from OpenGP5 Launchpad 9adfaa5 (MIT, see LICENSE).
import { buildSysex, parseSysex } from "./midi.js";
import { STORE, STORE_SIZE, planSave, latest } from "./library-store.js";

const CLASS_CMD = 1;
export class DeviceError extends Error {}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const le32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

export async function cmd(link, payload, timeout = 1000) {
  link.flush();
  await link.send(buildSysex(CLASS_CMD, 0, payload));
  const end = now() + timeout;
  while (now() < end) {
    const raw = await link.recv(Math.max(0, end - now()));
    if (raw === null) break;
    const p = parseSysex(raw);
    if (p && p.ok && p.payload[0] === payload[0] && p.payload[1] === payload[1]) return p.payload;
  }
  return null;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function blobInfo(b) {
  if (b.length < 68 || b[0] !== 0x41 || b[1] !== 0x32 || b[2] !== 0x52 || b[3] !== 0x31) return null;
  const dv = new DataView(b.buffer, b.byteOffset);
  return { length: dv.getUint32(4, true), crc: dv.getUint32(8, true),
           name: new TextDecoder().decode(b.subarray(44, 68)).replace(/\0+$/, "") };
}

export async function flashRead(link, addr, length) {
  const out = new Uint8Array(length);
  for (let o = 0; o < length; o += 64) {
    const n = Math.min(64, length - o);
    const pl = await cmd(link, [0x7E, 0x05, ...le32(addr + o), n]);
    if (!pl || pl.length < 3 + n || !pl[2]) throw new DeviceError("the pedal did not answer a flash read: is the capture player firmware running?");
    out.set(pl.subarray(3, 3 + n), o);
  }
  return out;
}

export async function readStore(link) { return flashRead(link, STORE, STORE_SIZE); }

async function program(link, addr, bytes) {
  for (let i = 0; i < bytes.length; i += 56) {
    const part = bytes.subarray(i, i + 56);
    const r = await cmd(link, [0x7E, 0x08, ...le32(addr + i), ...part], 2000);
    if (!r || r.length < 3 || !r[2]) throw new DeviceError("The pedal refused a write to its settings store.");
  }
}

// Save a record the way the firmware would (gp5_store_save), then read it back. The firmware keeps its own
// copy in memory: it sees the new record after a restart.
export async function storeSave(link, id, data) {
  const img = await readStore(link);
  const plan = planSave(img, id, data);
  for (const e of plan.erase) {
    const r = await cmd(link, [0x7E, 0x07, ...le32(STORE + e)], 5000);
    if (!r || r.length < 3 || !r[2]) throw new DeviceError("The pedal refused to erase its settings store.");
  }
  // header last: a record is only valid once its first words are in
  await program(link, STORE + plan.at + 16, plan.bytes.subarray(16));
  await program(link, STORE + plan.at, plan.bytes.subarray(0, 16));
  const back = latest(await readStore(link)).get(id);
  if (!back || back.data.length !== data.length || back.data.some((v, i) => v !== data[i]))
    throw new DeviceError("The settings did not read back correctly. Nothing else was changed; try again.");
  return { reloaded: await storeChanged(link, id) };
}

// Tell the firmware a record changed (platform 0.2.2+, 7E 0E): true if it loaded it again, false if the pedal
// must be restarted for it (older platforms don't answer).
export async function storeChanged(link, id) {
  const r = await cmd(link, [0x7E, 0x0E, ...le32(id)], 500);
  return !!(r && r.length >= 3 && r[2] === 1);
}
