// SUlaşım · Claude (Anthropic) tarafından geliştirildi — Claude Opus 5.5
// İBB / İETT web servisleri: istek, yanıt ayrıştırma, tarife ve duyuru işleme.
// Ağ dışındaki tüm fonksiyonlar saf; Node testlerinde de çalışır.

import {
  DAY_MS, DAY_TYPES, MONTHS, addDays, dateKeyOf, dowOfKey, fmtHM, parseHM, wallToMs,
} from './core.js';

const pad = (n) => String(n).padStart(2, '0');

/* ---------------- Metin yardımcıları ---------------- */

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&';
    if (l === 'lt') return '<';
    if (l === 'gt') return '>';
    if (l === 'quot') return '"';
    if (l === 'apos') return "'";
    if (l === 'nbsp') return ' ';
    if (l.startsWith('#x')) return String.fromCodePoint(parseInt(l.slice(2), 16));
    return String.fromCodePoint(parseInt(l.slice(1), 10));
  });
}

export function cleanText(v) {
  if (v == null) return '';
  return decodeEntities(String(v)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const FOLD = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };
/** Türkçe küçük harfe çevirip aksanları atar: "İPTAL EDİLMİŞTİR" → "iptal edilmistir" */
export function fold(s) {
  return String(s).toLocaleLowerCase('tr').replace(/[ışğüöçâîû]/g, (c) => FOLD[c]);
}

export function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function pick(row, ...patterns) {
  const keys = Object.keys(row || {});
  for (const re of patterns) {
    const k = keys.find((key) => re.test(key));
    if (k !== undefined) return row[k];
  }
  return undefined;
}

/* ---------------- Yanıt ayrıştırma ---------------- */

function unwrapJson(v) {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[') || t.startsWith('{') || t.startsWith('"')) {
      try { return unwrapJson(JSON.parse(t)); } catch { return v; }
    }
    return v;
  }
  if (v && !Array.isArray(v) && typeof v === 'object' && 'd' in v) return unwrapJson(v.d);
  return v;
}

/** SOAP zarfı, ASMX <string> yanıtı ya da düz JSON içinden veri dizisini çıkarır. */
export function extractPayload(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('Boş yanıt');
  if (t[0] === '[' || t[0] === '{' || t[0] === '"') return unwrapJson(JSON.parse(t));
  const result = /<(?:[\w-]+:)?(\w+Result)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/.exec(t);
  if (result) {
    const inner = decodeEntities(result[2]).trim();
    return inner ? unwrapJson(JSON.parse(inner)) : [];
  }
  if (/<(?:[\w-]+:)?\w+Result\b[^>]*\/>/.test(t)) return [];
  const str = /<string\b[^>]*>([\s\S]*?)<\/string>/i.exec(t);
  if (str) return unwrapJson(JSON.parse(decodeEntities(str[1]).trim()));
  const fault = /<(?:[\w-]+:)?(?:faultstring|Text)\b[^>]*>([\s\S]*?)<\//i.exec(t);
  if (fault) throw new Error('SOAP hatası: ' + cleanText(fault[1]).slice(0, 200));
  throw new Error('Tanınmayan yanıt biçimi');
}

/* ---------------- Planlı sefer saatleri ---------------- */

const DAYTYPE_MAP = { I: 'weekday', C: 'saturday', P: 'sunday' };

function firstToken(e) { return String(e).trim().split(/\s+/)[0]; }

/**
 * GetPlanlananSeferSaati_json satırlarını { fromCampus:{weekday,...}, toCampus:{...} } listelerine çevirir.
 * Yön eşlemesi (G/D → kampüsten/kampüse) gömülü yedek tarifeyle örtüşmeye bakılarak yapılır;
 * örtüşme yoksa G = Sabancı kalkışlı varsayılır.
 */
export function planFromRows(rows, fallback) {
  if (!Array.isArray(rows)) throw new Error('Tarife yanıtı dizi değil');
  const norm = [];
  const routeCount = {};
  for (const r of rows) {
    const yon = String(pick(r, /^S?YON$/i) ?? '').trim().toUpperCase();
    const gt = String(pick(r, /GUNTIPI/i) ?? '').trim().toUpperCase().charAt(0);
    const min = parseHM(String(pick(r, /^DT$/i, /SAAT/i) ?? ''));
    const guz = String(pick(r, /^S?GUZERGAH$/i) ?? '').trim();
    const rawMark = pick(r, /ISARET/i);
    const mark = rawMark == null ? '' : String(rawMark).trim();
    if (!yon || !DAYTYPE_MAP[gt] || !Number.isFinite(min)) continue;
    norm.push({ yon, dayType: DAYTYPE_MAP[gt], min, guz, mark });
    routeCount[yon] ??= {};
    routeCount[yon][guz] = (routeCount[yon][guz] || 0) + 1;
  }
  if (!norm.length) throw new Error('Tarifede geçerli satır yok');

  const yons = Object.keys(routeCount);
  const mainRoute = {};
  for (const y of yons) mainRoute[y] = Object.entries(routeCount[y]).sort((a, b) => b[1] - a[1])[0][0];

  const setOf = (dir) => new Set(['weekday', 'saturday', 'sunday']
    .flatMap((t) => (fallback?.[dir]?.[t] || []).map((e) => `${t}|${firstToken(e)}`)));
  const fbFrom = setOf('fromCampus');
  const fbTo = setOf('toCampus');
  const score = (y, set) => norm.filter((n) => n.yon === y && set.has(`${n.dayType}|${fmtHM(n.min)}`)).length;

  let mapping = null;
  let mappingBy = 'varsayılan (G = Sabancı kalkışlı)';
  if (yons.length === 2) {
    const [a, b] = yons;
    const s1 = score(a, fbFrom) + score(b, fbTo);
    const s2 = score(a, fbTo) + score(b, fbFrom);
    if (s1 !== s2) {
      mapping = s1 > s2 ? { [a]: 'fromCampus', [b]: 'toCampus' } : { [a]: 'toCampus', [b]: 'fromCampus' };
      mappingBy = `yedek tarifeyle örtüşme (${Math.max(s1, s2)}/${norm.length})`;
    }
  }
  if (!mapping) {
    mapping = {};
    for (const y of yons) mapping[y] = y === 'G' ? 'fromCampus' : y === 'D' ? 'toCampus' : null;
  }

  const fbMarker = (dir, dayType, time) => {
    const e = (fallback?.[dir]?.[dayType] || []).find((x) => firstToken(x) === time);
    const parts = e ? String(e).trim().split(/\s+/) : [];
    return parts.length > 1 && !/^[0-9,]+$/.test(parts[1]) ? parts[1] : '';
  };

  const lists = {
    fromCampus: { weekday: [], saturday: [], sunday: [] },
    toCampus: { weekday: [], saturday: [], sunday: [] },
  };
  for (const n of norm) {
    const dir = mapping[n.yon];
    if (!dir) continue;
    const time = fmtHM(n.min);
    let marker = n.mark && n.mark.length <= 3 && !/^(null|0)$/i.test(n.mark) ? n.mark : '';
    if (!marker && n.guz && n.guz !== mainRoute[n.yon]) marker = fbMarker(dir, n.dayType, time) || '*';
    lists[dir][n.dayType].push(marker ? `${time} ${marker}` : time);
  }
  for (const dir of Object.keys(lists)) {
    for (const t of Object.keys(lists[dir])) {
      const uniq = [...new Map(lists[dir][t].map((e) => [firstToken(e), e])).values()];
      lists[dir][t] = uniq.sort((x, y) => parseHM(firstToken(x)) - parseHM(firstToken(y)));
    }
  }
  if (lists.fromCampus.weekday.length < 3 || lists.toCampus.weekday.length < 3) {
    throw new Error('Tarife beklenenden kısa; yedek tarifede kalındı');
  }
  return { lists, mapping, mappingBy, rows: norm.length };
}

/* ---------------- Duyurular ---------------- */

export function parseIbbDate(v) {
  if (v == null) return NaN;
  const s = String(v).trim();
  let m = /\/Date\((-?\d+)/.exec(s);
  if (m) return +m[1];
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) return Date.parse(s);
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return wallToMs(`${m[1]}-${m[2]}-${m[3]}T${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return wallToMs(`${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`);
  return NaN;
}

/** Tüm hatların duyurularından ilgili hattınkileri seçer ve sadeleştirir. */
export function normalizeAnnouncements(rows, line) {
  if (!Array.isArray(rows)) throw new Error('Duyuru yanıtı dizi değil');
  const L = line.toUpperCase();
  const lineRe = new RegExp(`(^|[^A-Z0-9])${L.replace(/^([A-ZÇĞİÖŞÜ]+)(\d.*)$/, '$1\\s?-?$2')}([^A-Z0-9]|$)`, 'i');
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const hat = String(pick(r, /^HAT/i) ?? '').trim().toUpperCase();
    const text = cleanText(pick(r, /MESAJ/i, /METIN/i, /ICERIK/i));
    if (!text) continue;
    const hats = hat.split(/[\s,;/]+/).filter(Boolean);
    if (!hats.includes(L) && !lineRe.test(text)) continue;
    const id = hashStr(`${hat}|${text}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const updatedRaw = String(pick(r, /GUNCELLEME/i, /TARIH/i) ?? '');
    out.push({
      id, line: L, hat, text, updatedRaw,
      type: String(pick(r, /^TIP/i) ?? '').trim(),
      updatedMs: parseIbbDate(updatedRaw),
    });
  }
  return out;
}

const CANCEL_RE = /iptal|yapilama|yapilmayacak|yapilmamis|gerceklestirileme|gerceklesmeyecek|gerceklesmemis|calismayacak|calistirilmayacak|hizmet veril(?:e)?meyecek|seferden cikar|kaldiril/;
const MONTHS_FOLDED = MONTHS.map(fold);
const MONTH_RE = new RegExp(`(\\d{1,2})\\s+(${MONTHS_FOLDED.join('|')})(?:\\s+(\\d{4}))?`, 'g');

function placeBefore(f, idx) {
  const start = Math.max(0, idx - 45);
  const win = f.slice(start, idx);
  let best = null;
  let bestPos = -1;
  for (const [re, place] of [[/kurtkoy/g, 'kurtkoy'], [/sabanci|universite|\buni\b|\bunv\b|medeniyet/g, 'campus']]) {
    let m;
    while ((m = re.exec(win))) if (m.index > bestPos) { bestPos = m.index; best = place; }
  }
  return best;
}

/**
 * Duyuru metnini okur: iptal mi, hangi gün, hangi saat(ler), hangi yön.
 * plan: { fromCampus:{weekday:[...]}, toCampus:{...} } — o günün tarifesi; yön belirsizse saat buna göre eşlenir.
 */
export function analyzeAnnouncement(ann, { nowMs, plan }) {
  const f = fold(ann.text);
  const isCancel = CANCEL_RE.test(f);
  const baseMs = Number.isFinite(ann.updatedMs) ? ann.updatedMs : nowMs;
  let serviceKey = dateKeyOf(baseMs);
  const baseYear = +serviceKey.slice(0, 4);

  let explicit = null;
  let m = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(f);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    explicit = `${y}-${pad(m[2])}-${pad(m[1])}`;
  } else {
    MONTH_RE.lastIndex = 0;
    m = MONTH_RE.exec(f);
    if (m) explicit = `${m[3] || baseYear}-${pad(MONTHS_FOLDED.indexOf(m[2]) + 1)}-${pad(m[1])}`;
  }
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) serviceKey = explicit;
  else if (/\byarin\b/.test(f)) serviceKey = addDays(serviceKey, 1);

  // Tarihleri saat sanılmasın diye çıkar
  let s = f.replace(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g, ' ');
  s = s.replace(MONTH_RE, ' ');

  // Yön ipuçları: "Kurtköy kalkışlı" → kampüse; "Sabancı yönüne" → kampüse; tersleri kampüsten
  const votes = { fromCampus: 0, toCampus: 0 };
  for (const mm of s.matchAll(/kalkis/g)) {
    const p = placeBefore(s, mm.index);
    if (p === 'kurtkoy') votes.toCampus++;
    else if (p === 'campus') votes.fromCampus++;
  }
  for (const mm of s.matchAll(/yonu|istikamet/g)) {
    const p = placeBefore(s, mm.index);
    if (p === 'kurtkoy') votes.fromCampus++;
    else if (p === 'campus') votes.toCampus++;
  }
  let dirHint = null;
  if (votes.fromCampus && !votes.toCampus) dirHint = 'fromCampus';
  if (votes.toCampus && !votes.fromCampus) dirHint = 'toCampus';

  // Aralıklar: "16:00-18:00 saatleri arasında"
  const ranges = [];
  s = s.replace(/(\d{1,2})[:.](\d{2})\s*(?:-|–|—|ile)\s*(\d{1,2})[:.](\d{2})(?=[^.\d]{0,25}aras)/g, (all, h1, m1, h2, m2) => {
    const a = parseHM(`${h1}:${m1}`);
    const b = parseHM(`${h2}:${m2}`);
    if (Number.isFinite(a) && Number.isFinite(b)) ranges.push({ start: a, end: b });
    return ' ';
  });

  const times = [];
  for (const mm of s.matchAll(/(^|[^\d:.])(\d{1,2})[:.](\d{2})(?!\d)/g)) {
    const min = parseHM(`${mm[2]}:${mm[3]}`);
    if (Number.isFinite(min)) times.push(fmtHM(min));
  }

  const dayType = DAY_TYPES[dowOfKey(serviceKey)];
  const listOf = (dir) => (plan?.[dir]?.[dayType] || []).map(firstToken);
  const dirs = dirHint ? [dirHint] : ['fromCampus', 'toCampus'];
  const items = [];
  const unresolved = [];
  for (const time of [...new Set(times)]) {
    const ds = dirs.filter((d) => listOf(d).includes(time));
    if (!ds.length) unresolved.push(time);
    for (const d of ds) items.push({ dir: d, time });
  }
  for (const r of ranges) {
    for (const d of dirs) {
      for (const time of listOf(d)) {
        const mn = parseHM(time);
        if (mn >= r.start && mn <= r.end) items.push({ dir: d, time });
      }
    }
  }
  const uniq = [...new Map(items.map((i) => [`${i.dir}|${i.time}`, i])).values()];
  const ageDays = Number.isFinite(ann.updatedMs) ? (nowMs - ann.updatedMs) / DAY_MS : null;
  return {
    isCancel, serviceKey, explicitDate: !!explicit, dirHint, votes, times: [...new Set(times)], ranges,
    items: isCancel ? uniq : [], unresolved, ageDays,
  };
}

/** Kalıcı not mu (uyarı bandında gösterilmez), güncel duyuru mu? */
export function classifyAnnouncement(ann, analysis, { nowMs, standingAfterDays, todayKey }) {
  const f = fold(ann.text);
  const legend = !analysis.isCancel && /\boho\b|ozel halk|eski ankara cad/.test(f);
  const old = Number.isFinite(analysis.ageDays) && analysis.ageDays > standingAfterDays;
  const pastCancel = analysis.isCancel && analysis.serviceKey < todayKey;
  return { standing: legend || old, expired: pastCancel };
}

/** İptal edilen seferler: core.js'teki sefer anahtarıyla eşleşen Map. */
export function cancellationMap(analyses, line) {
  const map = new Map();
  for (const { ann, analysis } of analyses) {
    if (!analysis.isCancel) continue;
    for (const it of analysis.items) {
      map.set(`iett:${line}:${it.dir}:${analysis.serviceKey}:${it.time}`, { annId: ann.id, text: ann.text });
    }
  }
  return map;
}

/* ---------------- Okul sitesindeki dönem başlıkları ---------------- */

export function extractTerms(html) {
  const text = cleanText(html);
  const re = /(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+(?:\s+\d{4})?\s*[-–]\s*\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4}\s+[^()]{0,60}?Shuttle Program[ıi])\s*(\((?:Current Term|Güncel Dönem)\))?/g;
  const out = new Map();
  for (const m of text.matchAll(re)) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const prev = out.get(name);
    out.set(name, { name, current: !!m[2] || !!prev?.current });
  }
  return [...out.values()];
}

/* ---------------- Ağ ---------------- */

export const STRATEGIES = ['soap11', 'soap12', 'form', 'get'];
export const STRATEGY_LABELS = {
  proxy: 'Ara sunucu',
  soap11: 'SOAP 1.1',
  soap12: 'SOAP 1.2',
  form: 'HTTP POST (form)',
  get: 'HTTP GET',
};

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function buildRequest(strategy, { key, url, method, params }, { ns, proxyUrl }) {
  const body = Object.entries(params || {}).map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join('');
  const qs = new URLSearchParams(params || {}).toString();
  switch (strategy) {
    case 'proxy':
      return { url: `${proxyUrl.replace(/\/$/, '')}/${key}${qs ? `?${qs}` : ''}`, init: { method: 'GET' } };
    case 'soap11':
      return {
        url,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${ns}${method}"` },
          body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method} xmlns="${ns}">${body}</${method}></soap:Body></soap:Envelope>`,
        },
      };
    case 'soap12':
      return {
        url,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
          body: `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><${method} xmlns="${ns}">${body}</${method}></soap12:Body></soap12:Envelope>`,
        },
      };
    case 'form':
      return {
        url: `${url}/${method}`,
        init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs },
      };
    case 'get':
      return { url: `${url}/${method}${qs ? `?${qs}` : ''}`, init: { method: 'GET' } };
    default:
      throw new Error(`Bilinmeyen yöntem: ${strategy}`);
  }
}

export async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
}

export function describeFetchError(e) {
  if (e?.name === 'AbortError') return 'Zaman aşımı';
  if (e instanceof TypeError) return 'Erişilemedi (tarayıcı engeli/CORS ya da ağ hatası)';
  return e?.message || String(e);
}

const nowPerf = () => (globalThis.performance?.now ? performance.now() : Date.now());

/**
 * İBB servisini sırayla farklı yöntemlerle dener; ilk çalışanı döndürür.
 * preferred: daha önce çalışmış yöntem (önce o denenir).
 */
export async function callIbb(service, { ns, timeoutMs, proxyUrl = '', preferred = null, only = null }) {
  let order = only ? [only] : [...(proxyUrl ? ['proxy'] : []), ...STRATEGIES];
  if (preferred && order.includes(preferred)) order = [preferred, ...order.filter((s) => s !== preferred)];
  const attempts = [];
  for (const strategy of order) {
    const t0 = nowPerf();
    const att = { strategy, ok: false };
    try {
      const req = buildRequest(strategy, service, { ns, proxyUrl });
      att.url = req.url;
      const res = await fetchWithTimeout(req.url, req.init, timeoutMs);
      const text = await res.text();
      att.status = res.status;
      att.ms = Math.round(nowPerf() - t0);
      att.snippet = text.slice(0, 400);
      const data = extractPayload(text);
      if (!Array.isArray(data)) throw new Error('Yanıt bir liste değil');
      att.ok = true;
      att.count = data.length;
      attempts.push(att);
      return { ok: true, data, strategy, attempts };
    } catch (e) {
      att.ms ??= Math.round(nowPerf() - t0);
      att.error = describeFetchError(e);
      attempts.push(att);
      if (globalThis.navigator && navigator.onLine === false) break;
    }
  }
  return { ok: false, attempts };
}

export async function checkShuttlePage(url, termName, timeoutMs) {
  const t0 = nowPerf();
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', mode: 'cors' }, timeoutMs);
    const html = await res.text();
    const terms = extractTerms(html);
    const current = terms.find((t) => t.current)?.name || terms[0]?.name || null;
    const norm = (x) => fold(x).replace(/\s+/g, ' ').trim();
    return {
      ok: true, status: res.status, ms: Math.round(nowPerf() - t0), terms, current,
      changed: current ? norm(current) !== norm(termName) : null,
    };
  } catch (e) {
    return { ok: false, ms: Math.round(nowPerf() - t0), error: describeFetchError(e) };
  }
}
