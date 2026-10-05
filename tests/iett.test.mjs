import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractPayload, planFromRows, normalizeAnnouncements, analyzeAnnouncement, classifyAnnouncement,
  cancellationMap, extractTerms, parseIbbDate, fold,
} from '../js/iett.js';
import { wallToMs, dateKeyOf } from '../js/core.js';

const km18 = JSON.parse(readFileSync(new URL('../data/km18.json', import.meta.url)));

test('SOAP 1.1 zarfından JSON çıkarılır (kaçışlı karakterlerle)', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetDuyurular_jsonResponse xmlns="http://tempuri.org/"><GetDuyurular_jsonResult>[{"HAT":"KM18","MESAJ":"A &amp; B &lt;test&gt;"}]</GetDuyurular_jsonResult></GetDuyurular_jsonResponse></soap:Body></soap:Envelope>`;
  assert.deepEqual(extractPayload(xml), [{ HAT: 'KM18', MESAJ: 'A & B <test>' }]);
});

test('ASMX <string> yanıtı ve {d:...} JSON yanıtı', () => {
  assert.deepEqual(extractPayload('<?xml version="1.0"?><string xmlns="http://tempuri.org/">[{"a":1}]</string>'), [{ a: 1 }]);
  assert.deepEqual(extractPayload('{"d":"[{\\"a\\":2}]"}'), [{ a: 2 }]);
});

test('SOAP hatası okunur', () => {
  const xml = '<soap:Envelope xmlns:soap="x"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Server did not recognize the value of HTTP Header SOAPAction</faultstring></soap:Fault></soap:Body></soap:Envelope>';
  assert.throws(() => extractPayload(xml), /SOAP hatası: Server did not recognize/);
});

function fakeRows() {
  const rows = [];
  const add = (yon, gt, list, guz) => list.forEach((t) => {
    const [time, mark] = t.split(' ');
    rows.push({ SHATKODU: 'KM18', HATADI: 'X', SGUZERGAH: mark ? 'KM18_G_D1' : (guz || `KM18_${yon}_D0`), SYON: yon, SGUNTIPI: gt, GUZERGAH_ISARETI: null, DT: time });
  });
  add('G', 'I', km18.fromCampus.weekday);
  add('G', 'C', km18.fromCampus.saturday);
  add('G', 'P', km18.fromCampus.sunday);
  add('D', 'I', km18.toCampus.weekday);
  add('D', 'C', km18.toCampus.saturday);
  add('D', 'P', km18.toCampus.sunday);
  return rows;
}

test('Tarife satırları yönlere ve gün tiplerine dağılır; farklı güzergâh E olarak yedekten alınır', () => {
  const r = planFromRows(fakeRows(), km18);
  assert.equal(r.mapping.G, 'fromCampus');
  assert.deepEqual(r.lists.fromCampus.weekday, km18.fromCampus.weekday);
  assert.deepEqual(r.lists.toCampus.sunday, km18.toCampus.sunday);
});

test('Yön harfleri ters gelse bile örtüşmeye göre doğru eşlenir', () => {
  const rows = fakeRows().map((x) => ({ ...x, SYON: x.SYON === 'G' ? 'D' : 'G' }));
  const r = planFromRows(rows, km18);
  assert.equal(r.mapping.D, 'fromCampus');
  assert.deepEqual(r.lists.toCampus.weekday, km18.toCampus.weekday);
});

test('Saat "07:20:00" biçiminde ve işaret alanı dolu gelirse', () => {
  const rows = fakeRows().map((x) => ({ ...x, DT: `${x.DT}:00`, GUZERGAH_ISARETI: x.DT === '09:30' && x.SYON === 'G' && x.SGUNTIPI === 'I' ? 'K' : null }));
  const r = planFromRows(rows, km18);
  assert.ok(r.lists.fromCampus.weekday.includes('09:30 K'));
});

test('Tarihler: ISO, Türk biçimi, /Date()/', () => {
  assert.equal(parseIbbDate('2026-10-05 14:22:10'), wallToMs('2026-10-05T14:22:10'));
  assert.equal(parseIbbDate('05.10.2026 14:22'), wallToMs('2026-10-05T14:22'));
  assert.equal(parseIbbDate('/Date(1759666930000)/'), 1759666930000);
  assert.ok(Number.isNaN(parseIbbDate('')));
});

const plan = { fromCampus: km18.fromCampus, toCampus: km18.toCampus };
const ann = (text, at = '2026-10-05T12:00') => ({ id: 'x', text, updatedMs: wallToMs(at) });
const analyze = (text, at) => analyzeAnnouncement(ann(text, at), { nowMs: wallToMs(at || '2026-10-05T12:00'), plan });

test('Kurtköy kalkışlı tek sefer iptali → kampüse yönü', () => {
  const a = analyze('KM18 SABANCI ÜNİ.-KURTKÖY METRO hattında saat 16:00 Kurtköy Metro kalkışlı seferimiz araç arızası nedeniyle yapılamayacaktır.');
  assert.equal(a.isCancel, true);
  assert.equal(a.dirHint, 'toCampus');
  assert.deepEqual(a.items, [{ dir: 'toCampus', time: '16:00' }]);
  assert.equal(a.serviceKey, '2026-10-05');
});

test('Yön yazmıyorsa saat tarifeden bulunur', () => {
  const a = analyze('KM18 hattının 15:55 seferi iptal edilmiştir.');
  assert.deepEqual(a.items, [{ dir: 'fromCampus', time: '15:55' }]);
});

test('Büyük harfli ve noktalı saat, "yarın"', () => {
  const a = analyze('YARIN SABANCI ÜNİVERSİTESİ KALKIŞLI 07.20 SEFERİ GERÇEKLEŞTİRİLEMEYECEKTİR', '2026-10-05T21:00');
  assert.equal(a.serviceKey, '2026-10-06');
  assert.deepEqual(a.items, [{ dir: 'fromCampus', time: '07:20' }]);
});

test('Açık tarih saat sanılmaz; ay adıyla tarih', () => {
  const a = analyze('06.10.2026 tarihinde KM18 hattının 09:45 seferi iptal edilmiştir.');
  assert.equal(a.serviceKey, '2026-10-06');
  assert.deepEqual(a.times, ['09:45']);
  const b = analyze('7 Ekim Çarşamba günü 12:00 Sabancı kalkışlı sefer yapılamayacaktır.');
  assert.equal(b.serviceKey, '2026-10-07');
  assert.deepEqual(b.items, [{ dir: 'fromCampus', time: '12:00' }]);
});

test('Saat aralığı: "12:00-15:00 saatleri arasında" iki yönde de tarifedeki seferler', () => {
  const a = analyze('Yol çalışması nedeniyle 12:00-15:00 saatleri arasındaki KM18 seferleri yapılamayacaktır.');
  const keys = a.items.map((i) => `${i.dir} ${i.time}`).sort();
  assert.deepEqual(keys, ['fromCampus 12:00', 'fromCampus 13:30', 'fromCampus 15:00', 'toCampus 12:45', 'toCampus 14:15']);
});

test('İptal içermeyen duyuru sefer işaretlemez; açıklama notu kalıcı sayılır', () => {
  const a = analyze('Kırmızı renkli seferler ÖHO; siyah renkli seferler İETT\'ye aittir.');
  assert.equal(a.isCancel, false);
  assert.deepEqual(a.items, []);
  const c = classifyAnnouncement(ann('Kırmızı renkli seferler ÖHO'), a, { nowMs: wallToMs('2026-10-05T12:00'), standingAfterDays: 7, todayKey: '2026-10-05' });
  assert.equal(c.standing, true);
});

test('Geçmiş günün iptali bantta gösterilmez; eski duyuru kalıcı not olur', () => {
  const now = wallToMs('2026-10-05T12:00');
  const a1 = analyzeAnnouncement(ann('16:00 seferi iptal', '2026-10-04T10:00'), { nowMs: now, plan });
  assert.equal(classifyAnnouncement({ text: '16:00 seferi iptal' }, a1, { nowMs: now, standingAfterDays: 7, todayKey: '2026-10-05' }).expired, true);
  const a2 = analyzeAnnouncement(ann('Güzergâh değişikliği', '2026-09-20T10:00'), { nowMs: now, plan });
  assert.equal(classifyAnnouncement({ text: 'Güzergâh değişikliği' }, a2, { nowMs: now, standingAfterDays: 7, todayKey: '2026-10-05' }).standing, true);
});

test('Duyurular hatta göre süzülür, iptal haritası core anahtarıyla eşleşir', () => {
  const rows = [
    { HAT: '500T', TIP: 'Günlük', GUNCELLEME_SAATI: '2026-10-05 11:00:00', MESAJ: '500T 10:00 iptal' },
    { HAT: 'KM18', TIP: 'Günlük', GUNCELLEME_SAATI: '2026-10-05 11:05:00', MESAJ: 'Kurtköy kalkışlı 16:00 seferi iptal edilmiştir.' },
    { HAT: '', TIP: 'Genel', GUNCELLEME_SAATI: '2026-10-05 11:06:00', MESAJ: 'KM 18 hattında güzergâh değişikliği' },
  ];
  const list = normalizeAnnouncements(rows, 'KM18');
  assert.equal(list.length, 2);
  const now = wallToMs('2026-10-05T12:00');
  const analyses = list.map((a) => ({ ann: a, analysis: analyzeAnnouncement(a, { nowMs: now, plan }) }));
  const map = cancellationMap(analyses, 'KM18');
  assert.ok(map.has('iett:KM18:toCampus:2026-10-05:16:00'));
  assert.equal(map.size, 1);
});

test('Okul sitesinden dönem başlıkları', () => {
  const html = `<ul><li><a href="?term_id=2192">26 Eylül 2026 - 31 Aralık 2026 Kış Dönemi Shuttle Programı <em>(Current Term)</em></a></li>
  <li><a>26 Ağustos - 25 Eylül 2026 Yaz Dönemi Shuttle Programı</a></li></ul><h1>26 Eylül 2026 - 31 Aralık 2026 Kış Dönemi Shuttle Programı</h1>`;
  const t = extractTerms(html);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { name: '26 Eylül 2026 - 31 Aralık 2026 Kış Dönemi Shuttle Programı', current: true });
  assert.equal(t[1].current, false);
  assert.equal(fold('İPTAL EDİLMİŞTİR'), 'iptal edilmistir');
  assert.equal(dateKeyOf(wallToMs('2026-10-05T23:59')), '2026-10-05');
});
