/* Calendarr — écran de cuisine (lecture seule, mise à jour automatique) */
"use strict";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const AUDIENCE = { enfants: "Les enfants", famille: "Toute la famille", adultes: "Les parents" };
const token = new URLSearchParams(location.search).get("token") || "";

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };

function hue(text) { let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const fakeBg = (it) => { const h = hue(it.title || ""); return `linear-gradient(160deg,hsl(${h} 45% 38%),hsl(${(h + 50) % 360} 55% 16%))`; };
function cover(it) {
  const fb = `<b>${esc(it.title)}</b><small>${it.year || ""}</small>`;
  if (it.poster) return `<div class="cover" style="background:${fakeBg(it)}"><img src="${esc(it.poster)}" alt="" onerror="this.remove()"></div>`;
  return `<div class="cover fake" style="background:${fakeBg(it)}">${fb}</div>`;
}
function ageLabel(it) {
  if (it.age === undefined || it.age === null) return "";
  if (!it.cert && it.age >= 16) return "";
  return it.age === 0 ? "Tous publics" : `Dès ${it.age} ans`;
}
function when(e) {
  const today = isoDay(new Date());
  const now = hhmm();
  if (e.date === today) {
    if (e.start <= now && now < e.end) return "En ce moment";
    return e.start >= "18:00" ? "Ce soir" : e.start >= "12:00" ? "Cet après-midi" : "Ce matin";
  }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (e.date === isoDay(tomorrow)) return "Demain";
  const d = parse(e.date);
  return `${DAYS[d.getDay()]} ${d.getDate()}`;
}

function tick() {
  const d = new Date();
  $("#clock").textContent = hhmm(d);
  $("#date").textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

let data = null;
function render() {
  if (!data) return;
  const now = hhmm();
  const today = isoDay(new Date());
  const list = data.entries.filter((e) => e.date > today || (e.date === today && e.end > now));
  if (!list.length) {
    $("#wall").innerHTML = `<div class="wall-empty"><div><h1>Soirée sans écran</h1><p>Rien de prévu pour l'instant.</p></div></div>`;
    return;
  }
  const [e, ...rest] = list;
  const it = e.item;
  const bg = it.poster ? `background-image:url('${esc(it.poster)}')` : `background:${fakeBg(it)}`;
  const eps = (e.episodes || []).map((x) => x.code).join(" · ");
  const atv = e.appletv ? `<div class="wall-atv">Sur l'Apple TV : ${esc(e.appletv.where)}${e.appletv.episode ? ` · ${esc(e.appletv.episode)}` : ""}</div>` : "";
  $("#wall").innerHTML = `
    <section class="wall-hero">
      <div class="hero-bg" style="${bg}"></div>
      ${cover(it)}
      <div>
        <p class="wall-kicker">${e.confirmed ? "" : "Idée · "}${when(e)} · ${e.start}</p>
        <h1 class="wall-title">${esc(it.title)}</h1>
        <p class="wall-meta">${esc(AUDIENCE[e.audience] || "")}${e.label ? " · " + esc(e.label) : ""} · ${e.start} – ${e.end}</p>
        <div class="badges"><span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span>${ageLabel(it) ? `<span class="badge">${ageLabel(it)}</span>` : ""}</div>
        ${eps ? `<div class="wall-eps">${esc(eps)}</div>` : ""}
        ${atv}
      </div>
    </section>
    <aside class="wall-next">
      <h2>Ensuite</h2>
      ${rest.slice(0, 4).map((x) => `
        <div class="wall-item">${cover(x.item)}<div><p>${x.confirmed ? "" : "Idée · "}${when(x)} · ${x.start}</p><b>${esc(x.item.title)}</b><span>${esc(AUDIENCE[x.audience] || "")}${x.episodes?.length ? " · " + x.episodes[0].code : ""}</span></div></div>`).join("")}
    </aside>`;
}

async function load() {
  try {
    const res = await fetch(`/api/wall?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (res.status === 403) {
      $("#wall").innerHTML = `<div class="wall-empty"><div><h1>Lien invalide</h1><p>Demandez le lien de l'écran dans Calendarr → Réglages.</p></div></div>`;
      return;
    }
    data = await res.json();
    render();
  } catch {
    /* réseau coupé : on garde l'affichage actuel et on réessaiera */
  }
}

/* Écran toujours allumé, plein écran si possible (un toucher suffit) */
let lock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => (lock = null)); } } catch { /* refusé */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { keepAwake(); load(); } });
document.addEventListener("click", keepAwake);
if (document.fullscreenEnabled && !matchMedia("(display-mode: standalone)").matches) {
  $("#fs").hidden = false;
  $("#fs").onclick = (ev) => { ev.stopPropagation(); document.documentElement.requestFullscreen().catch(() => {}); };
  document.addEventListener("fullscreenchange", () => ($("#fs").hidden = !!document.fullscreenElement));
}

tick();
load();
keepAwake();
setInterval(tick, 15000);
setInterval(render, 60000);        // « En ce moment », « Ensuite »… sans rappeler le serveur
setInterval(load, 5 * 60000);      // nouvelles données toutes les 5 minutes
