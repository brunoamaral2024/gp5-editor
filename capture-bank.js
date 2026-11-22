import { validateNamA2 } from "./convert-nam.js";

const CAPACITY = 50;
const STORE = "captures";
let opening;

function openDatabase() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open("gp5-nam-bank", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, {keyPath: "id"});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}

async function listCaptures() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putBatch(entries) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const keys = store.getAllKeys();
    const counts = { added: 0, duplicate: 0, full: 0 };
    keys.onsuccess = () => {
      const seen = new Set(keys.result);
      for (const entry of entries) {
        if (seen.has(entry.id)) counts.duplicate++;
        else if (seen.size >= CAPACITY) counts.full++;
        else {
          store.add(entry);
          seen.add(entry.id);
          counts.added++;
        }
      }
    };
    tx.oncomplete = () => resolve(counts);
    tx.onabort = () => reject(tx.error || new Error("O banco local não pôde ser salvo."));
  });
}

async function removeCapture(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

async function inspect(file) {
  if (!/\.nam$/i.test(file.name) || file.size > 4 * 1024 * 1024)
    throw new Error("Arquivo NAM acima de 4 MB ou formato inválido.");
  validateNamA2(await file.text());
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  return { id, file };
}

export function installCaptureBank(send) {
  const input = document.getElementById("bankFiles");
  const select = document.getElementById("bankCapture");
  const importButton = document.getElementById("bankImport");
  const status = document.getElementById("bankStatus");
  let bank = [];
  async function refresh() {
    const selection = select.value;
    bank = (await listCaptures()).sort((a, b) => a.file.name.localeCompare(b.file.name, "pt-BR"));
    select.replaceChildren(new Option(`Selecione uma captura (${bank.length}/${CAPACITY})`, ""));
    for (const entry of bank) select.add(new Option(entry.file.name, entry.id));
    if (bank.some(entry => entry.id === selection)) select.value = selection;
  }
  importButton.addEventListener("click", async () => {
    if (!input.files.length) { status.textContent = "Selecione pelo menos um arquivo .nam."; return; }
    if (input.files.length > CAPACITY) { status.textContent = "Selecione até 50 arquivos por vez."; return; }
    const entries = [], rejected = [];
    importButton.disabled = true;
    try {
      for (const file of input.files) {
        status.textContent = `Verificando ${file.name}…`;
        try { entries.push(await inspect(file)); }
        catch { rejected.push(file.name); }
      }
      const {added, duplicate, full} = await putBatch(entries);
      await refresh();
      status.textContent = `${added} importadas · ${duplicate} duplicadas · ${full} sem espaço · ${rejected.length} incompatíveis.`
        + (rejected.length ? ` Confira: ${rejected.join(", ")}.` : "");
      input.value = "";
    } catch (error) { status.textContent = error.message; }
    finally { importButton.disabled = false; }
  });
  document.getElementById("bankSend").addEventListener("click", async () => {
    const entry = bank.find(capture => capture.id === select.value);
    if (!entry) { status.textContent = "Escolha uma captura guardada."; return; }
    try {
      await send([entry.file], document.getElementById("bankSlot").valueAsNumber, message => { status.textContent = message; });
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById("bankSendFiles").addEventListener("click", async () => {
    try {
      await send([...input.files], document.getElementById("bankSlot").valueAsNumber, message => { status.textContent = message; });
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById("bankRemove").addEventListener("click", async () => {
    const entry = bank.find(capture => capture.id === select.value);
    if (!entry || !confirm(`Remover ${entry.file.name} do banco deste navegador?`)) return;
    try {
      await removeCapture(entry.id);
      await refresh();
      status.textContent = "Captura removida do banco local.";
    } catch (error) { status.textContent = error.message; }
  });
  refresh().catch(error => { status.textContent = error.message; });
}
