// Formats one MIDI channel message from the controller for the MIDI monitor.
export function describeMidi(data) {
  if (!data?.length || data[0] >= 0xF0) return null;
  const status = data[0] & 0xF0;
  const channel = (data[0] & 0x0F) + 1;
  if (data.length < 2) return null;
  if (data.length < 3 && status !== 0xC0 && status !== 0xD0) return null;
  switch (status) {
    case 0x80: return { kind: "Note off", text: `nota ${data[1]} · canal ${channel}` };
    case 0x90: return { kind: data[2] ? "Note on" : "Note off", text: `nota ${data[1]} · vel ${data[2]} · canal ${channel}` };
    case 0xA0: return { kind: "Aftertouch", text: `${data[1]} · ${data[2]} · canal ${channel}` };
    case 0xB0: return { kind: "CC", text: `${data[1]} = ${data[2]} · canal ${channel}` };
    case 0xC0: return { kind: "PC", text: `programa ${data[1]} · canal ${channel}` };
    case 0xD0: return { kind: "Pressão", text: `${data[1]} · canal ${channel}` };
    case 0xE0: return { kind: "Pitch", text: `${(data[2] << 7 | data[1]) - 8192} · canal ${channel}` };
    default: return null;
  }
}
