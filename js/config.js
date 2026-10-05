// Uygulama ayarları. Değiştirdikten sonra sw.js içindeki VERSION'ı da artır.
export const CONFIG = {
  version: '1.1.0',
  line: 'KM18',

  ibb: {
    // İBB / İETT web servisleri (SOAP, .asmx). Uygulama bunları doğrudan telefondan çağırır.
    planUrl: 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/PlanlananSeferSaati.asmx',
    planMethod: 'GetPlanlananSeferSaati_json',
    announceUrl: 'https://api.ibb.gov.tr/iett/UlasimDinamikVeri/Duyurular.asmx',
    announceMethod: 'GetDuyurular_json',
    soapNamespace: 'http://tempuri.org/',
    timeoutMs: 9000,
  },

  // İsteğe bağlı ara sunucu (extras/cloudflare-worker.js). Boşsa hiç kullanılmaz.
  // Debug ekranından da ayarlanabilir.
  proxyUrl: '',

  refresh: {
    announcementsMs: 3 * 60 * 1000,   // uygulama açıkken duyuruları bu aralıkla yenile
    planMs: 12 * 3600 * 1000,          // KM18 tarifesini en fazla bu sıklıkla yenile
    shuttlePageMs: 24 * 3600 * 1000,   // okul sitesindeki dönem başlığını günde bir dene
  },

  // Bu kadar günden eski İETT duyuruları "kalıcı not" sayılır: uyarı bandında değil,
  // Program sekmesindeki hat notlarında görünür.
  standingAfterDays: 7,

  shuttlePageUrl: 'https://www.sabanciuniv.edu/tr/kampus-shuttle-seferleri',
  iettRouteUrl: 'https://iett.istanbul/RouteDetail?hkod=KM18',
};
