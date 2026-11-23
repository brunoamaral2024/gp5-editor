// Transporte adaptado do OpenGP5 Launchpad (MIT, veja LICENSE).
export function crc8(data) {
  let c = 0;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF;
  }
  return c;
}

export function buildSysex(cls, index, payload) {
  const pl = Array.from(payload), body = [crc8([0, cls, index, pl.length, ...pl]), cls, index, pl.length, ...pl];
  const out = [0xF0];
  for (const b of body) out.push(b >> 4, b & 0x0F);
  out.push(0xF7);
  return Uint8Array.from(out);
}

export function parseSysex(msg) {
  if (msg[0] !== 0xF0 || msg[msg.length - 1] !== 0xF7) return null;
  const wire = Array.from(msg.slice(1, -1));
  const decode = (bytes) => {
    if (bytes.length % 2) return null;
    const dec = [];
    for (let i = 0; i < bytes.length; i += 2) dec.push(((bytes[i] & 0xF) << 4) | (bytes[i + 1] & 0xF));
    return dec.length >= 4 ? dec : null;
  };
  const accept = (dec) => {
    if (!dec) return null;
    const [crc, cls, index, len] = dec, pl = dec.slice(4, 4 + len);
    if (pl.length !== len) return null;
    return crc8([0, cls, index, len, ...pl]) === crc ? { cls, index, len, payload: Uint8Array.from(pl), ok: true } : null;
  };
  /* Windows WinRT (Chrome) sometimes inserts a stray byte in a long SysEx. Try the
   * frame as is, then with one byte removed, before giving up. */
  const direct = accept(decode(wire));
  if (direct) return direct;
  for (let k = 0; k < wire.length; k++) {
    const fixed = accept(decode(wire.slice(0, k).concat(wire.slice(k + 1))));
    if (fixed) return fixed;
  }
  return null;
}

export function portBase(name) {
  return name.split(":")[0].replace(/\s+\d+$/, "")
    .replace(/\s+(?:midi\s+)?(?:input|output|in|out)$/i, "").trim().toLowerCase();
}

export async function webMidiPorts() {
  if (!navigator.requestMIDIAccess)
    throw new Error("Este navegador não oferece Web MIDI. Use Chrome/Edge no computador; no iPhone/iPad o Safari não tem Web MIDI.");
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch (error) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      throw new Error("Permissão MIDI bloqueada. Nas configurações do site no Chrome, permita MIDI e tente conectar novamente.");
    throw error;
  }
  const live = (map) => [...map.values()].filter((p) => p.state === "connected");

  const isGp5 = port => /\bgp[ -]?5\b/i.test(port.name);
  return {
    access,
    pairs() {
      const inputs = live(access.inputs);
      const outputs = live(access.outputs);
      const candidates = outputs.flatMap(output => inputs
        .filter(input => portBase(input.name) === portBase(output.name) || (isGp5(input) && isGp5(output)))
        .map(input => ({input, output})));
      if (!candidates.length && inputs.length === 1 && outputs.length === 1)
        candidates.push({input: inputs[0], output: outputs[0]});
      return candidates.sort((a, b) => Number(isGp5(b.input) || isGp5(b.output)) - Number(isGp5(a.input) || isGp5(a.output)));
    },
    async open({input: inp, output: out}) {
      const queue = [];
      let waiter = null;
      const onMessage = (ev) => {
        if (ev.data[0] !== 0xF0) return;                       // notes and controllers from the pedal: not ours
        if (waiter) { const w = waiter; waiter = null; w(ev.data); } else queue.push(ev.data);
      };
      inp.addEventListener("midimessage", onMessage);
      const close = async () => {
        inp.removeEventListener("midimessage", onMessage);
        await Promise.allSettled([inp.close?.(), out.close?.()]);
      };
      try {
        await Promise.all([out.open(), inp.open()]);
      } catch (error) {
        await close();
        throw error;
      }
      return {
        input: inp,
        output: out,
        async send(bytes) { out.send(Array.from(bytes)); },
        recv(timeout) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((resolve) => {
            const t = setTimeout(() => { waiter = null; resolve(null); }, timeout);
            waiter = (msg) => { clearTimeout(t); resolve(msg); };
          });
        },
        flush() { queue.length = 0; },
        close,
      };
    },
  };
}
