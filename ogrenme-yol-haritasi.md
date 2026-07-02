# İsim Şehir Hayvan — Online Çok Oyunculu Oyun: Yol Haritası

Oda yok. Herkes aynı, sürekli akan tek oyuna hızlı bir nickname ile katılır. Sunucu her 60 saniyede bir yeni harf seçip herkese aynı anda yollar, süre bitince cevapları toplar, en az yazılan cevaba en yüksek puanı verir ve yeni tur başlar. Nickname/puan şimdilik sadece o oturum için geçerli; kalıcı hesap (Google auth) ve puan ekonomisi (kozmetik özelleştirmeler) ileride eklenecek.

**Teknoloji:** JavaScript (hem frontend hem Node.js backend), gerçek zamanlı iletişim için Socket.io, arayüz için düz HTML/CSS/JS.

## Aşamalar

1. **Web temelleri** (1-2 hafta) — HTML/CSS/JS temelleri: buton, sayaç, liste işlemleri. Kaynak: freeCodeCamp.
2. **Tek kişilik prototip** (1 hafta) — Sunucusuz, tarayıcıda çalışan harf + kategori + 60sn geri sayım mantığı.
3. **Node.js sunucu** (1 hafta) — Basit Express sunucusu kurmayı öğren.
4. **Socket.io** (1-2 hafta) — En kritik aşama: sunucudan tüm bağlı istemcilere anlık yayın yapmayı öğren, harfi sunucuya taşı.
5. **Küresel tur döngüsü + puanlama** (2 hafta) — `setInterval` ile durmayan 60sn döngü, sonradan katılan oyuncunun kaldığı yerden dahil olması, cevapları normalize edip sayma, "az yazılan = çok puan" hesaplaması.
6. **Deploy** (birkaç gün) — Render/Railway/Fly.io gibi WebSocket destekleyen bir servise yayınlama.
7. **Ölçeklendirme ve iyileştirme** (süresiz) — Yüzlerce eşzamanlı bağlantı, hile önleme, mobil uyum.
8. **Kalıcı hesap + puan ekonomisi** (ileride) — Google auth, veritabanı, kozmetik ödüller.

Toplam tahmini süre: günde 1-2 saatle ~6-8 hafta.

## Güvenlik (Aşama 7'nin parçası)

Karşılaşabileceğin saldırı/kötüye kullanım türleri ve önlemleri:

- **DDoS / trafik bombardımanı** (siteyi çökertmek için sahte trafik) — kendi sunucun yerine Cloudflare gibi bir katman kullan; seçtiğin hosting (Render/Railway/Fly.io) genelde temel DDoS korumasını zaten sağlar.
- **Bağlantı/istek sınırlama (rate limiting)** — bir IP veya socket'in saniyede kaç istek/cevap gönderebileceğini sınırla, aşırı hızlı istek gönderen bağlantıyı geçici olarak kapat.
- **Girdi doğrulama (input validation)** — nickname ve cevap metinlerinde uzunluk sınırı koy, HTML/script karakterlerini temizle (XSS önleme), sadece beklenen karakterlere izin ver.
- **Sahte oyuncu / puan şişirme** — bir kişinin çok sayıda sekme veya bot ile katılıp otomatik cevap göndererek puan şişirmesini zorlaştırmak için basit bir CAPTCHA (nickname girerken) veya IP başına eşzamanlı bağlantı sınırı düşünülebilir; tam çözüm ancak Aşama 8'deki hesap sistemiyle gelir.
- **Sunucu kaynak tükenmesi** — hafızada tutulan oyuncu/cevap listesinin sınırsız büyümesini engelle (bağlantısı kopan oyuncuyu listeden temizle), tek bir kötü niyetli istemcinin sunucuyu kilitlemesini önlemek için gelen veriyi işlemeden önce boyut/format kontrolü yap.
- **İzleme (monitoring)** — hosting servisinin sunduğu temel log/metrik ekranını takip et, anormal trafik artışını erken fark edebilmek için.

Bu önlemlerin çoğu ileri seviye konular; ilk çalışan prototip için gerekli değil, Aşama 6 (deploy) sonrasında, site gerçekten halka açıldığında ele alınmalı.

**Sıradaki adım:** Aşama 1'den başlayıp birlikte küçük parçalar halinde kod yazmaya başlayabiliriz.
