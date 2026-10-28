// Header for signed-in pages, plus toasts.
import { session } from "./api.js";

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="10" width="8" height="7" fill="none" stroke="#ff5a1f" stroke-width="2"/><circle cx="21" cy="21" r="2.4" fill="currentColor"/></svg>`;

export function mountHeader(active) {
  const user = session.user || { full_name: "?" };
  const initials = user.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const el = document.getElementById("app-header");
  el.className = "app-header";
  el.innerHTML = `
    <div class="wrap topbar">
      <a class="brand" href="/analyze.html">${LOGO}Microplastic Detector</a>
      <nav aria-label="Main">
        <a class="nav-link" href="/analyze.html" ${active === "analyze" ? 'aria-current="page"' : ""}>Image</a>
        <a class="nav-link" href="/video.html" ${active === "video" ? 'aria-current="page"' : ""}>Video</a>
        <a class="nav-link" href="/history.html" ${active === "history" ? 'aria-current="page"' : ""}>History</a>
        <div class="user-chip">
          <span class="avatar" aria-hidden="true"></span>
          <span class="user-name"></span>
          <button class="btn btn-ghost btn-sm" id="signout" type="button">Sign out</button>
        </div>
      </nav>
    </div>`;
  el.querySelector(".avatar").textContent = initials;
  el.querySelector(".user-name").textContent = user.full_name;
  el.querySelector("#signout").addEventListener("click", () => {
    session.clear();
    location.replace("/login.html");
  });
}

export function toast(message, type = "info") {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const t = document.createElement("div");
  t.className = `toast ${type === "error" ? "error" : ""}`;
  t.textContent = message;
  host.append(t);
  setTimeout(() => t.remove(), 4500);
}
