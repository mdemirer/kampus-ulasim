// Saf mantık: İstanbul saati, gün tipleri, seferlerin takvime yayılması, sıradaki araç.
// Tarayıcıda ve Node testlerinde aynı dosya kullanılır; DOM'a dokunmaz.

export const TZ_OFFSET_MS = 3 * 3600 * 1000; // Europe/Istanbul: 2016'dan beri sabit UTC+3
export const NIGHT_CUTOFF_MIN = 4 * 60;       // 04:00'ten önceki saatler ertesi takvim gününe aittir
export const DAY_MS = 86400000;

export const DAY_TYPES = ['sunday', 'weekday', 'weekday', 'weekday', 'weekday', 'weekday', 'saturday'];
export const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const pad = (n) => String(n).padStart(2, '0');

/** Bir anın İstanbul'daki duvar saati bileşenleri. */
export function wall(ms) {
  const d = new Date(ms + TZ_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
  };
}

export function dateKeyOf(ms) {
  const w = wall(ms);
  return `${w.y}-${pad(w.mo + 1)}-${pad(w.d)}`;
}

export function parseDateKey(key) {
  const [y, mo, d] = key.split('-').map(Number);
  return { y, mo: mo - 1, d };
}

/** İstanbul'da o günün 00:00'ının epoch ms karşılığı. */
export function midnightOf(key) {
  const { y, mo, d } = parseDateKey(key);
  return Date.UTC(y, mo, d) - TZ_OFFSET_MS;
}

export function addDays(key, n) {
  return dateKeyOf(midnightOf(key) + n * DAY_MS + 3600000); // +1 sa: güvenli tarafta kal
}

export function dowOfKey(key) {
  const { y, mo, d } = parseDateKey(key);
  return new Date(Date.UTC(y, mo, d)).getUTCDay();
}

/** İstanbul duvar saatini ("2026-10-09T23:50") epoch ms'ye çevirir. */
export function wallToMs(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - TZ_OFFSET_MS;
}

export function msToWallInput(ms) {
  const w = wall(ms);
  return `${w.y}-${pad(w.mo + 1)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

export function parseHM(s) {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(s).trim());
  if (!m) return NaN;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}

export function fmtHM(min) {
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

export function fmtClock(ms) {
  const w = wall(ms);
  return `${pad(w.h)}:${pad(w.mi)}`;
}

export function fmtDateLong(key) {
  const { mo, d } = parseDateKey(key);
  return `${d} ${MONTHS[mo]} ${DAY_NAMES[dowOfKey(key)]}`;
}

/**
 * "19:40 2,14" → { time, min, notes:['2','14'], marker:null }
 * "15:50 E"    → { time, min, notes:[],         marker:'E' }
 */
export function parseEntry(raw) {
  const parts = String(raw).trim().split(/\s+/);
  const min = parseHM(parts[0]);
  const out = { time: fmtHM(min), min, notes: [], marker: null };
  for (const tok of parts.slice(1)) {
    if (/^[0-9,]+$/.test(tok)) out.notes.push(...tok.split(',').filter(Boolean));
    else out.marker = tok;
  }
  return out;
}

/**
 * Bir "hizmet": tek güzergâh + tek yön + tek araç tipi.
 * lists: { weekday:[...], saturday:[...], sunday:[...] } (ham string ya da parse edilmiş giriş)
 */
export function makeService({ id, kind, routeId, dir, line = null, lists, noteDefs = {}, markerDefs = {}, validTo = null }) {
  const parsed = {};
  for (const t of ['weekday', 'saturday', 'sunday']) {
    parsed[t] = (lists?.[t] || [])
      .map((e) => (typeof e === 'string' ? parseEntry(e) : e))
      .filter((e) => Number.isFinite(e.min));
  }
  return { id, kind, routeId, dir, line, lists: parsed, noteDefs, markerDefs, validTo };
}

/** Hizmetin, takvim anı olarak [startMs, endMs] aralığına düşen seferleri. */
export function expandService(svc, startMs, endMs) {
  const out = [];
  const firstKey = addDays(dateKeyOf(startMs), -1);
  const lastKey = dateKeyOf(endMs);
  for (let key = firstKey, guard = 0; key <= lastKey && guard < 400; key = addDays(key, 1), guard++) {
    const dow = dowOfKey(key);
    const list = svc.lists[DAY_TYPES[dow]] || [];
    const base = midnightOf(key);
    for (const e of list) {
      const defs = e.notes.map((n) => svc.noteDefs[n]).filter(Boolean);
      if (defs.some((d) => Array.isArray(d.serviceDays) && !d.serviceDays.includes(dow))) continue;
      const night = e.min < NIGHT_CUTOFF_MIN;
      const ms = base + (e.min + (night ? 1440 : 0)) * 60000;
      if (ms < startMs || ms > endMs) continue;
      const marker = e.marker ? (svc.markerDefs[e.marker] || { text: `Farklı güzergâh (${e.marker})`, chip: `Farklı güzergâh` }) : null;
      const chips = [];
      for (const d of defs) if (d.chip) chips.push(d.chip);
      if (marker?.chip) chips.push(marker.chip);
      const dateKey = dateKeyOf(ms);
      out.push({
        key: `${svc.kind}:${svc.line || svc.routeId}:${svc.dir}:${key}:${e.time}`,
        serviceId: svc.id, kind: svc.kind, line: svc.line, routeId: svc.routeId, dir: svc.dir,
        serviceKey: key, dateKey, ms, time: e.time,
        night, nightOf: night ? key : null,
        notes: e.notes, marker: e.marker, markerDef: marker,
        skipsCampus: !!marker?.skipsCampus,
        reservation: defs.some((d) => d.reservation),
        chips,
        beyondTerm: svc.validTo ? dateKey > svc.validTo : false,
        cancelled: false, cancelInfo: null,
      });
    }
  }
  return out;
}

export function tripsBetween(services, startMs, endMs, cancellations = null) {
  const all = services.flatMap((s) => expandService(s, startMs, endMs));
  if (cancellations) {
    for (const t of all) {
      const c = cancellations.get(t.key);
      if (c) { t.cancelled = true; t.cancelInfo = c; }
    }
  }
  all.sort((a, b) => a.ms - b.ms || (a.kind === 'shuttle' ? -1 : 1));
  return all;
}

/**
 * Sıradaki seferler: iptal edilmemiş `count` sefer toplanana kadar ilerler;
 * aradaki iptal seferleri de (üstü çizili göstermek için) listede kalır.
 * Kampüsten kalkmayan seferler (skipsCampus) hiç sayılmaz.
 */
export function upcoming(services, nowMs, { count = 3, graceMs = 60000, horizonDays = 8, cancellations = null } = {}) {
  const list = tripsBetween(services, nowMs - graceMs, nowMs + horizonDays * DAY_MS, cancellations)
    .filter((t) => !t.skipsCampus);
  const out = [];
  let live = 0;
  for (const t of list) {
    out.push(t);
    if (!t.cancelled) live++;
    if (live >= count) break;
  }
  return out;
}

/** Bir takvim gününün tüm seferleri (gece yarısından sonrakiler dahil, önceki günden gelenler o güne yazılır). */
export function dayProgram(services, dateKey, cancellations = null) {
  const start = midnightOf(dateKey);
  return tripsBetween(services, start, start + DAY_MS - 1, cancellations);
}

/** "12 dk", "1 sa 5 dk", "Kalkıyor"... */
export function countdown(ms, nowMs) {
  const diff = ms - nowMs;
  if (diff <= 0) return { big: 'Kalkıyor', unit: '', soon: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return { big: '<1', unit: 'dk', soon: true };
  if (mins < 100) return { big: String(mins), unit: 'dk', soon: mins <= 5 };
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 10) return { big: String(h), unit: m ? `sa ${m} dk` : 'sa', soon: false };
  return { big: null, unit: '', soon: false };
}

/** Seferin gününü bugüne göre etiketler: "", "Yarın", "Cuma"... */
export function dayLabel(ms, nowMs) {
  const k = dateKeyOf(ms), today = dateKeyOf(nowMs);
  if (k === today) return '';
  if (k === addDays(today, 1)) return 'Yarın';
  return DAY_NAMES[dowOfKey(k)];
}

/** Gece seferi açıklaması: "Cuma'yı Cumartesi'ye bağlayan gece" */
const DAY_ACC = ["Pazar'ı", "Pazartesi'yi", "Salı'yı", "Çarşamba'yı", "Perşembe'yi", "Cuma'yı", "Cumartesi'yi"];
const DAY_DAT = ["Pazar'a", "Pazartesi'ye", "Salı'ya", "Çarşamba'ya", "Perşembe'ye", "Cuma'ya", "Cumartesi'ye"];
export function nightLabel(serviceKey) {
  const a = dowOfKey(serviceKey);
  return `${DAY_ACC[a]} ${DAY_DAT[(a + 1) % 7]} bağlayan gece`;
}

/** shuttle.json + KM18 tarifesinden, seçilen yön için güzergâh başına hizmet listesi. */
export function buildServices(shuttle, km18, dir) {
  const byRoute = new Map();
  for (const r of shuttle.routes) {
    const svcs = [makeService({
      id: `shuttle:${r.id}:${dir}`, kind: 'shuttle', routeId: r.id, dir,
      lists: r[dir], noteDefs: shuttle.notes, validTo: shuttle.term?.validTo || null,
    })];
    if (r.iett && km18 && km18[dir]) {
      svcs.push(makeService({
        id: `iett:${r.iett}:${dir}`, kind: 'iett', routeId: r.id, dir, line: r.iett,
        lists: km18[dir], markerDefs: km18.markers || {},
      }));
    }
    byRoute.set(r.id, svcs);
  }
  return byRoute;
}

/**
 * "Bugün" penceresi: 04:00'ten ertesi gün 04:00'e kadar. Gece 01:30'da hâlâ önceki günün
 * penceresindeyiz, böylece Cuma gecesinin 00:45 ve 02:00 seferleri "bugün"ün sonunda görünür.
 */
export function serviceDayWindow(nowMs) {
  const today = dateKeyOf(nowMs);
  const key = wall(nowMs).h * 60 + wall(nowMs).mi < NIGHT_CUTOFF_MIN ? addDays(today, -1) : today;
  const start = midnightOf(key) + NIGHT_CUTOFF_MIN * 60000;
  return { key, start, end: start + DAY_MS - 1 };
}
