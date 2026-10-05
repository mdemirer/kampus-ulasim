// SUlaşım · Claude (Anthropic) tarafından geliştirildi — Claude Opus 5.5
// Arayüz metinleri (Türkçe / English) ve dile göre tarih biçimleri.
// Debug ekranı geliştirici içindir, Türkçe kalır.

import { DAY_NAMES, DAY_SHORT, MONTHS, dateKeyOf, addDays, dowOfKey, parseDateKey, nightLabel as trNightLabel } from './core.js';

const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const a = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const DATA = 'https://data.ibb.gov.tr';

const STR = {
  tr: {
    appName: 'SUlaşım',
    dirFrom: 'Kampüsten', dirTo: 'Kampüse', dirGroup: 'Yön', tabsGroup: 'Bölümler',
    tabFav: 'Favoriler', tabNext: 'Sıradaki', tabProgram: 'Program', tabInfo: 'Bilgi',
    refreshAria: 'İETT bilgisini yenile', loading: 'Yükleniyor…',
    campus: 'Kampüs', today: 'Bugün', tomorrow: 'Yarın', tonight: 'bu gece', night: 'gece',
    favAdd: 'Favorilere ekle', favRemove: 'Favorilerden çıkar', favAdded: 'Favorilere eklendi', favRemoved: 'Favorilerden çıkarıldı',
    outOfTerm: 'Program dönemi dışında', reserve: 'Rezervasyon yap',
    noTrips: 'Önümüzdeki günlerde bu yönde sefer yok.',
    cancelled: 'iptal', cancelledTag: 'İptal', nextTag: 'Sıradaki',
    cancelUnknown: ({ line }) => `${line} iptalleri kontrol edilemedi; iptal edilen bir sefer burada görünmeyebilir.`,
    checkedAgo: ({ ago }) => `${ago} kontrol edildi`,
    checkedLast: ({ ago }) => `en son ${ago} kontrol edilebildi`,
    cancelsToday: ({ n, line, times }) => `Bugün bu yönde ${n} ${line} seferi iptal (${times})`,
    noCancels: ({ line }) => `${line} için iptal duyurusu yok`,
    noMoreToday: 'Bugün bu yönde başka sefer yok.',
    hidePast: 'Geçmiş seferleri gizle', showPast: ({ n }) => `Geçmiş ${n} seferi göster`,
    remainingToday: 'Bugün kalan seferler',
    favEmptyTitle: 'Henüz favorin yok',
    favEmptyBody: 'Sıradaki sekmesinde bir hattın yanındaki yıldıza dokun. Favorin olduğunda uygulama bu sayfayla açılır ve her favori için bugünün bütün seferlerini gösterir.',
    goNext: "Sıradaki'ye git",
    routeGroup: 'Güzergâh', dayGroup: 'Gün', noTripsDay: 'Bu gün bu yönde sefer yok.',
    iettNotes: 'İETT hat notları', iettPage: "İETT'de KM18 sayfası",
    bookingSystem: 'Shuttle rezervasyon sistemi', stopsMap: 'Duraklar (haritada aç)',
    langTitle: 'Dil',
    aboutTitle: 'Bu uygulama',
    aboutBody: "Kampüse gelen ve kampüsten kalkan shuttle'ları ve İETT KM18 otobüsünü tek ekranda gösterir. Kurtköy satırında ikisi birlikte, hangisi önce kalkıyorsa o üstte.",
    aboutFav: 'Bir hattın yanındaki yıldıza dokunarak onu favorilere ekleyebilirsin. Favorin varsa uygulama Favoriler sayfasıyla açılır.',
    install: 'Uygulamayı yükle',
    dataTitle: 'Veriler', shuttleProgram: 'Shuttle programı',
    termLine: ({ range, checked }) => `${range} dönemi. ${checked} tarihinde okul sitesinden alındı.`,
    siteCheck: 'Okul sitesi kontrolü', siteNotTried: 'Henüz denenmedi.',
    siteChanged: ({ name }) => `Sitede farklı bir program görünüyor: ${name}.`,
    siteSame: ({ ago }) => `Sitedeki program uygulamadakiyle aynı (${ago}).`,
    siteBlocked: ({ ago }) => `Okul sitesi uygulamanın sayfayı okumasına izin vermiyor; saatler uygulamanın içinden gösteriliyor (${ago}).`,
    kmTimetable: 'KM18 tarifesi',
    kmBundled: ({ date, auto }) => `${date} tarihli İETT tarifesi.${auto ? " İBB'nin tarife servisiyle her gün karşılaştırılıp güncelleniyor." : ''}`,
    kmApi: ({ ago }) => `İBB'den alındı, ${ago}.`,
    kmAnn: 'KM18 iptal ve duyurular',
    annLine: ({ ago, failing, n }) => `Son kontrol ${ago}${failing ? ', şu an alınamıyor' : ''}. ${n ? `KM18 için ${n} duyuru var.` : 'KM18 için duyuru yok.'}`,
    annNone: 'İBB duyuru servisine ulaşılamadı; iptal edilen seferler görünmez.',
    refreshNow: 'İETT bilgisini şimdi yenile',
    linksTitle: 'Bağlantılar', linkShuttle: 'Okulun shuttle sayfası', linkIett: 'İETT KM18 sayfası',
    installTitle: 'Telefona kurmak',
    installBody: 'Android\'de Chrome menüsünden "Ana ekrana ekle" ya da "Uygulamayı yükle". iPhone\'da Safari\'de Paylaş düğmesi, sonra "Ana Ekrana Ekle".',
    sourcesTitle: 'Kaynaklar ve lisans',
    sourcesIett: () => `KM18 tarifesi ve duyuruları İETT'nin İBB Açık Veri Portalı'nda yayımladığı web servislerinden alınır (${a(`${DATA}/dataset/iett-planlanan-sefer-saati-web-servisi`, 'Planlanan Sefer Saati')}, ${a(`${DATA}/dataset/iett-duyurular-web-servisi`, 'Duyurular')}) ve ${a(`${DATA}/license`, 'İBB Açık Veri Lisansı')} kapsamında kullanılır.`,
    sourcesShuttle: ({ url }) => `Shuttle saatleri ${a(url, "Sabancı Üniversitesi'nin shuttle sayfasından")} alınmıştır; durak açıklamaları kısaltılarak yeniden yazılmıştır.`,
    disclaimer: "Bu uygulama Sabancı Üniversitesi, İETT ya da İBB'nin resmi uygulaması değildir ve onlar tarafından onaylanmamıştır. Saatler bilgi amaçlıdır; kesin bilgi için resmi kaynaklara bak.",
    font: 'Yazı tipi: Barlow Condensed, SIL Open Font License.',
    privacyTitle: 'Gizlilik',
    privacy1: 'Uygulama kişisel veri toplamaz: hesap, çerez, reklam ya da kullanım takibi yok. Seçtiğin yön, dil ve favoriler gibi tercihler ve son indirilen İETT verisi yalnızca bu cihazda saklanır, hiçbir yere gönderilmez.',
    privacy2: "Veri almak için İBB'nin ve Sabancı Üniversitesi'nin sunucularına, uygulama güncellemesi için GitHub Pages'e bağlanır. Her web sitesinde olduğu gibi bu bağlantılarda cihazının IP adresi o sunuculara ulaşır.",
    version: ({ v, date }) => `Sürüm ${v} · ${date}`, debugLink: 'Debug ekranı',
    builtWith: ({ model }) => `Claude (Anthropic) tarafından geliştirildi · ${model}`,
    simBanner: ({ when, stopped }) => `Test saati: ${when}${stopped ? ' (durduruldu)' : ''}`,
    realTime: 'Gerçek saate dön', realTimeBack: 'Gerçek saate dönüldü',
    updateReady: 'Uygulamanın yeni sürümü hazır.', reload: 'Yenile',
    termExpired: ({ date, link }) => `Shuttle programının süresi ${date} tarihinde doldu. Saatler değişmiş olabilir; ${link}.`,
    termExpiredLink: 'okul sitesine bak',
    siteNewTerm: ({ name }) => `Okul sitesinde yeni bir shuttle programı var: ${name}. Uygulamadaki saatler eski olabilir.`,
    annCancel: ({ list }) => `İptal: ${list}`, annCancelGeneric: 'İptal duyurusu', annNotice: 'Duyuru',
    fromCampusShort: 'kampüsten', toCampusShort: 'kampüse',
    testAnn: 'Test duyurusu', origTurkish: '', dismiss: 'Gizle',
    iettFail: 'İETT servisine ulaşılamadı', updated: 'Güncellendi', debugOpened: 'Debug ekranı açıldı',
    dataLoadFail: ({ msg }) => `Veri dosyaları yüklenemedi (${msg}). İnternete bağlanıp sayfayı yenile.`,
    never: 'hiç', justNow: 'az önce',
    minAgo: ({ n }) => `${n} dk önce`, hrAgo: ({ n }) => `${n} sa önce`, dayAgo: ({ n }) => `${n} gün önce`,
    cd: { departing: 'Kalkıyor', min: 'dk', hr: 'sa' },
  },

  en: {
    appName: 'SUlaşım',
    dirFrom: 'From campus', dirTo: 'To campus', dirGroup: 'Direction', tabsGroup: 'Sections',
    tabFav: 'Favorites', tabNext: 'Next', tabProgram: 'Timetable', tabInfo: 'Info',
    refreshAria: 'Refresh İETT data', loading: 'Loading…',
    campus: 'Campus', today: 'Today', tomorrow: 'Tomorrow', tonight: 'tonight', night: 'night',
    favAdd: 'Add to favorites', favRemove: 'Remove from favorites', favAdded: 'Added to favorites', favRemoved: 'Removed from favorites',
    outOfTerm: 'Outside the timetable period', reserve: 'Book a seat',
    noTrips: 'No trips in this direction in the coming days.',
    cancelled: 'cancelled', cancelledTag: 'Cancelled', nextTag: 'Next',
    cancelUnknown: ({ line }) => `Couldn't check ${line} cancellations; a cancelled trip may still appear here.`,
    checkedAgo: ({ ago }) => `checked ${ago}`,
    checkedLast: ({ ago }) => `last checked ${ago}`,
    cancelsToday: ({ n, line, times }) => `${n} ${line} trip${n > 1 ? 's' : ''} cancelled today in this direction (${times})`,
    noCancels: ({ line }) => `No ${line} cancellations announced`,
    noMoreToday: 'No more trips in this direction today.',
    hidePast: 'Hide earlier trips', showPast: ({ n }) => `Show ${n} earlier trip${n > 1 ? 's' : ''}`,
    remainingToday: "Today's remaining trips",
    favEmptyTitle: 'No favorites yet',
    favEmptyBody: "Tap the star next to a route on the Next tab. Once you have a favorite, the app opens on this page and shows all of today's trips for each one.",
    goNext: 'Go to Next',
    routeGroup: 'Route', dayGroup: 'Day', noTripsDay: 'No trips in this direction on this day.',
    iettNotes: 'İETT line notes', iettPage: 'KM18 on the İETT website',
    bookingSystem: 'Shuttle booking system', stopsMap: 'Stops (open in maps)',
    langTitle: 'Language',
    aboutTitle: 'About',
    aboutBody: 'Shows the campus shuttles and the İETT KM18 bus on one screen, both to and from campus. On the Kurtköy row both are listed together, whichever leaves first on top.',
    aboutFav: 'Tap the star next to a route to add it to your favorites. If you have favorites, the app opens on the Favorites page.',
    install: 'Install app',
    dataTitle: 'Data', shuttleProgram: 'Shuttle timetable',
    termLine: ({ range, checked }) => `Term ${range}. Taken from the university website on ${checked}.`,
    siteCheck: 'University website check', siteNotTried: 'Not tried yet.',
    siteChanged: ({ name }) => `The website shows a different timetable: ${name}.`,
    siteSame: ({ ago }) => `The website timetable matches the app (${ago}).`,
    siteBlocked: ({ ago }) => `The university website doesn't allow the app to read it, so the times come from the app itself (${ago}).`,
    kmTimetable: 'KM18 timetable',
    kmBundled: ({ date, auto }) => `İETT timetable dated ${date}.${auto ? ' Compared with İBB\'s timetable service and updated daily.' : ''}`,
    kmApi: ({ ago }) => `Fetched from İBB ${ago}.`,
    kmAnn: 'KM18 cancellations and notices',
    annLine: ({ ago, failing, n }) => `Last checked ${ago}${failing ? ", can't reach it right now" : ''}. ${n ? `${n} notice${n > 1 ? 's' : ''} for KM18.` : 'No notices for KM18.'}`,
    annNone: "Couldn't reach İBB's notice service; cancelled trips won't be shown.",
    refreshNow: 'Refresh İETT data now',
    linksTitle: 'Links', linkShuttle: 'University shuttle page', linkIett: 'KM18 on the İETT website',
    installTitle: 'Install on your phone',
    installBody: 'On Android, open the Chrome menu and choose "Add to Home screen" or "Install app". On iPhone, tap Share in Safari, then "Add to Home Screen".',
    sourcesTitle: 'Sources and license',
    sourcesIett: () => `KM18 timetable and notices come from the web services İETT publishes on the İBB Open Data Portal (${a(`${DATA}/dataset/iett-planlanan-sefer-saati-web-servisi`, 'Planned Departure Times')}, ${a(`${DATA}/dataset/iett-duyurular-web-servisi`, 'Announcements')}) and are used under the ${a(`${DATA}/license`, 'İBB Open Data License')}.`,
    sourcesShuttle: ({ url }) => `Shuttle times are taken from ${a(url, "Sabancı University's shuttle page")}; stop descriptions have been shortened and rewritten.`,
    disclaimer: "This is not an official app of Sabancı University, İETT or İBB, and it isn't endorsed by them. Times are for information only; check the official sources to be sure.",
    font: 'Typeface: Barlow Condensed, SIL Open Font License.',
    privacyTitle: 'Privacy',
    privacy1: 'The app collects no personal data: no accounts, cookies, ads or usage tracking. Your preferences such as direction, language and favorites, and the latest İETT data, are stored only on this device and never sent anywhere.',
    privacy2: "It connects to İBB's and Sabancı University's servers to get data, and to GitHub Pages for app updates. As with any website, your device's IP address reaches those servers.",
    version: ({ v, date }) => `Version ${v} · ${date}`, debugLink: 'Debug screen',
    builtWith: ({ model }) => `Built by Claude (Anthropic) · ${model}`,
    simBanner: ({ when, stopped }) => `Test time: ${when}${stopped ? ' (paused)' : ''}`,
    realTime: 'Back to real time', realTimeBack: 'Back to real time',
    updateReady: 'A new version of the app is ready.', reload: 'Reload',
    termExpired: ({ date, link }) => `The shuttle timetable expired on ${date}. Times may have changed; ${link}.`,
    termExpiredLink: 'check the university website',
    siteNewTerm: ({ name }) => `The university website has a new shuttle timetable: ${name}. The times in the app may be out of date.`,
    annCancel: ({ list }) => `Cancelled: ${list}`, annCancelGeneric: 'Cancellation notice', annNotice: 'Notice',
    fromCampusShort: 'from campus', toCampusShort: 'to campus',
    testAnn: 'Test notice', origTurkish: 'original in Turkish', dismiss: 'Dismiss',
    iettFail: "Couldn't reach İETT", updated: 'Updated', debugOpened: 'Debug screen unlocked',
    dataLoadFail: ({ msg }) => `Couldn't load the data files (${msg}). Connect to the internet and reload.`,
    never: 'never', justNow: 'just now',
    minAgo: ({ n }) => `${n} min ago`, hrAgo: ({ n }) => `${n} h ago`, dayAgo: ({ n }) => `${n} day${n > 1 ? 's' : ''} ago`,
    cd: { departing: 'Leaving', min: 'min', hr: 'h' },
  },
};

let lang = 'tr';

export function detectLang(saved) {
  if (saved === 'tr' || saved === 'en') return saved;
  const nav = (globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'tr').toLowerCase();
  return nav.startsWith('tr') ? 'tr' : 'en';
}
export function setLang(l) { lang = l === 'en' ? 'en' : 'tr'; }
export function getLang() { return lang; }

/** Metin al: t('key') ya da t('key', {değişkenler}) */
export function t(key, vars = {}) {
  const v = STR[lang][key] ?? STR.tr[key];
  if (v === undefined) return key;
  return typeof v === 'function' ? v(vars) : v;
}

export const dayName = (dow) => (lang === 'en' ? EN_DAYS : DAY_NAMES)[dow];
export const dayShort = (dow) => (lang === 'en' ? EN_DAYS_SHORT : DAY_SHORT)[dow];
export const monthName = (mo) => (lang === 'en' ? EN_MONTHS : MONTHS)[mo];

/** "5 Ekim Pazartesi" / "Monday, 5 October" */
export function fmtDateLong(key) {
  const { mo, d } = parseDateKey(key);
  const day = dayName(dowOfKey(key));
  return lang === 'en' ? `${day}, ${d} ${monthName(mo)}` : `${d} ${monthName(mo)} ${day}`;
}

/** "5 Ekim 2026" / "5 October 2026" */
export function fmtDate(key) {
  const { y, mo, d } = parseDateKey(key);
  return `${d} ${monthName(mo)} ${y}`;
}

export function fmtRange(fromKey, toKey) {
  const A = parseDateKey(fromKey);
  const B = parseDateKey(toKey);
  return `${A.d} ${monthName(A.mo)}${A.y !== B.y ? ` ${A.y}` : ''} – ${B.d} ${monthName(B.mo)} ${B.y}`;
}

/** "Cuma'yı Cumartesi'ye bağlayan gece" / "Friday–Saturday night" */
export function nightLabel(serviceKey) {
  if (lang === 'tr') return trNightLabel(serviceKey);
  const d = dowOfKey(serviceKey);
  return `${EN_DAYS[d]}–${EN_DAYS[(d + 1) % 7]} night`;
}

/** "", "Yarın"/"Tomorrow" ya da gün adı */
export function dayLabel(ms, nowMs) {
  const k = dateKeyOf(ms);
  const today = dateKeyOf(nowMs);
  if (k === today) return '';
  if (k === addDays(today, 1)) return t('tomorrow');
  return dayName(dowOfKey(k));
}

export function ago(ms) {
  if (!ms) return t('never');
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t('justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('hrAgo', { n: h });
  return t('dayAgo', { n: Math.round(h / 24) });
}

/** Veri dosyasındaki çift dilli alan: x_en varsa ve dil İngilizceyse onu kullan. */
export function pick(obj, field) {
  if (!obj) return '';
  return (lang === 'en' && obj[`${field}_en`]) || obj[field] || '';
}
