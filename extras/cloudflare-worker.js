// İSTEĞE BAĞLI ara sunucu. Sadece telefon İBB servislerine doğrudan ulaşamıyorsa gerekir
// (debug ekranında hiçbir yöntem çalışmıyorsa). Cloudflare Workers ücretsiz planında çalışır.
//
// Kurulum: dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker → bu dosyanın
// içeriğini yapıştır → Deploy. Çıkan adresi (https://….workers.dev) uygulamanın debug ekranındaki
// "Ara sunucu adresi" alanına ya da js/config.js içindeki proxyUrl'e yaz.
//
// Worker yalnızca bu iki İBB servisine istek atar; başka adrese yönlendirme yapmaz.

const NS = 'http://tempuri.org/';
const TARGETS = {
  plan: {
    url: 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/PlanlananSeferSaati.asmx',
    method: 'GetPlanlananSeferSaati_json',
    params: ['HatKodu'],
    ttl: 3600,
  },
  duyuru: {
    url: 'https://api.ibb.gov.tr/iett/UlasimDinamikVeri/Duyurular.asmx',
    method: 'GetDuyurular_json',
    params: [],
    ttl: 60,
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(request.url);
    const t = TARGETS[u.pathname.replace(/^\/+|\/+$/g, '')];
    if (!t) return new Response('Bilinmeyen servis', { status: 404, headers: CORS });

    let body = '';
    for (const p of t.params) {
      const v = u.searchParams.get(p) || '';
      if (!/^[A-Za-z0-9ÇĞİÖŞÜçğıöşü]{1,10}$/.test(v)) return new Response(`Geçersiz ${p}`, { status: 400, headers: CORS });
      body += `<${p}>${v}</${p}>`;
    }
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${t.method} xmlns="${NS}">${body}</${t.method}></soap:Body></soap:Envelope>`;
    const r = await fetch(t.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}${t.method}"` },
      body: envelope,
    });
    return new Response(await r.text(), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': `public, max-age=${t.ttl}` },
    });
  },
};
