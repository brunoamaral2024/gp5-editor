import { installCaptureBank } from "./capture-bank.js";
import { makePreset, loadPreset, exportPrst } from "./preset.js?v=stereo";
import { exportLibrary, listInstalledFiles, parseLibrary, restoreLibrary, planSlotBatch, prepareSlotFile, sendSlotFile } from "./library.js";
import { cmd as libraryCommand } from "./library-wire.js";
import { buildSysex, parseSysex, webMidiPorts } from "./midi.js?v=studio-pro";

const get = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll("[data-panel]")];
const blocks = [...document.querySelectorAll("[data-block]")];
const selectedToggle = get("toggleSelectedEffect");
let selectedBlock = blocks.find(block => block.dataset.block === "amp");
const setDisabled = (disabled) => {
  for (const panel of [...panels, get("performance"), get("liveMidi"), get("library"), get("libraryBackup"), get("slotUpload"), get("globalControls"), get("sceneBar"), get("presetBar"), get("tempoControls"), get("quickOutput")]) panel.disabled = disabled;
  const indicator = get("connectionState");
  indicator.dataset.online = String(!!link && !disabled);
  indicator.textContent = link && libraryBusy ? "Transferindo" : disabled ? "Desconectada" : "GP-5 conectada";
  selectedToggle.disabled = disabled;
  if (disabled) lastTap = undefined;
  get("reloadSlots").disabled = disabled;
  for (const id of ["chainBypass", "tunerToggle", "mapVolume", "driveOnly"]) get(id).disabled = disabled;
  get("bankSendFiles").disabled = disabled;
  get("bankSend").disabled = disabled;
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
  block.querySelector("[data-effect-edit]").addEventListener("click", () => selectEffect(block));

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
  { id: 64, name: "Amp Bass", group: "NAM", input: get("ampBass") },
  { id: 65, name: "Amp Mid", group: "NAM", input: get("ampMid") },
  { id: 66, name: "Amp Treble", group: "NAM", input: get("ampTreble") },
  { id: 67, name: "Presence", group: "NAM", input: get("ampPresence") },
  { id: 68, name: "Delay Tone", group: "Delay", input: get("delayTone") },
  { id: 69, name: "Mod Depth", group: "Delay", input: get("delayModDepth") },
  { id: 70, name: "Mod Rate", group: "Delay", input: get("delayModRate") },
  { id: 71, name: "Duck Level", group: "Delay", input: get("delayDuck") },
  { id: 72, name: "Width", group: "Delay", input: get("delayWidth") },
  { id: 73, name: "Early", group: "Reverb", input: get("cloudEarly") },
  { id: 74, name: "Tail Mod", group: "Reverb", input: get("cloudMod") },
  { id: 75, name: "Attack", group: "Comp", input: get("compAttack") },
  { id: 76, name: "Release", group: "Comp", input: get("compRelease") },
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
  .map((name, i) => ({id: 99 + i, input: get(name)}));
const delayFields = [{id: 78, input: get("delayModel")}];
const stereoFields = ["modPattern", "modStereo", "delayStereo", "reverbStereo"]
  .map((name, i) => ({id: 80 + i, input: get(name)}));
const liveMidiFields = [{id: 84, input: get("liveExpression")}];
const liveNavigation = 85;
const expressionCommand = 97;
const libraryLockCommand = 98;
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
let expressionLearn = false;
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
        return;
      }
      await writeParam(effect.type, effect.initial);
    }
    await writeParam(effect.id, Number(enabled !== Boolean(effect.bypass)));
    await refresh();
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
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => {
      if (link === connection && !libraryBusy) run(refresh);
    }, 600);
  });
}

for (const button of document.querySelectorAll("[data-midi-nav]"))
  button.addEventListener("click", () => navigateMidi(Number(button.dataset.midiNav)));

function controllerMessage({data}) {
  if (!link || libraryBusy || data.length < 2 || (data[0] & 15) + 1 !== get("midiChannel").valueAsNumber) return;
  const type = data[0] & 240;
  if (type === 0xc0) {
    const presets = current[28] === 2;
    if (data[1] > (presets ? 29 : 2)) return;
    clearExpression();
    run(async () => {
      if (!link) return;
      await writeParam(presets ? 7 : 27, presets ? data[1] + 1 : data[1]);
      await refresh();
    });
    return;
  }
  if (type !== 0xb0 || data.length !== 3) return;
  if (expressionLearn) {
    expressionLearn = false;
    get("expressionCc").value = String(data[1]);
    get("midiChannel").value = String((data[0] & 15) + 1);
    const button = get("expressionLearn");
    if (button) button.textContent = "Aprender CC";
    get("expressionValue").textContent = `CC ${data[1]} · CH ${(data[0] & 15) + 1}`;
    return;
  }
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

get("expressionLearn").addEventListener("click", () => {
  expressionLearn = true;
  get("expressionLearn").textContent = "Mova o pedal...";
});

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
  get("midiPrograms").textContent = current[28] === 2
    ? "PC 0 a 29 selecionam os presets NAM 01 a 30."
    : "PC 0, 1, 2 e 3 selecionam Base, Solo, Ambiente e Cena 4.";
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
for (const button of document.querySelectorAll("[data-scene]")) {
  button.addEventListener("click", () => {
    if (!link || libraryBusy) return;
    get("scene").value = button.dataset.scene;
    get("scene").dispatchEvent(new Event("change"));
  });
}

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
  for (const group of [extendedControls && extraFields, delayFields, stereoControls && stereoFields, nativeMidi && liveMidiFields].filter(Boolean)) {
    const extra = await readExtraParameters(group);
    if (extra.length !== group.length) throw new Error("Resposta incompleta dos parâmetros adicionais.");
    extra.forEach((value, index) => { values[group[index].id] = value; });
  }
  return values;
}

async function refresh() {
  const values = await readParameters();
  current = values;
  syncOrder(values[orderId]);
  fitSlotSelect(get("capture"), "tone", values[7], "Captura interna");
  fitSlotSelect(get("quickPreset"), "tone", values[7], "Captura interna");
  fitSlotSelect(get("ir"), "cab", values[6], "Nenhum IR");
  const model = values[63] ? get("ampVoice").options[values[63]]?.text : get("capture").selectedOptions[0]?.text;
  const outputMode = liveTools ? values[bypassId] : 0;
  const label = outputMode === 1 ? "Sinal direto (bypass)" : outputMode === 2 ? "Só o drive" : model;
  status.textContent = label ? `GP-5 conectada · ${label}` : "GP-5 conectada";
  for (const field of [...fields, ...delayFields, ...(extendedControls ? extraFields : []), ...(stereoControls ? stereoFields : []), ...(nativeMidi ? liveMidiFields : [])]) {
    if ((field.input.type === "number" && field.input === document.activeElement) || field.input.matches(":active")) continue;
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
      const expected = {23: 62, 45: 31, 51: 4, 61: 1, 63: 20};
      if (reply[2] !== 1 || name !== field.name || group !== field.group || (max !== expected[id] && !(id === 45 && max === 36)))
        throw new Error("Esta versão do editor precisa do firmware GP-5 NAM Studio.");
      if (id === 45) {
        for (const option of field.input.options) option.hidden = option.disabled = Number(option.value) > max;
      }
    }
    const footDescriptor = await request(0x12, 28, 0);
    get("sceneMode").querySelector('option[value="2"]').disabled = footDescriptor[2] !== 1 || footDescriptor[11] < 2;
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
    setDisabled(false);
    connect.textContent = "Desconectar";
    showOrder();
    if (!current[tunerId]) run(() => link && refreshNamedSlots());
  });
  connect.disabled = false;
});

for (const { id, input } of [...fields, ...extraFields, ...delayFields, ...stereoFields, ...liveMidiFields]) {
  input.addEventListener("input", showValues);
  input.addEventListener("change", () => {
    if (!input.checkValidity() || input.value === "") { input.reportValidity(); return; }
    const value = input.type === "checkbox" ? Number(input.checked) : Number(input.value);
    run(async () => {
      if (!link) return;
      if (id === 27 || id === 7) clearExpression();
      await writeParam(id, value);
      const pairedEffect = Object.values(toggles).find(effect => effect.bypass && effect.type === id);
      if (pairedEffect && value && current[pairedEffect.id]) await writeParam(pairedEffect.id, 0);
      if (id === 45 && value && liveTools && current[bypassId] === 1) await writeParam(bypassId, 2);
      if (id === 63) await activateAmplifier();
      input.blur();
      await refresh();
    });
  });
}
get("worshipSettings").addEventListener("click", () => {
  if (!link || libraryBusy) return;
  run(async () => {
    if (!link) return;
    const settings = [[18, 10], [14, 42], [15, 84], [16, 35], [17, 65], [53, 10], [54, 2], [13, 1]];
    for (const [id, value] of settings) await writeParam(id, value);
    await refresh();
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
      select.add(new Option(`${String(entry.slot).padStart(2, "0")} · ${entry.name}`, entry.slot));
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
  });
}

function showSlots() {
  get("slotList").replaceChildren();
  if (libraryTab === "presets") return;
  const entries = installed.filter(item => item.kind === libraryTab);
  const slots = new Map(entries.map(item => [item.slot, item.name]));
  for (let slot = 1; slot <= 30; slot++) {
    const row = document.createElement("li");
    const number = document.createElement("code");
    const name = document.createElement("span");
    const select = document.createElement("button");
    number.textContent = String(slot).padStart(2, "0");
    name.textContent = slots.get(slot) ?? (link ? "Vazio" : "–");
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
    if (slots.has(slot)) {
      const use = document.createElement("button");
      const kind = libraryTab;
      use.className = "secondary";
      use.type = "button";
      use.textContent = "Usar";
      use.setAttribute("aria-label", `Usar ${slots.get(slot)}`);
      use.disabled = !link;
      use.addEventListener("click", () => useInstalledSlot(kind, slot, slots.get(slot)));
      actions.prepend(use);
    }
    row.append(number, name, actions);
    get("slotList").append(row);
  }
}

function setLibraryTab(tab) {
  if (tab !== libraryTab) get("slotFile").value = "";
  libraryTab = tab;
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
      const prefix = acquired && mode === 2 ? "Transferência interrompida. " : "";
      progress(prefix + error.message);
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

async function sendFiles(files, slot, kind, progress = showLibraryProgress, auto = false) {
  if (!link || libraryBusy) throw new Error("Conecte a GP-5 antes de enviar os arquivos.");
  const extension = kind === "cab" ? /\.wav$/i : /\.nam$/i;
  const format = kind === "cab" ? "WAV" : "NAM A2";
  if (!files.length) throw new Error(`Use Escolher arquivos aqui e selecione os arquivos ${format} antes de enviar.`);
  if (!Number.isInteger(slot) || slot < 1 || slot > 30) throw new Error("Escolha um slot de 1 a 30.");
  if (files.some(file => !extension.test(file.name))) throw new Error(`Selecione apenas arquivos ${format}.`);
  if (files.length === 1 && !auto && !confirm(`Gravar no slot ${slot}? O arquivo nesse slot será substituído.`)) return;
  await transferLibrary(2, async (heartbeat) => {
    progress(`Verificando ${files.length} arquivo(s) ${format}…`);
    const entries = files.length === 1 && !auto
      ? [await prepareSlotFile(files[0], slot)]
      : await planSlotBatch(link, files, slot, kind);
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
      if (confirmed && extendedControls) {
        const reply = await request(0x11, kind === "tone" ? 74 : 76, 0, 2);
        if (reply[2] === 2 && reply.length >= 7) {
          const mask = new DataView(reply.buffer, reply.byteOffset + 3, 4).getUint32(0, true);
          const rejected = written.filter(slot => !(mask & (1 << (Number(slot) - 1))));
          if (rejected.length) return `A GP-5 leu a gravação, mas recusou o conteúdo dos slots ${rejected.join(", ")}. Confira se o formato do arquivo é compatível.`;
        }
      }
      return confirmed ? `${written.length} arquivo(s) gravado(s) nos slots ${written.join(", ")}. Toque em Usar para carregar.`
        : "A gravação respondeu, mas a leitura final dos slots não confirmou os arquivos. Toque em Atualizar para conferir.";
    };
  }, progress);
}

const slotFile = get("slotFile");
function pickFiles(manual) {
  manualDestination = manual;
  slotFile.value = "";
  slotFile.click();
}
get("slotPicker").addEventListener("click", () => pickFiles(false));
get("sendSlot").addEventListener("click", () => pickFiles(true));
get("quickCaptures").addEventListener("click", () => {
  setLibraryTab("tone");
  setView("library");
  if (link && !libraryBusy) pickFiles(false);
  else if (!link) showLibraryProgress("Conecte a GP-5 por USB para importar na pedaleira.");
});
slotFile.addEventListener("change", async () => {
  const files = [...slotFile.files];
  if (!files.length) return;
  try {
    await sendFiles(files, manualDestination ? get("slotNumber").valueAsNumber : 1,
      libraryTab, showLibraryProgress, !manualDestination);
  } catch (error) { showLibraryProgress(error.message); }
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
