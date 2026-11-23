// TONE3000 integration for the GP-5 editor.
// OAuth 2.0 + PKCE, model download with the Bearer token, then the existing slot writer.
// The user creates a publishable key (t3k_pub_...) and registers this page as a redirect URI.

const API = "https://www.tone3000.com/api/v1";
const KEY = "t3k_client", TOKEN = "t3k_token", EXP = "t3k_exp";
const VERIFIER = "t3k_verifier", STATE = "t3k_state";

export function t3kClient() { return localStorage.getItem(KEY) || ""; }
export function t3kToken() {
    const token = localStorage.getItem(TOKEN);
    const exp = Number(localStorage.getItem(EXP) || 0);
    return token && Date.now() < exp ? token : "";
}
export function t3kRedirectUri() { return location.origin + location.pathname; }

function b64url(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function t3kConnect(clientId) {
    if (!clientId) throw new Error("Informe a publishable key (t3k_pub_…).");
    localStorage.setItem(KEY, clientId);
    const verifier = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const state = crypto.randomUUID();
    sessionStorage.setItem(VERIFIER, verifier);
    sessionStorage.setItem(STATE, state);
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: t3kRedirectUri(),
        response_type: "code",
        code_challenge: b64url(new Uint8Array(digest)),
        code_challenge_method: "S256",
        state,
    });
    location.href = `${API}/oauth/authorize?${params}`;
}

export async function t3kHandleCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code"), state = params.get("state"), error = params.get("error");
    if (!code && !error) return null;
    history.replaceState(null, "", location.pathname);
    if (error) throw new Error(`TONE3000: ${error}`);
    if (state !== sessionStorage.getItem(STATE)) throw new Error("TONE3000: state inválido.");
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: sessionStorage.getItem(VERIFIER) || "",
        redirect_uri: t3kRedirectUri(),
        client_id: t3kClient(),
    });
    const response = await fetch(`${API}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!response.ok) throw new Error(`TONE3000: token ${response.status}`);
    const tokens = await response.json();
    localStorage.setItem(TOKEN, tokens.access_token);
    localStorage.setItem(EXP, String(Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60000));
    return tokens;
}

async function api(path) {
    const token = t3kToken();
    if (!token) throw new Error("Conecte a TONE3000 primeiro.");
    const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`TONE3000: ${response.status}`);
    return response.json();
}

export async function t3kTone(id) { return api(`/tones/${id}`); }

export async function t3kModels(id) {
    const data = await api(`/models?tone_id=${id}`);
    return Array.isArray(data) ? data : data.data || data.models || [];
}

export function t3kIdFromInput(text) {
    const value = text.trim();
    const match = value.match(/(\d{2,})/);
    return match ? match[1] : "";
}

export async function t3kDownloadToSlot(toneId, slot, prepare, send, progress) {
    const models = await t3kModels(toneId);
    const isA2 = model => Number(model.architecture) === 2 || model.architecture === "2";
    const model = models.find(item => isA2(item) && /nam/i.test(item.format || "")) || models.find(isA2);
    if (!model) throw new Error("TONE3000: nenhum modelo A2 nesse tone (A1 não roda na GP-5).");
    const url = model.model_url || model.url || model.download_url;
    if (!url) throw new Error("TONE3000: modelo sem URL de download.");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${t3kToken()}` } });
    if (!response.ok) throw new Error(`TONE3000: download ${response.status}`);
    const blob = await response.blob();
    if (progress) progress("Baixado; convertendo para A2-Lite…");
    const file = new File([blob], `t3k-${toneId}.nam`, { type: "application/json" });
    const entry = await prepare(file, slot);
    if (progress) progress("Gravando no slot…");
    await send(entry, progress);
    return entry;
}
