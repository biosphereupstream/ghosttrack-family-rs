# GhostTrack Family Locator (`ghosttrack-family-rs`)

Aplikasi Android & Web (PWA) untuk **pelacakan GPS smartphone anggota keluarga berbasis izin resmi (opt-in)** yang dipadukan dengan modul utilitas **GhostTrack** (Phone Number Intelligence, IP Tracker, Username OSINT 22 platform) — dibangun dengan **Rust**, **WebAssembly**, **Axum**, **Tauri v2**, **Neon Serverless PostgreSQL**, dan **Vercel Free Tier**.

Referensi inspirasi OSINT: [HunxByts/GhostTrack](https://github.com/hunxbyts/ghosttrack)

---

## Rekomendasi Stack & Framework yang Digunakan

| Lapisan | Framework / Teknologi | Fungsi |
| :--- | :--- | :--- |
| **Core Engine** | **Rust (`ghosttrack-core`)** → `wasm32-unknown-unknown` | Parsing nomor HP +62/08xx & internasional, kalkulasi jarak Haversine & geofence Safe Zone, hash PIN SHA-256, dan daftar 22 platform OSINT. |
| **Android App** | **Tauri v2 (`src-tauri`)** + Android WebView APK & **PWA** | Membungkus aplikasi menjadi APK Android native (`com.ghosttrack.family`) dan mendukung instalasi langsung via Chrome Android (PWA). |
| **Native Backend** | **Rust Axum (`ghosttrack-server`)** | Server HTTP Rust performa tinggi untuk dijalankan lokal atau container/VPS. |
| **Free Tier Cloud API** | **Vercel Serverless Functions (`api/index.js`)** | Menjalankan binary Rust WASM (`public/wasm/ghosttrack_core.wasm`) di edge/serverless Vercel gratis. |
| **Free Tier Database** | **Neon Serverless PostgreSQL (`@neondatabase/serverless`)** | Menyimpan data grup keluarga, posisi GPS terbaru, Safe Zones, dan riwayat rute secara persisten. |
| **Peta & UI** | **Leaflet.js + OpenStreetMap / CARTO Dark** | Peta interaktif gratis tanpa perlu kartu kredit / API key Google Maps. |

---

## Struktur Workspace

- `crates/ghosttrack-core` — Library Rust murni (native + WebAssembly `ghosttrack_core.wasm`).
- `crates/ghosttrack-server` — Backend REST API Rust (`Axum` + `tokio` + `reqwest`).
- `src-tauri` — Proyek Tauri v2 Android & Desktop (`com.ghosttrack.family`).
- `api/index.js` — Vercel Serverless Function yang menjalankan `ghosttrack_core.wasm` + Neon Postgres.
- `public/` — Frontend PWA responsif, Leaflet map, Service Worker (`sw.js`), dan `public/wasm/ghosttrack_core.wasm`.
- `.github/workflows/android-apk.yml` — Workflow CI/CD GitHub Actions untuk menjalankan `cargo test`, build WASM, dan menghasilkan artefak `.apk` Android.

---

## Menjalankan Secara Lokal

### 1. Dengan Rust Server (Axum)
```bash
cargo test --workspace
cargo run -p ghosttrack-server
# Buka http://localhost:8787
```

### 2. Build Rust WebAssembly Core
```bash
rustup target add wasm32-unknown-unknown
cargo build -p ghosttrack-core --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/ghosttrack_core.wasm public/wasm/ghosttrack_core.wasm
```

### 3. Deploy ke Vercel + Neon Postgres (Free Tier)
```bash
npm install
vercel link --yes
vercel integration add neon
vercel deploy --prod --yes
```

---

## Catatan Privasi & Keamanan
- Pelacakan lokasi smartphone anggota keluarga bersifat **consent-based (opt-in)**: setiap perangkat anggota keluarga harus bergabung dengan Kode Grup + PIN keluarga dan menyetujui izin GPS Android/Browser.
- Modul **Phone Tracker** & **IP Tracker** dari referensi GhostTrack hanya membaca metadata prefix operator/negara dan geolokasi IP jaringan publik, bukan menyadap BTS atau meretas perangkat pihak ketiga.
