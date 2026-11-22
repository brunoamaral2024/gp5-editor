import PRST from "./valeton-prst.js";

const reverbModels = [201326613, 201326603, 201326592, 201326593, 201326594, 201326608, 201326607, 201326596, 201326598, 201326599];
const modModels = [0, 67108872, 67108881, 67108902, 67108889, 67108887];
const rhythm = [1, 1 / 2, 3 / 4, 1 / 3, 1 / 4];
const localIds = [2, 3, 4, 5, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 67, 68, 69, 70, 71, 72, 73, 80, 81, 82, 83];
const round = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

export function makePreset(values) {
  return JSON.stringify({ format: "gp5-scene", version: 1, values: Object.fromEntries(localIds.map(id => [id, values[id]])) }, null, 2);
}

function checkedPrst(bytes) {
  const prst = PRST;
  const device = prst.detect(bytes);
  if (device.key !== "gp5" || bytes.length !== device.prstLen
      || !device.header.every((byte, index) => byte === bytes[index])
      || bytes[prst.CRC_OFF] !== prst.crc8(bytes.subarray(prst.CRC_OFF + 1))
      || prst.modelRecords(bytes).length !== 10 || prst.paramFloats(bytes).length !== 80
      || prst.bypassOffset(bytes) < 0)
    throw new Error("Escolha um .prst válido do modelo Valeton GP-5.");
  return prst;
}

export async function loadPreset(file) {
  if (file.size > 64 * 1024) throw new Error("Arquivo de preset muito grande.");
  if (!/\.prst$/i.test(file.name)) {
    const data = JSON.parse(await file.text());
    if (data?.format !== "gp5-scene" || data.version !== 1 || !data.values || typeof data.values !== "object")
      throw new Error("Arquivo .gp5preset incompatível.");
    const values = {};
    for (const [key, value] of Object.entries(data.values)) {
      if (key === "50" || key === "51") continue;
      const id = Number(key);
      const min = id === 72 || id >= 80 ? 0 : -12;
      const max = id === 72 || id >= 81 ? 1 : id === 80 ? 3 : id >= 67 ? 12 : 5039;
      if (!localIds.includes(id) || !Number.isInteger(value) || value < min || value > max)
        throw new Error("O preset contém parâmetros inválidos.");
      values[key] = value;
    }
    return { values };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const prst = checkedPrst(bytes);
  const ids = prst.modelRecords(bytes).map(([, category, low]) => (category << 24) | low);
  const floats = prst.paramFloats(bytes);
  if (!floats.every(Number.isFinite)) throw new Error("O .prst contém valores inválidos.");
  const mask = prst.bypassMask(bytes);
  const on = block => !!(mask & (1 << block));
  const get = (block, field) => floats[8 * block + field];
  const [, bpm] = prst.readVolBpm(bytes);
  const values = { 2: on(0) ? round(get(0, 0) * 61 / 100, 1, 61) : 0, 57: 0, 59: 0, 60: 0 };
  values[19] = on(1) && [0, 1].includes(ids[1]) ? 1 : 0;
  if (values[19]) values[20] = round(-48 * get(1, 0) / 100, -48, 0);
  values[45] = on(2) ? ids[2] === 50331648 || ids[2] === 50331650 || ids[2] === 50331654 ? 1 : 2 : 0;
  const stockMod = modModels.indexOf(ids[6]);
  values[23] = on(6) && stockMod > 0 ? stockMod : 0;
  if (values[23]) {
    values[24] = round(get(6, stockMod === 4 ? 0 : 1) * 10, 1, 80);
    if (stockMod !== 4) values[25] = round(get(6, 0), 0, 100);
  }
  values[8] = Number(on(7));
  values[9] = round(bpm, 45, 240);
  values[10] = rhythm.reduce((best, ratio, index) =>
    Math.abs(60000 * ratio / values[9] - get(7, 1)) < Math.abs(60000 * rhythm[best] / values[9] - get(7, 1)) ? index : best, 0);
  values[11] = round(get(7, 0), 0, 100);
  values[12] = round(get(7, 2), 0, 90);
  const rv = reverbModels.indexOf(ids[8]);
  values[13] = on(8) && rv >= 0 ? 1 : 0;
  if (values[13]) {
    values[18] = rv;
    values[14] = round(get(8, 0), 0, 100);
    values[15] = round(get(8, rv >= 7 ? 1 : 2), 0, 100);
  }
  return { values, template: bytes, name: prst.readName(bytes) };
}

export function exportPrst(template, values) {
  const prst = checkedPrst(template);
  const rv = values[18] === 10 ? 3 : values[18], mod = values[23] <= 5 ? values[23] : 0, drive = values[45];
  const models = { 0: 27, 1: 0, 2: drive === 1 || (drive >= 3 && drive <= 19) || drive === 22 || drive === 32 || drive >= 34 ? 50331648 : 50331690, 7: 184549376, 8: reverbModels[rv] };
  if (modModels[mod]) models[6] = modModels[mod];
  const params = {
    0: {0: values[2] * 100 / 61}, 1: {0: -values[20] * 100 / 48, 1: 50},
    7: {0: values[11], 1: round(60000 * rhythm[values[10]] / values[9], 20, 1000), 2: values[12]},
    8: {0: values[14], [rv >= 7 ? 1 : 2]: values[15]},
  };
  if (mod > 0) params[6] = mod === 4 ? {0: values[24] / 10} : {0: values[25], 1: values[24] / 10};
  return prst.applyEdits(template, { models, params, settings: {bpm: values[9]}, bypass: {
    0: !!values[2] && !values[57], 1: !!values[19], 2: !!drive && !values[59], 6: !!mod && !values[60], 7: !!values[8], 8: !!values[13],
  } });
}
