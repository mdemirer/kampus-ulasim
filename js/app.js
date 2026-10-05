import { CONFIG } from './config.js';
import * as C from './core.js';
import * as I from './iett.js';
import { renderDebug, bindDebug } from './debug.js';

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

export function ago(ms) {
  if (!ms) return 'hiç';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'az önce';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} sa önce`;
  return `${Math.round(h / 24)} gün önce`;
}

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
  dir: LS.get('dir', 'fromCampus'),
  tab: 'next',
  programRoute: LS.get('programRoute', 'kurtkoy'),
  programDate: null,
  sim: LS.get('sim', null),
  fakeAnns: LS.get('fakeAnns', []),
  dismissed: new Set(LS.get('dismissed', [])),
  shuttleCheck: LS.get('shuttleCheck', null),
  attempts: { plan: [], duyuru: [] },
  updateReady: false,
  installPrompt: null,
  busy: false,
};

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

function km18Data() {
  const fb = state.km18Fallback;
  if (!fb) return null;
  const lists = state.km18.lists || { fromCampus: fb.fromCampus, toCampus: fb.toCampus };
  return { ...fb, fromCampus: lists.fromCampus, toCampus: lists.toCampus };
}

/** Duyuruları yeniden değerlendirir, iptal haritasını kurar. */
export function recompute() {
  if (!state.km18Fallback) return;
  const t = now();
  const todayKey = C.dateKeyOf(t);
  const plan = km18Data();
  const all = [...state.ann.items, ...state.fakeAnns.map((a) => ({ ...a, fake: true }))];
  state.analyses = all.map((ann) => {
    const analysis = I.analyzeAnnouncement(ann, { nowMs: t, plan });
    const cls = I.classifyAnnouncement(ann, analysis, { nowMs: t, standingAfterDays: CONFIG.standingAfterDays, todayKey });
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
  if (!force && state.km18.failedAt && Date.now() - state.km18.failedAt < 60 * 60000) return;
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
      state.km18 = { ...entry, source: 'api', error: null };
    } catch (e) {
      state.km18.error = e.message;
      state.km18.failedAt = Date.now();
    }
  } else {
    state.km18.error = 'İBB tarife servisine ulaşılamadı';
    state.km18.failedAt = Date.now();
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

function whenLabel(trip, t) {
  const today = C.dateKeyOf(t);
  if (trip.dateKey === today) return '';
  if (trip.night && trip.serviceKey === today) return 'bu gece';
  return C.dayLabel(trip.ms, t);
}

function routeById(id) { return state.shuttle.routes.find((r) => r.id === id) || state.shuttle.routes[0]; }

function dirTitle(route) {
  return state.dir === 'fromCampus' ? `Kampüs → ${route.name}` : `${route.name} → Kampüs`;
}

/* ---------------- Sıradaki ---------------- */

function routeRow(route, trips, t) {
  const leadIdx = trips.findIndex((x) => !x.cancelled);
  const lead = trips[leadIdx];
  const name = `<h2><button type="button" class="route-link" data-open-route="${route.id}">${esc(route.name)}</button></h2>`;
  if (!lead) {
    return `<section class="route empty">${name}<p class="none">Önümüzdeki günlerde bu yönde sefer yok.</p></section>`;
  }
  const before = trips.slice(0, leadIdx);
  // Seyrek hatlarda günler sonrasını sıralamak gürültü olur: en fazla 24 saat ileriyi göster
  const later = trips.slice(leadIdx + 1).filter((x) => x.ms < t + C.DAY_MS);
  const diff = lead.ms - t;
  const wl = whenLabel(lead, t);
  const cd = C.countdown(lead.ms, t);
  let big;
  const asClock = !(diff < 10 * 3600000 && cd.big);
  if (!asClock) {
    big = `<b${cd.big.length > 3 ? ' class="word"' : ''}>${esc(cd.big)}</b>${cd.unit ? `<span class="unit">${cd.unit}</span>` : ''}`;
  } else {
    big = `<b>${C.fmtClock(lead.ms)}</b>`;
  }
  const chips = [...lead.chips];
  if (lead.beyondTerm) chips.push('Program dönemi dışında');
  const cancelLine = before.length
    ? `<p class="cancelled-line">${before.map((x) => `<s>${x.time}</s> ${esc(x.line || 'Shuttle')} iptal`).join(', ')}</p>`
    : '';
  const laterHtml = later.length
    ? `<ol class="later">${later.map((x) => {
      const lbl = whenLabel(x, t);
      return `<li class="${x.kind}${x.cancelled ? ' x' : ''}">${vehicleBadge(x, { withLine: false })}<time>${x.time}</time>${x.cancelled ? '<em>iptal</em>' : ''}${lbl ? `<span class="d">${esc(lbl)}</span>` : ''}</li>`;
    }).join('')}</ol>`
    : '';
  let foot = '';
  if (route.iett) {
    const src = state.km18.source === 'bundled' ? 'gömülü tarife' : 'İBB tarifesi';
    const annTxt = state.ann.fetchedAt && !state.ann.error
      ? `iptal bilgisi ${ago(state.ann.fetchedAt)}`
      : state.ann.fetchedAt ? `iptal bilgisi ${ago(state.ann.fetchedAt)} (şu an alınamıyor)` : 'iptal bilgisi alınamadı';
    foot = `<p class="foot${!state.ann.fetchedAt || state.ann.error ? ' warn' : ''}">${route.iett}: ${src} · ${annTxt}</p>`;
  }
  return `<section class="route ${lead.kind}">
    ${name}
    ${cancelLine}
    <div class="lead">
      <div class="count">${big}</div>
      <div class="meta">
        <div class="when">${asClock ? '' : `<time>${lead.time}</time>`}${wl ? `<span class="d${asClock ? ' big-d' : ''}">${esc(wl)}</span>` : ''}${vehicleBadge(lead)}</div>
        ${chips.length ? `<p class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</p>` : ''}
        ${lead.reservation ? `<p class="res"><a href="${esc(state.shuttle.reservationUrl)}" target="_blank" rel="noopener">Rezervasyon yap</a></p>` : ''}
      </div>
    </div>
    ${laterHtml}
    ${foot}
  </section>`;
}

function renderNext() {
  const t = now();
  const services = C.buildServices(state.shuttle, km18Data(), state.dir);
  const rows = state.shuttle.routes.map((r) => routeRow(r, C.upcoming(services.get(r.id), t, { count: 4, cancellations: state.cancellations }), t));
  return `<div class="board">${rows.join('')}</div>`;
}

/* ---------------- Program ---------------- */

function programControls(t) {
  const todayKey = C.dateKeyOf(t);
  const routes = state.shuttle.routes.map((r) => `<button type="button" class="chip-btn" data-route="${r.id}" aria-pressed="${r.id === state.programRoute}">${esc(r.name)}</button>`).join('');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = C.addDays(todayKey, i);
    const { d } = C.parseDateKey(k);
    const label = i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : C.DAY_SHORT[C.dowOfKey(k)];
    days.push(`<button type="button" class="day-btn" data-date="${k}" aria-pressed="${k === state.programDate}"><span>${label}</span><b>${d}</b></button>`);
  }
  return `<div class="pick routes" role="group" aria-label="Güzergâh">${routes}</div>
    <div class="pick days" role="group" aria-label="Gün">${days.join('')}</div>`;
}

function programList(t) {
  const route = routeById(state.programRoute);
  const svcs = C.buildServices(state.shuttle, km18Data(), state.dir).get(route.id);
  const trips = C.dayProgram(svcs, state.programDate, state.cancellations);
  const nextKey = C.upcoming(svcs, t, { count: 1, graceMs: 0, cancellations: state.cancellations }).find((x) => !x.cancelled)?.key;
  const head = `<h2 class="prog-title">${esc(dirTitle(route))}<span>${esc(C.fmtDateLong(state.programDate))}</span></h2>`;
  if (!trips.length) return `${head}<p class="none pad">Bu gün bu yönde sefer yok.</p>`;
  const items = trips.map((x) => {
    const past = x.ms < t - 60000;
    const chips = [...x.chips];
    if (x.night) chips.unshift(C.nightLabel(x.serviceKey));
    if (x.beyondTerm) chips.push('Program dönemi dışında');
    const cls = [x.kind, past && 'past', x.cancelled && 'x', x.skipsCampus && 'skip', x.key === nextKey && 'next'].filter(Boolean).join(' ');
    return `<li class="${cls}"><time>${x.time}</time>${vehicleBadge(x)}${x.cancelled ? '<em class="tag-x">İptal</em>' : ''}${x.key === nextKey ? '<em class="tag-next">Sıradaki</em>' : ''}${chips.length ? `<span class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</span>` : ''}</li>`;
  }).join('');
  return `${head}<ol class="prog">${items}</ol>`;
}

function programNotes() {
  const route = routeById(state.programRoute);
  const dirData = route[state.dir];
  const notes = state.shuttle.notes;
  const used = new Set();
  for (const t of ['weekday', 'saturday', 'sunday']) {
    for (const e of dirData[t]) C.parseEntry(e).notes.forEach((n) => used.add(n));
  }
  const info = (dirData.info || []).map((n) => `<p>${esc(notes[n]?.text)}</p>`).join('');
  const special = [...used].filter((n) => notes[n]?.chip && !(dirData.info || []).includes(Number(n)))
    .map((n) => {
      const t = notes[n].text;
      return fold1(t).startsWith(fold1(notes[n].chip)) ? `<p>${esc(t)}</p>` : `<p><strong>${esc(notes[n].chip)}:</strong> ${esc(t)}</p>`;
    }).join('');
  const stops = route.stops.map((s) => `<li><a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('');
  const hasRes = [...used].some((n) => notes[n]?.reservation);
  let iett = '';
  if (route.iett) {
    const fb = state.km18Fallback;
    const standing = state.analyses.filter((a) => a.standing && !a.ann.fake);
    iett = `<h3>${vehicleBadge({ kind: 'iett', line: route.iett })}</h3>
      <p>${esc(state.dir === 'toCampus' ? fb.toCampusInfo : fb.fromCampusInfo)}</p>
      ${standing.length ? `<p class="sub">İETT hat notları</p>${standing.map((a) => `<p class="note-old">${esc(a.ann.text)}</p>`).join('')}` : ''}
      <p><a href="${esc(CONFIG.iettRouteUrl)}" target="_blank" rel="noopener">İETT'de KM18 sayfası</a></p>`;
  }
  return `<div class="notes">
    <h3>${vehicleBadge({ kind: 'shuttle' })}</h3>
    ${info}${special}
    ${hasRes ? `<p><a href="${esc(state.shuttle.reservationUrl)}" target="_blank" rel="noopener">Shuttle rezervasyon sistemi</a></p>` : ''}
    <p class="sub">Duraklar (haritada aç)</p><ul class="stops">${stops}</ul>
    ${iett}
  </div>`;
}

const fold1 = (x) => I.fold(x).replace(/[^a-z0-9]/g, '');

function renderProgram() {
  const t = now();
  const todayKey = C.dateKeyOf(t);
  if (!state.programDate || state.programDate < todayKey || state.programDate > C.addDays(todayKey, 6)) state.programDate = todayKey;
  return `<div class="program">${programControls(t)}<div id="program-list">${programList(t)}</div>${programNotes()}</div>`;
}

/* ---------------- Bilgi ---------------- */

function renderInfo() {
  const term = state.shuttle.term;
  const k = state.km18;
  const a = state.ann;
  const sc = state.shuttleCheck;
  const { d: d1, mo: m1, y: y1 } = C.parseDateKey(term.validFrom);
  const { d: d2, mo: m2, y: y2 } = C.parseDateKey(term.validTo);
  const kmLine = k.source === 'bundled'
    ? `Uygulamaya gömülü tarife (${esc(fmtKey(state.km18Fallback.checked))} tarihinde kontrol edildi).${k.error ? ` İBB'den güncel tarife alınamadı.` : ''}`
    : `İBB'den alındı, ${ago(k.fetchedAt)}.`;
  const annLine = a.fetchedAt
    ? `Son kontrol ${ago(a.fetchedAt)}${a.error ? ', şu an alınamıyor' : ''}. ${a.items.length ? `KM18 için ${a.items.length} duyuru var.` : 'KM18 için duyuru yok.'}`
    : 'İBB duyuru servisine ulaşılamadı; iptal edilen seferler görünmez.';
  let scLine = 'Henüz denenmedi.';
  if (sc) {
    scLine = sc.ok
      ? (sc.changed ? `Sitede farklı bir program görünüyor: ${esc(sc.current)}.` : `Sitedeki program uygulamadakiyle aynı (${ago(sc.checkedAt)}).`)
      : `Okul sitesi uygulamanın sayfayı okumasına izin vermiyor; saatler uygulamanın içinden gösteriliyor (${ago(sc.checkedAt)}).`;
  }
  const debugLink = LS.get('debugUnlocked') ? '<p><button type="button" class="link" data-tab-go="debug">Debug ekranı</button></p>' : '';
  return `<div class="info">
    <section>
      <h2>Bu uygulama</h2>
      <p>Kampüse gelen ve kampüsten kalkan shuttle'ları ve İETT KM18 otobüsünü tek ekranda gösterir. Kurtköy satırında ikisi birlikte, hangisi önce kalkıyorsa o üstte.</p>
      ${state.installPrompt ? '<p><button type="button" class="btn" id="install">Uygulamayı yükle</button></p>' : ''}
    </section>
    <section>
      <h2>Veriler</h2>
      <dl>
        <dt>Shuttle programı</dt><dd>${d1} ${C.MONTHS[m1]}${y1 !== y2 ? ` ${y1}` : ''} – ${d2} ${C.MONTHS[m2]} ${y2} dönemi. ${esc(fmtKey(term.checked))} tarihinde okul sitesinden alındı.</dd>
        <dt>Okul sitesi kontrolü</dt><dd>${scLine}</dd>
        <dt>KM18 tarifesi</dt><dd>${kmLine}</dd>
        <dt>KM18 iptal ve duyurular</dt><dd>${annLine}</dd>
      </dl>
      <p><button type="button" class="btn" id="refresh-now">İETT bilgisini şimdi yenile</button></p>
    </section>
    <section>
      <h2>Bağlantılar</h2>
      <ul class="links">
        <li><a href="${esc(state.shuttle.source)}" target="_blank" rel="noopener">Okulun shuttle sayfası</a></li>
        <li><a href="${esc(state.shuttle.reservationUrl)}" target="_blank" rel="noopener">Shuttle rezervasyon sistemi</a></li>
        <li><a href="${esc(CONFIG.iettRouteUrl)}" target="_blank" rel="noopener">İETT KM18 sayfası</a></li>
      </ul>
    </section>
    <section>
      <h2>Telefona kurmak</h2>
      <p>Android'de Chrome menüsünden "Ana ekrana ekle" ya da "Uygulamayı yükle". iPhone'da Safari'de Paylaş düğmesi, sonra "Ana Ekrana Ekle".</p>
    </section>
    <section>
      <h2>Kaynaklar ve lisans</h2>
      <p>KM18 tarifesi ve duyuruları İETT'nin İBB Açık Veri Portalı'nda yayımladığı web servislerinden alınır (<a href="https://data.ibb.gov.tr/dataset/iett-planlanan-sefer-saati-web-servisi" target="_blank" rel="noopener">Planlanan Sefer Saati</a>, <a href="https://data.ibb.gov.tr/dataset/iett-duyurular-web-servisi" target="_blank" rel="noopener">Duyurular</a>) ve <a href="https://data.ibb.gov.tr/license" target="_blank" rel="noopener">İBB Açık Veri Lisansı</a> kapsamında kullanılır.</p>
      <p>Shuttle saatleri <a href="${esc(state.shuttle.source)}" target="_blank" rel="noopener">Sabancı Üniversitesi'nin shuttle sayfasından</a> alınmıştır; durak açıklamaları kısaltılarak yeniden yazılmıştır.</p>
      <p>Bu uygulama Sabancı Üniversitesi, İETT ya da İBB'nin resmi uygulaması değildir ve onlar tarafından onaylanmamıştır. Saatler bilgi amaçlıdır; kesin bilgi için resmi kaynaklara bak.</p>
      <p>Yazı tipi: Barlow Condensed, SIL Open Font License.</p>
    </section>
    <section>
      <h2>Gizlilik</h2>
      <p>Uygulama kişisel veri toplamaz: hesap, çerez, reklam ya da kullanım takibi yok. Seçtiğin yön gibi tercihler ve son indirilen İETT verisi yalnızca bu cihazda saklanır, hiçbir yere gönderilmez.</p>
      <p>Veri almak için İBB'nin ve Sabancı Üniversitesi'nin sunucularına, uygulama güncellemesi için GitHub Pages'e bağlanır. Her web sitesinde olduğu gibi bu bağlantılarda cihazının IP adresi o sunuculara ulaşır.</p>
    </section>
    <p class="version"><button type="button" id="version">Sürüm ${CONFIG.version}</button></p>
    ${debugLink}
  </div>`;
}

function fmtKey(key) {
  const { y, mo, d } = C.parseDateKey(key);
  return `${d} ${C.MONTHS[mo]} ${y}`;
}

/* ---------------- Bantlar ---------------- */

function renderBanners() {
  const t = now();
  const out = [];
  if (state.sim) {
    out.push(`<div class="banner sim"><p>Test saati: ${esc(C.fmtDateLong(C.dateKeyOf(t)))} ${C.fmtClock(t)}${state.sim.running ? '' : ' (durduruldu)'}</p><button type="button" data-action="real-time">Gerçek saate dön</button></div>`);
  }
  if (state.updateReady) {
    out.push('<div class="banner info"><p>Uygulamanın yeni sürümü hazır.</p><button type="button" data-action="reload">Yenile</button></div>');
  }
  if (state.tab === 'next' || state.tab === 'program') {
    const todayKey = C.dateKeyOf(t);
    const term = state.shuttle.term;
    if (todayKey > term.validTo) {
      out.push(`<div class="banner warn"><p>Shuttle programının süresi ${esc(fmtKey(term.validTo))} tarihinde doldu. Saatler değişmiş olabilir; <a href="${esc(state.shuttle.source)}" target="_blank" rel="noopener">okul sitesine bak</a>.</p></div>`);
    } else if (state.shuttleCheck?.ok && state.shuttleCheck.changed) {
      out.push(`<div class="banner warn"><p>Okul sitesinde yeni bir shuttle programı var: ${esc(state.shuttleCheck.current)}. Uygulamadaki saatler eski olabilir.</p></div>`);
    }
    const alerts = state.analyses.filter((x) => !x.standing && !x.expired && !state.dismissed.has(x.ann.id));
    for (const x of alerts) {
      const { ann, analysis } = x;
      const when = Number.isFinite(ann.updatedMs) ? `${C.fmtClock(ann.updatedMs)}${C.dateKeyOf(ann.updatedMs) !== todayKey ? `, ${fmtKey(C.dateKeyOf(ann.updatedMs))}` : ''}` : '';
      const lead = analysis.isCancel
        ? (analysis.items.length ? `İptal: ${analysis.items.map((i) => `${i.time} (${i.dir === 'fromCampus' ? 'kampüsten' : 'kampüse'})`).join(', ')}` : 'İptal duyurusu')
        : 'Duyuru';
      out.push(`<div class="banner ${analysis.isCancel ? 'cancel' : 'note'}${ann.fake ? ' fake' : ''}">
        <p><strong>KM18 · ${esc(lead)}</strong></p>
        <p>${esc(ann.text)}</p>
        <p class="meta">${ann.fake ? 'Test duyurusu · ' : 'İETT · '}${esc(when)}</p>
        <button type="button" data-dismiss="${esc(ann.id)}">Gizle</button>
      </div>`);
    }
  }
  $('#banners').innerHTML = out.join('');
}

/* ---------------- Ana çizim ---------------- */

export function render() {
  if (!state.shuttle) return;
  const t = now();
  $('#clock').textContent = C.fmtClock(t);
  document.querySelectorAll('.dir button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === state.dir)));
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false'));
  document.body.dataset.tab = state.tab;
  renderBanners();
  const view = $('#view');
  if (state.tab === 'next') view.innerHTML = renderNext();
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
  const t = now();
  recompute();
  $('#clock').textContent = C.fmtClock(t);
  if (state.tab === 'next') {
    $('#view').innerHTML = renderNext();
    renderBanners();
  } else if (state.tab === 'program') {
    const list = $('#program-list');
    if (list) list.innerHTML = programList(t);
    renderBanners();
  } else if (state.tab === 'debug') {
    const el = $('#dbg-now');
    if (el) el.textContent = `${C.fmtDateLong(C.dateKeyOf(t))} ${C.fmtClock(t)}:${String(C.wall(t).s).padStart(2, '0')}`;
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
    if (d.dir) {
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
      toast('Gerçek saate dönüldü');
    } else if (d.action === 'reload') {
      location.reload();
    } else if (el.id === 'refresh' || el.id === 'refresh-now') {
      refreshAll(true).then(() => toast(state.ann.error ? 'İETT servisine ulaşılamadı' : 'Güncellendi'));
    } else if (el.id === 'install' && state.installPrompt) {
      state.installPrompt.prompt();
      state.installPrompt = null;
    } else if (el.id === 'version') {
      const t = Date.now();
      versionTaps = versionTaps.filter((x) => t - x < 4000).concat(t);
      if (versionTaps.length >= 7) {
        versionTaps = [];
        LS.set('debugUnlocked', true);
        toast('Debug ekranı açıldı');
        setTab('debug');
      }
    }
  });
  bindDebug(ctx);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
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
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'activated' && state.hadController) {
          state.updateReady = true;
          renderBanners();
        }
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
  try {
    [state.shuttle, state.km18Fallback] = await Promise.all([loadJson('./data/shuttle.json'), loadJson('./data/km18.json')]);
  } catch (e) {
    $('#view').innerHTML = `<p class="none pad">Veri dosyaları yüklenemedi (${esc(e.message)}). İnternete bağlanıp sayfayı yenile.</p>`;
    return;
  }
  applyCachedPlan();
  const cachedAnn = LS.get('ann');
  if (cachedAnn?.items && Date.now() - cachedAnn.fetchedAt < 12 * 3600000) {
    Object.assign(state.ann, { items: cachedAnn.items, fetchedAt: cachedAnn.fetchedAt, strategy: cachedAnn.strategy, totalRows: cachedAnn.totalRows });
  }
  if (location.hash === '#debug') state.tab = 'debug';
  bind();
  recompute();
  render();
  registerSW();
  setInterval(tick, 10000);
  setInterval(() => { if (document.visibilityState === 'visible') refreshAll(false); }, 60000);
  refreshAll(false);
}

init();
