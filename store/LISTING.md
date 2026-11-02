# Tempo: Chrome Web Store submission

Everything the Developer Dashboard asks for, ready to paste. English is the
default listing; add Turkish under **Store listing → Add localization**.

---

## 1. Package

Upload `dist/tempo-1.0.0.zip` (create it with `store/package.ps1`).

## 2. Store listing

**Name:** filled automatically from the manifest
`Tempo – Playback Speed for YouTube` / `Tempo – YouTube için Oynatma Hızı`

**Category:** Productivity → Tools (or the closest "Productivity" option)

**Language:** English (default), Turkish

### Summary (max 132 characters)

EN: `Watch YouTube at your own pace: speed from your keyboard, skip silences and sponsors, smart speed for every speaker.`

TR: `YouTube'u kendi temponuzda izleyin: klavyeden hız, sessizlik ve sponsor atlama, her konuşmacıya uyan akıllı hız.`

### Description: English

```
Tempo lets you watch YouTube at exactly the pace you want, and shows you how much time you save.

ONE SHORTCUT
• Shift + ↑ jumps to 2×, then adds 0.25× with every press, up to 10×
• Shift + ↓ slows down; going back to 1× hands control back to YouTube
• Your speed stays the same across videos

SKIP SILENCE (PRO)
Pauses fly by while speech stays at your speed. One simple slider goes from Gentle (catches short pauses) to Fast (only clear pauses, at 8×).

SMART SPEED (PRO)
Tempo reads the pace from captions or audio and adjusts as people talk: it slows down fast talkers and speeds up slow ones, so everything sounds natural.

SKIP SPONSORS
Jumps over sponsor segments, intros and subscribe reminders using the SponsorBlock community database, with one-tap Undo.

TIME REMAINING
See how much of the video is left at your speed, right next to the video time.

TIME SAVED
The Tempo menu shows how much time you saved on each video, and how that compares with watching at a constant 2×.

PRIVATE BY DESIGN
No accounts, no analytics, no ads, no tracking. Audio and captions are processed on your device and never leave it.

Sponsor data from SponsorBlock, used under CC BY-NC-SA 4.0. Tempo is not affiliated with or endorsed by YouTube or Google.
```

### Description: Türkçe

```
Tempo ile YouTube'u tam istediğiniz hızda izleyin ve ne kadar zaman kazandığınızı görün.

TEK KISAYOL
• Shift + ↑ 2×'e geçer, sonra her basışta 0,25× ekler, en fazla 10×
• Shift + ↓ yavaşlatır; 1×'e dönünce kontrol YouTube'a geçer
• Hızınız videolar arasında korunur

SESSİZLİĞİ ATLA (PRO)
Duraklamalar hızla geçer, konuşma sizin hızınızda kalır. Tek bir kaydırıcı Yumuşak (kısa duraklamaları da yakalar) ile Hızlı (yalnızca belirgin duraklamalar, 8×) arasında ayar yapar.

AKILLI HIZ (PRO)
Tempo konuşma temposunu altyazıdan veya sesten okur ve konuşmaya göre ayarlar: hızlı konuşanı yavaşlatır, yavaş konuşanı hızlandırır; her şey doğal duyulur.

SPONSORLARI ATLA
Sponsor bölümlerini, girişleri ve abone ol hatırlatmalarını SponsorBlock topluluk veritabanıyla atlar; tek dokunuşla geri alınır.

KALAN SÜRE
Videonun sizin hızınızla ne kadar kaldığını, video süresinin hemen yanında görün.

KAZANILAN SÜRE
Tempo menüsü her videoda ne kadar zaman kazandığınızı ve bunun sabit 2× izlemeye göre farkını gösterir.

GİZLİLİK ÖNCELİKLİ
Hesap, analiz, reklam veya takip yok. Ses ve altyazılar cihazınızda işlenir, hiçbir yere gönderilmez.

Sponsor verileri SponsorBlock'tan alınır, CC BY-NC-SA 4.0 lisansıyla kullanılır. Tempo, YouTube veya Google ile bağlantılı değildir ve onlar tarafından onaylanmamıştır.
```

### Graphics (in `store/assets/`)

| Field | File | Size |
|---|---|---|
| Store icon | `icons/icon128.png` | 128×128 |
| Screenshot 1 | `store/assets/screenshot-1.png` | 1280×800 |
| Screenshot 2 | `store/assets/screenshot-2.png` | 1280×800 |
| Small promo tile | `store/assets/promo-small.png` | 440×280 |

## 3. Privacy practices

### Single purpose

```
Tempo controls the playback speed of YouTube videos: keyboard speed control, skipping silences and sponsor segments, adapting speed to the speaker, and showing time remaining and time saved.
```

### Permission justifications

**storage**
```
Saves the user's Tempo settings (which features are on, skip style). No browsing data is stored.
```

**Host permission: https://www.youtube.com/***
```
Tempo's content scripts run on YouTube to change the video player's playback speed, read the video's audio level and caption timing on the device for Skip silence and Smart speed, and show the speed indicator and time remaining in the player.
```

**Optional host permission: https://sponsor.ajay.app/***
```
Requested only when the user turns on "Skip sponsors". Used to look up sponsor/intro segment times from the SponsorBlock community database. Only the first 4 characters of a SHA-256 hash of the video ID are sent (k-anonymity); the video ID itself is never sent.
```

**Remote code:** `No, I am not using remote code.`
(All JavaScript ships in the package. The only network request returns JSON data from SponsorBlock.)

### Data usage

Tempo does not collect or transmit personal data. Leave every data-type box
unchecked, then tick all three certifications:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

> Note: Skip sponsors sends a 4-character hash prefix that cannot identify a
> video or a person. If a reviewer disagrees, tick **Web history** and point to
> the privacy policy section "Skip sponsors".

### Privacy policy URL

The Dashboard needs a public URL. Host `privacy/privacy.html` somewhere public
(for example GitHub Pages, or a GitHub Gist rendered through a page host) and
paste the link. **Before hosting, replace `CONTACT_EMAIL` with your support email.**

## 4. Distribution

- Visibility: Public
- Regions: All regions
- Pricing: Free (Pro payment to be added later)

## 5. Before you press Submit

- [ ] Replace `CONTACT_EMAIL` in `privacy/privacy.html`
- [ ] Privacy policy hosted and URL pasted
- [ ] Support email set in the Developer account
- [ ] Final test on YouTube: ads, live stream, theater mode, fullscreen, miniplayer
- [ ] Payment for PRO features (the only remaining item)
