# Mobil App Durum Dosyası

> Bu dosya mobil app çalışmasının canlı durum takibidir. Her faz
> tamamlandıkça güncellenir. Yeni bir oturumda "bu dosyayı oku ve kaldığımız
> yerden devam et" demek yeterlidir.

**Son güncelleme:** 2026-07-18

## Kararlar (kesinleşmiş)

- **Yöntem: Capacitor** — mevcut `public/` klasörü iOS + Android app'e ortak
  gider; UI yeniden yazılmaz, yeni programlama dili yok.
- **Cross-play:** app, Railway'deki aynı Socket.io sunucusuna bağlanır;
  browser ve app oyuncuları aynı odada oynar.
- **YouTube Playables:** ikinci emre kadar rafa kaldırıldı (cross-play
  YouTube politikalarıyla şu an mümkün değil).
- **Sunucu koduna dokunulmuyor** — tüm iş istemci tarafında.

## Faz durumu

| Faz | İş | Durum |
|---|---|---|
| — | 1h/24h UTC leaderboard (web) | ✅ Canlıda (commit `e78e3b7`) |
| 0 | Hazırlık: socket.io vendor + SERVER_URL config | ⬜ Sıradaki |
| 1 | Capacitor iskeleti (`cap init`, `cap add ios/android`) | ⬜ |
| 2 | iOS: Xcode, simulator, cross-play testi, ikon/splash | ⬜ |
| 3 | Android: Android Studio, emulator, geri tuşu | ⬜ |
| 4 | Store: hesaplar, privacy policy, onay | ⬜ |

**Şu an yapılan:** Xcode kurulumu için bilgisayar yeniden başlatılıyor.

## Faz detayları

### Faz 0 — Hazırlık (~15 dk, risksiz) — SIRADAKİ
1. `node_modules/socket.io/client-dist/socket.io.min.js` → `public/` altına kopyala.
2. `public/index.html`: socket script'i `socket.io.min.js`'ten yüklenecek;
   viewport'a `viewport-fit=cover` eklenecek.
3. `public/app.js`: socket adresi `window.CATTEGORIES_SERVER_URL`'den okunacak
   (tanımsızsa same-origin — web davranışı değişmez).
4. Local test + commit + push.

### Faz 1 — Capacitor iskeleti (~30 dk)
1. `npm i @capacitor/core @capacitor/cli`
2. `npx cap init "Cattegories" "io.cattegories.app" --web-dir public`
3. `npx cap add ios` + `npx cap add android`
4. App ortamında `CATTEGORIES_SERVER_URL=https://cattegories.io` ayarla.
5. Commit + durum raporu.

### Faz 2 — iOS (~1-2 saat)
1. Xcode kurulumu (kullanıcı — App Store, ~10 GB, ücretsiz). **Devam ediyor.**
2. CocoaPods kurulumu.
3. iOS Simulator'da çalıştır + cross-play testi (app + browser aynı odada).
4. İkon/splash, safe-area kontrolleri.
5. Commit.

### Faz 3 — Android (~1-2 saat)
1. Android Studio kurulumu (kullanıcı — ~3 GB, ücretsiz).
2. Emulator'da çalıştır + cross-play testi.
3. Geri tuşu davranışı (`@capacitor/app` plugin).
4. Commit.

### Faz 4 — Store (kullanıcı hesaplarıyla)
1. Apple Developer ($99/yıl) + Google Play ($25) hesapları (kullanıcı açar).
2. `/privacy` statik sayfa (nickname/ülke/IP toplandığı için şart).
3. Ekran görüntüleri + store açıklamaları.
4. TestFlight + internal testing → onay (1-3 gün).

## Devam rehberi

```bash
cd ~/Desktop/Ertugrul/OnlineCategories
kimi -c     # önceki oturumu sürdürür
# veya yeni oturumda: "MOBIL-APP-DURUM.md dosyasını oku, kaldığımız yerden devam et"
```

## Notlar
- Web sitesi tüm süreç boyunca canlı ve bozulmadan kalır; her faz ayrı commit.
- Geri alma: `ios/` `android/` klasörleri + config silinirse proje eski haline döner.
