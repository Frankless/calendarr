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

const state = { status: null, week: null, plan: null, settings: null, meta: null, pick: null, shelves: [] };

/* ---------- utilitaires ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fr = (g) => GENRES_FR[g] || g;
const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (isoDate, n) => { const d = parse(isoDate); d.setDate(d.getDate() + n); return iso(d); };
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);
const dayName = (isoDate) => DAYS[(parse(isoDate).getDay() + 6) % 7];

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

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

function metaLine(item) {
  const parts = [];
  if (item.year) parts.push(item.year);
  parts.push(item.kind === "film" ? dur(item.runtime || 0) : `épisodes de ${item.runtime || "?"} min`);
  const g = (item.genres || []).slice(0, 2).map(fr).join(", ");
  if (g) parts.push(g);
  if (item.cert) parts.push(item.cert);
  return parts.join(" · ");
}
const neverSeen = (reason) => (reason || "").startsWith("Jamais vu");

/* ---------- navigation ---------- */
function show(view) {
  $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === "surprise" && !state.shelves.length) loadShelves();
  if (view === "upcoming") loadUpcoming();
  if (view === "settings") loadSettings();
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0 });
}
$$("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
$(".logo").addEventListener("click", (e) => { e.preventDefault(); show("week"); });

function renderSideStatus() {
  const s = state.status;
  if (!s) return;
  $("#side-status").innerHTML = s.demo
    ? `<div><span class="dot"></span>Mode découverte</div>`
    : Object.entries(s.services).map(([n, i]) =>
        `<div><span class="dot ${i.ok ? "ok" : i.configured ? "ko" : ""}"></span>${n[0].toUpperCase() + n.slice(1)}</div>`).join("");
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

function nextUp() {
  const today = state.status?.today || iso(new Date());
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return state.plan.entries.find((e) => e.item && (e.date > today || (e.date === today && e.end > hhmm)));
}

function renderHero() {
  const e = nextUp();
  if (!e) { $("#hero").innerHTML = ""; return; }
  const it = e.item;
  const today = state.status?.today || iso(new Date());
  const when = e.date === today ? (e.start >= "18:00" ? "Ce soir" : "Aujourd'hui") : e.date === addDays(today, 1) ? "Demain" : dayName(e.date);
  const bg = it.poster ? `background-image:url('${esc(it.poster)}')` : `background:${fakeBg(it)}`;
  const eps = (e.episodes || []).map((ep) => `<li><b>${ep.code}</b>${ep.name ? " · " + esc(ep.name) : ""}</li>`).join("");
  $("#hero").innerHTML = `<section class="hero">
    <div class="hero-bg" style="${bg}"></div>
    <div class="hero-inner">
      ${cover(it)}
      <div>
        <p class="kicker">${when} · ${e.start}</p>
        <div class="badges"><span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span><span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span>${e.label ? `<span class="badge">${esc(e.label)}</span>` : ""}</div>
        <h2>${esc(it.title)}${it.year ? `<small>(${it.year})</small>` : ""}</h2>
        <p class="meta">${esc(metaLine(it))}</p>
        ${eps ? `<ul class="eps">${eps}</ul>` : ""}
        ${e.reason ? `<p class="reason">${esc(e.reason)}</p>` : ""}
      </div>
    </div>
  </section>`;
}

function renderWeek() {
  const plan = state.plan;
  const today = state.status?.today || iso(new Date());
  $("#week-title").textContent = weekTitle(plan.week);
  const warn = (plan.warnings || []).join(" · ");
  const banner = $("#banner");
  if (state.status?.demo) {
    banner.innerHTML = `<b>Mode découverte.</b> Radarr et Sonarr ne sont pas encore branchés : vous voyez une bibliothèque d'exemple. <a href="#settings" data-goto="settings">Ajoutez leurs adresses et clés API dans Réglages → Connexions</a>.`;
    banner.hidden = false;
  } else if (warn) {
    banner.innerHTML = `<b>Attention :</b> ${esc(warn)}`;
    banner.hidden = false;
  } else banner.hidden = true;

  renderHero();
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
        <button class="mini" data-swap="${e.id}" title="Proposer autre chose">${icon("swap")}Autre idée</button>
        <button class="mini danger" data-remove="${e.id}" title="Retirer du programme">${icon("x")}Retirer</button>
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
      toast("Retiré du programme");
    }
    renderWeek();
  } catch (e) {
    toast("Oups : " + e.message);
    btn.disabled = false;
  }
});

$("#prev-week").onclick = () => loadWeek(addDays(state.week, -7));
$("#next-week").onclick = () => loadWeek(addDays(state.week, 7));
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
}

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
  const body = { jellyfin_user: $("#jf-user").value };
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

/* ---------- démarrage ---------- */
(async function init() {
  try {
    state.status = await api("/api/status");
    renderSideStatus();
  } catch {
    state.status = null;
  }
  await loadWeek();
  const view = location.hash.slice(1);
  if (["surprise", "upcoming", "settings"].includes(view)) show(view);
})();
