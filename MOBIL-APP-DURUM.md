# Mobil App Durum Dosyası

> Bu dosya mobil app çalışmasının canlı durum takibidir. Her faz
> tamamlandıkça güncellenir. Yeni bir oturumda "bu dosyayı oku ve kaldığımız
> yerden devam et" demek yeterlidir.

**Son güncelleme:** 2026-07-22

## Kararlar (kesinleşmiş)

- **Yöntem: Capacitor** — mevcut `public/` klasörü iOS + Android app'e ortak
  gider; UI yeniden yazılmaz, yeni programlama dili yok.
- **Cross-play:** app, Railway'deki aynı Socket.io sunucusuna bağlanır;
  browser ve app oyuncuları aynı odada oynar. (Test edildi, çalışıyor.)
- **YouTube Playables:** ikinci emre kadar rafa kaldırıldı (cross-play
  YouTube politikalarıyla şu an mümkün değil).
- **Sunucu koduna dokunulmuyor** — tüm iş istemci tarafında.

## Faz durumu

| Faz | İş | Durum |
|---|---|---|
| — | 1h/24h UTC leaderboard (web) | ✅ Canlıda (commit `e78e3b7`) |
| 0 | Hazırlık: socket.io vendor + SERVER_URL config | ✅ (commit `87ac348`) |
| 1 | Capacitor iskeleti (`cap init`, `cap add ios/android`) | ✅ (commit `d666a53`) |
| 2 | iOS: simulator, cross-play, safe-area, CORS fix | ✅ (commit `5596628`, `d885340`) |
| 2b | iOS gerçek cihaz: iPhone 11'de build + oyun testi | ✅ |
| 3 | Android: geri tuşu implement edildi, emulator testi **blocked** | ⚠️ (commit `f44618e`) |
| 4 | Store: hesaplar, privacy policy, onay | ⬜ Sıradaki |

**Şu an yapılan:** Faz 4 öncesi küçük UX iyileştirmeleri. Son eklenen:
oyun ekranında sol üstteki **Cattegories.io logosuna tıklayınca** mode
seçim ekranına dönme (`room:leave` + mode ekranı).

## Sayfa / ekran isimleri (tarif için)

- **Mode ekranı** — "Play Public / Private Room" seçim ekranı (oyun açılışı).
- **Lobby** — odaya girince oyuncu listesi + başlatma ekranı.
- **Oyun ekranı** — harf + kategoriler + cevap girişi + skor tablosu.
- **Skor tablosu (leaderboard)** — Players/Nations sekmeli, 1h/24h UTC
  sıralama + geri sayım.

## Faz 3 — Android durumu (blocked)

- `@capacitor/app` plugin ile geri tuşu: oyun ekranındayken mode ekranına
  döner, mode ekranındayken app'ten çıkar. **Kod hazır, test edilemedi.**
- **Bloker:** Intel i9 Mac, Android emulator'ü çalıştıramıyor. Pixel 8
  (API 37), Pixel 4 ve Small Tablet profilleri denendi; emulator açılıyor
  ama sistem UI çöküyor / siyah ekran / kendiliğinden kapanıyor. Cold boot
  ve wipe data da çözmedi. Hypervisor uyumsuzluğu.
- **Çözüm seçenekleri (henüz karar verilmedi):**
  1. Fiziksel Android telefonla USB debug testi (en pratik).
  2. Apple Silicon Mac'e geçince emulator testi.
  3. Genymotion gibi Intel uyumlu 3. parti emulator.

## Faz 4 — Store (sıradaki, kullanıcı hesaplarıyla)

1. Apple Developer ($99/yıl) + Google Play ($25) hesapları (kullanıcı açar).
2. `/privacy` statik sayfa (nickname/ülke/IP toplandığı için şart).
3. İkon + splash markalaştırma (şu an Capacitor default).
4. Ekran görüntüleri + store açıklamaları.
5. TestFlight + internal testing → onay (1-3 gün).

## Devam rehberi

```bash
cd ~/Desktop/Ertugrul/OnlineCategories
kimi -c     # önceki oturumu sürdürür
# veya yeni oturumda: "MOBIL-APP-DURUM.md dosyasını oku, kaldığımız yerden devam et"
```

### Faydalı komutlar

```bash
# iOS simulator'a deploy:
cp env.production.js public/env.js && npx cap copy ios && git checkout public/env.js
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17' build

# Local test sunucusu:
npm start   # http://localhost:3000

# App kodu public/env.js üzerinden canlı sunucuya bağlanır;
# public/env.js web'de boş kalır (same-origin), cap copy öncesi
# env.production.js ile geçici olarak değiştirilir.
```

## Notlar
- Web sitesi tüm süreç boyunca canlı ve bozulmadan kalır; her faz ayrı commit.
- Geri alma: `ios/` `android/` klasörleri + config silinirse proje eski haline döner.
- Home butonu denemesi (⌂ harf üstü) yapıldı, UX beğenilmedi, geri alındı;
  yerine logo tıklaması çözümü uygulandı.
