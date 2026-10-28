// Shared API client + session helpers.
// The JWT is kept in localStorage for simplicity. For a higher-security deployment,
// switch to an HttpOnly cookie set by the backend.
const TOKEN_KEY = "mp_token";
const USER_KEY = "mp_user";

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  save({ access_token, user }) {
    localStorage.setItem(TOKEN_KEY, access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export function requireAuth() {
  if (!session.token) {
    location.replace("/login.html");
    throw new Error("redirecting");
  }
}

export function redirectIfSignedIn() {
  if (session.token) location.replace("/analyze.html");
}

export function errorMessage(body, status) {
  const d = body && body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    // FastAPI validation errors: [{loc, msg}, ...]
    return d.map((e) => (e.msg || "").replace(/^Value error, /, "")).join(". ");
  }
  if (status >= 500) return "The server hit a problem. Try again in a moment.";
  return "Something went wrong. Try again.";
}

export async function api(path, { method = "GET", json, form, raw = false } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // browser sets the multipart boundary
  }

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401 && session.token) {
    session.clear();
    location.replace("/login.html?expired=1");
    throw new Error("Your session has expired.");
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error */ }
    throw new Error(errorMessage(data, res.status));
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

// Fetch a protected image and return an object URL usable in <img src>.
export async function imageUrl(id, kind = "result") {
  const res = await api(`/detections/${id}/image?kind=${kind}`, { raw: true });
  return URL.createObjectURL(await res.blob());
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
