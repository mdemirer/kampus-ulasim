// SUlaşım · Claude (Anthropic) tarafından geliştirildi — Claude Opus 5.5
import { CONFIG } from './config.js';
import * as C from './core.js';
import * as I from './iett.js';
import * as L from './i18n.js';
import { renderDebug, bindDebug } from './debug.js';

const { t } = L;

/* ---------------- Yardımcılar ---------------- */

export const LS = {
  get(k, d = null) {
    try { const v = localStorage.getItem(`ku.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(`ku.${k}`, JSON.stringify(v)); } catch { /* özel mod */ } },
  del(k) { try { localStorage.removeItem(`ku.${k}`); } catch { /* yok */ } },
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const ago = (ms) => L.ago(ms);
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ---------------- Durum ---------------- */

export const state = {
  shuttle: null,
  km18Fallback: null,
  km18: { lists: null, source: 'bundled', fetchedAt: null, strategy: null, mappingBy: null, error: null },
  ann: { items: [], fetchedAt: null, strategy: null, error: null, failedAt: null, totalRows: null },
  analyses: [],
  cancellations: new Map(),
  lang: L.detectLang(LS.get('lang')),
  dir: LS.get('dir', 'fromCampus'),
  tab: 'next',
  programRoute: LS.get('programRoute', 'kurtkoy'),
  favs: LS.get('favs', []),
  favShowPast: new Set(),
  programDate: null,
  sim: LS.get('sim', null),
  fakeAnns: LS.get('fakeAnns', []),
  dismissed: new Set(LS.get('dismissed', [])),
  shuttleCheck: LS.get('shuttleCheck', null),
  attempts: { plan: [], duyuru: [] },
  updateReady: false,
  swReg: null,
  resumedAt: Date.now(),
  installPrompt: null,
  busy: false,
};
L.setLang(state.lang);

/** Uygulamanın "şimdi"si: debug ekranında test saati ayarlıysa o. */
export function now() {
  const s = state.sim;
  if (!s) return Date.now();
  return s.running ? s.baseMs + (Date.now() - s.setAt) : s.baseMs;
}

export function setSim(sim) {
  state.sim = sim;
  if (sim) LS.set('sim', sim); else LS.del('sim');
  state.programDate = null;
  recompute();
  render();
}

function setLanguage(lang) {
  state.lang = lang;
  L.setLang(lang);
  LS.set('lang', lang);
  render();
}

function km18Data() {
  const fb = state.km18Fallback;
  if (!fb) return null;
  const lists = state.km18.lists || { fromCampus: fb.fromCampus, toCampus: fb.toCampus };
  return { ...fb, fromCampus: lists.fromCampus, toCampus: lists.toCampus };
}

const services = () => C.buildServices(state.shuttle, km18Data(), state.dir, state.lang);

/** Duyuruları yeniden değerlendirir, iptal haritasını kurar. */
export function recompute() {
  if (!state.km18Fallback) return;
  const nowMs = now();
  const todayKey = C.dateKeyOf(nowMs);
  const plan = km18Data();
  const all = [...state.ann.items, ...state.fakeAnns.map((a) => ({ ...a, fake: true }))];
  state.analyses = all.map((ann) => {
    const analysis = I.analyzeAnnouncement(ann, { nowMs, plan });
    const cls = I.classifyAnnouncement(ann, analysis, { nowMs, standingAfterDays: CONFIG.standingAfterDays, todayKey });
    return { ann, analysis, ...cls };
  });
  state.cancellations = I.cancellationMap(state.analyses, CONFIG.line);
}

/* ---------------- Veri yenileme ---------------- */

function applyCachedPlan() {
  const c = LS.get('plan');
  if (c?.lists) {
    state.km18 = { lists: c.lists, source: 'cache', fetchedAt: c.fetchedAt, strategy: c.strategy, mappingBy: c.mappingBy, error: null, rows: c.rows };
  }
}

export async function refreshPlan(force = false) {
  const c = LS.get('plan');
  if (!force && c && Date.now() - c.fetchedAt < CONFIG.refresh.planMs) return;
  // İBB tarife servisi tarayıcıdan gelen isteklere şu an izin vermiyor (CORS); günde bir denemek yeterli
  const failAt = LS.get('planFailAt');
  if (!force && failAt && Date.now() - failAt < 24 * 3600000) return;
  const r = await I.callIbb(
    { key: 'plan', url: CONFIG.ibb.planUrl, method: CONFIG.ibb.planMethod, params: { HatKodu: CONFIG.line } },
    { ns: CONFIG.ibb.soapNamespace, timeoutMs: CONFIG.ibb.timeoutMs, proxyUrl: proxyUrl(), preferred: LS.get('strat.plan') },
  );
  state.attempts.plan = r.attempts;
  if (r.ok) {
    try {
      const p = I.planFromRows(r.data, state.km18Fallback);
      const entry = { fetchedAt: Date.now(), strategy: r.strategy, lists: p.lists, mappingBy: p.mappingBy, rows: p.rows };
      LS.set('plan', entry);
      LS.set('strat.plan', r.strategy);
      LS.del('planFailAt');
      state.km18 = { ...entry, source: 'api', error: null };
    } catch (e) {
      state.km18.error = e.message;
      LS.set('planFailAt', Date.now());
    }
  } else {
    state.km18.error = 'İBB tarife servisine telefondan ulaşılamadı';
    LS.set('planFailAt', Date.now());
  }
}

export async function refreshAnnouncements(force = false) {
  const a = state.ann;
  if (!force && a.fetchedAt && Date.now() - a.fetchedAt < CONFIG.refresh.announcementsMs - 5000) return;
  if (!force && a.failedAt && Date.now() - a.failedAt < 10 * 60000) return;
  const r = await I.callIbb(
    { key: 'duyuru', url: CONFIG.ibb.announceUrl, method: CONFIG.ibb.announceMethod, params: {} },
    { ns: CONFIG.ibb.soapNamespace, timeoutMs: CONFIG.ibb.timeoutMs, proxyUrl: proxyUrl(), preferred: LS.get('strat.duyuru') },
  );
  state.attempts.duyuru = r.attempts;
  if (r.ok) {
    try {
      const items = I.normalizeAnnouncements(r.data, CONFIG.line);
      Object.assign(state.ann, { items, fetchedAt: Date.now(), strategy: r.strategy, error: null, failedAt: null, totalRows: r.data.length });
      LS.set('ann', { items, fetchedAt: state.ann.fetchedAt, strategy: r.strategy, totalRows: r.data.length });
      LS.set('strat.duyuru', r.strategy);
    } catch (e) {
      Object.assign(state.ann, { error: e.message, failedAt: Date.now() });
    }
  } else {
    Object.assign(state.ann, { error: 'İBB duyuru servisine ulaşılamadı', failedAt: Date.now() });
  }
}

export async function refreshShuttleCheck(force = false) {
  const c = state.shuttleCheck;
  if (!force && c && Date.now() - c.checkedAt < CONFIG.refresh.shuttlePageMs) return;
  const r = await I.checkShuttlePage(CONFIG.shuttlePageUrl, state.shuttle.term.name, CONFIG.ibb.timeoutMs);
  state.shuttleCheck = { ...r, checkedAt: Date.now() };
  LS.set('shuttleCheck', state.shuttleCheck);
}

export function proxyUrl() { return LS.get('proxy', CONFIG.proxyUrl) || ''; }

export async function refreshAll(force = false) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('busy');
  try {
    await Promise.all([refreshPlan(force), refreshAnnouncements(force), refreshShuttleCheck(false)]);
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
    recompute();
    render();
  }
}

/* ---------------- Ortak parçalar ---------------- */

function vehicleBadge(trip, { withLine = true } = {}) {
  if (trip.kind === 'iett') {
    return `<span class="veh iett"><svg class="i" aria-hidden="true"><use href="#i-bus"/></svg>${withLine ? `<span>İETT ${esc(trip.line)}</span>` : '<span class="sr">İETT</span>'}</span>`;
  }
  return `<span class="veh shuttle"><svg class="i" aria-hidden="true"><use href="#i-van"/></svg>${withLine ? '<span>Shuttle</span>' : '<span class="sr">Shuttle</span>'}</span>`;
}

function whenLabel(trip, nowMs) {
  const today = C.dateKeyOf(nowMs);
  if (trip.dateKey === today) return '';
  if (trip.night && trip.serviceKey === today) return t('tonight');
  return L.dayLabel(trip.ms, nowMs);
}

function routeById(id) { return state.shuttle.routes.find((r) => r.id === id) || state.shuttle.routes[0]; }

function dirTitle(route) {
  return state.dir === 'fromCampus' ? `${t('campus')} → ${route.name}` : `${route.name} → ${t('campus')}`;
}

/* ---------------- Sıradaki ---------------- */

function starBtn(routeId) {
  const on = state.favs.includes(routeId);
  return `<button type="button" class="star" data-fav="${routeId}" aria-pressed="${on}" aria-label="${esc(on ? t('favRemove') : t('favAdd'))}"><svg class="i" aria-hidden="true"><use href="#i-star"/></svg></button>`;
}

/** Büyük geri sayım + saat + araç + notlar. Sıradaki ve Favoriler sayfası aynı bloğu kullanır. */
function leadBlock(lead, nowMs) {
  const diff = lead.ms - nowMs;
  const wl = whenLabel(lead, nowMs);
  const cd = C.countdown(lead.ms, nowMs, t('cd'));
  const asClock = !(diff < 10 * 3600000 && cd.big);
  const big = asClock
    ? `<b>${C.fmtClock(lead.ms)}</b>`
    : `<b${cd.big.length > 3 ? ' class="word"' : ''}>${esc(cd.big)}</b>${cd.unit ? `<span class="unit">${esc(cd.unit)}</span>` : ''}`;
  const chips = [...lead.chips];
  if (lead.beyondTerm) chips.push(t('outOfTerm'));
  return `<div class="lead">
      <div class="count">${big}</div>
      <div class="meta">
        <div class="when">${asClock ? '' : `<time>${lead.time}</time>`}${wl ? `<span class="d${asClock ? ' big-d' : ''}">${esc(wl)}</span>` : ''}${vehicleBadge(lead)}</div>
        ${chips.length ? `<p class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</p>` : ''}
        ${lead.reservation ? `<p class="res">${link(state.shuttle.reservationUrl, t('reserve'))}</p>` : ''}
      </div>
    </div>`;
}

function routeRow(route, trips, nowMs) {
  const leadIdx = trips.findIndex((x) => !x.cancelled);
  const lead = trips[leadIdx];
  const head = `<div class="route-head"><h2><button type="button" class="route-link" data-open-route="${route.id}">${esc(route.name)}</button></h2>${starBtn(route.id)}</div>`;
  if (!lead) {
    return `<section class="route empty">${head}<p class="none">${esc(t('noTrips'))}</p></section>`;
  }
  const before = trips.slice(0, leadIdx);
  // Seyrek hatlarda günler sonrasını sıralamak gürültü olur: en fazla 24 saat ileriyi göster
  const later = trips.slice(leadIdx + 1).filter((x) => x.ms < nowMs + C.DAY_MS);
  const cancelLine = before.length
    ? `<p class="cancelled-line">${before.map((x) => `<s>${x.time}</s> ${esc(x.line || 'Shuttle')} ${esc(t('cancelled'))}`).join(', ')}</p>`
    : '';
  const laterHtml = later.length
    ? `<ol class="later">${later.map((x) => {
      const lbl = whenLabel(x, nowMs);
      return `<li class="${x.kind}${x.cancelled ? ' x' : ''}">${vehicleBadge(x, { withLine: false })}<time>${x.time}</time>${x.cancelled ? `<em>${esc(t('cancelled'))}</em>` : ''}${lbl ? `<span class="d">${esc(lbl)}</span>` : ''}</li>`;
    }).join('')}</ol>`
    : '';
  const foot = route.iett ? cancelFoot(route.iett, nowMs) : '';
  return `<section class="route ${lead.kind}">
    ${head}
    ${cancelLine}
    ${leadBlock(lead, nowMs)}
    ${laterHtml}
    ${foot}
  </section>`;
}

/** Kurtköy satırının altındaki KM18 iptal durumu: ne bulunduğu ve ne zaman bakıldığı açıkça yazılır. */
function cancelFoot(line, nowMs) {
  const a = state.ann;
  if (!a.fetchedAt) {
    return `<p class="foot warn">${esc(t('cancelUnknown', { line }))}</p>`;
  }
  const prefix = `iett:${line}:${state.dir}:${C.dateKeyOf(nowMs)}:`;
  const times = [...state.cancellations.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort();
  const checked = a.error ? t('checkedLast', { ago: ago(a.fetchedAt) }) : t('checkedAgo', { ago: ago(a.fetchedAt) });
  const what = times.length
    ? t('cancelsToday', { n: times.length, line, times: times.join(', ') })
    : t('noCancels', { line });
  const cls = a.error ? ' warn' : times.length ? ' cancel' : '';
  return `<p class="foot${cls}">${esc(what)} · ${esc(checked)}</p>`;
}

function renderNext() {
  const nowMs = now();
  const svc = services();
  const rows = state.shuttle.routes.map((r) => routeRow(r, C.upcoming(svc.get(r.id), nowMs, { count: 4, cancellations: state.cancellations }), nowMs));
  return `<div class="board">${rows.join('')}</div>`;
}

/* ---------------- Favoriler ---------------- */

function favCard(route, svcs, nowMs) {
  const trips = C.upcoming(svcs, nowMs, { count: 1, cancellations: state.cancellations });
  const lead = trips.find((x) => !x.cancelled);
  const win = C.serviceDayWindow(nowMs);
  // Kampüsten kalkmayan seferler (KM18 15:50 E) burada hiç gösterilmez: kafa karıştırmasın
  const day = C.tripsBetween(svcs, win.start, win.end, state.cancellations).filter((x) => !x.skipsCampus);
  const past = day.filter((x) => x.ms < nowMs - 60000);
  const rest = day.filter((x) => x.ms >= nowMs - 60000);
  const showPast = state.favShowPast.has(route.id);
  const cell = (x) => {
    const note = x.cancelled ? t('cancelled') : x.night ? t('night') : (x.chips[0] || '');
    const cls = [x.kind, x.cancelled && 'x', lead && x.key === lead.key && 'now', x.ms < nowMs - 60000 && 'past'].filter(Boolean).join(' ');
    return `<li class="${cls}"><time>${x.time}</time><span class="v">${x.kind === 'iett' ? `<svg class="i" aria-hidden="true"><use href="#i-bus"/></svg>${esc(x.line)}` : '<svg class="i" aria-hidden="true"><use href="#i-van"/></svg>Shuttle'}</span>${note ? `<span class="n">${esc(note)}</span>` : ''}</li>`;
  };
  const list = rest.length
    ? `<ul class="fav-grid">${rest.map(cell).join('')}</ul>`
    : `<p class="none">${esc(t('noMoreToday'))}</p>`;
  const pastHtml = past.length
    ? `<button type="button" class="link past-toggle" data-fav-past="${route.id}">${esc(showPast ? t('hidePast') : t('showPast', { n: past.length }))}</button>
       ${showPast ? `<ul class="fav-grid past-grid">${past.map(cell).join('')}</ul>` : ''}`
    : '';
  return `<section class="fav ${lead ? lead.kind : ''}">
    <div class="route-head"><h2><button type="button" class="route-link" data-open-route="${route.id}">${esc(route.name)}</button></h2>${starBtn(route.id)}</div>
    <p class="fav-dir">${esc(dirTitle(route))}</p>
    ${lead ? leadBlock(lead, nowMs) : `<p class="none">${esc(t('noTrips'))}</p>`}
    <h3 class="fav-sub">${esc(t('remainingToday'))}</h3>
    ${list}
    ${pastHtml}
    ${route.iett ? cancelFoot(route.iett, nowMs) : ''}
  </section>`;
}

function renderFav() {
  const favs = state.favs.map((id) => state.shuttle.routes.find((r) => r.id === id)).filter(Boolean);
  if (!favs.length) {
    return `<div class="fav-empty">
      <h2>${esc(t('favEmptyTitle'))}</h2>
      <p>${esc(t('favEmptyBody'))}</p>
      <p><button type="button" class="btn" data-tab-go="next">${esc(t('goNext'))}</button></p>
    </div>`;
  }
  const nowMs = now();
  const svc = services();
  return `<div class="favs">${favs.map((r) => favCard(r, svc.get(r.id), nowMs)).join('')}</div>`;
}

/* ---------------- Program ---------------- */

function programControls(nowMs) {
  const todayKey = C.dateKeyOf(nowMs);
  const routes = state.shuttle.routes.map((r) => `<button type="button" class="chip-btn" data-route="${r.id}" aria-pressed="${r.id === state.programRoute}">${esc(r.name)}</button>`).join('');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = C.addDays(todayKey, i);
    const { d } = C.parseDateKey(k);
    const label = i === 0 ? t('today') : i === 1 ? t('tomorrow') : L.dayShort(C.dowOfKey(k));
    days.push(`<button type="button" class="day-btn" data-date="${k}" aria-pressed="${k === state.programDate}"><span>${esc(label)}</span><b>${d}</b></button>`);
  }
  return `<div class="pick routes" role="group" aria-label="${esc(t('routeGroup'))}">${routes}</div>
    <div class="pick days" role="group" aria-label="${esc(t('dayGroup'))}">${days.join('')}</div>`;
}

function programList(nowMs) {
  const route = routeById(state.programRoute);
  const svcs = services().get(route.id);
  const trips = C.dayProgram(svcs, state.programDate, state.cancellations);
  const nextKey = C.upcoming(svcs, nowMs, { count: 1, graceMs: 0, cancellations: state.cancellations }).find((x) => !x.cancelled)?.key;
  const head = `<h2 class="prog-title">${esc(dirTitle(route))}<span>${esc(L.fmtDateLong(state.programDate))}</span></h2>`;
  if (!trips.length) return `${head}<p class="none pad">${esc(t('noTripsDay'))}</p>`;
  const items = trips.map((x) => {
    const past = x.ms < nowMs - 60000;
    const chips = [...x.chips];
    if (x.night) chips.unshift(L.nightLabel(x.serviceKey));
    if (x.beyondTerm) chips.push(t('outOfTerm'));
    const cls = [x.kind, past && 'past', x.cancelled && 'x', x.skipsCampus && 'skip', x.key === nextKey && 'next'].filter(Boolean).join(' ');
    return `<li class="${cls}"><time>${x.time}</time>${vehicleBadge(x)}${x.cancelled ? `<em class="tag-x">${esc(t('cancelledTag'))}</em>` : ''}${x.key === nextKey ? `<em class="tag-next">${esc(t('nextTag'))}</em>` : ''}${chips.length ? `<span class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</span>` : ''}</li>`;
  }).join('');
  return `${head}<ol class="prog">${items}</ol>`;
}

const fold1 = (x) => I.fold(x).replace(/[^a-z0-9]/g, '');

function programNotes() {
  const route = routeById(state.programRoute);
  const dirData = route[state.dir];
  const notes = state.shuttle.notes;
  const used = new Set();
  for (const day of ['weekday', 'saturday', 'sunday']) {
    for (const e of dirData[day]) C.parseEntry(e).notes.forEach((n) => used.add(n));
  }
  const info = (dirData.info || []).map((n) => `<p>${esc(L.pick(notes[n], 'text'))}</p>`).join('');
  const special = [...used].filter((n) => notes[n]?.chip && !(dirData.info || []).includes(Number(n)))
    .map((n) => {
      const text = L.pick(notes[n], 'text');
      const chip = L.pick(notes[n], 'chip');
      return fold1(text).startsWith(fold1(chip)) ? `<p>${esc(text)}</p>` : `<p><strong>${esc(chip)}:</strong> ${esc(text)}</p>`;
    }).join('');
  const stops = route.stops.map((s) => `<li>${link(`https://www.google.com/maps?q=${s.lat},${s.lng}`, L.pick(s, 'name'))}</li>`).join('');
  const hasRes = [...used].some((n) => notes[n]?.reservation);
  let iett = '';
  if (route.iett) {
    const fb = state.km18Fallback;
    const standing = state.analyses.filter((a) => a.standing && !a.ann.fake);
    iett = `<h3>${vehicleBadge({ kind: 'iett', line: route.iett })}</h3>
      <p>${esc(L.pick(fb, state.dir === 'toCampus' ? 'toCampusInfo' : 'fromCampusInfo'))}</p>
      ${standing.length ? `<p class="sub">${esc(t('iettNotes'))}</p>${standing.map((a) => `<p class="note-old" lang="tr">${esc(a.ann.text)}</p>`).join('')}` : ''}
      <p>${link(CONFIG.iettRouteUrl, t('iettPage'))}</p>`;
  }
  return `<div class="notes">
    <h3>${vehicleBadge({ kind: 'shuttle' })}</h3>
    ${info}${special}
    ${hasRes ? `<p>${link(state.shuttle.reservationUrl, t('bookingSystem'))}</p>` : ''}
    <p class="sub">${esc(t('stopsMap'))}</p><ul class="stops">${stops}</ul>
    ${iett}
  </div>`;
}

function renderProgram() {
  const nowMs = now();
  const todayKey = C.dateKeyOf(nowMs);
  if (!state.programDate || state.programDate < todayKey || state.programDate > C.addDays(todayKey, 6)) state.programDate = todayKey;
  return `<div class="program">${programControls(nowMs)}<div id="program-list">${programList(nowMs)}</div>${programNotes()}</div>`;
}

/* ---------------- Bilgi ---------------- */

function renderInfo() {
  const term = state.shuttle.term;
  const k = state.km18;
  const a = state.ann;
  const sc = state.shuttleCheck;
  const fb = state.km18Fallback;
  const kmLine = k.source === 'bundled'
    ? t('kmBundled', { date: L.fmtDate(fb.checked), auto: !!fb.updatedBy })
    : t('kmApi', { ago: ago(k.fetchedAt) });
  const annLine = a.fetchedAt
    ? t('annLine', { ago: ago(a.fetchedAt), failing: !!a.error, n: a.items.length })
    : t('annNone');
  let scLine = t('siteNotTried');
  if (sc) {
    scLine = sc.ok
      ? (sc.changed ? t('siteChanged', { name: sc.current }) : t('siteSame', { ago: ago(sc.checkedAt) }))
      : t('siteBlocked', { ago: ago(sc.checkedAt) });
  }
  const debugLink = LS.get('debugUnlocked') ? `<p><button type="button" class="link" data-tab-go="debug">${esc(t('debugLink'))}</button></p>` : '';
  const langBtn = (code, label) => `<button type="button" class="chip-btn" data-lang="${code}" aria-pressed="${state.lang === code}" lang="${code}">${label}</button>`;
  return `<div class="info">
    <section>
      <h2>${esc(t('langTitle'))}</h2>
      <div class="row" role="group" aria-label="${esc(t('langTitle'))}">${langBtn('tr', 'Türkçe')}${langBtn('en', 'English')}</div>
    </section>
    <section>
      <h2>${esc(t('aboutTitle'))}</h2>
      <p>${esc(t('aboutBody'))}</p>
      <p>${esc(t('aboutFav'))}</p>
      ${state.installPrompt ? `<p><button type="button" class="btn" id="install">${esc(t('install'))}</button></p>` : ''}
    </section>
    <section>
      <h2>${esc(t('dataTitle'))}</h2>
      <dl>
        <dt>${esc(t('shuttleProgram'))}</dt><dd>${esc(t('termLine', { range: L.fmtRange(term.validFrom, term.validTo), checked: L.fmtDate(term.checked) }))}</dd>
        <dt>${esc(t('siteCheck'))}</dt><dd>${esc(scLine)}</dd>
        <dt>${esc(t('kmTimetable'))}</dt><dd>${esc(kmLine)}</dd>
        <dt>${esc(t('kmAnn'))}</dt><dd>${esc(annLine)}</dd>
      </dl>
      <p><button type="button" class="btn" id="refresh-now">${esc(t('refreshNow'))}</button></p>
    </section>
    <section>
      <h2>${esc(t('linksTitle'))}</h2>
      <ul class="links">
        <li>${link(state.shuttle.source, t('linkShuttle'))}</li>
        <li>${link(state.shuttle.reservationUrl, t('bookingSystem'))}</li>
        <li>${link(CONFIG.iettRouteUrl, t('linkIett'))}</li>
      </ul>
    </section>
    <section>
      <h2>${esc(t('installTitle'))}</h2>
      <p>${esc(t('installBody'))}</p>
    </section>
    <section>
      <h2>${esc(t('sourcesTitle'))}</h2>
      <p>${t('sourcesIett')}</p>
      <p>${t('sourcesShuttle', { url: esc(state.shuttle.source) })}</p>
      <p>${esc(t('disclaimer'))}</p>
      <p>${esc(t('font'))}</p>
    </section>
    <section>
      <h2>${esc(t('privacyTitle'))}</h2>
      <p>${esc(t('privacy1'))}</p>
      <p>${esc(t('privacy2'))}</p>
    </section>
    <footer class="credits">
      <p class="credits-name">${esc(t('appName'))}</p>
      <p><button type="button" id="version">${esc(t('version', { v: CONFIG.version, date: L.fmtDate(CONFIG.buildDate) }))}</button></p>
      <p>${esc(t('builtWith', { model: CONFIG.builtWith.replace(/ /g, '\u00a0') }))}</p>
      ${debugLink}
    </footer>
  </div>`;
}

/* ---------------- Bantlar ---------------- */

function renderBanners() {
  const nowMs = now();
  const out = [];
  if (state.sim) {
    out.push(`<div class="banner sim"><p>${esc(t('simBanner', { when: `${L.fmtDateLong(C.dateKeyOf(nowMs))} ${C.fmtClock(nowMs)}`, stopped: !state.sim.running }))}</p><button type="button" data-action="real-time">${esc(t('realTime'))}</button></div>`);
  }
  if (state.updateReady) {
    out.push(`<div class="banner info"><p>${esc(t('updateReady'))}</p><button type="button" data-action="reload">${esc(t('reload'))}</button></div>`);
  }
  if (state.tab === 'next' || state.tab === 'program' || state.tab === 'fav') {
    const todayKey = C.dateKeyOf(nowMs);
    const term = state.shuttle.term;
    if (todayKey > term.validTo) {
      out.push(`<div class="banner warn"><p>${t('termExpired', { date: esc(L.fmtDate(term.validTo)), link: link(state.shuttle.source, t('termExpiredLink')) })}</p></div>`);
    } else if (state.shuttleCheck?.ok && state.shuttleCheck.changed) {
      out.push(`<div class="banner warn"><p>${esc(t('siteNewTerm', { name: state.shuttleCheck.current }))}</p></div>`);
    }
    const alerts = state.analyses.filter((x) => !x.standing && !x.expired && !state.dismissed.has(x.ann.id));
    for (const x of alerts) {
      const { ann, analysis } = x;
      const when = Number.isFinite(ann.updatedMs) ? `${C.fmtClock(ann.updatedMs)}${C.dateKeyOf(ann.updatedMs) !== todayKey ? `, ${L.fmtDate(C.dateKeyOf(ann.updatedMs))}` : ''}` : '';
      const lead = analysis.isCancel
        ? (analysis.items.length
          ? t('annCancel', { list: analysis.items.map((i) => `${i.time} (${i.dir === 'fromCampus' ? t('fromCampusShort') : t('toCampusShort')})`).join(', ') })
          : t('annCancelGeneric'))
        : t('annNotice');
      const meta = [ann.fake ? t('testAnn') : 'İETT', when, t('origTurkish')].filter(Boolean).join(' · ');
      out.push(`<div class="banner ${analysis.isCancel ? 'cancel' : 'note'}${ann.fake ? ' fake' : ''}">
        <p><strong>KM18 · ${esc(lead)}</strong></p>
        <p lang="tr">${esc(ann.text)}</p>
        <p class="meta">${esc(meta)}</p>
        <button type="button" data-dismiss="${esc(ann.id)}">${esc(t('dismiss'))}</button>
      </div>`);
    }
  }
  $('#banners').innerHTML = out.join('');
}

/* ---------------- Ana çizim ---------------- */

/** index.html'deki sabit metinler (üst bant, sekmeler) */
function applyStatic() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

export function render() {
  if (!state.shuttle) return;
  const nowMs = now();
  applyStatic();
  $('#clock').textContent = C.fmtClock(nowMs);
  document.querySelectorAll('.dir button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === state.dir)));
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  document.body.dataset.tab = state.tab;
  renderBanners();
  const view = $('#view');
  if (state.tab === 'fav') view.innerHTML = renderFav();
  else if (state.tab === 'next') view.innerHTML = renderNext();
  else if (state.tab === 'program') {
    const keep = $('.pick.routes')?.scrollLeft || 0;
    view.innerHTML = renderProgram();
    const r = $('.pick.routes');
    if (r) r.scrollLeft = keep;
  } else if (state.tab === 'info') view.innerHTML = renderInfo();
  else if (state.tab === 'debug') view.innerHTML = renderDebug(ctx);
}

/** Saniyelik akışta sadece değişen yerleri yenile (debug ekranındaki formlar silinmesin). */
function tick() {
  if (!state.shuttle) return;
  const nowMs = now();
  recompute();
  $('#clock').textContent = C.fmtClock(nowMs);
  if (state.tab === 'next' || state.tab === 'fav') {
    $('#view').innerHTML = state.tab === 'fav' ? renderFav() : renderNext();
    renderBanners();
  } else if (state.tab === 'program') {
    const list = $('#program-list');
    if (list) list.innerHTML = programList(nowMs);
    renderBanners();
  } else if (state.tab === 'debug') {
    const el = $('#dbg-now');
    if (el) el.textContent = `${C.fmtDateLong(C.dateKeyOf(nowMs))} ${C.fmtClock(nowMs)}:${String(C.wall(nowMs).s).padStart(2, '0')}`;
    renderBanners();
  }
}

export function setTab(tab) {
  state.tab = tab;
  if (tab !== 'debug' && location.hash === '#debug') history.replaceState(null, '', location.pathname + location.search);
  render();
  window.scrollTo({ top: 0 });
}

/* ---------------- Olaylar ---------------- */

let versionTaps = [];

function bind() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('button, a');
    if (!el) return;
    const d = el.dataset;
    if (d.fav) {
      const id = d.fav;
      const on = state.favs.includes(id);
      state.favs = on ? state.favs.filter((x) => x !== id) : [...state.favs, id];
      LS.set('favs', state.favs);
      toast(on ? t('favRemoved') : t('favAdded'));
      render();
    } else if (d.favPast) {
      if (state.favShowPast.has(d.favPast)) state.favShowPast.delete(d.favPast);
      else state.favShowPast.add(d.favPast);
      render();
    } else if (d.lang) {
      setLanguage(d.lang);
    } else if (d.dir) {
      state.dir = d.dir;
      LS.set('dir', state.dir);
      render();
    } else if (d.tab) {
      setTab(d.tab);
    } else if (d.tabGo) {
      setTab(d.tabGo);
    } else if (d.route) {
      state.programRoute = d.route;
      LS.set('programRoute', d.route);
      render();
    } else if (d.openRoute) {
      state.programRoute = d.openRoute;
      LS.set('programRoute', d.openRoute);
      setTab('program');
    } else if (d.date) {
      state.programDate = d.date;
      render();
    } else if (d.dismiss) {
      state.dismissed.add(d.dismiss);
      LS.set('dismissed', [...state.dismissed].slice(-200));
      render();
    } else if (d.action === 'real-time') {
      setSim(null);
      toast(t('realTimeBack'));
    } else if (d.action === 'reload') {
      location.reload();
    } else if (el.id === 'refresh' || el.id === 'refresh-now') {
      refreshAll(true).then(() => toast(state.ann.error ? t('iettFail') : t('updated')));
    } else if (el.id === 'install' && state.installPrompt) {
      state.installPrompt.prompt();
      state.installPrompt = null;
    } else if (el.id === 'version') {
      const tm = Date.now();
      versionTaps = versionTaps.filter((x) => tm - x < 4000).concat(tm);
      if (versionTaps.length >= 7) {
        versionTaps = [];
        LS.set('debugUnlocked', true);
        toast(t('debugOpened'));
        setTab('debug');
      }
    }
  });
  bindDebug(ctx);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      state.resumedAt = Date.now();
      state.swReg?.update().catch(() => {});
      tick();
      refreshAll(false);
    }
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#debug') setTab('debug'); });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    if (state.tab === 'info') render();
  });
  window.addEventListener('online', () => refreshAll(false));
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    state.swReg = reg;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state !== 'activated' || !state.hadController) return;
        // Uygulama yeni açıldıysa sessizce yeni sürüme geç; ekrana bakarken kesmemek için aksi halde bant göster
        if (Date.now() - state.resumedAt < 15000) location.reload();
        else { state.updateReady = true; renderBanners(); }
      });
    });
  }).catch(() => { /* dosya:// ya da desteklenmiyor */ });
  state.hadController = !!navigator.serviceWorker.controller;
}

/* ---------------- Başlangıç ---------------- */

const ctx = {
  state, LS, esc, ago, now, setSim, recompute, render, setTab, toast,
  refreshPlan, refreshAnnouncements, refreshShuttleCheck, refreshAll, proxyUrl, I, C, CONFIG,
};

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function init() {
  applyStatic();
  try {
    [state.shuttle, state.km18Fallback] = await Promise.all([loadJson('./data/shuttle.json'), loadJson('./data/km18.json')]);
  } catch (e) {
    $('#view').innerHTML = `<p class="none pad">${esc(t('dataLoadFail', { msg: e.message }))}</p>`;
    return;
  }
  applyCachedPlan();
  const cachedAnn = LS.get('ann');
  if (cachedAnn?.items && Date.now() - cachedAnn.fetchedAt < 12 * 3600000) {
    Object.assign(state.ann, { items: cachedAnn.items, fetchedAt: cachedAnn.fetchedAt, strategy: cachedAnn.strategy, totalRows: cachedAnn.totalRows });
  }
  state.favs = state.favs.filter((id) => state.shuttle.routes.some((r) => r.id === id));
  state.tab = location.hash === '#debug' ? 'debug' : state.favs.length ? 'fav' : 'next';
  bind();
  recompute();
  render();
  registerSW();
  setInterval(tick, 10000);
  setInterval(() => { if (document.visibilityState === 'visible') refreshAll(false); }, 60000);
  refreshAll(false);
}

init();
