# Kampüs Ulaşım

Sabancı Üniversitesi kampüs shuttle'larını ve İETT KM18 otobüsünü tek ekranda gösteren, telefona kurulabilen (PWA) bir web uygulaması. Sunucusu yok; GitHub Pages'te ücretsiz yayınlanır.

- **Sıradaki:** Her güzergâh için bir sonraki sefer ve geri sayım. Kurtköy satırında shuttle ve KM18 birlikte; hangisi önce kalkıyorsa o üstte. İkonlar ve renkler aracın türünü ayırır.
- **Program:** Seçilen güne ait bütün seferler. Gece yarısından sonraki seferler (Kadıköy 02:00, Kurtköy 00:45) takvimde ait oldukları güne yazılır: "Cuma'yı Cumartesi'ye bağlayan gece" gibi.
- **İptaller:** KM18 için İBB'nin duyuru servisi okunur. İptal duyurusundaki saat ayıklanıp o seferin üstü çizilir. Diğer duyurular üstte bir bant olarak görünür.
- **Gizli debug ekranı:** Bilgi sekmesinde "Sürüm" yazısına 4 saniye içinde 7 kez dokun ya da adresin sonuna `#debug` ekle.

## Veriler nereden geliyor?

| Veri | Kaynak | Nasıl |
|---|---|---|
| Shuttle saatleri | [Okulun shuttle sayfası](https://www.sabanciuniv.edu/tr/kampus-shuttle-seferleri) | `data/shuttle.json` içinde. Okul sitesi başka sitelerin sayfayı okumasına izin vermediği için uygulama saatleri kendi içinden gösterir. Günde bir kez sayfayı okumayı yine de dener; okuyabilir ve dönem başlığı farklıysa uyarır. Dönem bitince (31 Aralık 2026) de uyarır. |
| KM18 saatleri | İBB `PlanlananSeferSaati` servisi | Telefondan doğrudan çağrılır, 12 saatte bir yenilenir. Ulaşılamazsa `data/km18.json` içindeki gömülü tarife kullanılır. |
| KM18 iptal/duyuru | İBB `Duyurular` servisi | Uygulama açıkken 3 dakikada bir. |

Kurulduktan sonra uygulama yalnızca şunlarla konuşur: İBB servisleri (`api.ibb.gov.tr`), günde bir kez okulun shuttle sayfası ve açılışta kendi dosyalarının yeni sürümü var mı diye GitHub Pages. GitHub Pages'e ulaşamazsa telefondaki kopyayla çalışmaya devam eder. Analitik, reklam ya da dış yazı tipi yok.

## GitHub'a yükleme ve yayınlama

1. github.com'da yeni bir **public** depo oluştur (örneğin `kampus-ulasim`). Ücretsiz hesapta GitHub Pages yalnızca public depolarda çalışır.
2. Bu klasörün **içindekileri** depoya yükle. Web arayüzünden: depo sayfasında "uploading an existing file" bağlantısı, sonra klasörün içindekileri sürükle bırak, "Commit changes". (Gizli `.github` klasörü ve `.nojekyll` dosyası da gitmeli; sürükle bırakta görünmüyorsa aşağıdaki git komutlarını kullan.)

   ```bash
   cd kampus-ulasim
   git init -b main
   git add .
   git commit -m "İlk sürüm"
   git remote add origin https://github.com/KULLANICI_ADIN/kampus-ulasim.git
   git push -u origin main
   ```

3. Depoda **Settings → Pages**. "Build and deployment" altında Source: **Deploy from a branch**, Branch: **main** ve **/(root)**, sonra **Save**.
4. Bir iki dakika sonra site `https://KULLANICI_ADIN.github.io/kampus-ulasim/` adresinde açılır.

## Telefona kurma

- **Android (Chrome):** Siteyi aç, menüden "Uygulamayı yükle" ya da "Ana ekrana ekle".
- **iPhone (Safari):** Siteyi aç, Paylaş düğmesi, "Ana Ekrana Ekle".

Kurulumdan sonra bir kez açmak, dosyaların telefona inmesi için yeterli. Sonrasında internet olmadan da shuttle saatleri ve gömülü KM18 tarifesi görünür.

## İlk test: İBB servisine telefondan ulaşılabiliyor mu?

Bunu ancak gerçek bir telefonda/tarayıcıda görebiliriz.

1. Uygulamada debug ekranını aç.
2. **İBB bağlantısı** bölümünde "Tarifeyi dene" ve "Duyuruları dene".
3. Sonuç:
   - Bir yöntem **Çalıştı** diyorsa iş tamam. Uygulama bundan sonra hep önce o yöntemi kullanır.
   - Hepsi "Erişilemedi (tarayıcı engeli/CORS…)" diyorsa İBB tarayıcıdan gelen isteklere izin vermiyor demektir. O zaman aşağıdaki ara sunucu seçeneği gerekir.
4. "Tanılamayı kopyala" düğmesi her şeyi panoya alır; sorun çıkarsa o metni paylaşman yeterli.

### Gerekirse: ücretsiz ara sunucu (Cloudflare Worker)

`extras/cloudflare-worker.js` yalnızca iki İBB servisine istek atan küçük bir aracıdır. Cloudflare'in ücretsiz planında: dash.cloudflare.com → Workers & Pages → Create → Worker → kodu yapıştır → Deploy. Çıkan `https://….workers.dev` adresini debug ekranındaki "Ara sunucu adresi" alanına yaz (sadece o telefon için) ya da `js/config.js` içindeki `proxyUrl`'e yaz (herkes için).

## Debug ekranı

- **Test saati:** Tarih ve saati elle ayarla ("Saat aksın" işaretliyse oradan itibaren ilerler). Hazır düğmeler kritik durumları dener: Cuma 23:50 (Kurtköy 00:45), Cumartesi/Pazar 01:30 (Kadıköy 02:00), Pazartesi 01:30 (gece seferi yok), Perşembe 23:50 (23:55), Pazartesi 15:44 (KM18 15:50 (E) atlanmalı), Cuma 20:00 (Çekmeköy → Pazartesi), 1 Ocak 2027 (dönem bitti uyarısı). Test saati açıkken her ekranda mavi bir bant görünür.
- **Sıradaki seferler (iki yön):** Bütün güzergâhların sıradaki üç seferi tek tabloda.
- **KM18 tarifesi:** Kaynak (İBB / önbellek / gömülü) ve İBB tarifesinin gömülüden farkı.
- **Duyurular:** Her duyurunun nasıl okunduğu: iptal mi, hangi gün, hangi yön, hangi saatler işaretlendi.
- **Test duyurusu:** Kendi yazdığın metni gerçek bir İETT duyurusu gibi işletir. İptal ayrıştırıcısını denemek için.

## Program değişince

Shuttle saatleri `data/shuttle.json` içinde, okul sitesindeki tabloyla aynı düzende:

```json
"toCampus": {
  "info": [9],
  "weekday": ["07:50", "08:20", "23:55 10", "00:45 11"],
  "saturday": ["08:00 12", "00:45 11"],
  "sunday": ["08:10"]
}
```

- Saatin yanındaki sayılar sitedeki not numaraları (`notes` bölümünde). `serviceDays` alanı olan notlar seferi haftanın belli günlerine sınırlar (0 = Pazar … 6 = Cumartesi).
- 04:00'ten önceki saatler sitede olduğu gibi bir önceki günün listesine yazılır. Uygulama onları kendisi ertesi güne taşır.
- `term` bölümündeki tarihleri ve dönem adını da güncelle; dönem adı okul sitesindeki başlıkla aynı olmalı (karşılaştırma bununla yapılıyor).

Sadece veri dosyasını değiştirdiysen başka bir şey yapmana gerek yok; telefonlar yeni saatleri arka planda alır ve bir sonraki açılışta gösterir. Uygulama kodunu (`js/`, `css/`, `index.html`) değiştirdiysen `sw.js` içindeki `VERSION` değerini artır.

## İsteğe bağlı: shuttle sayfası izleyici

`.github/workflows/shuttle-watch.yml` her sabah okulun sayfasını okur. İçerik değişirse depoda bir issue açılır ve GitHub sana e-posta atar; içinde eklenen/çıkan saatler yazar. Uygulama buna bağlı değildir. İstemiyorsan Actions → "Shuttle sayfası izleyici" → "Disable workflow". GitHub, 60 gün hiç commit olmayan depolarda zamanlanmış işleri durdurur ve öncesinde e-postayla haber verir.

## Testler

```bash
node --test tests/*.test.mjs
```

Gece seferleri, gün kısıtları, KM18 (E) seferi, iptal ayrıştırma ve İBB yanıt biçimleri için 26 test.

## Kaynaklar, lisans ve gizlilik

- **KM18 tarife ve duyuruları:** İETT'nin [İBB Açık Veri Portalı](https://data.ibb.gov.tr)'nda yayımladığı [Planlanan Sefer Saati](https://data.ibb.gov.tr/dataset/iett-planlanan-sefer-saati-web-servisi) ve [Duyurular](https://data.ibb.gov.tr/dataset/iett-duyurular-web-servisi) web servisleri. [İBB Açık Veri Lisansı](https://data.ibb.gov.tr/license) uygulamalarda kullanıma izin veriyor; şartları kaynak göstermek ve İBB'nin uygulamayı onayladığı izlenimini vermemek. İkisi de Bilgi sekmesinde yapılıyor.
- **Shuttle saatleri:** Sabancı Üniversitesi'nin shuttle sayfası. Saatler olduğu gibi, durak açıklamaları kısaltılarak yeniden yazıldı; kaynak bağlantısı Bilgi sekmesinde.
- **Logolar:** İETT, İBB ya da Sabancı logosu kullanılmıyor; otobüs ve minibüs ikonları bu uygulama için çizildi.
- **Gizlilik:** Uygulama kişisel veri toplamıyor; hesap, çerez, analitik yok. Tercihler ve önbellek yalnızca cihazda (localStorage). GitHub Pages depo sahibine ziyaretçi kaydı vermiyor.
- **Yazı tipi:** Barlow Condensed, SIL Open Font License (`fonts/OFL-LICENSE.txt`).

## Bilinen sınırlar

- Resmi tatillerde shuttle ve İETT'nin farklı çalışması uygulamaya yansımaz.
- KM18 saatleri İETT'nin ilk duraktan kalkış saatleridir: kampüsten Sabancı Üniversitesi durağı, kampüse Kurtköy Mahallesi Metro durağı.
- İptal ayıklama, İETT duyurularının metnine dayanır. Saat yazmayan ya da alışılmadık biçimde yazılmış bir duyuru sefer işaretlemez; yine de üstteki bantta görünür.
