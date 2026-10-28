import { api, session, redirectIfSignedIn } from "./api.js";
import { startField } from "./field.js";

redirectIfSignedIn();
startField(document.getElementById("field"));

const $ = (id) => document.getElementById(id);
const loginForm = $("login-form");
const registerForm = $("register-form");
const form = loginForm || registerForm;

// Show/hide password
document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.getAttribute("aria-controls"));
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", String(show));
  });
});

if (loginForm && new URLSearchParams(location.search).get("expired")) {
  const n = $("notice");
  n.textContent = "Your session expired. Sign in again to continue.";
  n.hidden = false;
}

function setError(name, msg) {
  const input = $(name), out = $(`${name}-error`);
  if (out) out.textContent = msg || "";
  if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
}
function showBanner(msg) {
  const b = $("error");
  b.textContent = msg || "";
  b.hidden = !msg;
}

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (pw.length >= 12) s++;
  if (/[^A-Za-z0-9]/.test(pw) && pw.length >= 8) s++;
  return s;
}
if (registerForm) {
  $("password").addEventListener("input", (e) => {
    $("strength").dataset.level = e.target.value ? strength(e.target.value) : 0;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(data) {
  let ok = true;
  const check = (name, bad, msg) => { setError(name, bad ? msg : ""); if (bad) ok = false; };
  if (registerForm) check("full_name", data.full_name.trim().length < 2, "Enter your full name.");
  check("email", !EMAIL_RE.test(data.email), "Enter a valid email address.");
  if (registerForm) {
    check("password", data.password.length < 8 || !/[A-Za-z]/.test(data.password) || !/\d/.test(data.password),
      "Use at least 8 characters with a letter and a number.");
    check("confirm", data.confirm !== data.password, "Passwords don't match.");
  } else {
    check("password", !data.password, "Enter your password.");
  }
  return ok;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showBanner("");
  const data = Object.fromEntries(new FormData(form));
  if (!validate(data)) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  const btn = form.querySelector('button[type="submit"]');
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Please wait';
  try {
    const payload = registerForm
      ? { full_name: data.full_name, email: data.email, password: data.password }
      : { email: data.email, password: data.password };
    const res = await api(registerForm ? "/auth/register" : "/auth/login", { method: "POST", json: payload });
    session.save(res);
    location.replace("/analyze.html");
  } catch (err) {
    showBanner(err.message);
    btn.disabled = false;
    btn.textContent = label;
  }
});
