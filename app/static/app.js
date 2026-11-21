/* Calendarr — interface */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const GENRES_FR = {
  "Action": "Action", "Adventure": "Aventure", "Animation": "Animation", "Biography": "Biographie",
  "Children": "Jeunesse", "Comedy": "Comédie", "Crime": "Policier", "Documentary": "Documentaire",
  "Drama": "Drame", "Family": "Famille", "Fantasy": "Fantastique", "History": "Histoire",
  "Horror": "Horreur", "Kids": "Enfants", "Music": "Musique", "Musical": "Comédie musicale",
  "Mystery": "Mystère", "Reality": "Téléréalité", "Romance": "Romance", "Science Fiction": "Science-fiction",
  "Sci-Fi & Fantasy": "SF & Fantastique", "Sport": "Sport", "Talk Show": "Talk-show", "Thriller": "Thriller",
  "TV Movie": "Téléfilm", "War": "Guerre", "Western": "Western", "Anime": "Anime", "Food": "Cuisine",
  "Game Show": "Jeu télévisé", "Home and Garden": "Maison & jardin", "Mini-Series": "Mini-série",
  "Soap": "Feuilleton", "Suspense": "Suspense", "Travel": "Voyage",
};
const AUDIENCE = { enfants: "Les enfants", famille: "Toute la famille", adultes: "Les parents" };
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const FREE_LINES = [
  "Soirée sans écran : jeux de société, lecture, ou dodo tôt.",
  "Pas de télé ce soir. Et si on se racontait sa journée ?",
  "Soirée libre. Le canapé se repose aussi.",
  "Rien de prévu : un bon livre, peut-être ?",
];
const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;

const state = { user: null, started: false, status: null, week: null, plan: null, settings: null, meta: null, pick: null, shelves: [] };

/* ---------- utilitaires ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fr = (g) => GENRES_FR[g] || g;
const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (isoDate, n) => { const d = parse(isoDate); d.setDate(d.getDate() + n); return iso(d); };
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);
const dayName = (isoDate) => DAYS[(parse(isoDate).getDay() + 6) % 7];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Calendarr": "1", ...(opts.headers || {}) },
    credentials: "same-origin",
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    showAuth("login", "Votre session a expiré : reconnectez-vous.");
    throw new Error("Connexion requise");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }
  return res.json();
}

const isAdmin = () => state.user?.role === "admin";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

function hue(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function fakeBg(item) {
  const h = hue(item.title || "");
  return `linear-gradient(160deg,hsl(${h} 45% 38%),hsl(${(h + 50) % 360} 55% 16%))`;
}
function fakeInner(item) {
  return `<b>${esc(item.title)}</b><small>${item.year || ""}</small>`;
}

/* Jaquette : affiche si disponible, sinon une jaquette générée. */
function cover(item, { type = false, seen = false, over = "" } = {}) {
  const extra = over +
    (type ? `<span class="badge type ${item.kind}">${item.kind === "film" ? "Film" : "Série"}</span>` : "") +
    (seen ? `<span class="seen" title="Jamais vu">${icon("check")}</span>` : "");
  if (item.poster) {
    return `<div class="cover"><img loading="lazy" src="${esc(item.poster)}" alt="" data-fb="${esc(fakeInner(item))}" data-bg="${esc(fakeBg(item))}" onerror="const c=this.parentNode;c.classList.add('fake');c.style.background=this.dataset.bg;this.outerHTML=this.dataset.fb">${extra}</div>`;
  }
  return `<div class="cover fake" style="background:${fakeBg(item)}">${fakeInner(item)}${extra}</div>`;
}

/* Âge conseillé en clair (« Tous publics », « Dès 12 ans »), plutôt que PG-13 ou TV-MA. */
const CERT_AGES = { "G": 0, "TV-Y": 0, "TV-G": 0, "U": 0, "AL": 0, "KT": 0, "TP": 0, "0": 0, "ALL": 0,
  "TV-Y7": 7, "PG": 7, "6": 6, "7": 7, "TV-PG": 10, "10": 10, "PG-13": 13, "12": 12, "TV-14": 14, "13": 13,
  "14": 14, "R": 16, "16": 16, "TV-MA": 16, "17": 16, "NC-17": 18, "18": 18 };
function ageLabel(item) {
  const cert = String(item.cert || "").toUpperCase().replace("+", "").trim();
  const age = item.age ?? CERT_AGES[cert];
  if (age === undefined || (!cert && age >= 16)) return "";
  return age === 0 ? "Tous publics" : `Dès ${age} ans`;
}

function metaLine(item, { age = true } = {}) {
  const parts = [];
  if (item.year) parts.push(item.year);
  parts.push(item.kind === "film" ? dur(item.runtime || 0) : `épisodes de ${item.runtime || "?"} min`);
  const g = (item.genres || []).slice(0, 2).map(fr).join(", ");
  if (g) parts.push(g);
  const a = age ? ageLabel(item) : "";
  if (a) parts.push(a);
  return parts.join(" · ");
}
const neverSeen = (reason) => (reason || "").startsWith("Jamais vu");

/* ---------- navigation ---------- */
function show(view) {
  $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === "tonight") loadTonight();
  if (view === "week" && state.plan) renderWeek();
  if (view !== "tonight") releaseWakeLock();
  if (view === "surprise" && !state.shelves.length) loadShelves();
  if (view === "upcoming") loadUpcoming();
  if (view === "settings") loadSettings();
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0 });
}
$$("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
$(".logo").addEventListener("click", (e) => { e.preventDefault(); show("tonight"); });

function renderSideStatus() {
  const s = state.status;
  if (!s) return;
  $("#side-status").innerHTML = s.demo
    ? `<div><span class="dot"></span>Exemples (bibliothèque non branchée)</div>`
    : Object.entries(s.services).map(([n, i]) =>
        `<div><span class="dot ${i.ok ? "ok" : i.configured ? "ko" : ""}"></span>${n[0].toUpperCase() + n.slice(1)}</div>`).join("");
  $("#side-status").insertAdjacentHTML("beforeend", `<div class="version">Calendarr ${esc(s.version || "")}</div>`);
}

/* ---------- semaine ---------- */
function weekTitle(start) {
  const a = parse(start), b = parse(addDays(start, 6));
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.getDate()}${sameMonth ? "" : " " + MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

async function loadWeek(week) {
  $("#week").innerHTML = `<div class="loading">Préparation du programme…</div>`;
  try {
    state.plan = await api(`/api/plan${week ? "?week=" + week : ""}`);
    state.week = state.plan.week;
    renderWeek();
  } catch (e) {
    $("#week").innerHTML = `<div class="loading">Impossible de charger le programme : ${esc(e.message)}</div>`;
  }
}

function renderBanner(plan) {
  const warn = (plan?.warnings || []).join(" · ");
  const banner = $("#banner");
  if (state.status?.demo) {
    banner.innerHTML = isAdmin()
      ? `Ce sont des <b>exemples</b>. <a href="#settings" data-goto="settings">Branchez Radarr, Sonarr et Jellyfin dans Réglages</a> pour voir votre bibliothèque.`
      : `Ce sont des exemples : votre bibliothèque sera bientôt prête.`;
    banner.hidden = false;
  } else if (warn && isAdmin()) {
    banner.innerHTML = `<b>Attention :</b> ${esc(warn)}`;
    banner.hidden = false;
  } else banner.hidden = true;
}

function renderWeek() {
  const plan = state.plan;
  const today = state.status?.today || iso(new Date());
  $("#week-title").textContent = weekTitle(plan.week);
  renderBanner(plan);
  const html = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(plan.week, i);
    const d = parse(day);
    const entries = plan.entries.filter((e) => e.date === day);
    const cls = day === today ? "today" : day < today ? "past" : "";
    html.push(`<article class="day ${cls}">
      <div class="day-head"><span>${DAYS[i]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}</span></div>
      <div class="day-items">${entries.length ? entries.map(renderEntry).join("") : `<div class="free">${FREE_LINES[(d.getDate() + i) % FREE_LINES.length]}</div>`}</div>
    </article>`);
  }
  $("#week").innerHTML = html.join("");
}

function watchButton(e, cls) {
  if (e.appletv) {
    return `<button type="button" class="${cls}" data-atv='${esc(JSON.stringify(e.appletv))}' title="Comment le lancer sur l'Apple TV">${icon("play")}Sur l'Apple TV</button>`;
  }
  if (!e.watch_url) return "";
  return `<a class="${cls}" href="${esc(e.watch_url)}" target="_blank" rel="noopener" title="Ouvrir dans Jellyfin">${icon("play")}Regarder</a>`;
}

function renderEntry(e) {
  const it = e.item;
  if (!it) {
    return `<div class="prog ${e.audience}" style="grid-template-columns:1fr"><div class="prog-body">
      <div class="prog-top"><span class="time">${e.start}</span><span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span><span>${esc(e.label)}</span></div>
      <p class="reason">${esc(e.reason)}</p>
      <div class="prog-actions"><button class="mini" data-swap="${e.id}">${icon("swap")}Réessayer</button></div></div></div>`;
  }
  const eps = (e.episodes || []).map((ep) => `<li title="${esc(ep.name)}"><b>${ep.code}</b>${ep.name ? " · " + esc(ep.name) : ""}</li>`).join("");
  return `<div class="prog ${e.audience}">
    ${cover(it, { type: true })}
    <div class="prog-body">
      <div class="prog-top">
        <span class="time">${e.start} – ${e.end}</span>
        <span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span>
        ${e.label ? `<span>${esc(e.label)}</span>` : ""}
      </div>
      <h3>${esc(it.title)}</h3>
      <p class="meta">${esc(metaLine(it))}</p>
      ${eps ? `<ul class="eps">${eps}</ul>` : ""}
      ${e.reason ? `<p class="reason">${esc(e.reason)}</p>` : ""}
      <div class="prog-actions">
        ${watchButton(e, "mini play")}
        <button class="mini" data-swap="${e.id}" title="Proposer autre chose">${icon("swap")}Autre idée</button>
        <button class="mini danger" data-remove="${e.id}" title="Retirer du programme (sans rien supprimer de la bibliothèque)">${icon("x")}Pas cette fois</button>
      </div>
    </div>
  </div>`;
}

$("#week").addEventListener("click", async (ev) => {
  const swap = ev.target.closest("[data-swap]");
  const remove = ev.target.closest("[data-remove]");
  if (!swap && !remove) return;
  const btn = swap || remove;
  btn.disabled = true;
  try {
    if (swap) {
      state.plan = await api(`/api/plan/swap?week=${state.week}&entry=${swap.dataset.swap}`, { method: "POST" });
    } else {
      state.plan = await api(`/api/plan/entry?week=${state.week}&entry=${remove.dataset.remove}`, { method: "DELETE" });
      toast("Retiré du programme (le titre reste dans la bibliothèque)");
    }
    renderWeek();
  } catch (e) {
    toast("Oups : " + e.message);
    btn.disabled = false;
  }
});

$("#prev-week").onclick = () => loadWeek(addDays(state.week, -7));
$("#next-week").onclick = () => loadWeek(addDays(state.week, 7));
$("#more-btn").onclick = (ev) => {
  ev.stopPropagation();
  $("#week-actions").classList.toggle("open");
};
document.addEventListener("click", () => $("#week-actions").classList.remove("open"));

$("#regen").onclick = async () => {
  if (!confirm("Refaire tout le programme de cette semaine ?")) return;
  $("#regen").disabled = true;
  try {
    state.plan = await api(`/api/plan/regenerate?week=${state.week}&refresh=true`, { method: "POST" });
    renderWeek();
    toast("Nouveau programme prêt");
  } finally {
    $("#regen").disabled = false;
  }
};

/* ---------- Ce soir ---------- */
const nowHHMM = () => { const n = new Date(); return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`; };
const weekOf = (isoDate) => addDays(isoDate, -((parse(isoDate).getDay() + 6) % 7));

async function loadTonight() {
  const today = state.status?.today || iso(new Date());
  const thisWeek = weekOf(today);
  try {
    const [a, b] = await Promise.all([api(`/api/plan?week=${thisWeek}`), api(`/api/plan?week=${addDays(thisWeek, 7)}`)]);
    if (!state.plan || state.plan.week === a.week) { state.plan = a; state.week = a.week; }
    renderBanner(a);
    const now = nowHHMM();
    state.tonight = [...a.entries, ...b.entries]
      .filter((e) => e.item && (e.date > today || (e.date === today && e.end > now)))
      .sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
    renderTonight();
  } catch (e) {
    $("#tonight").innerHTML = `<div class="loading">Impossible de charger le programme : ${esc(e.message)}</div>`;
  }
}

function whenLabel(e) {
  const today = state.status?.today || iso(new Date());
  if (e.date === today) {
    const now = nowHHMM();
    if (e.start <= now && now < e.end) return "En ce moment";
    if (e.start >= "18:00") return "Ce soir";
    return e.start >= "12:00" ? "Cet après-midi" : "Ce matin";
  }
  if (e.date === addDays(today, 1)) return "Demain";
  const d = parse(e.date);
  return `${dayName(e.date)} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function renderTonight() {
  const list = state.tonight || [];
  const el = $("#tonight");
  if (!list.length) {
    el.innerHTML = `<div class="empty-tonight">
      <h1>Rien de prévu pour l'instant</h1>
      <p class="muted">Soirée sans écran… ou une petite surprise ?</p>
      <button class="btn big" data-goto="surprise">${icon("surprise")}Surprends-moi</button>
    </div>`;
    return;
  }
  const [e, ...rest] = list;
  const it = e.item;
  const bg = it.poster ? `background-image:url('${esc(it.poster)}')` : `background:${fakeBg(it)}`;
  const eps = (e.episodes || []).map((ep) => `<li><b>${ep.code}</b>${ep.name ? " · " + esc(ep.name) : ""}</li>`).join("");
  const later = rest.slice(0, 3);
  el.innerHTML = `
    <section class="hero big">
      <div class="hero-bg" style="${bg}"></div>
      <div class="hero-inner">
        ${cover(it)}
        <div class="hero-text">
          <p class="kicker">${whenLabel(e)} · ${e.start} – ${e.end}</p>
          <div class="badges"><span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span><span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span>${ageLabel(it) ? `<span class="badge">${ageLabel(it)}</span>` : ""}</div>
          <h1>${esc(it.title)}</h1>
          <p class="meta">${esc(metaLine(it, { age: false }))}</p>
          ${eps ? `<ul class="eps">${eps}</ul>` : ""}
          ${e.reason ? `<p class="reason">${esc(e.reason)}</p>` : ""}
          ${it.overview ? `<p class="overview">${esc(it.overview)}</p>` : ""}
          <div class="hero-actions">
            ${watchButton(e, "btn big")}
            <button class="btn big secondary" data-t-swap="${e.id}" data-week="${weekOf(e.date)}">${icon("swap")}Autre idée</button>
            <button class="btn big ghost" data-t-skip="${e.id}" data-week="${weekOf(e.date)}">${icon("moon")}Pas ce soir</button>
          </div>
        </div>
      </div>
    </section>
    ${later.length ? `<div class="later-head"><h2>Ensuite</h2><button class="mini" data-goto="week">Toute la semaine ${icon("right")}</button></div>
    <div class="later">${later.map((x) => `
      <div class="later-card ${x.audience}">
        ${cover(x.item)}
        <div>
          <p class="kicker">${whenLabel(x)} · ${x.start}</p>
          <b>${esc(x.item.title)}</b>
          <span class="meta">${esc(AUDIENCE[x.audience])}${x.episodes?.length ? " · " + x.episodes[0].code : ""}</span>
        </div>
      </div>`).join("")}</div>` : ""}
    ${"wakeLock" in navigator ? `<button class="mini wake" id="wake">${icon("sun")}<span>Garder l'écran allumé</span></button>` : ""}`;
  updateWakeButton();
}

$("#tonight").addEventListener("click", async (ev) => {
  const swap = ev.target.closest("[data-t-swap]");
  const skip = ev.target.closest("[data-t-skip]");
  if (ev.target.closest("#wake")) { toggleWakeLock(); return; }
  if (!swap && !skip) return;
  const btn = swap || skip;
  btn.disabled = true;
  try {
    if (swap) await api(`/api/plan/swap?week=${btn.dataset.week}&entry=${btn.dataset.tSwap}`, { method: "POST" });
    else {
      await api(`/api/plan/entry?week=${btn.dataset.week}&entry=${btn.dataset.tSkip}`, { method: "DELETE" });
      toast("D'accord, pas ce soir.");
    }
    state.plan = null;
    await loadTonight();
  } catch (e) {
    toast("Oups : " + e.message);
    btn.disabled = false;
  }
});

/* Écran toujours allumé (iPad posé dans la cuisine, par exemple) */
let wakeLock = null;
let wakeWanted = false;
async function toggleWakeLock() {
  wakeWanted = !wakeLock;
  if (wakeLock) releaseWakeLock(); else await requestWakeLock();
  updateWakeButton();
}
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; updateWakeButton(); });
  } catch { toast("L'écran ne peut pas rester allumé sur cet appareil."); }
}
function releaseWakeLock() {
  wakeLock?.release();
  wakeLock = null;
}
function updateWakeButton() {
  const b = $("#wake");
  if (!b) return;
  b.classList.toggle("on", !!wakeLock);
  $("span", b).textContent = wakeLock ? "Écran allumé (toucher pour arrêter)" : "Garder l'écran allumé";
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeWanted && !wakeLock && !$("#view-tonight").hidden) requestWakeLock().then(updateWakeButton);
});

/* ---------- Apple TV ---------- */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-atv]");
  if (!b) return;
  const a = JSON.parse(b.dataset.atv);
  $("#atv-title").textContent = a.title;
  $("#atv-where").textContent = a.where.replace(/^Infuse → /, "");
  $("#atv-ep").textContent = a.episode;
  $("#atv-ep-row").hidden = !a.episode;
  $("#atv-dialog").showModal();
});

/* ---------- calendrier ---------- */
$("#open-cal").onclick = () => {
  $("#cal-url").value = state.status?.calendar_url || "";
  $("#webcal-link").href = state.status?.webcal_url || "#";
  $("#cal-dialog").showModal();
};
$("#copy-cal").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("#cal-url").value);
    toast("Lien copié");
  } catch {
    $("#cal-url").select();
  }
};

/* ---------- Surprends-moi ---------- */
async function loadShelves() {
  $("#shelves").innerHTML = `<div class="loading">On cherche des idées…</div>`;
  state.shelves = await api("/api/surprise");
  $("#shelves").innerHTML = state.shelves.map((s) => `
    <section class="slider">
      <div class="slider-head"><h2>${esc(s.title)}</h2><span>${esc(s.subtitle)}</span></div>
      ${s.items.length ? `<div class="slider-row">${s.items.map((it, i) => `
        <button class="title-card" data-shelf="${s.key}" data-i="${i}" aria-label="${esc(it.title)}">
          ${cover(it, { type: true, seen: neverSeen(it.reason), over: `<div class="over"><small>${it.year || ""}${it.kind === "film" ? " · " + dur(it.runtime || 0) : ""}</small><b>${esc(it.title)}</b><i>${esc(it.overview || (it.genres || []).slice(0, 3).map(fr).join(", "))}</i></div>` })}
        </button>`).join("")}</div>` : `<p class="hint">Rien ne correspond pour l'instant.</p>`}
    </section>`).join("");
}
$("#reshuffle").onclick = loadShelves;

$("#shelves").addEventListener("click", (ev) => {
  const card = ev.target.closest(".title-card");
  if (!card) return;
  const shelf = state.shelves.find((s) => s.key === card.dataset.shelf);
  const it = shelf.items[+card.dataset.i];
  state.pick = { item: it, audience: shelf.audience === "famille" ? "famille" : "adultes" };
  $("#pick-backdrop").style.background = it.poster ? `center/cover url('${it.poster}')` : fakeBg(it);
  $("#pick-cover").innerHTML = cover(it);
  $("#pick-badges").innerHTML = `<span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span>${neverSeen(it.reason) ? `<span class="badge ok">Jamais vu</span>` : ""}`;
  $("#pick-title").textContent = it.title;
  $("#pick-meta").textContent = metaLine(it);
  $("#pick-reason").textContent = it.reason || "";
  $("#pick-reason").hidden = !it.reason || neverSeen(it.reason) && it.reason === "Jamais vu";
  $("#pick-overview").textContent = it.overview || "";
  $("#pick-overview").hidden = !it.overview;
  $("#pick-date").value = state.status?.today || iso(new Date());
  $("#pick-time").innerHTML = timeOptions(state.pick.audience === "famille" ? "18:30" : "21:00");
  $("#pick-dialog").showModal();
});

$("#pick-dialog").addEventListener("close", async () => {
  if ($("#pick-dialog").returnValue !== "ok" || !state.pick) return;
  const date = $("#pick-date").value;
  try {
    await api("/api/plan/add", {
      method: "POST",
      body: JSON.stringify({ uid: state.pick.item.uid, date, start: readTime($("#pick-time").value), audience: state.pick.audience }),
    });
    const d = parse(date);
    toast(`« ${state.pick.item.title} » programmé ${dayName(date).toLowerCase()} ${d.getDate()} ${MONTHS[d.getMonth()]}`);
    await loadWeek(date);
  } catch (e) {
    toast("Oups : " + e.message);
  }
});

/* ---------- à venir ---------- */
async function loadUpcoming() {
  $("#upcoming").innerHTML = `<div class="loading">Chargement…</div>`;
  const list = await api("/api/upcoming");
  if (!list.length) {
    $("#upcoming").innerHTML = `<p class="hint">Rien d'annoncé pour les trois prochaines semaines.</p>`;
    return;
  }
  const groups = {};
  list.forEach((u) => (groups[u.date] ||= []).push(u));
  $("#upcoming").innerHTML = Object.entries(groups).map(([date, items]) => {
    const d = parse(date);
    return `<div><div class="day-head"><span>${dayName(date)} ${d.getDate()} ${MONTHS[d.getMonth()]}</span></div>
      <div class="up-list">${items.map((u) => `<div class="up-item">${cover(u)}<div class="txt"><strong>${esc(u.title)}</strong><span class="meta">${esc(u.detail)}</span></div>
      <span class="badge ${u.available ? "ok" : u.kind}">${u.available ? "Disponible" : u.kind === "film" ? "Film" : "Épisode"}</span></div>`).join("")}</div>
    </div>`;
  }).join("");
}

/* ---------- réglages ---------- */
const TIMES = [];
for (let h = 6; h < 24; h++) for (const m of ["00", "15", "30", "45"]) TIMES.push(`${String(h).padStart(2, "0")}:${m}`);
function timeOptions(value) {
  const list = TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return list.map((t) => `<option ${t === value ? "selected" : ""}>${t.replace(":", " h ")}</option>`).join("");
}
const readTime = (v) => v.replace(" h ", ":");

async function loadSettings() {
  renderAccount();
  if (!isAdmin()) return;
  loadUsers();
  const [meta, status] = await Promise.all([api("/api/settings"), api("/api/status")]);
  state.status = status;
  state.meta = meta;
  state.settings = structuredClone(meta.settings);
  const s = state.settings;
  renderSideStatus();

  loadConnections();

  $("#s-children").value = s.children_ages.join(", ");
  $("#s-age-family").value = s.max_age_family;
  $("#s-age-kids").value = s.max_age_kids;
  $("#s-eps").value = s.series_max_episodes;
  $("#s-rewatch").value = Math.round(s.rewatch_after_days / 365);
  $("#s-reminder").value = s.reminder_minutes;
  renderGenres();
  renderWeekEditor();
  renderWatching();
}

const PLAYER_HINTS = {
  jellyfin: "▶ Regarder ouvre le titre dans Jellyfin (au bon épisode pour une série en cours).",
  infuse: "▶ Regarder ouvre Infuse sur le téléphone ou l'iPad, au bon film ou au bon épisode. Infuse doit être relié à votre Jellyfin.",
  appletv: "Une page web ne peut pas lancer un film sur l'Apple TV. Le bouton devient « Sur l'Apple TV » et rappelle où trouver le titre dans Infuse. Activez la collection ci-dessous : les titres de la semaine y seront rassemblés.",
};
function renderWatching() {
  const s = state.settings;
  $("#s-player").innerHTML = options(state.meta.players, s.player);
  $("#player-hint").textContent = PLAYER_HINTS[s.player] || "";
  $("#s-sync").checked = !!s.sync_collection;
  $("#coll-name").textContent = `« ${state.meta.collection_name} »`;
  api("/api/wall-link").then((r) => {
    $("#wall-url").value = r.url;
    $("#open-wall").href = r.url;
  }).catch(() => {});
}
$("#s-player").addEventListener("change", (ev) => {
  state.settings.player = ev.target.value;
  $("#player-hint").textContent = PLAYER_HINTS[ev.target.value] || "";
  if (ev.target.value === "appletv" && !state.settings.sync_collection) {
    state.settings.sync_collection = true;
    $("#s-sync").checked = true;
  }
});
$("#s-sync").addEventListener("change", (ev) => (state.settings.sync_collection = ev.target.checked));
$("#sync-now").onclick = async () => {
  try { toast("Collection : " + (await api("/api/collection/sync", { method: "POST" })).message); }
  catch (e) { toast(e.message); }
};
$("#copy-wall").onclick = async () => {
  try { await navigator.clipboard.writeText($("#wall-url").value); toast("Lien copié"); } catch { $("#wall-url").select(); }
};
$("#reset-wall").onclick = async () => {
  if (!confirm("Créer un nouveau lien ? Les écrans qui utilisent l'ancien afficheront « lien invalide ».")) return;
  const r = await api("/api/wall-link/reset", { method: "POST" });
  $("#wall-url").value = r.url;
  $("#open-wall").href = r.url;
  toast("Nouveau lien créé");
};

function renderGenres() {
  const s = state.settings;
  const all = [...new Set([...state.meta.genres, ...s.liked_genres, ...s.avoided_genres])].sort((a, b) => fr(a).localeCompare(fr(b)));
  $("#s-genres").innerHTML = all.map((g) => {
    const cls = s.liked_genres.includes(g) ? "liked" : s.avoided_genres.includes(g) ? "avoided" : "";
    return `<button type="button" class="chip ${cls}" data-genre="${esc(g)}">${esc(fr(g))}</button>`;
  }).join("") || `<p class="hint">Les genres apparaîtront quand la bibliothèque sera chargée.</p>`;
}
$("#s-genres").addEventListener("click", (ev) => {
  const chip = ev.target.closest("[data-genre]");
  if (!chip) return;
  const g = chip.dataset.genre, s = state.settings;
  if (s.liked_genres.includes(g)) {
    s.liked_genres = s.liked_genres.filter((x) => x !== g);
    s.avoided_genres.push(g);
  } else if (s.avoided_genres.includes(g)) {
    s.avoided_genres = s.avoided_genres.filter((x) => x !== g);
  } else s.liked_genres.push(g);
  renderGenres();
});

function options(map, value) {
  return Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === value ? "selected" : ""}>${esc(v)}</option>`).join("");
}

function renderWeekEditor() {
  const { audiences, kinds } = state.meta;
  $("#s-week").innerHTML = state.settings.week.map((day, di) => `
    <div class="ed-day">
      <div class="ed-day-head"><b>${DAYS[di]}</b><button type="button" class="mini" data-add="${di}">+ Créneau</button></div>
      <div class="slots">
      ${day.slots.length ? `<div class="slot slot-legend"><span>Heure</span><span>Max (min)</span><span>Pour qui</span><span>Quoi</span><span>Nom</span><span></span></div>` : `<span class="nofree">Soirée sans écran</span>`}
      ${day.slots.map((sl, si) => `
        <div class="slot" data-d="${di}" data-s="${si}">
          <select data-k="start" aria-label="Heure">${timeOptions(sl.start)}</select>
          <input type="number" data-k="max_minutes" min="10" max="300" step="5" value="${sl.max_minutes}" aria-label="Durée maximum en minutes">
          <select data-k="audience" aria-label="Pour qui">${options(audiences, sl.audience)}</select>
          <select data-k="kind" aria-label="Quoi">${options(kinds, sl.kind)}</select>
          <input class="name" type="text" data-k="label" value="${esc(sl.label)}" placeholder="Nom du créneau" aria-label="Nom du créneau">
          <button type="button" class="x" data-del="${di}-${si}" aria-label="Supprimer ce créneau">${icon("x")}</button>
        </div>`).join("")}
      </div>
    </div>`).join("");
}

const onSlotEdit = (ev) => {
  const row = ev.target.closest(".slot[data-d]");
  if (!row || !ev.target.dataset.k) return;
  const sl = state.settings.week[+row.dataset.d].slots[+row.dataset.s];
  const k = ev.target.dataset.k;
  sl[k] = k === "max_minutes" ? +ev.target.value : k === "start" ? readTime(ev.target.value) : ev.target.value;
};
$("#s-week").addEventListener("input", onSlotEdit);
$("#s-week").addEventListener("change", onSlotEdit);
$("#s-week").addEventListener("click", (ev) => {
  const add = ev.target.closest("[data-add]");
  const del = ev.target.closest("[data-del]");
  if (add) {
    state.settings.week[+add.dataset.add].slots.push({ start: "21:00", max_minutes: 60, audience: "adultes", kind: "any", label: "" });
    renderWeekEditor();
  } else if (del) {
    const [d, s] = del.dataset.del.split("-").map(Number);
    state.settings.week[d].slots.splice(s, 1);
    renderWeekEditor();
  }
});

$("#save").onclick = async () => {
  const s = state.settings;
  s.children_ages = $("#s-children").value.split(/[,; ]+/).filter(Boolean).map(Number).filter((n) => !isNaN(n));
  s.max_age_family = +$("#s-age-family").value;
  s.max_age_kids = +$("#s-age-kids").value;
  s.series_max_episodes = +$("#s-eps").value || 1;
  s.rewatch_after_days = Math.round(+$("#s-rewatch").value * 365);
  s.reminder_minutes = +$("#s-reminder").value;
  $("#save").disabled = true;
  try {
    const res = await api("/api/settings", { method: "PUT", body: JSON.stringify(s) });
    state.settings = res.settings;
    renderWeekEditor();
    // on refait la semaine prochaine pour qu'elle tienne compte des nouveaux réglages
    await api(`/api/plan/regenerate?week=${addDays(state.week || state.status.today, 7)}`, { method: "POST" });
    toast("Réglages enregistrés. La semaine prochaine a été refaite ; pour celle-ci, utilisez « Nouveau programme ».");
  } catch (e) {
    toast("Oups : " + e.message);
  } finally {
    $("#save").disabled = false;
  }
};

/* ---------- connexions ---------- */
function renderConnections(conn, services) {
  for (const svc of ["radarr", "sonarr", "jellyfin"]) {
    const card = $(`.service-card[data-svc="${svc}"]`);
    const c = conn[svc], info = services[svc];
    $('[data-k="url"]', card).value = c.url || "";
    const key = $('[data-k="key"]', card);
    key.value = "";
    key.placeholder = c.has_key ? `Clé enregistrée (${c.key_hint}) : laissez vide pour la garder` : "Collez la clé API ici";
    $(".dot", card).className = `dot ${info.ok ? "ok" : info.configured ? "ko" : ""}`;
    $("[data-status]", card).textContent = info.message;
  }
  state.jfUser = conn.jellyfin_user || "";
  $("#jf-web").value = conn.jellyfin_web_url || "";
}

async function loadJellyfinUsers() {
  const sel = $("#jf-user");
  const users = await api("/api/jellyfin/users").catch(() => []);
  const current = state.jfUser;
  const names = [...new Set([...users, ...(current ? [current] : [])])];
  sel.innerHTML = `<option value="">Le premier administrateur</option>` +
    names.map((n) => `<option ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("");
}

async function loadConnections() {
  const res = await api("/api/connections");
  renderConnections(res.connections, res.services);
  loadJellyfinUsers();
}

$("#save-conn").onclick = async () => {
  const body = { jellyfin_user: $("#jf-user").value, jellyfin_web_url: $("#jf-web").value.trim() };
  for (const card of $$(".service-card")) {
    body[card.dataset.svc] = { url: $('[data-k="url"]', card).value.trim(), key: $('[data-k="key"]', card).value.trim() };
  }
  const btn = $("#save-conn");
  btn.disabled = true;
  btn.lastChild.textContent = "Test en cours…";
  try {
    const res = await api("/api/connections", { method: "PUT", body: JSON.stringify(body) });
    renderConnections(res.connections, res.services);
    await loadJellyfinUsers();
    state.status = await api("/api/status");
    renderSideStatus();
    const ok = Object.values(res.services).filter((x) => x.ok).length;
    const configured = Object.values(res.services).filter((x) => x.configured).length;
    toast(configured === 0 ? "Enregistré. Mode découverte."
      : ok === configured ? "Connexions enregistrées et testées ✓"
      : "Enregistré, mais une connexion ne répond pas : voir le message rouge.");
    state.shelves = [];
    await loadWeek();
  } catch (e) {
    toast("Oups : " + e.message);
  } finally {
    btn.disabled = false;
    btn.lastChild.textContent = "Enregistrer et tester";
  }
};

document.addEventListener("click", (ev) => {
  const go = ev.target.closest("[data-goto]");
  if (go) { ev.preventDefault(); show(go.dataset.goto); }
});

/* ---------- comptes ---------- */
function renderAccount() {
  const u = state.user;
  if (!u) return;
  $("#user-name").textContent = u.username;
  $("#user-role").textContent = u.role_label;
  $("#user-avatar").textContent = u.username.slice(0, 1).toUpperCase();
  $("#me-line").textContent = `Connecté en tant que ${u.username} (${u.role_label.toLowerCase()}).`;
  document.body.classList.toggle("is-admin", isAdmin());
  $("#settings-sub").textContent = isAdmin()
    ? "Votre compte, les comptes de la famille, les connexions et la semaine type."
    : "Votre compte. Les réglages du programme sont gérés par un administrateur.";
  $$('[data-view="settings"]').forEach((b) => (b.lastChild.textContent = isAdmin() ? "Réglages" : "Mon compte"));
  $("#view-settings .page-head h1").textContent = isAdmin() ? "Réglages" : "Mon compte";
}

async function loadUsers() {
  const { users } = await api("/api/users");
  renderUsers(users);
}

function renderUsers(users) {
  $("#users-list").innerHTML = users.map((u) => `
    <div class="user-row" data-id="${u.id}">
      <span class="avatar">${esc(u.username.slice(0, 1).toUpperCase())}</span>
      <b>${esc(u.username)}${u.id === state.user.id ? ' <small class="muted">(vous)</small>' : ""}</b>
      <select data-role ${u.id === state.user.id ? "disabled" : ""} aria-label="Rôle de ${esc(u.username)}">
        <option value="famille" ${u.role === "famille" ? "selected" : ""}>Famille</option>
        <option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrateur</option>
      </select>
      ${u.id === state.user.id ? "<span></span><span></span>" : `
      <button type="button" class="mini" data-reset>Nouveau mot de passe</button>
      <button type="button" class="mini danger" data-delete aria-label="Supprimer ${esc(u.username)}">${icon("x")}</button>`}
    </div>`).join("");
}

$("#users-list").addEventListener("change", async (ev) => {
  const sel = ev.target.closest("[data-role]");
  if (!sel) return;
  const id = sel.closest(".user-row").dataset.id;
  try {
    renderUsers((await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify({ role: sel.value }) })).users);
    toast("Rôle modifié");
  } catch (e) { toast(e.message); loadUsers(); }
});

$("#users-list").addEventListener("click", async (ev) => {
  const row = ev.target.closest(".user-row");
  if (!row) return;
  const id = row.dataset.id, name = $("b", row).textContent;
  try {
    if (ev.target.closest("[data-reset]")) {
      const pw = prompt(`Nouveau mot de passe pour ${name} (6 caractères minimum) :`);
      if (!pw) return;
      await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify({ password: pw }) });
      toast(`Mot de passe de ${name} changé. Ses appareils devront se reconnecter.`);
    } else if (ev.target.closest("[data-delete]")) {
      if (!confirm(`Supprimer le compte de ${name} ?`)) return;
      renderUsers((await api(`/api/users/${id}`, { method: "DELETE" })).users);
      toast("Compte supprimé");
    }
  } catch (e) { toast(e.message); }
});

$("#user-add").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    const res = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ username: $("#nu-name").value, password: $("#nu-pass").value, role: $("#nu-role").value }),
    });
    renderUsers(res.users);
    toast(`Compte « ${$("#nu-name").value.trim()} » créé`);
    $("#user-add").reset();
  } catch (e) { toast(e.message); }
});

$("#pw-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if ($("#pw-new").value !== $("#pw-confirm").value) { toast("Les deux nouveaux mots de passe ne correspondent pas."); return; }
  try {
    await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current: $("#pw-current").value, password: $("#pw-new").value }) });
    $("#pw-form").reset();
    toast("Mot de passe changé. Vos autres appareils devront se reconnecter.");
  } catch (e) { toast(e.message); }
});

async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  showAuth("login");
}
$("#logout").onclick = logout;
$("#logout2").onclick = logout;

/* ---------- écran de connexion ---------- */
function showAuth(mode, message = "") {
  state.authMode = mode;
  const setup = mode === "setup";
  $("#app").hidden = true;
  $("#bottom-nav").hidden = true;
  $("#auth").hidden = false;
  $("#auth-title").textContent = setup ? "Bienvenue !" : "Connexion";
  $("#auth-sub").textContent = setup
    ? "Créez le compte administrateur. Vous pourrez ensuite ajouter un compte pour chaque membre de la famille."
    : "Connectez-vous pour voir le programme de la famille.";
  $("#auth-confirm-row").hidden = !setup;
  $("#auth-confirm").required = setup;
  $("#auth-pass").autocomplete = setup ? "new-password" : "current-password";
  $("#auth-btn").textContent = setup ? "Créer le compte" : "Se connecter";
  $("#auth-error").textContent = message;
  $("#auth-error").hidden = !message;
  $("#auth-pass").value = "";
  $("#auth-confirm").value = "";
  setTimeout(() => $("#auth-user").focus(), 50);
}

$("#auth-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const setup = state.authMode === "setup";
  const err = $("#auth-error");
  err.hidden = true;
  if (setup && $("#auth-pass").value !== $("#auth-confirm").value) {
    err.textContent = "Les deux mots de passe ne correspondent pas.";
    err.hidden = false;
    return;
  }
  $("#auth-btn").disabled = true;
  try {
    const res = await api(setup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#auth-user").value, password: $("#auth-pass").value }),
    });
    state.user = res.user;
    await startApp();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    $("#auth-btn").disabled = false;
  }
});

/* ---------- démarrage ---------- */
async function startApp() {
  $("#auth").hidden = true;
  $("#app").hidden = false;
  $("#bottom-nav").hidden = false;
  renderAccount();
  try {
    state.status = await api("/api/status");
    renderSideStatus();
  } catch {
    state.status = null;
  }
  const view = location.hash.slice(1);
  show(["week", "surprise", "upcoming", "settings"].includes(view) ? view : "tonight");
  if (view === "week") await loadWeek();
  else loadWeek();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

(async function init() {
  const st = await api("/api/auth/state");
  if (st.user) {
    state.user = st.user;
    await startApp();
  } else {
    showAuth(st.setup_needed ? "setup" : "login");
  }
})();
