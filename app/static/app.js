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
  return "linear-gradient(160deg,#3a342e,#26221e)";
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
  $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === (view === "compose" ? "week" : view)));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === "tonight") loadTonight();
  if (view === "week" && state.plan) renderWeek();
  if (view === "week") requestAnimationFrame(scrollToToday);
  if (view !== "tonight") releaseWakeLock();
  if (view === "surprise") loadDeck();
  if (view === "upcoming") loadUpcoming();
  if (view === "compose") loadCompose(state.week && state.week >= composeWeekStart(0) ? state.week : composeWeekStart(0));
  if (view === "series") { if (state.series) renderSeries(); loadSeries(); }
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
    if (!$("#view-week").hidden) requestAnimationFrame(scrollToToday);
  } catch (e) {
    $("#week").innerHTML = `<div class="loading">Impossible de charger le programme : ${esc(e.message)}</div>`;
  }
}

function scrollToToday() {
  const t = $("#week .day.today");
  if (t && !$("#view-week").hidden) t.scrollIntoView({ block: "start", behavior: "instant" });
  if (t) window.scrollBy(0, -16);
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
  const past = [], rest = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(plan.week, i);
    const d = parse(day);
    const entries = plan.entries.filter((e) => e.date === day);
    const cls = day === today ? "today" : day < today ? "past" : "";
    const html = `<article class="day ${cls}" data-day="${day}">
      <div class="day-head"><span>${DAYS[i]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}</span></div>
      <div class="day-items">${entries.length ? entries.map(renderEntry).join("") : `<div class="free">${FREE_LINES[(d.getDate() + i) % FREE_LINES.length]}</div>`}</div>
    </article>`;
    (day < today ? past : rest).push(html);
  }
  // Les jours passés sont repliés : la semaine s'ouvre sur aujourd'hui.
  const n = past.length;
  const folded = n ? `<details class="past-days"${state.showPast ? " open" : ""}>
      <summary>${n === 1 ? "Le jour passé" : `Les ${n} jours passés`} <span class="muted">${DAYS[0].toLowerCase()} → ${DAYS[n - 1].toLowerCase()}</span></summary>
      <div class="week">${past.join("")}</div>
    </details>` : "";
  $("#week").innerHTML = folded + rest.join("");
  const pd = $("#week .past-days");
  if (pd) pd.addEventListener("toggle", () => (state.showPast = pd.open));
}

function watchButton(e, cls) {
  if (e.appletv) {
    return `<button type="button" class="${cls}" data-atv='${esc(JSON.stringify(e.appletv))}' title="Comment le lancer sur l'Apple TV">${icon("play")}Sur l'Apple TV</button>`;
  }
  if (!e.watch_url) return "";
  return `<a class="${cls}" href="${esc(e.watch_url)}" target="_blank" rel="noopener" title="Ouvrir dans Jellyfin">${icon("play")}Regarder</a>`;
}

/* « On l'a vu » (aujourd'hui ou avant) ou « Déjà vu » (à venir) */
function seenButton(e, cls) {
  const today = state.status?.today || iso(new Date());
  if (e.date > today) {
    return `<button class="${cls}" data-seen="${e.id}" data-week="${weekOf(e.date)}" title="Vous l'avez déjà vu : on propose autre chose">${icon("eye")}Déjà vu</button>`;
  }
  return e.watched
    ? `<button class="${cls} on" data-seen="${e.id}" data-week="${weekOf(e.date)}" title="Toucher pour annuler">${icon("check")}Vu</button>`
    : `<button class="${cls}" data-seen="${e.id}" data-week="${weekOf(e.date)}" title="Coché aussi dans Jellyfin">${icon("check")}On l'a vu</button>`;
}

/* « Autre idée » : plusieurs propositions pour ce créneau, au choix */
state.alt = null;
async function openAlternatives(week, entryId, { afterSeen = false } = {}) {
  state.alt = { week, entryId };
  const dlg = $("#alt-dialog");
  $("#alt-title").textContent = afterSeen ? "Vu ! On regarde autre chose ?" : "Autre chose ?";
  $("#alt-sub").textContent = "";
  $("#alt-list").innerHTML = `<p class="muted">Je cherche des idées…</p>`;
  if (!dlg.open) dlg.showModal();
  try {
    const res = await api(`/api/plan/alternatives?week=${week}&entry=${entryId}`);
    const e = res.entry;
    if (e) {
      const d = parse(e.date);
      $("#alt-sub").textContent = `${dayName(e.date)} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} à ${e.start.replace(":", " h ")} · ${AUDIENCE[e.audience]}${e.label ? " · " + e.label : ""}`;
    }
    $("#alt-list").innerHTML = res.items.length
      ? res.items.map((it) => `<button type="button" class="alt-item" data-uid="${esc(it.uid)}">
          ${cover(it)}
          <span class="alt-text"><b>${esc(it.title)}</b><small>${esc(metaLine(it))}</small>${it.reason ? `<em>${esc(it.reason)}</em>` : ""}</span>
        </button>`).join("")
      : `<p class="muted">Rien d'autre ne convient à ce créneau dans la bibliothèque.</p>`;
  } catch (err) {
    $("#alt-list").innerHTML = `<p class="muted">Impossible de charger les idées : ${esc(err.message)}</p>`;
  }
}

async function afterPlanChange(res) {
  $("#alt-dialog").close();
  state.plan = null;
  if (!$("#view-week").hidden) {
    if (res && res.week === state.week) { state.plan = res; renderWeek(); } else await loadWeek(state.week);
  } else await loadTonight();
}

$("#alt-list").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-uid]");
  if (!b || !state.alt) return;
  $$("#alt-list button").forEach((x) => (x.disabled = true));
  try {
    const res = await api("/api/plan/replace", { method: "POST", body: JSON.stringify({ week: state.alt.week, entry: state.alt.entryId, uid: b.dataset.uid }) });
    toast(`« ${$("b", b).textContent} » est au programme.`);
    await afterPlanChange(res);
  } catch (err) {
    toast("Oups : " + err.message);
    $$("#alt-list button").forEach((x) => (x.disabled = false));
  }
});
$("#alt-random").onclick = async () => {
  if (!state.alt) return;
  $("#alt-random").disabled = true;
  try {
    const res = await api(`/api/plan/swap?week=${state.alt.week}&entry=${state.alt.entryId}`, { method: "POST" });
    const e = res.entries.find((x) => x.id === state.alt.entryId);
    toast(e?.item ? `« ${e.item.title} » est au programme.` : "Rien d'autre ne convient pour ce créneau.");
    await afterPlanChange(res);
  } catch (err) {
    toast("Oups : " + err.message);
  } finally {
    $("#alt-random").disabled = false;
  }
};
$("#alt-close").onclick = () => $("#alt-dialog").close();

async function markSeen(btn) {
  btn.disabled = true;
  try {
    const res = await api(`/api/plan/watched?week=${btn.dataset.week}&entry=${btn.dataset.seen}`, { method: "POST" });
    toast(res.message);
    const e = res.entries.find((x) => x.id === res.entry);
    if (res.film && e && (e.watched || e.date > (state.status?.today || ""))) {
      setTimeout(() => openAlternatives(btn.dataset.week, res.entry, { afterSeen: true }), 150);
    }
    return res;
  } catch (e) {
    toast("Oups : " + e.message);
    btn.disabled = false;
    return null;
  }
}

/* Une seule action visible : « Regarder » (aujourd'hui et à venir). Le reste est dans « … ».
   Un jour passé ne propose que de cocher « Vu ». */
function cardActions(e) {
  const today = state.status?.today || iso(new Date());
  if (e.date < today || e.watched) return seenButton(e, "mini seen-btn");
  const main = e.confirmed
    ? watchButton(e, "mini play")
    : `<button class="mini keep" data-confirm="${e.id}" data-week="${weekOf(e.date)}" title="Ajouter au programme (et au calendrier)">${icon("check")}On le garde</button>`;
  return `${main}
    <div class="card-menu">
      <button class="mini more" data-menu aria-label="Plus d'actions" aria-haspopup="true">${icon("more")}</button>
      <div class="menu" role="menu">
        <button data-swap="${e.id}" role="menuitem">${icon("swap")}Autre idée</button>
        ${seenButton(e, "")}
        ${e.confirmed ? `<button data-unconfirm="${e.id}" data-week="${weekOf(e.date)}" role="menuitem">${icon("swap")}Remettre en idée</button>` : ""}
        <button class="danger" data-remove="${e.id}" role="menuitem">${icon("x")}Pas cette fois</button>
      </div>
    </div>`;
}

async function setConfirmed(btn, confirmed) {
  btn.disabled = true;
  try {
    const id = btn.dataset.confirm || btn.dataset.unconfirm;
    const res = await api(`/api/plan/confirm?week=${btn.dataset.week}&entry=${id}&confirmed=${confirmed}`, { method: "POST" });
    toast(confirmed ? "C'est au programme (et dans le calendrier)." : "C'est redevenu une idée.");
    return res;
  } catch (err) {
    toast("Oups : " + err.message);
    btn.disabled = false;
    return null;
  }
}

function renderEntry(e) {
  const it = e.item;
  if (!it) {
    return `<div class="prog ${e.audience}" style="grid-template-columns:56px 1fr"><div class="prog-time"><b>${e.start}</b></div><div class="prog-body">
      <div class="prog-top"><span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span><span>${esc(e.label)}</span></div>
      <p class="reason">${esc(e.reason)}</p>
      <div class="prog-actions"><button class="mini" data-swap="${e.id}">${icon("swap")}Réessayer</button></div></div></div>`;
  }
  const eps = (e.episodes || []).map((ep) => `<li title="${esc(ep.name)}"><b>${ep.code}</b>${ep.name ? " · " + esc(ep.name) : ""}</li>`).join("");
  return `<div class="prog ${e.audience}${e.watched ? " watched" : ""}${e.confirmed ? "" : " idea"}">
    <div class="prog-time"><b>${e.start}</b><span>${e.end}</span></div>
    ${cover(it, { type: true })}
    <div class="prog-body">
      <div class="prog-top">
        ${e.confirmed ? "" : `<span class="badge idea-tag">Idée</span>`}
        <span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span>
        ${e.label ? `<span>${esc(e.label)}</span>` : ""}
      </div>
      <h3>${esc(it.title)}</h3>
      <p class="meta">${esc(metaLine(it))}</p>
      ${eps ? `<ul class="eps">${eps}</ul>` : ""}
      ${e.reason ? `<p class="reason">${esc(e.reason)}</p>` : ""}
      <div class="prog-actions">${cardActions(e)}</div>
    </div>
  </div>`;
}

$("#week").addEventListener("click", async (ev) => {
  const conf = ev.target.closest("[data-confirm], [data-unconfirm]");
  if (conf) {
    const res = await setConfirmed(conf, !!conf.dataset.confirm);
    if (res && res.week === state.week) { state.plan = res; renderWeek(); }
    return;
  }
  const menuBtn = ev.target.closest("[data-menu]");
  if (menuBtn) {
    ev.stopPropagation();
    const m = menuBtn.parentElement;
    const open = !m.classList.contains("open");
    $$(".card-menu.open").forEach((x) => x.classList.remove("open"));
    m.classList.toggle("open", open);
    return;
  }
  const seen = ev.target.closest("[data-seen]");
  if (seen) {
    const res = await markSeen(seen);
    if (res && res.week === state.week) { state.plan = res; renderWeek(); }
    return;
  }
  const alt = ev.target.closest("[data-swap]");
  if (alt) {
    $$(".card-menu.open").forEach((x) => x.classList.remove("open"));
    openAlternatives(state.week, alt.dataset.swap);
    return;
  }
  const remove = ev.target.closest("[data-remove]");
  if (!remove) return;
  remove.disabled = true;
  try {
    state.plan = await api(`/api/plan/entry?week=${state.week}&entry=${remove.dataset.remove}`, { method: "DELETE" });
    toast("Retiré du programme (le titre reste dans la bibliothèque)");
    renderWeek();
  } catch (e) {
    toast("Oups : " + e.message);
    remove.disabled = false;
  }
});

$("#prev-week").onclick = () => loadWeek(addDays(state.week, -7));
$("#next-week").onclick = () => loadWeek(addDays(state.week, 7));
$("#more-btn").onclick = (ev) => {
  ev.stopPropagation();
  $("#week-actions").classList.toggle("open");
};
document.addEventListener("click", () => {
  $("#week-actions").classList.remove("open");
  $$(".card-menu.open").forEach((x) => x.classList.remove("open"));
});

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
  if (!state.series) await loadSeries();
  const today = state.status?.today || iso(new Date());
  const thisWeek = weekOf(today);
  try {
    const [a, b] = await Promise.all([api(`/api/plan?week=${thisWeek}`), api(`/api/plan?week=${addDays(thisWeek, 7)}`)]);
    if (!state.plan || state.plan.week === a.week) { state.plan = a; state.week = a.week; }
    renderBanner(a);
    const now = nowHHMM();
    state.tonight = [...a.entries, ...b.entries]
      .filter((e) => e.item && !e.watched && (e.date > today || (e.date === today && e.end > now)))
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
  const idea = !e.confirmed;
  const bg = it.poster ? `background-image:url('${esc(it.poster)}')` : `background:${fakeBg(it)}`;
  const eps = (e.episodes || []).map((ep) => `<li><b>${ep.code}</b>${ep.name ? " · " + esc(ep.name) : ""}</li>`).join("");
  const later = rest.slice(0, 3);
  el.innerHTML = `
    <section class="hero big${idea ? " idea" : ""}">
      <div class="hero-bg" style="${bg}"></div>
      <div class="hero-inner">
        ${cover(it)}
        <div class="hero-text">
          <p class="kicker">${idea ? `Une idée pour ${whenLabel(e).toLowerCase()} ? · ${e.start}` : `${whenLabel(e)} · ${e.start} – ${e.end}`}</p>
          <div class="badges"><span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span><span class="badge ${e.audience}">${esc(AUDIENCE[e.audience])}</span>${ageLabel(it) ? `<span class="badge">${ageLabel(it)}</span>` : ""}</div>
          <h1>${esc(it.title)}</h1>
          <p class="meta">${esc(metaLine(it, { age: false }))}</p>
          ${eps ? `<ul class="eps">${eps}</ul>` : ""}
          ${e.reason ? `<p class="reason">${esc(e.reason)}</p>` : ""}
          ${it.overview ? `<p class="overview">${esc(it.overview)}</p>` : ""}
          <div class="hero-actions">
            ${idea ? `<button class="btn big" data-confirm="${e.id}" data-week="${weekOf(e.date)}">${icon("check")}On regarde ça</button>` : watchButton(e, "btn big")}
            <button class="link" data-t-swap="${e.id}" data-week="${weekOf(e.date)}">Autre idée${icon("right")}</button>
            <button class="link quiet" data-t-skip="${e.id}" data-week="${weekOf(e.date)}">Pas ce soir</button>
            ${seenButton(e, "link quiet")}
          </div>
        </div>
      </div>
    </section>
    ${later.length ? `<div class="later-head"><h2>Ensuite</h2><button class="mini" data-goto="week">Toute la semaine ${icon("right")}</button></div>
    <div class="later">${later.map((x) => `
      <div class="later-card ${x.audience}">
        ${cover(x.item)}
        <div>
          <p class="kicker">${x.confirmed ? "" : "Idée · "}${whenLabel(x)} · ${x.start}</p>
          <b>${esc(x.item.title)}</b>
          <span class="meta">${esc(AUDIENCE[x.audience])}${x.episodes?.length ? " · " + x.episodes[0].code : ""}</span>
        </div>
      </div>`).join("")}</div>` : ""}
`;
  renderSeriesNotices(el);
  if ("wakeLock" in navigator) {
    el.insertAdjacentHTML("afterbegin", `<div class="tonight-tools"><button class="mini wake" id="wake">${icon("sun")}<span>Garder l'écran allumé</span></button></div>`);
  }
  updateWakeButton();
}

$("#tonight").addEventListener("click", async (ev) => {
  const conf = ev.target.closest("[data-confirm]");
  if (conf) {
    if (await setConfirmed(conf, true)) { state.plan = null; await loadTonight(); }
    return;
  }
  const seen = ev.target.closest("[data-seen]");
  if (seen) {
    if (await markSeen(seen)) { state.plan = null; await loadTonight(); }
    return;
  }
  const alt = ev.target.closest("[data-t-swap]");
  if (alt) { openAlternatives(alt.dataset.week, alt.dataset.tSwap); return; }
  const skip = ev.target.closest("[data-t-skip]");
  if (ev.target.closest("#wake")) { toggleWakeLock(); return; }
  if (!skip) return;
  skip.disabled = true;
  try {
    await api(`/api/plan/entry?week=${skip.dataset.week}&entry=${skip.dataset.tSkip}`, { method: "DELETE" });
    toast("D'accord, pas ce soir.");
    state.plan = null;
    await loadTonight();
  } catch (e) {
    toast("Oups : " + e.message);
    skip.disabled = false;
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

/* ---------- Surprends-moi : swipe ---------- */
const SWIPE_MSG = {
  no: "D'accord, il ne sera plus proposé.",
  later: "On vous le reproposera dans deux semaines.",
};
state.deckKey = "nous";
state.cards = [];

async function loadDeck(key = state.deckKey) {
  state.deckKey = key;
  $$(".deck-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.deck === key));
  $("#deck").innerHTML = `<div class="loading">On mélange les cartes…</div>`;
  $("#deck-help").textContent = key === "nous"
    ? "Chacun swipe sur son compte. Quand vous dites oui tous les deux, c'est un match : le film est programmé."
    : "Un « oui » le place dans le prochain créneau qui lui convient.";
  try {
    const res = await api(`/api/deck?key=${key}`);
    state.cards = res.cards;
    renderDeck();
    renderMatches(res.matches || []);
  } catch (e) {
    $("#deck").innerHTML = `<div class="loading">${esc(e.message)}</div>`;
  }
}
$$(".deck-tabs button").forEach((b) => (b.onclick = () => loadDeck(b.dataset.deck)));

function cardHTML(it, i) {
  const bg = it.poster ? `background-image:url('${esc(it.poster)}')` : `background:${fakeBg(it)}`;
  return `<article class="swipe-card" data-i="${i}" style="--i:${i}">
    <div class="sc-img" style="${bg}"></div>
    <div class="stamp yes">OUI</div><div class="stamp no">NON</div><div class="stamp seen">DÉJÀ VU</div><div class="stamp later">PLUS TARD</div>
    <div class="sc-info">
      <div class="badges"><span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span>${ageLabel(it) ? `<span class="badge">${ageLabel(it)}</span>` : ""}</div>
      <h2>${esc(it.title)}</h2>
      <p class="meta">${esc(metaLine(it, { age: false }))}</p>
      ${it.reason ? `<p class="reason">${esc(it.reason)}</p>` : ""}
      ${it.overview ? `<p class="sc-overview">${esc(it.overview)}</p>` : ""}
    </div>
  </article>`;
}

function renderDeck() {
  const shown = state.cards.slice(0, 3);
  $("#deck").innerHTML = shown.length
    ? shown.map(cardHTML).reverse().join("")
    : `<div class="deck-empty"><h2>Vous avez tout vu !</h2><p class="muted">Plus d'idées dans cette pile pour l'instant. Essayez une autre pile, ou revenez plus tard.</p></div>`;
  $$(".deck-actions button").forEach((b) => (b.disabled = !shown.length && b.id !== "sw-undo"));
  const top = $('.swipe-card[data-i="0"]');
  if (top) attachDrag(top);
}

function attachDrag(card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false;
  card.addEventListener("pointerdown", (ev) => {
    dragging = true; sx = ev.clientX; sy = ev.clientY; dx = dy = 0;
    card.setPointerCapture(ev.pointerId);
    card.classList.add("dragging");
  });
  card.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    dx = ev.clientX - sx; dy = ev.clientY - sy;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const dir = swipeDir(dx, dy, 60);
    card.dataset.dir = dir || "";
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    const dir = swipeDir(dx, dy, 110);
    if (dir) decide(dir);
    else { card.style.transform = ""; card.dataset.dir = ""; }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

function swipeDir(dx, dy, min) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > min ? "yes" : dx < -min ? "no" : null;
  return dy < -min ? "seen" : dy > min ? "later" : null;
}

let deciding = false;
async function decide(decision) {
  const it = state.cards[0];
  const card = $('.swipe-card[data-i="0"]');
  if (!it || deciding) return;
  deciding = true;
  const fly = { yes: "translate(140%, -10%) rotate(25deg)", no: "translate(-140%, -10%) rotate(-25deg)",
                seen: "translate(0, -140%)", later: "translate(0, 140%)" }[decision];
  if (card) { card.dataset.dir = decision; card.classList.add("gone"); card.style.transform = fly; }
  try {
    const res = await api("/api/swipe", { method: "POST", body: JSON.stringify({ uid: it.uid, decision, deck: state.deckKey }) });
    state.cards.shift();
    state.lastDeck = state.deckKey;
    setTimeout(renderDeck, 220);
    if (res.match) showMatch(res);
    else if (decision === "yes") toast(res.placed ? `Programmé ${res.placed.when}` : state.deckKey === "nous" ? "Noté ! Si l'autre dit oui aussi, c'est un match." : "Noté : il passera en priorité.");
    else if (decision === "seen") toast(res.jellyfin ? "Marqué vu, aussi dans Jellyfin." : "Marqué vu : il ne sera plus proposé.");
    else toast(SWIPE_MSG[decision]);
    if (state.cards.length < 4) refillDeck();
    if (decision === "yes" || decision === "seen") state.plan = null;
  } catch (e) {
    toast("Oups : " + e.message);
    if (card) { card.classList.remove("gone"); card.style.transform = ""; card.dataset.dir = ""; }
  } finally {
    deciding = false;
  }
}

async function refillDeck() {
  try {
    const res = await api(`/api/deck?key=${state.deckKey}`);
    const have = new Set(state.cards.map((c) => c.uid));
    state.cards.push(...res.cards.filter((c) => !have.has(c.uid)));
    if ($("#deck .deck-empty") && state.cards.length) renderDeck();
    renderMatches(res.matches || []);
  } catch { /* on réessaiera au prochain choix */ }
}

function showMatch(res) {
  $("#match-text").textContent = res.placed ? `« ${res.title} » : programmé ${res.placed.when}.` : `« ${res.title} » : il passera en priorité.`;
  const pop = $("#match-pop");
  pop.hidden = false;
  setTimeout(() => (pop.hidden = true), 2600);
  if (state.deckKey === "nous") refillDeck();
}
$("#match-pop").onclick = () => ($("#match-pop").hidden = true);

$$(".deck-actions [data-sw]").forEach((b) => (b.onclick = () => decide(b.dataset.sw)));
$("#sw-undo").onclick = async () => {
  try {
    const res = await api("/api/swipe/undo", { method: "POST" });
    if (res.card && res.deck === state.deckKey) {
      state.cards = [res.card, ...state.cards.filter((c) => c.uid !== res.card.uid)];
      renderDeck();
    }
    state.plan = null;
    toast(`Choix annulé${res.card ? ` : « ${res.card.title} »` : ""}`);
  } catch (e) { toast(e.message); }
};
document.addEventListener("keydown", (ev) => {
  if ($("#view-surprise").hidden || ev.target.closest("input, select, textarea, dialog[open]")) return;
  const k = { ArrowRight: "yes", ArrowLeft: "no", ArrowUp: "seen", ArrowDown: "later" }[ev.key];
  if (k) { ev.preventDefault(); decide(k); }
  if (ev.key === "Backspace" || (ev.key === "z" && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); $("#sw-undo").click(); }
});

function renderMatches(list) {
  const el = $("#matches");
  if (state.deckKey !== "nous" || !list.length) { el.innerHTML = ""; return; }
  state.matchList = list;
  el.innerHTML = `<div class="later-head"><h2>Vos matchs</h2></div>
    <div class="slider-row">${list.map((it, i) => `
      <button class="title-card" data-match="${i}" aria-label="${esc(it.title)}">
        ${cover(it, { type: true, over: `<div class="over"><small>${it.year || ""}</small><b>${esc(it.title)}</b><i>Toucher pour choisir le soir</i></div>` })}
      </button>`).join("")}</div>`;
}
$("#matches").addEventListener("click", (ev) => {
  const c = ev.target.closest("[data-match]");
  if (c) openPick(state.matchList[+c.dataset.match], "adultes");
});

function openPick(it, audience) {
  state.pick = { item: it, audience };
  $("#pick-backdrop").style.background = it.poster ? `center/cover url('${it.poster}')` : fakeBg(it);
  $("#pick-cover").innerHTML = cover(it);
  $("#pick-badges").innerHTML = `<span class="badge ${it.kind}">${it.kind === "film" ? "Film" : "Série"}</span>`;
  $("#pick-title").textContent = it.title;
  $("#pick-meta").textContent = metaLine(it);
  $("#pick-reason").textContent = "Un match";
  $("#pick-reason").hidden = false;
  $("#pick-overview").textContent = it.overview || "";
  $("#pick-overview").hidden = !it.overview;
  $("#pick-date").value = state.status?.today || iso(new Date());
  $("#pick-time").innerHTML = timeOptions(audience === "famille" ? "18:30" : "21:00");
  $("#pick-dialog").showModal();
}

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

/* ---------- Composer la semaine (deck) ---------- */
state.compose = { week: null, board: [], hand: [], selected: null };
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function composeWeekStart(offset = 0) {
  const today = state.status?.today || iso(new Date());
  return addDays(weekOf(today), offset);
}

async function loadCompose(week) {
  const c = state.compose;
  c.week = week || c.week || composeWeekStart(0);
  c.selected = null;
  $$("[data-cweek]").forEach((b) => b.classList.toggle("active", addDays(composeWeekStart(0), +b.dataset.cweek) === c.week));
  $("#board").innerHTML = `<div class="loading">On prépare la main…</div>`;
  $("#hand").innerHTML = "";
  try {
    const res = await api(`/api/compose?week=${c.week}`);
    c.board = res.board;
    c.hand = res.hand;
    c.validated = res.validated_at;
    renderBoard();
    renderHand();
  } catch (err) {
    $("#board").innerHTML = `<div class="loading">${esc(err.message)}</div>`;
  }
}

function caseHTML(b) {
  const it = b.item;
  const body = it
    ? `<div class="case-card">${cover(it)}<div><b>${esc(it.title)}</b><small>${b.episodes?.length ? b.episodes.map((e) => e.code).join(" · ") : it.kind === "film" ? dur(it.runtime || 0) : ""}</small></div>
         <button type="button" class="case-x" data-clear="${b.id}" aria-label="Retirer ${esc(it.title)}">${icon("x")}</button></div>`
    : `<div class="case-empty">Poser une carte</div>`;
  return `<div class="case ${b.audience}${it ? " filled" : ""}${b.confirmed ? " confirmed" : ""}" data-entry="${b.id}" role="button" tabindex="0"
      aria-label="${esc(b.weekday)} ${b.start}, ${esc(AUDIENCE[b.audience])}${it ? ", " + esc(it.title) : ", vide"}">
    <div class="case-top"><span class="time">${b.start}</span><span class="badge ${b.audience}">${esc(AUDIENCE[b.audience])}</span><span class="muted small">${esc(b.label || "")} · ${b.max_minutes} min max</span></div>
    ${body}
  </div>`;
}

function renderBoard() {
  const c = state.compose;
  if (!c.board.length) {
    $("#board").innerHTML = `<p class="muted">Pas de créneau cette semaine. Ajoutez-en dans Réglages → La semaine type.</p>`;
    return;
  }
  const days = {};
  c.board.forEach((b) => (days[b.date] ||= []).push(b));
  $("#board").innerHTML = Object.entries(days).map(([d, list]) => {
    const dd = parse(d);
    return `<div class="board-day"><div class="day-head"><span>${dayName(d)} ${dd.getDate()} ${MONTHS_SHORT[dd.getMonth()]}</span></div>
      <div class="board-cases">${list.map(caseHTML).join("")}</div></div>`;
  }).join("");
  const placed = c.board.filter((b) => b.item).length;
  $("#compose-ok").textContent = placed ? `C'est bon pour la semaine (${placed})` : "C'est bon pour la semaine";
  $("#compose-sub").textContent = c.validated
    ? "Semaine validée. Vous pouvez encore changer une case, puis valider à nouveau."
    : "Glissez une carte sur un créneau, ou touchez la carte puis le créneau. Une case peut rester vide.";
  highlight();
}

function renderHand() {
  const c = state.compose;
  $("#hand").innerHTML = c.hand.length ? c.hand.map((h) => `
    <div class="hcard${c.selected === h.uid ? " selected" : ""}" data-uid="${esc(h.uid)}" role="button" tabindex="0" aria-pressed="${c.selected === h.uid}">
      ${cover(h, { type: true })}
      <b>${esc(h.title)}</b>
      <small>${h.kind === "serie" ? `${h.next} · ${h.runtime || "?"} min` : dur(h.runtime || 0)}</small>
      <button type="button" class="hcard-x" data-skip="${esc(h.uid)}" title="Pas cette semaine" aria-label="Pas cette semaine : ${esc(h.title)}">${icon("x")}</button>
    </div>`).join("") : `<p class="muted">Plus de carte compatible avec les cases libres. Essayez « Autre main ».</p>`;
}

function highlight() {
  const c = state.compose;
  const card = c.hand.find((h) => h.uid === c.selected);
  $$("#board .case").forEach((el) => {
    const ok = card ? card.fits.includes(el.dataset.entry) : false;
    el.classList.toggle("can", !!card && ok);
    el.classList.toggle("off", !!card && !ok);
  });
  $("#hand-hint").textContent = card ? `Où mettre « ${card.title} » ? Touchez une case allumée.` : "Touchez une carte pour voir où elle va.";
  // la case allumée ne doit pas rester cachée sous la main (téléphone)
  const first = card && $("#board .case.can");
  if (first) {
    const r = first.getBoundingClientRect(), bar = $(".hand-bar").getBoundingClientRect();
    if (r.top < 70 || r.bottom > bar.top) window.scrollBy({ top: r.top - 90, behavior: reduceMotion ? "auto" : "smooth" });
  }
}

function selectCard(uid) {
  const c = state.compose;
  c.selected = c.selected === uid ? null : uid;
  $$("#hand .hcard").forEach((el) => { el.classList.toggle("selected", el.dataset.uid === c.selected); el.setAttribute("aria-pressed", el.dataset.uid === c.selected); });
  highlight();
}

async function placeCard(uid, entryId) {
  const c = state.compose;
  const card = c.hand.find((h) => h.uid === uid);
  if (!card) return;
  if (!card.fits.includes(entryId)) { toast("Cette carte ne convient pas à ce créneau (public ou durée)."); return; }
  try {
    const res = await api("/api/compose/place", { method: "POST", body: JSON.stringify({ week: c.week, entry: entryId, uid }) });
    c.board = res.board;
    c.hand = c.hand.filter((h) => h.uid !== uid);
    c.selected = null;
    renderBoard();
    renderHand();
    refill(1);
  } catch (err) { toast(err.message); }
}

async function refill(n) {
  const c = state.compose;
  const exclude = [...c.hand.map((h) => h.uid), ...c.board.filter((b) => b.item).map((b) => b.item.uid)].join(",");
  try {
    const res = await api(`/api/compose/hand?week=${c.week}&exclude=${encodeURIComponent(exclude)}&n=${n}`);
    c.hand = [...c.hand, ...res.hand].slice(0, 5);
    // les cases déjà remplies ne comptent plus pour l'allumage
    renderHand();
  } catch { /* la main reste telle quelle */ }
}

$("#hand").addEventListener("click", async (ev) => {
  const skip = ev.target.closest("[data-skip]");
  const c = state.compose;
  if (skip) {
    ev.stopPropagation();
    const uid = skip.dataset.skip;
    await api("/api/compose/skip", { method: "POST", body: JSON.stringify({ week: c.week, uid }) }).catch(() => {});
    c.hand = c.hand.filter((h) => h.uid !== uid);
    if (c.selected === uid) c.selected = null;
    renderHand(); highlight();
    toast("Pas cette semaine : la carte est écartée.");
    refill(1);
    return;
  }
  const card = ev.target.closest(".hcard");
  if (card && !state.dragged) selectCard(card.dataset.uid);
});
$("#hand").addEventListener("keydown", (ev) => {
  const card = ev.target.closest(".hcard");
  if (card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); selectCard(card.dataset.uid); }
});

$("#board").addEventListener("click", async (ev) => {
  const c = state.compose;
  const clr = ev.target.closest("[data-clear]");
  if (clr) {
    ev.stopPropagation();
    const res = await api("/api/compose/clear", { method: "POST", body: JSON.stringify({ week: c.week, entry: clr.dataset.clear }) });
    c.board = res.board;
    renderBoard();
    return;
  }
  const cs = ev.target.closest(".case");
  if (!cs) return;
  if (c.selected) placeCard(c.selected, cs.dataset.entry);
  else toast("Choisissez d'abord une carte dans votre main.");
});
$("#board").addEventListener("keydown", (ev) => {
  const cs = ev.target.closest(".case");
  if (cs && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); cs.click(); }
});

/* Glisser une carte sur une case (souris ou doigt) */
(function enableDrag() {
  let start = null, ghost = null;
  $("#hand").addEventListener("pointerdown", (ev) => {
    const card = ev.target.closest(".hcard");
    if (!card || ev.target.closest("[data-skip]")) return;
    start = { x: ev.clientX, y: ev.clientY, card, id: ev.pointerId };
    state.dragged = false;
  });
  window.addEventListener("pointermove", (ev) => {
    if (!start || ev.pointerId !== start.id) return;
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!ghost && Math.hypot(dx, dy) > 10) {
      state.dragged = true;
      if (state.compose.selected !== start.card.dataset.uid) selectCard(start.card.dataset.uid);
      ghost = start.card.cloneNode(true);
      ghost.classList.add("ghost");
      const r = start.card.getBoundingClientRect();
      ghost.style.width = r.width + "px";
      document.body.appendChild(ghost);
    }
    if (ghost) {
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - 30}px, ${ev.clientY - 40}px)`;
      $$("#board .case.hover").forEach((x) => x.classList.remove("hover"));
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".case");
      if (over) over.classList.add("hover");
    }
  }, { passive: false });
  window.addEventListener("pointerup", (ev) => {
    if (!start) return;
    const card = start.card;
    start = null;
    if (!ghost) return;
    ghost.remove(); ghost = null;
    $$("#board .case.hover").forEach((x) => x.classList.remove("hover"));
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".case");
    if (over) placeCard(card.dataset.uid, over.dataset.entry);
    setTimeout(() => (state.dragged = false), 0);
  });
})();

$("#new-hand").onclick = async () => {
  const c = state.compose;
  const exclude = [...c.hand.map((h) => h.uid), ...c.board.filter((b) => b.item).map((b) => b.item.uid)].join(",");
  try {
    const res = await api(`/api/compose/hand?week=${c.week}&exclude=${encodeURIComponent(exclude)}&n=5`);
    if (!res.hand.length) { toast("Pas d'autre carte pour l'instant : on remélange."); return loadCompose(c.week); }
    c.hand = res.hand; c.selected = null;
    renderHand(); highlight();
  } catch (err) { toast(err.message); }
};
$$("[data-cweek]").forEach((b) => (b.onclick = () => loadCompose(composeWeekStart(+b.dataset.cweek))));
$("#compose-ok").onclick = async () => {
  const c = state.compose;
  try {
    const res = await api("/api/compose/validate", { method: "POST", body: JSON.stringify({ week: c.week }) });
    toast(res.confirmed ? `C'est noté : ${res.confirmed} programme${res.confirmed > 1 ? "s" : ""} pour la semaine (et dans le calendrier).` : "Semaine validée, sans programme : soirées libres !");
    state.plan = null;
    show("week");
    await loadWeek(c.week);
  } catch (err) { toast(err.message); }
};

/* ---------- Séries ---------- */
const SERIES_STATES = { watching: "On la regarde", later: "Plus tard", never: "Pas pour nous", inbox: "À classer" };
state.series = null;

async function loadSeries() {
  try {
    const res = await api("/api/series");
    state.series = res.series;
    updateInboxCount();
    if (!$("#view-series").hidden) renderSeries();
  } catch (err) {
    $("#series").innerHTML = `<div class="loading">${esc(err.message)}</div>`;
  }
}

function updateInboxCount() {
  const n = (state.series || []).filter((s) => s.state === "inbox").length;
  const b = $("#nav-inbox");
  if (b) { b.textContent = n; b.hidden = !n || !isAdmin(); }
}

function fmtDate(isoDate) {
  const d = parse(isoDate);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function seriesCard(s) {
  const admin = isAdmin();
  const aud = admin
    ? `<select data-aud="${esc(s.uid)}" aria-label="Pour qui">${Object.entries(AUDIENCE).map(([k, v]) => `<option value="${k}" ${k === s.audience ? "selected" : ""}>${v}</option>`).join("")}</select>`
    : `<span class="badge ${s.audience}">${AUDIENCE[s.audience]}</span>`;
  let info = s.next ? `Vous en êtes à ${s.next}` : s.started ? "Commencée" : "Jamais commencée";
  if (s.state === "later" && s.remind) info += ` · rappel le ${fmtDate(s.remind)}`;
  let actions = "";
  if (s.state === "inbox") {
    actions = admin
      ? `<button class="mini play" data-state="watching" data-uid="${esc(s.uid)}">On la regarde</button>
         <button class="mini" data-later="${esc(s.uid)}">Plus tard</button>
         <button class="mini danger" data-state="never" data-uid="${esc(s.uid)}">Pas pour nous</button>`
      : `<span class="muted small">Un administrateur va la classer.</span>`;
  } else if (s.state === "later") {
    actions = `<button class="mini play" data-state="watching" data-uid="${esc(s.uid)}">On commence</button>` +
      (admin ? `<button class="mini" data-later="${esc(s.uid)}">Rappel…</button>
                <button class="mini danger" data-state="never" data-uid="${esc(s.uid)}">Pas pour nous</button>` : "");
  } else if (s.state === "watching") {
    actions = admin ? `<button class="mini" data-later="${esc(s.uid)}">Plus tard</button>
                       <button class="mini danger" data-state="never" data-uid="${esc(s.uid)}">Pas pour nous</button>` : "";
  } else if (s.state === "never" && admin) {
    actions = `<button class="mini" data-state="later" data-uid="${esc(s.uid)}">Remettre en « Plus tard »</button>`;
  }
  return `<div class="serie-card${s.due ? " due" : ""}">
    ${cover(s)}
    <div class="serie-body">
      <b>${esc(s.title)}</b>
      <span class="meta">${esc(info)}</span>
      <div class="serie-row">${aud}</div>
      <div class="serie-actions">${actions}</div>
    </div>
  </div>`;
}

function renderSeries() {
  const all = state.series || [];
  const by = (st) => all.filter((s) => s.state === st);
  const due = all.filter((s) => s.due);
  const section = (title, list, hint = "") => list.length
    ? `<section class="serie-section"><div class="later-head"><h2>${title} <span class="muted">${list.length}</span></h2></div>${hint ? `<p class="muted small">${hint}</p>` : ""}<div class="serie-grid">${list.map(seriesCard).join("")}</div></section>`
    : "";
  const never = by("never");
  $("#series").innerHTML = (all.length ? "" : `<p class="muted">Aucune série dans la bibliothèque pour l'instant.</p>`) +
    section("À classer", by("inbox"), "Nouvelles séries téléchargées. Rien n'est programmé tant qu'elles ne sont pas classées.") +
    section("C'est le moment ?", due, "Vous aviez demandé un rappel pour ces séries.") +
    section("On la regarde", by("watching"), "Leurs prochains épisodes sont programmés, pour le public choisi.") +
    section("Plus tard", by("later").filter((s) => !s.due)) +
    (never.length ? `<details class="past-days"><summary>Pas pour nous <span class="muted">${never.length}</span></summary><div class="serie-grid pad">${never.map(seriesCard).join("")}</div></details>` : "");
}

async function setSeries(uid, body, msg) {
  try {
    const r = await api(`/api/series/${encodeURIComponent(uid)}`, { method: "PUT", body: JSON.stringify(body) });
    const s = state.series.find((x) => x.uid === uid);
    if (s) { s.state = r.state; s.audience = r.audience; s.remind = r.remind; s.due = false; }
    toast(msg || "C'est noté.");
    updateInboxCount();
    renderSeries();
    state.plan = null;
  } catch (err) {
    toast(err.message);
  }
}

$("#series").addEventListener("click", (ev) => {
  const st = ev.target.closest("[data-state]");
  const later = ev.target.closest("[data-later]");
  if (st) {
    const s = state.series.find((x) => x.uid === st.dataset.uid);
    const msgs = { watching: `« ${s.title} » : on la regarde. Ses épisodes seront programmés.`, never: `« ${s.title} » n'apparaîtra plus.`, later: `« ${s.title} » attend son tour.` };
    setSeries(st.dataset.uid, { state: st.dataset.state }, msgs[st.dataset.state]);
  } else if (later) {
    const s = state.series.find((x) => x.uid === later.dataset.later);
    state.remindFor = s;
    $("#remind-title").textContent = `« ${s.title} » : plus tard`;
    $("#remind-date").value = s.remind || "";
    $("#remind-dialog").showModal();
  }
});
$("#series").addEventListener("change", (ev) => {
  const sel = ev.target.closest("[data-aud]");
  if (sel) setSeries(sel.dataset.aud, { audience: sel.value }, `Public : ${AUDIENCE[sel.value].toLowerCase()}.`);
});
$("#remind-dialog").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-remind]");
  if (!b || !state.remindFor) return;
  const v = b.dataset.remind;
  $("#remind-dialog").close();
  setSeries(state.remindFor.uid, { state: "later", remind: v === "none" ? null : v },
    v === "none" ? "Plus tard, sans rappel." : `Plus tard : rappel dans ${v.slice(1)} mois.`);
});
$("#remind-ok").onclick = () => {
  const v = $("#remind-date").value;
  if (!v || !state.remindFor) { toast("Choisissez une date."); return; }
  $("#remind-dialog").close();
  setSeries(state.remindFor.uid, { state: "later", remind: v }, `Plus tard : rappel le ${fmtDate(v)}.`);
};

/* Sur Ce soir : séries à classer (administrateur) et rappels arrivés */
function renderSeriesNotices(el) {
  const all = state.series || [];
  const inbox = isAdmin() ? all.filter((s) => s.state === "inbox") : [];
  const due = all.filter((s) => s.due);
  const notes = [];
  if (inbox.length) notes.push(`<button class="notice" data-goto="series">${icon("series")}<span>${inbox.length === 1 ? `Nouvelle série à classer : « ${esc(inbox[0].title)} »` : `${inbox.length} nouvelles séries à classer`}</span>${icon("right")}</button>`);
  for (const s of due.slice(0, 2)) notes.push(`<button class="notice" data-goto="series">${icon("upcoming")}<span>Rappel : et si on commençait « ${esc(s.title)} » ?</span>${icon("right")}</button>`);
  if (notes.length) el.insertAdjacentHTML("afterbegin", `<div class="notices">${notes.join("")}</div>`);
}

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
      <div class="up-list">${items.map((u) => `<div class="up-item">${cover(u)}<div class="txt"><strong>${esc(u.title)}${u.state === "watching" ? ` <span class="badge idea-tag">On la regarde</span>` : ""}</strong><span class="meta">${esc(u.detail)}</span></div>
      <span class="badge ${u.available ? "ok" : ""}">${u.available ? "Prêt à regarder" : `Sort le ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`}</span></div>`).join("")}</div>
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
  state.jfKids = conn.jellyfin_user_kids || "";
  state.jfFamily = conn.jellyfin_user_family || "";
  $("#jf-web").value = conn.jellyfin_web_url || "";
}

async function loadJellyfinUsers() {
  const sel = $("#jf-user");
  const users = await api("/api/jellyfin/users").catch(() => []);
  const current = state.jfUser;
  const names = [...new Set([...users, ...(current ? [current] : [])])];
  sel.innerHTML = `<option value="">Le premier administrateur</option>` +
    names.map((n) => `<option ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("");
  for (const [id, cur] of [["#jf-user-kids", state.jfKids], ["#jf-user-family", state.jfFamily]]) {
    const all = [...new Set([...users, ...(cur ? [cur] : [])])];
    $(id).innerHTML = `<option value="">Le même que les parents</option>` +
      all.map((n) => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("");
  }
}

async function loadConnections() {
  const res = await api("/api/connections");
  renderConnections(res.connections, res.services);
  loadJellyfinUsers();
}

$("#save-conn").onclick = async () => {
  const body = {
    jellyfin_user: $("#jf-user").value, jellyfin_web_url: $("#jf-web").value.trim(),
    jellyfin_user_kids: $("#jf-user-kids").value, jellyfin_user_family: $("#jf-user-family").value,
  };
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
      : ok === configured ? "Connexions enregistrées et testées"
      : "Enregistré, mais une connexion ne répond pas : voir le message rouge.");
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
  show(["week", "compose", "surprise", "series", "upcoming", "settings"].includes(view) ? view : "tonight");
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
