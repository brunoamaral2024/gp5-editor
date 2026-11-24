// OpenGP5 Launchpad MIT converter. See LICENSE.
// Cab IRs for NAM Loader: a .wav impulse response -> the pedal's cab file ("cab-NN": one per tone slot before NAM
// Loader 1.3; from 1.3 a bank of 12 that any tone can choose from).
// The same steps as NAM Loader's tools/make_cab.py: mono (channels averaged), 48 kHz, the first CAB_TAPS samples with a
// fade over the last 5 %, scaled so every IR is equally loud (LOUDNESS_DB, weighted roughly as a guitar is heard) with
// its loudest frequency at most PEAK_MAX_DB (unit energy put a 4x12 at +13 dB at 129 Hz and the pedal clipped). Files:
//   "CAB1" (NAM Loader 1.1+): taps, 48000, 0 (u32 LE), the taps as float32 LE
//   "CAB2" (1.3+, one 4 KB storage sector instead of two): taps, 48000, scale (float32), the taps as int16 LE
//          (tap = value x scale; the pedal plays the IR in 16 bits anyway), padded to 4 bytes
// then the name (32 bytes UTF-8, zero padded; NAM Loader 1.3 shows it, Launchpad too).
// makeCabFile() is plain JavaScript (tested in Node); decodeIr() needs the browser's audio engine.

export const CAB_TAPS = 1024;          // what NAM Loader plays (21 ms at 48 kHz)
export const CAB_RATE = 48000;
const MAGIC = 0x31424143;              // "CAB1"
const MAGIC2 = 0x32424143;             // "CAB2"
const NAME_BYTES = 32;
const LOUDNESS_DB = -6.0;              // the middle of 51 IRs from five packs when only their peak was set (3.4 dB apart)
const PEAK_MAX_DB = 2.0;

/** A .wav (any rate, any channels) -> mono samples at 48 kHz (the browser decodes and resamples). */
export async function decodeIr(bytes) {
  const ac = new OfflineAudioContext(1, 1, CAB_RATE);
  let buf;
  try { buf = await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
  catch { throw new Error("This file isn't a sound file Launchpad can read. Use a .wav impulse response."); }
  const n = buf.length, out = new Float64Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i]; }
  for (let i = 0; i < n; i++) out[i] /= buf.numberOfChannels;
  return { samples: out, seconds: buf.duration };
}

// in-place radix-2 FFT (n a power of two)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** The largest magnitude of h's spectrum (FFT of 8192 points, as make_cab.py's np.fft.rfft(h, 8192)). */
function peakMagnitude(h) {
  const re = new Float64Array(8192), im = new Float64Array(8192);
  re.set(h.subarray(0, Math.min(h.length, 8192)));
  fft(re, im);
  let m = 0;
  for (let k = 0; k <= 4096; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
  return m;
}
/** A rough hearing weight for a guitar through a cab (as make_cab.py's weight()): K-weighting (shelf + high-pass,
 *  analog form), a pink spectrum, the amp's top rolled off above 3 kHz; 60 Hz .. 12 kHz only. */
function weight(f) {
  if (f < 60 || f > 12000) return 0;
  const x = f / 1500, y = f / 38, a2 = 10 ** (4 / 10);
  return (1 / f) * (1 + a2 * x * x) / (1 + x * x) * y ** 4 / (1 + y * y) ** 2 / (1 + (f / 3000) ** 4);
}
/** The weighted loudness of h in dB (FFT of 16384 points). */
export function loudnessDb(h) {
  const N = 16384, re = new Float64Array(N), im = new Float64Array(N);
  re.set(h.subarray(0, Math.min(h.length, N)));
  fft(re, im);
  let s = 0, sw = 0;
  for (let k = 0; k <= N / 2; k++) { const w = weight(k * 48000 / N); s += (re[k] * re[k] + im[k] * im[k]) * w; sw += w; }
  return 10 * Math.log10(s / sw + 1e-30);
}
/** The scale make_cab.py's cab_gain() gives: loudest frequency at 0 dB, then to LOUDNESS_DB, peak at most PEAK_MAX_DB. */
function cabGain(h) {
  const g = 1 / (peakMagnitude(h) + 1e-12);
  const loud = loudnessDb(h.map(v => v * g));
  return g * Math.min(10 ** ((LOUDNESS_DB - loud) / 20), 10 ** (PEAK_MAX_DB / 20));
}
/** The loudest frequency of h in dB. */
export function peakGainDb(h) { return 20 * Math.log10(peakMagnitude(h) || 1e-12); }

/** The bytes of a file's taps, by its format (0: not a cab file). */
export const cabTapBytes = (magic, taps) => magic === MAGIC ? 4 * taps : magic === MAGIC2 ? (2 * taps + 3) & ~3 : 0;

/** Float taps -> a "CAB2" file: 16 bits, scaled so the largest tap is full scale. */
function cab2(h, name) {
  const n = h.length, tb = cabTapBytes(MAGIC2, n), out = new Uint8Array(16 + tb + NAME_BYTES), dv = new DataView(out.buffer);
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(h[i]));
  const scale = Math.fround((m || 1) / 32767);
  dv.setUint32(0, MAGIC2, true); dv.setUint32(4, n, true); dv.setUint32(8, CAB_RATE, true); dv.setFloat32(12, scale, true);
  for (let i = 0; i < n; i++) dv.setInt16(16 + 2 * i, Math.max(-32767, Math.min(32767, Math.round(h[i] / scale))), true);
  out.set(new TextEncoder().encode(name || "").slice(0, NAME_BYTES - 1), 16 + tb);
  return out;
}

/** An old "CAB1" file (float taps) -> the same IR as "CAB2" (half the room); a CAB2 file comes back as it is. */
export function cabToCab2(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), magic = dv.getUint32(0, true), n = dv.getUint32(4, true);
  if (magic === MAGIC2) return bytes;
  if (magic !== MAGIC || !n || 16 + 4 * n > bytes.length) throw new Error("Not a cab IR file.");
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) h[i] = dv.getFloat32(16 + 4 * i, true);
  const nb = bytes.subarray(16 + 4 * n, 16 + 4 * n + NAME_BYTES), z = nb.indexOf(0);
  return cab2(h, new TextDecoder().decode(nb.subarray(0, z < 0 ? nb.length : z)));
}

/** Mono samples at 48 kHz -> the cab file (Uint8Array): "CAB2", or "CAB1" with { format: 1 } (NAM Loader before 1.3). */
export function makeCabFile(samples, name, { format = 2 } = {}) {
  const n = Math.min(CAB_TAPS, samples.length);
  if (n < 16) throw new Error("This impulse response is too short.");
  const h = Float64Array.from(samples.subarray(0, n));
  const f = Math.max(1, Math.floor(n / 20));
  for (let i = 0; i < f; i++) h[n - f + i] *= f === 1 ? 1 : 1 - i / (f - 1);      // numpy linspace(1, 0, f)
  const g = cabGain(h);                                                              // as the Python
  if (format === 2) return cab2(h.map((v) => Math.fround(v * g)), name);   // (as float32 first: an old file converts to the same)
  const out = new Uint8Array(16 + 4 * n + NAME_BYTES), dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, n, true); dv.setUint32(8, CAB_RATE, true); dv.setUint32(12, 0, true);
  for (let i = 0; i < n; i++) dv.setFloat32(16 + 4 * i, h[i] * g, true);
  const nm = new TextEncoder().encode(name || "").slice(0, NAME_BYTES - 1);
  out.set(nm, 16 + 4 * n);
  return out;
}

/** A cab file's header (+ its name bytes, at 16 + tapBytes) -> { taps, format (1 or 2), tapBytes, name }, or null. */
export function cabInfo(bytes, nameBytes) {
  if (!bytes || bytes.length < 16) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 16), magic = dv.getUint32(0, true);
  const taps = dv.getUint32(4, true), tapBytes = cabTapBytes(magic, taps);
  if (!tapBytes || !taps || taps > CAB_TAPS) return null;
  let name = "";
  if (nameBytes) { const z = nameBytes.indexOf(0); name = new TextDecoder().decode(nameBytes.subarray(0, z < 0 ? nameBytes.length : z)); }
  return { taps, format: magic === MAGIC ? 1 : 2, tapBytes, name };
}
export const cabNameBytes = NAME_BYTES;

/** Mix two IR sample arrays (already at CAB_RATE, mono). blend 0 = A, 1 = B. */
export function mixIrSamples(a, b, blend) {
  const n = Math.max(a.length, b.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (i < a.length ? a[i] : 0) * (1 - blend) + (i < b.length ? b[i] : 0) * blend;
  return out;
}