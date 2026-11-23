import { installCaptureBank } from "./capture-bank.js";
import { describeMidi } from "./midi-format.js";
import { validateNamA2 } from "./convert-nam.js";
import { makePreset, loadPreset, exportPrst } from "./preset.js?v=stereo";
import { exportLibrary, listInstalledFiles, moveSlotFile, namError, parseLibrary, renameSlotFile, restoreLibrary, planSlotBatch, prepareSlotFile, sendSlotFile } from "./library.js?v=import13";
import { t3kClient, t3kConnect, t3kDownloadToSlot, t3kHandleCallback, t3kIdFromInput, t3kToken } from "./t3k.js?v=2";
import { cmd as libraryCommand } from "./library-wire.js";
import { buildSysex, parseSysex, webMidiPorts } from "./midi.js?v=studio-pro";

const get = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll("[data-panel]")];
const blocks = [...document.querySelectorAll("[data-block]")];
const selectedToggle = get("toggleSelectedEffect");
let selectedBlock = blocks.find(block => block.dataset.block === "amp");
let toastTimer;
function toast(message) {
  const element = get("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
}
let saveTimer;
function setSaveState(text) {
  const element = get("saveState");
  if (!element) return;
  element.textContent = text;
  clearTimeout(saveTimer);
  if (text === "Salvo")
    saveTimer = setTimeout(() => { if (element.textContent === "Salvo") element.textContent = ""; }, 2400);
}
const setDisabled = (disabled) => {
  for (const panel of [...panels, get("performance"), get("midiMonitor"), get("liveMidi"), get("library"), get("libraryBackup"), get("slotUpload"), get("globalControls"), get("sceneBar"), get("presetBar"), get("tempoControls"), get("quickOutput"), get("sceneToolsField")]) panel.disabled = disabled;
  const indicator = get("connectionState");
  indicator.dataset.online = String(!!link && !disabled);
  indicator.textContent = link && libraryBusy ? "Transferindo" : disabled ? "Desconectada" : "GP-5 conectada";
  selectedToggle.disabled = disabled;
  if (disabled) lastTap = undefined;
  get("reloadSlots").disabled = disabled;
  for (const id of ["chainBypass", "tunerToggle", "mapVolume", "driveOnly", "visorPrev", "visorNext", "saveScene"]) get(id).disabled = disabled;
  get("bankSendFiles").disabled = disabled;
  get("bankSend").disabled = disabled;
  get("boardFootMode").disabled = disabled;
  showValues();
};
get("controls").addEventListener("submit", (event) => event.preventDefault());
function selectEffect(block) {
  selectedBlock = block;
  for (const candidate of blocks) {
    candidate.dataset.selected = String(candidate === block);
    candidate.querySelector("[data-effect-edit]").setAttribute("aria-pressed", String(candidate === block));
  }
  for (const panel of panels) panel.hidden = panel.id !== block.dataset.block;
  const name = block.querySelector(".pedal-name").textContent;
  get("effectTitle").textContent = name;
  selectedToggle.setAttribute("aria-label", `Ligar ou desligar ${name}`);
  get("controls").scrollTop = 0;
  showOrder();
  showValues();
}

for (const block of blocks)
  block.querySelector("[data-effect-edit]").addEventListener("click", () => {
    selectEffect(block);
    if (window.matchMedia("(max-width: 700px)").matches)
      get("effectPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    toggleEffect(block.dataset.block);
  });

const headerElement = document.querySelector("header");
function syncHeaderHeight() {
  if (headerElement) document.documentElement.style.setProperty("--header-h", `${Math.ceil(headerElement.getBoundingClientRect().height)}px`);
}
if (headerElement && "ResizeObserver" in window) {
  new ResizeObserver(syncHeaderHeight).observe(headerElement);
  syncHeaderHeight();
}

selectedToggle.addEventListener("click", () => toggleEffect(selectedBlock.dataset.block));

let lastTap;
get("tapTempo").addEventListener("click", () => {
  if (!link || libraryBusy) return;
  const now = performance.now();
  const elapsed = now - (lastTap ?? 0);
  const valid = lastTap !== undefined && elapsed >= 250 && elapsed <= 60000 / 45;
  if (lastTap === undefined || elapsed >= 250) lastTap = now;
  if (!valid) return;
  const bpm = get("bpm");
  bpm.value = Math.round(60000 / elapsed);
  bpm.dispatchEvent(new Event("change"));
});
const fields = [
  { id: 0, name: "Cab IR", group: "Cab", input: get("cabEnabled") },
  { id: 2, name: "Gate", group: "Tone", input: get("gate") },
  { id: 3, name: "Bass", group: "Tone", input: get("bass") },
  { id: 4, name: "Mid", group: "Tone", input: get("mid") },
  { id: 5, name: "Treble", group: "Tone", input: get("treble") },
  { id: 6, name: "IR", group: "Cab", input: get("ir") },
  { id: 7, name: "Capture", group: "Bank", input: get("capture") },
  { id: 8, name: "Delay", input: get("enabled") },
  { id: 9, name: "BPM", input: get("bpm") },
  { id: 10, name: "Subdivision", input: get("division") },
  { id: 11, name: "Mix", input: get("mix") },
  { id: 12, name: "Feedback", input: get("feedback") },
  { id: 13, name: "Cloud", group: "Reverb", input: get("cloudEnabled") },
  { id: 14, name: "Cloud Mix", group: "Reverb", input: get("cloudMix") },
  { id: 15, name: "Cloud Decay", group: "Reverb", input: get("cloudDecay") },
  { id: 16, name: "Cloud Pre", group: "Reverb", input: get("cloudPre") },
  { id: 17, name: "Cloud Tone", group: "Reverb", input: get("cloudTone") },
  { id: 18, name: "Reverb Type", group: "Reverb", input: get("reverbType") },
  { id: 19, name: "Compressor", group: "Compressor", input: get("compEnabled") },
  { id: 20, name: "Threshold", group: "Compressor", input: get("compThreshold") },
  { id: 21, name: "Ratio", group: "Compressor", input: get("compRatio") },
  { id: 22, name: "Makeup", group: "Compressor", input: get("compGain") },
  { id: 23, name: "Modulation", group: "Modulation", input: get("modMode") },
  { id: 24, name: "Rate", group: "Modulation", input: get("modRate") },
  { id: 25, name: "Depth", group: "Modulation", input: get("modDepth") },
  { id: 26, name: "Mod Mix", group: "Modulation", input: get("modMix") },
  { id: 27, name: "Scene", group: "Scenes", input: get("scene") },
  { id: 28, name: "Scene Foot", group: "Scenes", input: get("sceneMode") },
  { id: 31, name: "Pitch", group: "Pitch", input: get("pitchOn") },
  { id: 32, name: "Semitones", group: "Pitch", input: get("pitchShift") },
  { id: 33, name: "Pitch Mix", group: "Pitch", input: get("pitchMix") },
  { id: 34, name: "NAM Input", group: "NAM", input: get("ampGain") },
  { id: 35, name: "NAM Level", group: "NAM", input: get("ampLevel") },
  { id: 36, name: "NAM Tone", group: "NAM", input: get("ampTone") },
  { id: 37, name: "EQ Mode", group: "EQ", input: get("eqMode") },
  { id: 38, name: "EQ 1", group: "EQ", input: get("eq1") },
  { id: 39, name: "EQ 2", group: "EQ", input: get("eq2") },
  { id: 40, name: "EQ 3", group: "EQ", input: get("eq3") },
  { id: 41, name: "EQ 4", group: "EQ", input: get("eq4") },
  { id: 42, name: "EQ 5", group: "EQ", input: get("eq5") },
  { id: 43, name: "EQ 6", group: "EQ", input: get("eq6") },
  { id: 44, name: "EQ 7", group: "EQ", input: get("eq7") },
  { id: 45, name: "Drive", group: "Drive", input: get("driveMode") },
  { id: 46, name: "Global Volume", group: "Global", input: get("globalVolume") },
  { id: 47, name: "Global Bass", group: "Global", input: get("globalBass") },
  { id: 48, name: "Global Mid", group: "Global", input: get("globalMid") },
  { id: 49, name: "Global Treble", group: "Global", input: get("globalTreble") },
  { id: 50, name: "Low Cut", group: "Global", input: get("lowCutValue") },
  { id: 51, name: "High Cut", group: "Global", input: get("highCutValue") },
  { id: 53, name: "Low Damp", group: "Reverb", input: get("lowDamp") },
  { id: 54, name: "Hi Damp", group: "Reverb", input: get("highDamp") },
  { id: 55, name: "Mod Sync", group: "Modulation", input: get("modSync") },
  { id: 61, name: "Volume Pedal", group: "Volume", input: get("volumeOn") },
  { id: 62, name: "Volume", group: "Volume", input: get("volumeValue") },
  { id: 63, name: "Amp Voice", group: "NAM", input: get("ampVoice") },
];
const bypassId = 29;
const tunerId = 30;
const tunerFrequencyId = 66;
const extraFields = ["driveGain", "driveBass", "driveMid", "driveTreble", "driveTone", "pitchDual", "pitchSecond"]
  .map((name, i) => ({id: 67 + i, input: get(name)}));
const stereoFields = ["modPattern", "modStereo", "delayStereo", "reverbStereo"]
  .map((name, i) => ({id: 80 + i, input: get(name)}));
const liveMidiFields = [{id: 84, input: get("liveExpression")}];
const liveNavigation = 85;
const expressionCommand = 64;
const libraryLockCommand = 65;
const orderId = 52;
const parameterCount = fields[fields.length - 1].id + 1;
const ratios = [1, 1 / 2, 3 / 4, 1 / 3, 1 / 4];
const status = get("status");
const connect = get("connect");
let link;
let queue = Promise.resolve();
let pending = 0;
let midiAccess;
let controllerInput;
let queuedExpression;
let expressionTimer;
let libraryBusy = false;
let selectedLibrary;
let current = [];
let installed = [];
let slotsRead = false;
let libraryTab = "tone";
let liveTools = false;
let extendedControls = false;
let stereoControls = false;
let nativeMidi = false;
let navigationTimer;
let manualDestination = false;
const undoStack = [];
let snapA, snapB, abShowing = "A";
let midiMessages = 0;
let midiMonitorPaused = false;
const midiRecent = new Map();
const MIDI_LOG_LIMIT = 60;
const MIDI_RECENT_LIMIT = 12;
const sceneLabels = ["Base", "Solo", "Ambiente", "Cena 4"];

function renderRecentCc() {
  const list = get("midiRecentCc");
  list.replaceChildren();
  for (const [cc, value] of midiRecent) {
    const item = document.createElement("li");
    const label = document.createElement("code");
    label.textContent = `CC ${cc}`;
    item.append(label, document.createTextNode(` ${value}`));
    list.append(item);
  }
}

function logMidi(data) {
  if (midiMonitorPaused || !data?.length || data[0] >= 0xF0) return;
  const message = describeMidi(data);
  if (!message) return;
  midiMessages++;
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("pt-BR");
  const kind = document.createElement("span");
  kind.className = "midi-kind";
  kind.dataset.kind = message.kind.toLowerCase();
  kind.textContent = message.kind;
  const text = document.createElement("span");
  text.textContent = message.text;
  item.append(time, kind, text);
  const log = get("midiLog");
  log.append(item);
  while (log.children.length > MIDI_LOG_LIMIT) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
  if ((data[0] & 0xF0) === 0xB0) {
    midiRecent.delete(data[1]);
    midiRecent.set(data[1], data[2]);
    while (midiRecent.size > MIDI_RECENT_LIMIT) midiRecent.delete(midiRecent.keys().next().value);
    renderRecentCc();
  }
  get("midiMonitorStatus").textContent = `${midiMessages} mensagem(ns) recebida(s)`;
}

function clearMidiMonitor() {
  midiMessages = 0;
  midiRecent.clear();
  get("midiLog").replaceChildren();
  get("midiRecentCc").replaceChildren();
  get("midiMonitorStatus").textContent = "Aguardando mensagens do Chocolate.";
}

get("midiMonitorClear").addEventListener("click", clearMidiMonitor);
get("midiMonitorPause").addEventListener("click", () => {
  midiMonitorPaused = !midiMonitorPaused;
  const button = get("midiMonitorPause");
  button.setAttribute("aria-pressed", String(midiMonitorPaused));
  button.textContent = midiMonitorPaused ? "Retomar" : "Pausar";
  get("midiMonitorStatus").textContent = midiMonitorPaused ? "Monitor pausado." : "Aguardando mensagens do Chocolate.";
});

const toggles = {
  drive: {id: 59, bypass: true, type: 45, initial: 1},
  amp: {id: 56, bypass: true},
  gatePanel: {id: 57, bypass: true, type: 2, initial: 31},
  compressor: {id: 19},
  cab: {id: 0, type: 6},
  eq: {id: 58, bypass: true},
  pitch: {id: 31},
  mod: {id: 60, bypass: true, type: 23, initial: 1},
  delay: {id: 8},
  cloud: {id: 13},
  volumePedal: {id: 61},
};

async function activateAmplifier() {
  const id = toggles.amp.id;
  if (current[id]) await writeParam(id, 0);
  if (liveTools && current[bypassId]) await writeParam(bypassId, 0);
}

function effectActive({id, bypass = false, type}) {
  return Boolean(current[id]) !== bypass && (type === undefined || current[type] > 0);
}

function toggleEffect(blockId) {
  run(async () => {
    if (!link || libraryBusy) return;
    const effect = toggles[blockId];
    const enabled = !effectActive(effect);
    if (enabled && effect.type !== undefined && !current[effect.type]) {
      if (effect.initial === undefined) {
        status.textContent = "Selecione um IR no bloco Caixa antes de ligar o efeito.";
        toast("Selecione um IR antes de ligar o efeito.");
        return;
      }
      await writeParam(effect.type, effect.initial);
    }
    await writeParam(effect.id, Number(enabled !== Boolean(effect.bypass)));
    await refresh();
    const name = blocks.find(block => block.dataset.block === blockId)?.querySelector(".pedal-name").textContent;
    toast(`${name} ${enabled ? "ligado" : "desligado"}`);
  });
}

async function writeParam(id, value) {
  const reply = await request(0x10, id, 0, value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24);
  if (reply[2] !== 1) throw new Error("A GP-5 recusou o ajuste. Reconecte o editor.");
}

function flushExpression() {
  expressionTimer = undefined;
  if (!link || queuedExpression === undefined) return;
  if (pending) { expressionTimer = setTimeout(flushExpression, 32); return; }
  const value = queuedExpression;
  queuedExpression = undefined;
  run(() => writeParam(expressionCommand, value));
}

function clearExpression() {
  clearTimeout(expressionTimer);
  expressionTimer = undefined;
  queuedExpression = undefined;
  get("expressionValue").textContent = "–";
}

function navigateMidi(cc) {
  if (!link || !nativeMidi || libraryBusy) return;
  clearExpression();
  run(async () => {
    if (!link) return;
    const connection = link;
    await writeParam(liveNavigation, cc);
    toast(`CC ${cc} enviado à GP-5`);
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => {
      if (link === connection && !libraryBusy) run(refresh);
    }, 600);
  });
}

for (const button of document.querySelectorAll("[data-midi-nav]"))
  button.addEventListener("click", () => navigateMidi(Number(button.dataset.midiNav)));

function controllerMessage({data}) {
  if (!link || libraryBusy || !data?.length) return;
  logMidi(data);
  if (data.length < 2 || (data[0] & 15) + 1 !== get("midiChannel").valueAsNumber) return;
  const type = data[0] & 240;
  if (type === 0xc0) {
    const presets = current[28] === 2;
    if (data[1] > (presets ? 29 : 3)) return;
    clearExpression();
    run(async () => {
      if (!link) return;
      await writeParam(presets ? 7 : 27, presets ? data[1] + 1 : data[1]);
      await refresh();
    });
    return;
  }
  if (type !== 0xb0 || data.length !== 3) return;
  if (nativeMidi && data[1] >= 83 && data[1] <= 86) {
    if (data[2] >= 64) navigateMidi(data[1]);
    return;
  }
  if (data[1] !== get("expressionCc").valueAsNumber) return;
  const target = Number(get("expressionTarget").value);
  const heel = get("expressionHeel").valueAsNumber;
  const toe = get("expressionToe").valueAsNumber;
  if (!target || get("expressionTarget").selectedOptions[0].disabled
      || !Number.isFinite(heel) || !Number.isFinite(toe)) return;
  const max = target === 4 ? 90 : 100;
  const percent = Math.max(0, Math.min(max, Math.round(heel + (toe - heel) * data[2] / 127)));
  const rate = (1 + Math.round(percent * 79 / 100)) / 10;
  get("expressionValue").textContent = target === 7 ? `${rate.toLocaleString("pt-BR")} Hz`
    : target === 9 ? `${Math.round(percent * 24 / 100) - 12} dB` : `${percent}%`;
  queuedExpression = target * 256 + percent;
  if (expressionTimer === undefined) expressionTimer = setTimeout(flushExpression, 32);
}

function updateMidiSources() {
  const select = get("midiSource");
  const previous = select.value;
  select.replaceChildren(new Option("Selecione uma entrada", ""));
  for (const input of midiAccess.inputs.values()) {
    if (input.state === "connected" && input !== link?.input && !/\bgp[ -]?5\b/i.test(input.name))
      select.add(new Option(input.name, input.id));
  }
  select.value = previous;
  const next = midiAccess.inputs.get(select.value);
  if (next !== controllerInput) selectController();
  else if (!next) get("midiStatus").textContent = select.options.length > 1
    ? "Selecione a entrada do Chocolate."
    : "Nenhum controlador MIDI apareceu. Conecte o Chocolate ao mesmo computador por USB de dados.";
}

function selectController() {
  controllerInput?.removeEventListener("midimessage", controllerMessage);
  controllerInput = midiAccess?.inputs.get(get("midiSource").value);
  controllerInput?.addEventListener("midimessage", controllerMessage);
  get("midiStatus").textContent = controllerInput
    ? `Recebendo de ${controllerInput.name}`
    : "Conecte o Chocolate e selecione a entrada MIDI.";
  resetExpression();
}

function resetExpression() {
  clearExpression();
  if (link && !libraryBusy) run(() => link ? writeParam(expressionCommand, 0) : undefined);
}

function closeController() {
  controllerInput?.removeEventListener("midimessage", controllerMessage);
  midiAccess?.removeEventListener("statechange", updateMidiSources);
  controllerInput = midiAccess = undefined;
  clearExpression();
}

get("midiSource").addEventListener("change", selectController);
get("expressionTarget").addEventListener("change", resetExpression);
for (const [id, min, max] of [["midiChannel", 1, 16], ["expressionCc", 0, 127], ["expressionHeel", 0, 100], ["expressionToe", 0, 100]]) {
  get(id).addEventListener("change", () => {
    const input = get(id);
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    input.value = String(Math.min(max, Math.max(min, Math.round(value))));
  });
}

async function request(op, ...payload) {
  link.flush();
  await link.send(buildSysex(1, 0, [0x7e, op, ...payload]));
  const end = performance.now() + 1000;
  while (performance.now() < end) {
    const raw = await link.recv(Math.max(0, end - performance.now()));
    if (!raw) break;
    const frame = parseSysex(raw);
    const reply = frame?.payload;
    if (frame?.ok && reply[0] === 0x7e && reply[1] === op &&
        (op !== 0x12 || !reply[2] || reply[5] === payload[0])) return reply;
  }
  throw new Error("A GP-5 não respondeu. Confira o cabo e feche outros editores.");
}

function renderVisor() {
  const connected = Boolean(link);
  const slot = connected ? Number(current[7] ?? 0) : 0;
  const name = slot === 0
    ? "Captura interna"
    : installed.find(entry => entry.kind === "tone" && entry.slot === slot)?.name ?? `Slot ${String(slot).padStart(2, "0")}`;
  const mode = connected && liveTools ? Number(current[bypassId] ?? 0) : 0;
  get("visorBank").textContent = slot ? `BANCO ${String(Math.ceil(slot / 4)).padStart(2, "0")}` : "BANCO --";
  get("visorSlot").textContent = slot ? `SLOT ${String(slot).padStart(2, "0")}` : "SLOT --";
  get("visorName").textContent = connected ? name : "GP-5 desconectada";
  get("visorScene").textContent = connected ? ["BASE", "SOLO", "AMBIENTE", "CENA 4"][Number(current[27] ?? 0)] ?? "—" : "—";
  get("visorState").textContent = !connected ? "" : mode === 1 ? "BYPASS" : mode === 2 ? "SÓ DRIVE" : "CADEIA";
  const hasSlots = connected && installed.some(entry => entry.kind === "tone");
  get("visorPrev").disabled = !hasSlots;
  get("visorNext").disabled = !hasSlots;
}

function showValues() {
  const bpm = get("bpm").valueAsNumber;
  const ratio = ratios[Number(get("division").value)];
  get("interval").textContent = Number.isFinite(bpm) && bpm >= 45 && bpm <= 240
    ? `${Math.round(60000 * ratio / bpm)} ms por repetição` : "Informe um BPM entre 45 e 240";
  get("mixValue").textContent = `${get("mix").value}%`;
  get("feedbackValue").textContent = `${get("feedback").value}%`;
  for (const id of ["cloudMix", "cloudDecay", "cloudTone"]) get(id + "Value").textContent = `${get(id).value}%`;
  for (const id of ["lowDamp", "highDamp"])
    get(id + "Value").textContent = Math.round(Number(get(id).value) * 100 / 15) + "%";
  get("cloudPreValue").textContent = `${get("cloudPre").value} ms`;
  for (const id of ["bass", "mid", "treble"]) get(id + "Value").textContent = `${get(id).value - 12} dB`;
  get("compThresholdValue").textContent = `${get("compThreshold").value} dBFS`;
  get("compRatioValue").textContent = `${get("compRatio").value}:1`;
  get("compGainValue").textContent = `${get("compGain").value} dB`;
  const modMode = Number(get("modMode").value);
  get("modPatternRow").hidden = !stereoControls || modMode !== 37;
  get("modStereoRow").hidden = !stereoControls || (modMode !== 31 && modMode !== 37);
  get("delayStereoRow").hidden = !stereoControls;
  get("reverbStereoRow").hidden = !stereoControls;
  const modSync = Number(get("modSync").value);
  const modRate = get("modRate");
  modRate.disabled = modSync !== 0;
  const frequency = modSync ? Number(get("bpm").value) / 60 / ratios[modSync - 1] : modRate.value / 10;
  get("modRateValue").textContent = Number.isFinite(frequency)
    ? frequency.toLocaleString("pt-BR", {maximumFractionDigits: 2}) + " Hz"
    : "–";
  for (const id of ["modDepth", "modMix"]) get(id + "Value").textContent = `${get(id).value}%`;
  const gate = Number(get("gate").value);
  get("gateValue").textContent = gate ? `${gate - 91} dBFS` : "Desligado";
  for (const input of document.querySelectorAll("[data-unit]"))
    get(input.id + "Value").textContent = input.value + input.dataset.unit;
  const eqMode = Number(get("eqMode").value);
  get("basicEq").hidden = eqMode !== 0;
  get("graphicEq").hidden = eqMode === 0;
  get("eq7").parentElement.hidden = eqMode !== 2;
  for (const button of document.querySelectorAll("[data-scene]"))
    button.setAttribute("aria-pressed", String(button.dataset.scene === get("scene").value));
  if (get("boardFootMode") !== document.activeElement) get("boardFootMode").value = String(current[28] ?? 0);
  if (get("delayModel") !== document.activeElement) get("delayModel").value = String(current[78] ?? 0);
  if (get("gateModel") !== document.activeElement) get("gateModel").value = String(current[79] ?? 0);
  get("midiPrograms").textContent = current[28] === 2
    ? "PC 0 a 29 selecionam os presets NAM 01 a 30."
    : "PC 0, 1 e 2 selecionam Base, Solo e Ambiente.";
  const bypass = liveTools && current[bypassId] === 1;
  const driveOnly = liveTools && current[bypassId] === 2;
  get("driveOnly").hidden = !liveTools;
  get("driveOnly").textContent = driveOnly ? "Voltar à cadeia completa" : "Só o drive";
  get("driveOnly").setAttribute("aria-pressed", String(driveOnly));
  get("studioTools").hidden = !link || !liveTools;
  get("chainBypass").textContent = bypass || driveOnly ? "Ativar timbre" : "Ativar bypass";
  get("chainBypass").setAttribute("aria-pressed", String(bypass));
  const tuning = Boolean(link && liveTools && current[tunerId]);
  get("tunerToggle").textContent = tuning ? "Fechar afinador" : "Afinador";
  get("tunerToggle").setAttribute("aria-expanded", String(tuning));
  get("tunerPanel").hidden = !tuning;
  const ampInactive = bypass || driveOnly || Boolean(current[toggles.amp.id]);
  const ampNote = get("ampOutputNote");
  ampNote.hidden = !link || (!ampInactive && !tuning);
  ampNote.textContent = tuning ? "Afinador ativo. A saída está silenciada."
    : bypass ? "Sinal direto ativo. Ative o amplificador para ouvir os ajustes."
    : driveOnly ? "Modo Só o drive ativo. Ative o amplificador para voltar à cadeia completa."
    : "Amplificador desligado.";
  get("activateAmp").hidden = !link || tuning || !ampInactive;
  get("mapVolume").hidden = !liveTools;
  get("driveKnobs").hidden = !extendedControls;
  get("dualPitchControls").hidden = !extendedControls;
  get("pitchSecondRow").hidden = !get("pitchDual").checked;
  const harmony = [0, 3, 4, 7, 12].indexOf(current[73]);
  if (get("harmony") !== document.activeElement && current[31] === 1 && current[72] === 1)
    get("harmony").value = String(harmony > 0 ? harmony : 0);
  get("capturePicker").hidden = get("ampVoice").value !== "0";
  for (const block of blocks) {
    const id = block.dataset.block;
    const enabled = Boolean(link && effectActive(toggles[id]));
    const active = enabled && !libraryBusy && !bypass && !tuning && (!driveOnly || id === "drive");
    block.dataset.active = String(active);
    if (block === selectedBlock) {
      selectedToggle.setAttribute("aria-pressed", String(enabled));
      selectedToggle.textContent = enabled ? "Ligado" : "Desligado";
    }
  }
  renderVisor();
}

const movable = ["eq", null, "mod", "delay", "cloud", "volumePedal", "pitch"];
const factorial = [1, 1, 2, 6, 24, 120, 720];
let chainOrder = [...movable];
function showOrder() {
  const selected = selectedBlock.dataset.block;
  const index = chainOrder.indexOf(selected);
  get("orderControls").hidden = index < 0;
  get("moveLeft").disabled = !link || libraryBusy || index < 0 || !chainOrder.slice(0, index).some(Boolean);
  get("moveRight").disabled = !link || libraryBusy || index < 0 || !chainOrder.slice(index + 1).some(Boolean);
}
function syncOrder(rank) {
  const available = [...movable];
  const order = [];
  for (let i = 6; i >= 0; i--) {
    order.push(available.splice(Math.floor(rank / factorial[i]), 1)[0]);
    rank %= factorial[i];
  }
  if (order.join() !== chainOrder.join()) {
    chainOrder = order;
    for (const id of order.filter(Boolean)) get("chain").append(blocks.find(button => button.dataset.block === id));
  }
  showOrder();
}
function moveOrder(step) {
  if (!link || libraryBusy) return;
  const selected = selectedBlock.dataset.block;
  const at = chainOrder.indexOf(selected);
  let other = at + step;
  if (chainOrder[other] === null) other += step;
  if (at < 0 || other < 0 || other >= movable.length) return;
  const order = [...chainOrder];
  [order[at], order[other]] = [order[other], order[at]];
  const remaining = [...movable];
  let rank = 0;
  for (const item of order) {
    const index = remaining.indexOf(item);
    remaining.splice(index, 1);
    rank += index * factorial[remaining.length];
  }
  run(async () => { if (link) { await writeParam(orderId, rank); await refresh(); } });
}
get("moveLeft").addEventListener("click", () => moveOrder(-1));
get("moveRight").addEventListener("click", () => moveOrder(1));
function selectScene(index) {
  if (!link || libraryBusy) return;
  get("scene").value = String(index);
  get("scene").dispatchEvent(new Event("change"));
  toast(`Cena ${sceneLabels[index] ?? index + 1}`);
}
for (const button of document.querySelectorAll("[data-scene]"))
  button.addEventListener("click", () => selectScene(Number(button.dataset.scene)));

get("boardFootMode").addEventListener("change", () => {
  if (!link || libraryBusy) return;
  get("sceneMode").value = get("boardFootMode").value;
  get("sceneMode").dispatchEvent(new Event("change"));
  toast(`Foot: ${get("boardFootMode").selectedOptions[0].textContent}`);
});
get("delayModel").addEventListener("change", () => {
  if (!link || libraryBusy) return;
  run(async () => {
    if (!link) return;
    const model = Number(get("delayModel").value);
    await writeParam(78, model);
    current[78] = model;
    toast(`Delay: ${get("delayModel").selectedOptions[0].textContent}`);
  });
});
get("gateModel").addEventListener("change", () => {
  if (!link || libraryBusy) return;
  run(async () => {
    if (!link) return;
    const model = Number(get("gateModel").value);
    await writeParam(79, model);
    current[79] = model;
    toast(`Gate: ${get("gateModel").selectedOptions[0].textContent}`);
  });
});
get("harmony").addEventListener("change", () => {
  if (!link || libraryBusy) return;
  const value = Number(get("harmony").value);
  run(async () => {
    if (!link) return;
    if (!value) await writeParam(72, 0);
    else {
      await writeParam(31, 1);
      await writeParam(72, 1);
      await writeParam(73, [0, 3, 4, 7, 12][value]);
      if (!current[33]) await writeParam(33, 50);
    }
    await refresh();
    toast(value ? `Harmonista: ${get("harmony").selectedOptions[0].textContent}` : "Harmonista off");
  });
});

function syncSceneButtons(max) {
  const container = get("sceneButtons");
  const select = get("scene");
  const count = Math.max(3, Math.min(4, (Number(max) || 2) + 1));
  for (let index = select.options.length; index < count; index++)
    select.add(new Option(sceneLabels[index] ?? `Cena ${index + 1}`, index));
  const buttons = [...container.querySelectorAll("[data-scene]")];
  for (let index = buttons.length; index < count; index++) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scene = String(index);
    button.setAttribute("aria-pressed", "false");
    button.textContent = sceneLabels[index] ?? `Cena ${index + 1}`;
    button.addEventListener("click", () => selectScene(index));
    container.append(button);
  }
  for (let index = buttons.length; index > count; index--) buttons[index - 1].remove();
}
get("quickGlobal").addEventListener("click", () => {
  setView("global");
  if (link) get("globalBass").focus();
  else toast("Conecte a GP-5 para ajustar o EQ global.");
});

function jumpBank(step) {
  if (!link || libraryBusy) return;
  const slots = installed.filter(entry => entry.kind === "tone").map(entry => entry.slot).sort((a, b) => a - b);
  if (!slots.length) { toast("Nenhuma captura nos slots da GP-5."); return; }
  const currentSlot = Number(current[7] ?? 0);
  let target = (currentSlot ? Math.ceil(currentSlot / 4) : 0) + step;
  while (target >= 1 && target <= 8) {
    const slot = slots.find(candidate => Math.ceil(candidate / 4) === target);
    if (slot !== undefined) {
      run(async () => {
        if (!link) return;
        clearExpression();
        await writeParam(7, slot);
        await refresh();
        toast(`Banco ${String(target).padStart(2, "0")} · slot ${String(slot).padStart(2, "0")}`);
      });
      return;
    }
    target += step;
  }
  toast(step > 0 ? "Último banco com capturas" : "Primeiro banco com capturas");
}
get("visorPrev").addEventListener("click", () => jumpBank(-1));
get("visorNext").addEventListener("click", () => jumpBank(1));

async function readExtraParameters(group) {
  const {id} = group[0];
  const count = group.length;
  const reply = await request(0x11, id, 0, count);
  if (reply[2] !== count || reply.length < 3 + 2 * count) return [];
  const data = new DataView(reply.buffer, reply.byteOffset + 3, 2 * count);
  return Array.from({length: count}, (_, index) => data.getInt16(index * 2, true));
}

async function readParameters() {
  const values = [];
  for (let start = 0; start < parameterCount; start += 40) {
    const count = Math.min(40, parameterCount - start);
    const result = await request(0x11, start, 0, count);
    if (result[2] !== count || result.length < 3 + 2 * count) throw new Error("Resposta de parâmetros incompleta.");
    const data = new DataView(result.buffer, result.byteOffset + 3, 2 * count);
    for (let i = 0; i < count; i++) values.push(data.getInt16(i * 2, true));
  }
  for (const group of [extendedControls && extraFields, stereoControls && stereoFields, nativeMidi && liveMidiFields].filter(Boolean)) {
    const extra = await readExtraParameters(group);
    if (extra.length !== group.length) throw new Error("Resposta incompleta dos parâmetros adicionais.");
    extra.forEach((value, index) => { values[group[index].id] = value; });
  }
  return values;
}

async function refresh() {
  const values = await readParameters();
  current = values;
  const modelReply = await request(0x11, 78, 0, 1).catch(() => null);
  current[78] = modelReply?.[2] === 1 ? modelReply[3] : 0;
  const gateReply = await request(0x11, 79, 0, 1).catch(() => null);
  current[79] = gateReply?.[2] === 1 ? gateReply[3] : 0;
  syncOrder(values[orderId]);
  fitSlotSelect(get("capture"), "tone", values[7], "Captura interna");
  fitSlotSelect(get("quickPreset"), "tone", values[7], "Captura interna");
  const presetName = get("quickPreset").selectedOptions[0]?.text ?? "";
  get("presetFullName").textContent = presetName;
  get("quickPreset").title = presetName;
  fitSlotSelect(get("ir"), "cab", values[6], "Nenhum IR");
  const model = values[63] ? get("ampVoice").options[values[63]]?.text : get("capture").selectedOptions[0]?.text;
  const outputMode = liveTools ? values[bypassId] : 0;
  const label = outputMode === 1 ? "Sinal direto (bypass)" : outputMode === 2 ? "Só o drive" : model;
  status.textContent = label ? `GP-5 conectada · ${label}` : "GP-5 conectada";
  for (const field of [...fields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : []), ...(nativeMidi ? liveMidiFields : [])]) {
    if (field.input === document.activeElement || field.input.matches(":active")) continue;
    if (field.input.type === "checkbox") field.input.checked = values[field.id] === 1;
    else field.input.value = values[field.id];
  }
  showValues();
}

function renderTuning(frequency) {
  const centsFromA = frequency ? 1200 * Math.log2(frequency / 440) : 0;
  const step = Math.round(centsFromA / 100);
  const cents = Math.round(centsFromA - step * 100);
  const midi = step + 69;
  const note = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"][midi % 12];
  get("tunerNote").textContent = frequency ? note + (Math.floor(midi / 12) - 1) : "–";
  get("tunerReading").textContent = frequency
    ? `${cents > 0 ? "+" : ""}${cents} cents · ${frequency.toFixed(1)} Hz`
    : "Toque uma corda por vez. Saída silenciada.";
  get("tunerMeter").value = cents;
  get("tunerPanel").dataset.tuned = String(Boolean(frequency && Math.abs(cents) <= 4));
}

get("chainBypass").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy || !liveTools) return;
  await writeParam(bypassId, Number(!current[bypassId]));
  await refresh();
  toast(current[bypassId] ? "Cadeia em bypass" : "Timbre ativo");
}));
get("driveOnly").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy || !liveTools) return;
  if (current[bypassId] === 2) {
    await writeParam(bypassId, 0);
  } else {
    if (!current[45]) await writeParam(45, 1);
    if (current[59]) await writeParam(59, 0);
    await writeParam(bypassId, 2);
  }
  await refresh();
  toast(current[bypassId] === 2 ? "Ouvindo só o drive" : "Voltou à cadeia completa");
}));
get("activateAmp").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  await activateAmplifier();
  await refresh();
}));
get("tunerToggle").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy || !liveTools) return;
  renderTuning(0);
  await writeParam(tunerId, Number(!current[tunerId]));
  await refresh();
}));
get("mapVolume").addEventListener("click", () => {
  get("expressionTarget").value = "5";
  get("expressionHeel").value = "0";
  get("expressionToe").value = "100";
  resetExpression();
  setView("midi");
});

function run(operation) {
  pending++;
  queue = queue.then(operation).catch(async (error) => {
    status.textContent = error.message;
    closeController();
    slotsRead = false;
    installed = [];
    await link?.close();
    link = undefined;
    setDisabled(true);
    connect.textContent = "Conectar GP-5";
  }).finally(() => { pending--; });
  return queue;
}

connect.addEventListener("click", async () => {
  connect.disabled = true;
  await run(async () => {
    if (link) {
      closeController();
      if (liveTools) await writeParam(tunerId, 0);
      await writeParam(expressionCommand, 0);
      await link.close();
      link = undefined;
      installed = [];
      slotsRead = false;
      showSlots();
      setDisabled(true);
      connect.textContent = "Conectar GP-5";
      status.textContent = "GP-5 desconectada do editor.";
      return;
    }
    status.textContent = "Procurando a GP-5 por USB MIDI…";
    const ports = await webMidiPorts();
    const candidates = ports.pairs();
    if (!candidates.length)
      throw new Error("O navegador não encontrou as duas portas MIDI da GP-5. No Android, confira se o OTG está ativo, use um cabo de dados e confira a alimentação do pedal.");
    const decoder = new TextDecoder();
    for (const pair of candidates) {
      try {
        link = await ports.open(pair);
        const reply = await request(0x12, 27, 0);
        if (reply[2] === 1 && decoder.decode(reply.slice(15)).split("\0")[0] === "Scene") break;
      } catch { /* Android can report generic port names. Try the next pair. */ }
      await link?.close();
      link = undefined;
    }
    if (!link) throw new Error("O navegador detectou MIDI, mas a GP-5 não respondeu como NAM Studio. Feche outros editores e confirme o firmware instalado.");
    for (const id of [23, 45, 51, 61, 63]) {
      const field = fields.find(item => item.id === id);
      const reply = await request(0x12, id, 0);
      const [name, group] = decoder.decode(reply.slice(15)).split("\0");
      const max = reply[11] | reply[12] << 8;
      const expected = {23: 62, 45: 31, 51: 4, 61: 1, 63: 6};
      if (reply[2] !== 1 || name !== field.name || group !== field.group || (max !== expected[id] && !(id === 45 && max === 36)))
        throw new Error("Esta versão do editor precisa do firmware GP-5 NAM Studio.");
      if (id === 45) {
        for (const option of field.input.options) option.hidden = option.disabled = Number(option.value) > max;
      }
    }
    const footDescriptor = await request(0x12, 28, 0);
    const footMax = footDescriptor[2] === 1 ? (footDescriptor[11] | footDescriptor[12] << 8) : 2;
    for (const select of [get("sceneMode"), get("boardFootMode")])
      for (const option of select.options) option.disabled = Number(option.value) > footMax;
    const sceneDescriptor = await request(0x12, 27, 0).catch(() => null);
    if (sceneDescriptor?.[2] === 1) syncSceneButtons(sceneDescriptor[11] | sceneDescriptor[12] << 8);
    const bypassDescriptor = await request(0x12, bypassId, 0);
    liveTools = decoder.decode(bypassDescriptor.slice(15)).split("\0")[0] === "Output Mode";
    extendedControls = liveTools && (await readExtraParameters(extraFields)).length === extraFields.length;
    stereoControls = liveTools && (await readExtraParameters(stereoFields)).length === stereoFields.length;
    nativeMidi = stereoControls && (await readExtraParameters(liveMidiFields)).length === 1;
    get("liveMidi").hidden = !nativeMidi;
    const expression = get("expressionTarget");
    for (const option of expression.options) {
      const target = Number(option.value);
      option.disabled = (target === 5 && !liveTools) || (target > 5 && !stereoControls);
    }
    if (expression.selectedOptions[0].disabled) expression.value = "0";
    await refresh();
    midiAccess = ports.access;
    midiAccess.addEventListener("statechange", updateMidiSources);
    updateMidiSources();
    clearMidiMonitor();
    if (nativeMidi)
      get("midiMonitorStatus").textContent = "Chocolate no computador: a GP-5 não é host USB neste firmware. Ligue a Chocolate (ou o receptor) na USB do PC e escolha a entrada acima.";
    setDisabled(false);
    connect.textContent = "Desconectar";
    showOrder();
    if (!current[tunerId]) run(() => link && refreshNamedSlots());
  });
  connect.disabled = false;
});

for (const { id, input } of [...fields, ...extraFields, ...stereoFields, ...liveMidiFields]) {
  input.addEventListener("input", showValues);
  input.addEventListener("change", () => {
    if (!input.checkValidity() || input.value === "") { input.reportValidity(); return; }
    const value = input.type === "checkbox" ? Number(input.checked) : Number(input.value);
    if (current[id] !== value) {
      undoStack.push({ id, value: current[id] });
      if (undoStack.length > 30) undoStack.shift();
      get("undoChange").disabled = false;
    }
    run(async () => {
      if (!link) return;
      setSaveState("Salvando…");
      if (id === 27 || id === 7) clearExpression();
      await writeParam(id, value);
      const pairedEffect = Object.values(toggles).find(effect => effect.bypass && effect.type === id);
      if (pairedEffect && value && current[pairedEffect.id]) await writeParam(pairedEffect.id, 0);
      if (id === 45 && value && liveTools && current[bypassId] === 1) await writeParam(bypassId, 2);
      if (id === 63) await activateAmplifier();
      input.blur();
      await refresh();
      if (current[id] !== value) {
        await writeParam(id, value);
        await refresh();
      }
      setSaveState(current[id] === value ? "Salvo" : "Não confirmado");
    });
  });
}
get("saveScene").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  setSaveState("Salvando…");
  const list = [...fields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : []), ...(nativeMidi ? liveMidiFields : [])];
  for (const { id, input } of list) {
    const value = input.type === "checkbox" ? Number(input.checked) : Number(input.value);
    if (Number.isFinite(value)) await writeParam(id, value);
  }
  await refresh();
  const saved = list.every(({ id, input }) =>
    current[id] === (input.type === "checkbox" ? Number(input.checked) : Number(input.value)));
  setSaveState(saved ? "Salvo" : "Não confirmado");
  toast(saved ? "Cena salva na GP-5" : "A GP-5 não confirmou todos os ajustes. Tente de novo.");
}));
get("undoChange").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  const entry = undoStack.pop();
  if (!entry) return;
  await writeParam(entry.id, entry.value);
  await refresh();
  get("undoChange").disabled = !undoStack.length;
  toast("Ajuste desfeito");
}));
function snapshotAll() {
  return [...fields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : []), ...(nativeMidi ? liveMidiFields : [])]
    .map(({ id }) => current[id]);
}
function applySnapshot(values) {
  return applySnapshotFrom(values, [...fields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : []), ...(nativeMidi ? liveMidiFields : [])]);
}
async function applySnapshotFrom(values, list) {
  for (const { id } of list) if (id !== 7 && id !== 27 && Number.isFinite(values[id])) await writeParam(id, values[id]);
  await refresh();
}
get("snapshotA").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  await refresh();
  snapA = snapshotAll();
  get("toggleAB").disabled = !(snapA && snapB);
  toast("Snapshot A salvo");
}));
get("snapshotB").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  await refresh();
  snapB = snapshotAll();
  get("toggleAB").disabled = !(snapA && snapB);
  toast("Snapshot B salvo");
}));
get("toggleAB").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  const values = abShowing === "A" ? snapB : snapA;
  if (!values) return;
  await applySnapshotFrom(values, [...fields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : []), ...(nativeMidi ? liveMidiFields : [])]);
  abShowing = abShowing === "A" ? "B" : "A";
  toast(`Mostrando ${abShowing}`);
}));
get("copyScene").addEventListener("click", () => run(async () => {
  if (!link || libraryBusy) return;
  const source = Number(get("scene").value);
  const target = Number(get("copyTarget").value);
  if (source === target) { toast("Escolha uma cena diferente."); return; }
  const values = await readParameters();
  await writeParam(27, target);
  for (const { id } of [...fields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : [])]) {
    if (id === 7 || id === 27) continue;
    if (Number.isFinite(values[id])) await writeParam(id, values[id]);
  }
  await refresh();
  toast(`Cena copiada para ${get("copyTarget").selectedOptions[0].textContent}`);
}));
get("worshipSettings").addEventListener("click", () => {
  if (!link || libraryBusy) return;
  run(async () => {
    if (!link) return;
    const settings = [[18, 10], [14, 42], [15, 84], [16, 35], [17, 65], [53, 10], [54, 2], [13, 1]];
    for (const [id, value] of settings) await writeParam(id, value);
    await refresh();
    toast("Ajuste Worship aplicado");
  });
});

const libraryStatus = get("libraryStatus");
const importFile = get("importFile");
const importButton = get("importLibrary");
const showLibraryProgress = (message) => { libraryStatus.textContent = message; };

function setView(view) {
  for (const button of document.querySelectorAll("[data-view]"))
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  for (const panel of document.querySelectorAll("[data-view-panel]"))
    panel.hidden = panel.dataset.viewPanel !== view;
  if (view === "library" && link && !libraryBusy && !slotsRead) run(() => link && refreshNamedSlots());
}

function fitSlotSelect(select, kind, slot, emptyLabel, rebuild = false) {
  if (rebuild) {
    select.replaceChildren(new Option(emptyLabel, "0"));
    for (const entry of installed.filter(item => item.kind === kind))
      select.add(new Option(`B${Math.ceil(entry.slot / 4)} · ${String(entry.slot).padStart(2, "0")} · ${entry.name}`, entry.slot));
  }
  if (![...select.options].some(option => Number(option.value) === slot))
    select.add(new Option(`Slot ${slot}`, slot));
  select.value = String(slot);
}

get("quickPreset").addEventListener("change", () => {
  const slot = Number(get("quickPreset").value);
  run(async () => {
    if (!link || libraryBusy) return;
    clearExpression();
    await writeParam(7, slot);
    await refresh();
    toast(`Preset ${slot === 0 ? "interno" : String(slot).padStart(2, "0")} carregado`);
  });
});

function useInstalledSlot(kind, slot, name) {
  run(async () => {
    if (!link || libraryBusy) return;
    if (kind === "tone") {
      await writeParam(7, slot);
      const deadline = performance.now() + 3500;
      do {
        await refresh();
        if (current[7] === slot) break;
        await new Promise(resolve => setTimeout(resolve, 125));
      } while (performance.now() < deadline);
      if (current[7] !== slot) {
        showLibraryProgress(`O slot ${slot} não carregou. Atualize a lista e tente novamente.`);
        return;
      }
      await writeParam(63, 0);
      await writeParam(56, 0);
    } else {
      await writeParam(6, slot);
      await writeParam(0, 1);
    }
    await refresh();
    showLibraryProgress(`${name} selecionado.${liveTools && current[bypassId] ? " Use Ativar timbre no Pedalboard para sair do bypass." : ""}`);
    toast(`${name} carregado`);
  });
}

function showSlots() {
  const list = get("slotList");
  list.replaceChildren();
  if (libraryTab === "presets") return;
  const query = get("slotFilter").value.trim().toLowerCase();
  const entries = installed.filter(item => item.kind === libraryTab);
  const slots = new Map(entries.map(item => [item.slot, item.name]));
  const label = libraryTab === "tone" ? "capturas" : "IRs";
  get("slotCount").textContent = `${slots.size} de 30 ${label}`;
  let shown = 0;
  for (let slot = 1; slot <= 30; slot++) {
    const stored = slots.get(slot);
    if (query && !String(slot).includes(query) && !stored?.toLowerCase().includes(query)) continue;
    shown++;
    const row = document.createElement("li");
    row.dataset.slot = String(slot);
    const number = document.createElement("code");
    const name = document.createElement("span");
    const select = document.createElement("button");
    number.textContent = `B${Math.ceil(slot / 4)}·${String(slot).padStart(2, "0")}`;
    name.textContent = stored ?? (slotsRead ? "Vazio" : link ? "…" : "–");
    if (!stored) name.className = "slot-empty";
    select.className = "secondary";
    select.type = "button";
    select.textContent = "Destino";
    select.setAttribute("aria-label", `Escolher o slot ${slot} como destino`);
    select.disabled = !link;
    select.addEventListener("click", () => {
      get("manualSlot").open = true;
      get("slotNumber").value = slot;
      get("sendSlot").focus();
    });
    const actions = document.createElement("div");
    actions.className = "slot-actions";
    actions.append(select);
    if (stored) {
      if (libraryTab === "tone") {
        const rename = document.createElement("button");
        rename.className = "secondary";
        rename.type = "button";
        rename.textContent = "Renomear";
        rename.setAttribute("aria-label", `Renomear ${stored}`);
        rename.disabled = !link;
        rename.addEventListener("click", () => {
          if (!link || libraryBusy) return;
          const input = prompt(`Novo nome para ${stored}`, stored);
          if (input === null) return;
          const name = input.trim();
          if (!name) return;
          transferLibrary(2, async (heartbeat) => {
            await heartbeat();
            await renameSlotFile(link, slot, name);
            return `Slot ${String(slot).padStart(2, "0")} renomeado para "${name}".`;
          });
        });
        actions.prepend(rename);
        const move = document.createElement("button");
        move.className = "secondary";
        move.type = "button";
        move.textContent = "Mover";
        move.setAttribute("aria-label", `Mover ${stored} para outro slot`);
        move.disabled = !link;
        move.addEventListener("click", () => {
          if (!link || libraryBusy) return;
          const to = Number(prompt(`Mover ${stored} para o slot (1–30):`, String(slot)));
          if (!Number.isInteger(to) || to < 1 || to > 30 || to === slot) return;
          const taken = installed.some(entry => entry.kind === "tone" && entry.slot === to);
          if (taken && !confirm(`O slot ${to} já tem captura e será substituído. Continuar?`)) return;
          transferLibrary(2, async (heartbeat) => {
            await heartbeat();
            await moveSlotFile(link, slot, to);
            return `Slot ${String(slot).padStart(2, "0")} movido para ${String(to).padStart(2, "0")}.`;
          });
        });
        actions.prepend(move);
      }
      const use = document.createElement("button");
      const kind = libraryTab;
      use.className = "secondary";
      use.type = "button";
      use.textContent = "Usar";
      use.setAttribute("aria-label", `Usar ${stored}`);
      use.disabled = !link;
      use.addEventListener("click", () => {
        if (libraryBusy) return;
        useInstalledSlot(kind, slot, stored);
      });
      actions.prepend(use);
    }
    row.append(number, name, actions);
    list.append(row);
  }
  if (!shown) {
    const row = document.createElement("li");
    row.className = "slot-empty-row";
    row.textContent = query ? "Nenhum slot corresponde ao filtro." : "Nenhum arquivo nesta aba.";
    list.append(row);
  }
}

function setLibraryTab(tab) {
  if (tab !== libraryTab) get("slotFile").value = "";
  libraryTab = tab;
  get("slotFilter").hidden = tab === "presets";
  get("slotCount").hidden = tab === "presets";
  for (const button of document.querySelectorAll("[data-library-tab]"))
    button.setAttribute("aria-pressed", String(button.dataset.libraryTab === tab));
  for (const panel of document.querySelectorAll("[data-library-panel]"))
    panel.hidden = panel.dataset.libraryPanel !== tab;
  get("installedFiles").hidden = tab === "presets";
  get("slotsTitle").textContent = tab === "tone" ? "Capturas na GP-5" : "IRs na GP-5";
  get("slotUploadTitle").textContent = tab === "tone" ? "Enviar captura" : "Enviar IR";
  get("slotPicker").textContent = tab === "tone" ? "Escolher capturas .nam" : "Escolher IRs .wav";
  get("slotFile").accept = tab === "tone" ? ".nam" : ".wav";
  showSlots();
}

async function refreshNamedSlots() {
  try {
    installed = await listInstalledFiles(link);
    slotsRead = true;
    fitSlotSelect(get("capture"), "tone", current[7], "Captura interna", true);
    fitSlotSelect(get("quickPreset"), "tone", current[7], "Captura interna", true);
    fitSlotSelect(get("ir"), "cab", current[6], "Nenhum IR", true);
    showSlots();
  } catch (error) {
    slotsRead = false;
    showLibraryProgress(`Falha ao ler os nomes dos slots. ${error.message}`);
  }
}

for (const button of document.querySelectorAll("[data-view]"))
  button.addEventListener("click", () => setView(button.dataset.view));
for (const button of document.querySelectorAll("[data-library-tab]"))
  button.addEventListener("click", () => setLibraryTab(button.dataset.libraryTab));
get("slotFilter").addEventListener("input", showSlots);
get("openCaptures").addEventListener("click", () => { setLibraryTab("tone"); setView("library"); });
get("openIrs").addEventListener("click", () => { setLibraryTab("cab"); setView("library"); });
get("reloadSlots").addEventListener("click", () => run(() => link && refreshNamedSlots()));

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  selectedLibrary = undefined;
  importButton.disabled = true;
  if (!file) return;
  showLibraryProgress("Verificando biblioteca…");
  try {
    const archive = await parseLibrary(file);
    if (importFile.files[0] !== file) return;
    selectedLibrary = archive;
    importButton.disabled = false;
    const captures = [...archive.files.keys()].filter(name => name.startsWith("tone-")).length;
    showLibraryProgress(`${captures} capturas e ${archive.files.size - captures} IRs. Restaurar substitui os slots e presets atuais.`);
  } catch (error) {
    if (importFile.files[0] === file) showLibraryProgress(error.message);
  }
});

async function transferLibrary(mode, operation, progress = showLibraryProgress) {
  if (!link || libraryBusy) return;
  libraryBusy = true;
  connect.disabled = true;
  setDisabled(true);
  clearExpression();
  progress("Preparando a transferência…");
  await run(async () => {
    if (!link) return;
    const lock = async (value) => {
      const reply = await libraryCommand(link, [0x7e, 0x10, libraryLockCommand, 0, value, 0, 0, 0], 15000);
      if (reply?.[2] !== 1) throw new Error("A GP-5 não liberou o modo de biblioteca. Aguarde o timbre carregar e tente novamente.");
    };
    let acquired = false;
    let result;
    try {
      await writeParam(expressionCommand, 0);
      await lock(mode);
      acquired = true;
      result = await operation(() => lock(mode));
    } catch (error) {
      progress(error.message);
      toast(error.message);
    } finally {
      if (acquired) {
        try { await lock(0); }
        catch (error) {
          progress("A GP-5 deixou de responder. Reconecte-a antes de usar a biblioteca novamente.");
          throw error;
        }
      }
    }
    if (acquired && mode === 2) {
      await refresh();
      await refreshNamedSlots();
    }
    if (result) progress(typeof result === "function" ? await result() : result);
  });
  libraryBusy = false;
  connect.disabled = false;
  setDisabled(!link);
  showOrder();
}

function saveDownload(data, filename, type = "application/octet-stream") {
    const url = URL.createObjectURL(new Blob([data], {type}));
    const download = document.createElement("a");
    download.href = url;
    download.download = filename;
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sendFiles(files, slot, kind, progress = showLibraryProgress, auto = false, askConfirm = true) {
  if (!link || libraryBusy) throw new Error("Conecte a GP-5 antes de enviar os arquivos.");
  const extension = kind === "cab" ? /\.wav$/i : /\.nam$/i;
  const format = kind === "cab" ? "WAV" : "NAM A2";
  if (!files.length) throw new Error(`Use Escolher arquivos aqui e selecione os arquivos ${format} antes de enviar.`);
  if (!Number.isInteger(slot) || slot < 1 || slot > 30) throw new Error("Escolha um slot de 1 a 30.");
  if (files.some(file => !extension.test(file.name))) throw new Error(`Selecione apenas arquivos ${format}.`);
  if (files.length === 1 && !auto && askConfirm && !confirm(`Gravar no slot ${slot}? O arquivo nesse slot será substituído.`)) return;
  await transferLibrary(2, async (heartbeat) => {
    progress(`Preparando ${files.length} arquivo(s) ${format}…`);
    const plan = files.length === 1 && !auto
      ? { entries: [await prepareSlotFile(files[0], slot)], rejected: [] }
      : await planSlotBatch(link, files, slot, kind, progress);
    const entries = plan.entries;
    const used = entries.map(entry => Number(entry.name.slice(-2))).join(", ");
    progress(`Gravando ${entries.length} arquivo(s) nos slots ${used}…`);
    const written = [];
    try {
      for (const [i, entry] of entries.entries()) {
        await heartbeat();
        await sendSlotFile(link, entry, details => progress(`${i + 1}/${entries.length} · ${details}`));
        written.push(entry.name.slice(-2));
      }
    } catch (error) {
      throw new Error(`${written.length}/${entries.length} gravados. ${error.message}`);
    }
    return async () => {
      const confirmed = slotsRead && written.every(slot => installed.some(entry => entry.kind === kind && entry.slot === Number(slot)));
      const skipped = plan.rejected.length
        ? ` Ignorados: ${plan.rejected.slice(0, 3).map(item => `${item.name} (${item.message})`).join("; ")}${plan.rejected.length > 3 ? "…" : ""}.`
        : "";
      if (confirmed && extendedControls) {
        const reply = await request(0x11, kind === "tone" ? 74 : 76, 0, 2);
        if (reply[2] === 2 && reply.length >= 7) {
          const mask = new DataView(reply.buffer, reply.byteOffset + 3, 4).getUint32(0, true);
          const rejected = written.filter(slot => !(mask & (1 << (Number(slot) - 1))));
          if (rejected.length) return `A GP-5 leu a gravação, mas recusou o conteúdo dos slots ${rejected.join(", ")}. Confira se o formato do arquivo é compatível.${skipped}`;
        }
      }
      return (confirmed ? `${written.length} arquivo(s) gravado(s) nos slots ${written.join(", ")}. Toque em Usar para carregar.`
        : "A gravação respondeu, mas a leitura final dos slots não confirmou os arquivos. Toque em Atualizar para conferir.") + skipped;
    };
  }, progress);
}

const slotFile = get("slotFile");
const folderFile = get("folderFiles");
let pendingImport = [];
let importGeneration = 0;

function pickFiles(manual) {
  manualDestination = manual;
  slotFile.value = "";
  if (typeof slotFile.showPicker === "function") {
    try { slotFile.showPicker(); return; } catch { /* browser refused: use the plain click */ }
  }
  slotFile.click();
}
get("slotPicker").addEventListener("click", () => pickFiles(false));
get("sendSlot").addEventListener("click", () => pickFiles(true));
get("quickCaptures").addEventListener("click", () => {
  setLibraryTab("tone");
  setView("library");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (link && !libraryBusy) pickFiles(false);
  else if (!link) showLibraryProgress("Conecte a GP-5 por USB para importar na pedaleira.");
});

async function classifyImportFile(file, kind) {
  const extension = kind === "cab" ? /\.wav$/i : /\.nam$/i;
  if (!extension.test(file.name)) return { file, ok: false, reason: `não é .${kind === "cab" ? "wav" : "nam"}` };
  if (file.size > 32 * 1024 * 1024) return { file, ok: false, reason: "acima de 32 MB" };
  if (kind === "cab") return { file, ok: true };
  let text = "";
  try {
    text = await file.text();
    validateNamA2(text);
    return { file, ok: true };
  } catch (error) {
    return { file, ok: false, reason: namError(error, text) };
  }
}

async function prepareImport(files) {
  if (!files.length) return;
  const generation = ++importGeneration;
  const kind = libraryTab;
  const list = get("importList");
  const summary = get("importSummary");
  list.replaceChildren();
  pendingImport = [];
  summary.textContent = `Analisando ${files.length} arquivo(s)…`;
  for (const [index, file] of files.entries()) {
    const item = await classifyImportFile(file, kind);
    if (generation !== importGeneration) return;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = item.ok;
    check.disabled = !item.ok;
    item.check = check;
    const name = document.createElement("span");
    name.className = "import-name";
    name.textContent = file.name;
    name.title = file.webkitRelativePath || file.name;
    const state = document.createElement("span");
    state.className = item.ok ? "import-ok" : "import-bad";
    state.textContent = item.ok ? (kind === "cab" ? "WAV ok" : "A2-Lite ok") : (item.reason || "incompatível");
    const row = document.createElement("li");
    row.append(check, name, state);
    list.append(row);
    pendingImport.push(item);
    if (index % 5 === 0) {
      summary.textContent = `Analisando ${index + 1}/${files.length}…`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (generation !== importGeneration) return;
  const ok = pendingImport.filter(item => item.ok).length;
  const free = Math.max(0, 30 - installed.filter(entry => entry.kind === kind).length);
  summary.textContent = `${ok} de ${files.length} compatível(is) · ${free} slot(s) vazio(s) de 30` +
    (ok > free ? ` · só ${free} cabem nesta leva` : "");
  get("importConfirm").disabled = !link || libraryBusy;
  get("importPreview").hidden = false;
  get("importPreview").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

get("importCancel").addEventListener("click", () => {
  importGeneration++;
  pendingImport = [];
  get("importPreview").hidden = true;
  slotFile.value = "";
  folderFile.value = "";
});
get("importConfirm").addEventListener("click", async () => {
  importGeneration++;
  const files = pendingImport.filter(item => item.ok && item.check.checked).map(item => item.file);
  if (!files.length) { toast("Marque pelo menos um arquivo compatível."); return; }
  get("importPreview").hidden = true;
  try {
    await sendFiles(files, manualDestination ? get("slotNumber").valueAsNumber : 1,
      libraryTab, showLibraryProgress, !manualDestination, false);
  } catch (error) {
    showLibraryProgress(error.message);
    toast(error.message);
  }
});

slotFile.addEventListener("change", async () => {
  const files = [...slotFile.files];
  if (files.length) await prepareImport(files);
});
get("folderPicker").addEventListener("click", () => {
  folderFile.value = "";
  folderFile.click();
});
folderFile.addEventListener("change", async () => {
  const pattern = libraryTab === "cab" ? /\.wav$/i : /\.nam$/i;
  const files = [...folderFile.files].filter(file => pattern.test(file.name));
  if (!files.length) {
    showLibraryProgress(`Nenhum arquivo ${libraryTab === "cab" ? "WAV" : "NAM"} na pasta escolhida.`);
    return;
  }
  await prepareImport(files);
});
installCaptureBank((files, slot, progress) => sendFiles(files, slot, "tone", progress));

const presetStatus = get("presetStatus");
let valetonTemplate;
get("importPreset").addEventListener("click", async () => {
  const file = get("presetFile").files[0];
  if (!file || !link || libraryBusy) { presetStatus.textContent = "Selecione um arquivo de preset."; return; }
  try {
    const preset = await loadPreset(file);
    if (!confirm("Aplicar os ajustes à cena atual?")) return;
    await run(async () => {
      if (!link) return;
      for (const [id, value] of Object.entries(preset.values)) {
        const param = Number(id);
        if (param < extraFields[0].id || (param < stereoFields[0].id ? extendedControls : stereoControls))
          await writeParam(param, value);
      }
      if (preset.template) {
        valetonTemplate = preset.template;
        get("exportPrst").disabled = false;
      }
      await refresh();
      presetStatus.textContent = preset.template
        ? `Ajustes compatíveis de ${preset.name || file.name} importados. AMP, IR, SnapTone e efeitos sem equivalente não foram importados.`
        : "Preset aplicado à cena atual.";
    });
  } catch (error) { presetStatus.textContent = error.message; }
});
get("exportPreset").addEventListener("click", () => run(async () => {
  if (link && !libraryBusy) saveDownload(makePreset(await readParameters()), "GP-5-cena.gp5preset", "application/json");
}));
get("exportPrst").addEventListener("click", () => run(async () => {
  if (link && !libraryBusy && valetonTemplate) saveDownload(exportPrst(valetonTemplate, await readParameters()), "GP-5-convertido.prst");
}));

for (let i = 1; i <= 30; i++) {
  const option = document.createElement("option");
  option.value = String(i);
  option.textContent = `Slot ${String(i).padStart(2, "0")}`;
  get("t3kSlot").append(option);
}
get("t3kClient").value = t3kClient();
get("t3kConnect").addEventListener("click", () => {
  t3kConnect(get("t3kClient").value.trim()).catch(error => toast(error.message));
});
get("t3kDownload").addEventListener("click", () => {
  if (!link || libraryBusy) return;
  const id = t3kIdFromInput(get("t3kTone").value);
  if (!id) { toast("Informe o ID ou o link do tone."); return; }
  if (!t3kToken()) { toast("Conecte a TONE3000 primeiro."); return; }
  const slot = Number(get("t3kSlot").value) || 1;
  transferLibrary(2, async (heartbeat) => {
    await heartbeat();
    const entry = await t3kDownloadToSlot(id, slot, prepareSlotFile,
      (fileEntry, progress) => sendSlotFile(link, fileEntry, details => progress?.(details)),
      message => toast(message));
    return `TONE3000: ${entry.name} gravado no slot ${String(slot).padStart(2, "0")}.`;
  });
});
t3kHandleCallback().then(() => { get("t3kClient").value = t3kClient(); toast("TONE3000 conectado"); })
  .catch(error => toast(error.message));
get("exportLibrary").addEventListener("click", () => {
  transferLibrary(1, async (heartbeat) => {
    const reply = await request(0x11, 7, 0, 1);
    if (reply[2] !== 1 || reply.length < 5) throw new Error("O slot atual não pôde ser lido.");
    const library = await exportLibrary(link, (reply[3] | reply[4] << 8) - 1, heartbeat, showLibraryProgress);
    saveDownload(library, `GP-5-${new Date().toISOString().slice(0, 10)}.gp5library`, "application/json");
    return "Biblioteca exportada.";
  });
});

importButton.addEventListener("click", () => {
  const archive = selectedLibrary;
  if (!archive || !link || libraryBusy) return;
  if (!confirm("Use a exportação primeiro se quiser guardar a biblioteca atual. Restaurar agora substituirá as capturas, IRs, presets e cenas da GP-5. Continuar?")) return;
  transferLibrary(2, async (heartbeat) => {
    await restoreLibrary(link, archive, heartbeat, showLibraryProgress);
    return "Biblioteca restaurada. Aguarde a GP-5 carregar o timbre.";
  });
});

setInterval(() => { if (link && !pending && !libraryBusy) run(refresh); }, 650);
setInterval(() => {
  if (!link || !liveTools || !current[tunerId] || pending || libraryBusy) return;
  run(async () => {
    const reply = await request(0x11, tunerFrequencyId, 0, 1);
    const hz10 = reply[2] === 1 && reply.length >= 5 ? reply[3] | reply[4] << 8 : 0;
    renderTuning(hz10 / 10);
  });
}, 135);

selectEffect(selectedBlock);
setDisabled(true);
setLibraryTab("tone");

if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
