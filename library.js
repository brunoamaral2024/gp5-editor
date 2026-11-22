import { convertNam } from "./convert-nam.js";
import { cabInfo, decodeIr, makeCabFile } from "./convert-ir.js";
import { blobInfo, crc32, flashRead, readStore, storeSave } from "./library-wire.js";
import { fourcc, latest } from "./library-store.js";
import { deleteFile, listFiles, readFile, sectorsFor, TOTAL_SECTORS, writeFile } from "./library-files.js";

const FORMAT = "gp5-nam-library";
const MAX_BYTES = 512 * 1024;
const OWNER = fourcc("AMPB");
const RECORD_LENGTHS = new Map([[fourcc("AMPT"), 992], [0x53434e31, 992], [0x53434e32, 992], [OWNER, 4]]);
const fileName = /^(tone|cab)-(0[1-9]|[12][0-9]|30)$/;
for (let i = 0; i < 3; i++) RECORD_LENGTHS.set(0x45513030 + i, 279);

function encode(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}

async function checksum(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function pack(key, bytes) {
  return { ...key, data: encode(bytes), sha256: await checksum(bytes) };
}

function checkAudio(name, bytes) {
  if (name.startsWith("tone-")) {
    const info = blobInfo(bytes);
    if (info && info.length === bytes.length && bytes.length % 4 === 0 && sectorsFor(bytes.length) <= 2
        && info.crc === crc32(bytes.subarray(12))) return;
  } else if (bytes.length >= 16) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const magic = view.getUint32(0, true);
    const taps = view.getUint32(4, true);
    const width = magic === fourcc("CAB1") ? 4 : magic === fourcc("CAB2") ? 2 : 0;
    const payload = 16 + ((taps * width + 3) & ~3);
    if (width && taps >= 1 && taps <= 1024 && view.getUint32(8, true) === 48000
        && bytes.length >= payload && bytes.length <= payload + 32) return;
  }
  throw new Error(`Arquivo incompatível ou danificado (${name}).`);
}

function normalizeEqBank(id, bytes) {
  if (id < 0x45513030 || id > 0x45513032) return bytes;
  if (bytes?.length === 279) return bytes;
  if (bytes && bytes.length !== 248) throw new Error("Banco de EQ incompatível.");
  const merged = new Uint8Array(279);
  for (let i = 0; i < 31; i++) {
    if (bytes) merged.set(bytes.subarray(i * 8, (i + 1) * 8), i * 9);
    merged[i * 9 + 8] = 0x27;
  }
  return merged;
}

async function unpack(entry) {
  if (typeof entry?.data !== "string" || typeof entry.sha256 !== "string")
    throw new Error("Entrada inválida na biblioteca.");
  const bytes = Uint8Array.from(atob(entry.data), char => char.charCodeAt(0));
  if (await checksum(bytes) !== entry.sha256) throw new Error("O arquivo não passou na verificação de integridade.");
  return bytes;
}

export async function parseLibrary(file) {
  if (file.size > MAX_BYTES) throw new Error("O arquivo excede o tamanho máximo de uma biblioteca da GP-5.");
  const data = JSON.parse(await file.text());
  if (data?.format !== FORMAT || data.version !== 1 || !Array.isArray(data.files) || !Array.isArray(data.records)
      || data.files.length > 60 || ![4, RECORD_LENGTHS.size].includes(data.records.length))
    throw new Error("Selecione uma biblioteca .gp5library exportada por este editor.");
  const files = new Map(), records = new Map();
  let occupied = 0;
  for (const entry of data.files) {
    if (typeof entry?.name !== "string" || !fileName.test(entry.name) || files.has(entry.name))
      throw new Error("A biblioteca contém slots inválidos ou duplicados.");
    const bytes = await unpack(entry);
    checkAudio(entry.name, bytes);
    occupied += sectorsFor(bytes.length);
    files.set(entry.name, bytes);
  }
  if (occupied > TOTAL_SECTORS) throw new Error("A biblioteca não cabe na GP-5.");
  for (const entry of data.records) {
    if (!RECORD_LENGTHS.has(entry?.id) || records.has(entry.id)) throw new Error("Registro de preset inválido ou duplicado.");
    const bytes = normalizeEqBank(entry.id, await unpack(entry));
    if (bytes.length !== RECORD_LENGTHS.get(entry.id)) throw new Error("Tamanho inválido de registro de preset.");
    if (entry.id === OWNER) {
      const slot = new DataView(bytes.buffer).getInt32(0, true);
      if (slot < -1 || slot >= 30 || (slot >= 0 && !files.has(`tone-${String(slot + 1).padStart(2, "0")}`)))
        throw new Error("O timbre ativo aponta para um slot indisponível.");
    }
    records.set(entry.id, bytes);
  }
  for (const id of RECORD_LENGTHS.keys()) {
    if (records.has(id)) continue;
    if (id < 0x45513030 || id > 0x45513032) throw new Error("Faltam registros de presets.");
    records.set(id, normalizeEqBank(id));
  }
  return { files, records };
}

const ownFile = (file) => file.owner === OWNER && fileName.test(file.name);

function normalizePresets(raw) {
  if (!raw || raw.length === 992) return raw ?? new Uint8Array(992);
  const layouts = new Map([[104, 8], [372, 12], [496, 16], [620, 20]]);
  const stride = layouts.get(raw.length);
  if (!stride) throw new Error("Formato de preset incompatível com esta versão.");
  const result = new Uint8Array(992);
  for (let i = 0; i < raw.length / stride; i++) {
    const offset = (stride === 8 && i === 12 ? 30 : i) * 32;
    const old = raw.subarray(i * stride, (i + 1) * stride);
    result.set(old.subarray(0, Math.min(stride, 18)), offset);
    if (stride < 16) result.set([25, 38], offset + 11);
    if (stride < 20) result.set([0, 30, 65, 25, 45], offset + 13);
    result.set([0, 0, 30, 4, 0, 0, 12, 45, 35], offset + 20);
  }
  return result;
}

export async function listInstalledFiles(link) {
  const directory = (await listFiles(link)).files.filter(ownFile);
  const installed = [];
  for (const file of directory) {
    const [kind, number] = file.name.split("-");
    const address = file.addr + 64;
    let name;
    if (kind === "tone" && file.len >= 68) {
      name = blobInfo(await flashRead(link, address, 68))?.name;
    } else if (kind === "cab" && file.len >= 16) {
      const header = await flashRead(link, address, 16);
      const cab = cabInfo(header);
      const offset = cab && 16 + cab.tapBytes;
      if (offset && offset < file.len)
        name = cabInfo(header, await flashRead(link, address + offset, Math.min(32, file.len - offset)))?.name;
    }
    installed.push({kind, slot: Number(number), name: name?.trim() || file.name});
  }
  return installed.sort((a, b) => a.slot - b.slot);
}

export async function exportLibrary(link, activeSlot, heartbeat, progress) {
  progress("Lendo presets e cenas…");
  const stored = latest(await readStore(link));
  const directory = (await listFiles(link)).files.filter(ownFile);
  const available = directory.some(file => file.name === `tone-${String(activeSlot + 1).padStart(2, "0")}`);
  const records = [];
  const selected = new Uint8Array(4);
  new DataView(selected.buffer).setInt32(0, available ? activeSlot : -1, true);
  for (const [id, length] of RECORD_LENGTHS) {
    const saved = stored.get(id)?.data;
    const raw = id === fourcc("AMPT") ? normalizePresets(saved) : normalizeEqBank(id, saved);
    if (id !== OWNER && raw && raw.length !== length) throw new Error("Formato de preset incompatível com esta versão.");
    records.push(await pack({ id }, id === OWNER ? selected : raw ?? new Uint8Array(length)));
  }
  const files = [];
  for (const [i, file] of directory.entries()) {
    await heartbeat();
    progress(`Lendo ${file.name} (${i + 1}/${directory.length})…`);
    const bytes = await readFile(link, file);
    checkAudio(file.name, bytes);
    files.push(await pack({ name: file.name }, bytes));
  }
  return JSON.stringify({ format: FORMAT, version: 1, created: new Date().toISOString(), files, records });
}

export async function restoreLibrary(link, backup, heartbeat, progress) {
  const directory = await listFiles(link);
  const current = directory.files.filter(ownFile);
  const occupiedByOthers = new Set(directory.used);
  for (const file of directory.all.filter(ownFile)) {
    for (let i = 0; i < file.sectors; i++) occupiedByOthers.delete(file.run * 64 + file.sector + i);
  }
  const needed = [...backup.files.values()].reduce((n, bytes) => n + sectorsFor(bytes.length), occupiedByOthers.size);
  if (needed > TOTAL_SECTORS) throw new Error("A biblioteca e os arquivos de outras funções não cabem juntos.");
  for (const file of current) {
    if (backup.files.has(file.name)) continue;
    await heartbeat();
    progress(`Limpando o slot ${file.name}…`);
    await deleteFile(link, OWNER, file.name);
  }

  const incoming = [...backup.files].sort((a, b) => sectorsFor(b[1].length) - sectorsFor(a[1].length));
  for (const [i, [name, bytes]] of incoming.entries()) {
    await heartbeat();
    progress(`Restaurando ${name} (${i + 1}/${incoming.length})…`);
    const previous = current.find(file => file.name === name);
    if (previous?.len === bytes.length && previous.crc === crc32(bytes)) {
      const contents = await readFile(link, previous).catch(() => null);
      if (contents?.every((byte, index) => byte === bytes[index])) continue;
    }
    await writeFile(link, OWNER, name, bytes);
  }

  for (const [id, bytes] of backup.records) {
    await heartbeat();
    progress("Restaurando presets e cenas…");
    await storeSave(link, id, bytes);
  }
}

const NAM_ERRORS = [
  [/no A2-Lite part|no width-3 A2-Lite model|not an A2-Lite model/i, "captura A2 sem A2-Lite (a GP-5 só toca NAM A2-Lite)"],
  [/not a NAM A2 capture/i, "não é uma captura NAM A2 (capturas A1 não funcionam na GP-5)"],
  [/must be made at 48 kHz/i, "a captura precisa ser feita em 48 kHz"],
  [/not a NAM capture/i, "o arquivo não é uma captura NAM"],
];

export function namError(error) {
  const message = String(error?.message ?? error);
  for (const [pattern, text] of NAM_ERRORS) if (pattern.test(message)) return text;
  return message;
}

export async function prepareSlotFile(file, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 30) throw new Error("Escolha um slot de 1 a 30.");
  if (file.size > 32 * 1024 * 1024) throw new Error("O arquivo ultrapassa 32 MB.");
  const capture = /\.nam$/i.test(file.name);
  const label = file.name.replace(/\.[^.]+$/, "");
  let data;
  if (capture) {
    try { data = convertNam(await file.text(), label).blob; }
    catch (error) { throw new Error(namError(error)); }
  } else if (/\.wav$/i.test(file.name)) {
    const { samples } = await decodeIr(new Uint8Array(await file.arrayBuffer()));
    data = makeCabFile(samples, label);
  } else throw new Error("Selecione uma captura NAM A2 ou um IR WAV.");
  const name = `${capture ? "tone" : "cab"}-${String(slot).padStart(2, "0")}`;
  checkAudio(name, data);
  return { name, data };
}

export async function planSlotBatch(link, files, firstSlot, kind, progress = () => {}) {
  const directory = await listFiles(link);
  const occupied = new Set(directory.files.filter(ownFile).map(file => file.name));
  const slots = Array.from({length: 31 - firstSlot}, (_, i) => firstSlot + i)
    .filter(slot => !occupied.has(`${kind}-${String(slot).padStart(2, "0")}`));
  const entries = [], rejected = [];
  for (const [index, file] of files.entries()) {
    progress(`Convertendo ${index + 1}/${files.length}: ${file.name}…`);
    if (entries.length >= slots.length) {
      rejected.push({ name: file.name, message: "não há slot livre" });
      continue;
    }
    try {
      entries.push(await prepareSlotFile(file, slots[entries.length]));
    } catch (error) {
      rejected.push({ name: file.name, message: error.message });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!entries.length) {
    const details = rejected.slice(0, 4).map(item => `${item.name}: ${item.message}`).join(" · ");
    throw new Error(`Nenhum arquivo compatível. ${details}`);
  }
  const sectors = entries.reduce((total, entry) => total + sectorsFor(entry.data.length), 0);
  if (sectors > directory.freeSectors)
    throw new Error(`Memória insuficiente: ${entries.length} arquivo(s) precisam de ${sectors} setores e há ${directory.freeSectors} livres. Nada foi gravado.`);
  return { entries, rejected };
}

export async function sendSlotFile(link, { name, data }, progress) {
  await writeFile(link, OWNER, name, data, value => progress(`Gravando ${name} · ${Math.round(value * 100)}%…`));
}
