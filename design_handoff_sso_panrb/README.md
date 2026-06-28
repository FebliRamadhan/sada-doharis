# Handoff: SSO PANRB — Single Sign-On (Login, Registrasi, Lupa Password, Portal, Akun)

## Overview
Rangkaian antarmuka **Single Sign-On (SSO)** untuk lingkungan pemerintah (Kementerian PANRB). Mencakup seluruh perjalanan autentikasi pengguna ASN: masuk, verifikasi 2 langkah, pemilihan akun, persetujuan akses aplikasi pihak ketiga (consent), registrasi, pemulihan sandi, portal peluncur aplikasi, dan pengelolaan akun (keamanan, sesi/perangkat).

## About the Design Files
File dalam paket ini adalah **referensi desain yang dibuat dalam HTML** — prototipe yang menunjukkan tampilan dan perilaku yang diinginkan, **bukan kode produksi untuk disalin langsung**. Tugas implementasi adalah **membuat ulang desain ini di dalam codebase tujuan** (React, Vue, Angular, SwiftUI, native, dll.) menggunakan pola, komponen, dan library yang sudah ada di sana. Jika belum ada environment, pilih framework yang paling sesuai untuk proyek lalu implementasikan desain ini di sana.

> Teknis: file `.dc.html` adalah "Design Component" — markup dengan inline-style + sebuah kelas logika kecil (state React). Anggap sebagai spesifikasi visual + perilaku, bukan artefak yang dideploy. `support.js` adalah runtime preview internal dan **tidak** untuk dibawa ke produksi.

## Fidelity
**High-fidelity (hifi).** Warna, tipografi, spacing, ikon, dan interaksi sudah final dan mengikuti design system PANRB. Buat ulang UI seakurat mungkin menggunakan library codebase. (File `Wireframe SSO PANRB.dc.html` disertakan sebagai konteks low-fi/eksplorasi — bukan acuan visual final.)

---

## Design Tokens

### Warna (PANRB brand)
| Token | Hex | Penggunaan |
|---|---|---|
| Primary (blue) | `#005598` | Tombol/CTA utama, link, focus ring, ikon aktif |
| Primary hover | `#014B86` | Hover tombol primer |
| Navy | `#01347C` | Panel brand, header gelap, sidebar |
| Navy deep | `#00235A` | Ujung gradien panel brand |
| Accent blue | `#2894D9` | Ikon/aksen sekunder |
| Gold (accent) | `#F5C218` | Pita aksen brand, ring logo, indikator langkah/aktif |
| Red | `#C1272D` | Hanya untuk destruktif/aksi keluar perangkat |
| Success | `#15803D` | Status aktif/berhasil |
| Warning | `#B45309` | Peringatan/aktivitas tidak biasa |
| Error | `#C0392B` | Error/keluar |

### Warna UI (surface/teks/border)
| Token | Hex |
|---|---|
| Background | `#EEF4FB` |
| Surface | `#FFFFFF` |
| Surface muted | `#F5F8FC` / `#FBFDFF` |
| Text | `#0D1B2A` |
| Text secondary | `#354E6B` |
| Text muted | `#5E7896` |
| Placeholder | `#9DB2C9` |
| Border | `#C8D8EA` |
| Border subtle | `#E5EEF7` / `#F1F5F9` |
| Soft blue fill (icon bg) | `#EEF4FB` |
| Soft green fill | `#E8F5EC` |

### Tipografi
- **Heading**: `Plus Jakarta Sans`, weight 700/800. Judul layar 24–34px; section title 13–17px.
- **Body/UI**: `Inter`, weight 400/500/600/700. Body 13–14px; label 12px/600; caption 11px; hint 9–11px.
- Skala: 36 / 30 / 27 / 24 / 20 / 18 / 16 / 14 / 13 / 12 / 11 px.

### Radius
- Field/input & tombol: `11px`
- Kartu: `16px`
- Pill/badge: `999px`
- Ikon kontainer kecil: `10–14px`
- Avatar: `50%`

### Shadow
- Kartu default: `0 1px 3px rgba(13,27,42,.04)`
- Hover kartu app: `0 10px 24px -10px rgba(1,52,124,.28)` + `translateY(-2px)`
- Tombol primer: `0 6px 16px -6px rgba(0,85,152,.5)`

### Spacing
Kelipatan 4: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 28 / 32 / 40 / 48 px.

### Input field (pola baku)
- Tinggi 48–50px, border `1.5px solid #C8D8EA`, radius 11px, padding kiri 44px (ikon), kanan 46px bila ada tombol mata.
- **Focus**: `border-color:#005598; box-shadow:0 0 0 3px rgba(0,85,152,.13)`.
- Ikon di dalam field absolut kiri, warna `#9DB2C9`.

### Pola "split-banner" (shell autentikasi)
Dipakai di Login, Flow, Lupa Password, Registrasi.
- Kiri: panel brand `width:40–46%`, `min-width:380–420px`, teks putih, background:
  `radial-gradient(circle at 16% 10%, rgba(245,194,24,.18), transparent 40%), radial-gradient(circle at 88% 92%, rgba(40,148,217,.28), transparent 46%), linear-gradient(158deg,#01347C,#00235A)`.
  Isi: logo (ring emas + wordmark), judul `Plus Jakarta Sans 800 ~32px`, subteks, opsional daftar benefit (ikon centang emas), footer copyright, dan **progress bar emas** (segmen 28–30px tinggi 5px; terisi `#F5C218`, kosong `rgba(255,255,255,.22)`).
- Kanan: area form, di-center, `max-width 390–440px`, background `#FBFDFF`.
- Pita aksen emas `border-top:3px solid #F5C218` pada kartu (lihat wireframe) — di hifi, panel brand sendiri sudah membawa emas.

### Logo PANRB (placeholder)
Direpresentasikan sebagai lingkaran ring emas (`border:2–2.5px solid #F5C218`) berisi huruf "P" (Plus Jakarta Sans 800, warna `#F5C218` di atas navy / `#01347C` di atas terang) + wordmark "PANRB". **Ganti dengan aset logo PANRB resmi saat implementasi.**

---

## Screens / Views

### 1. Login (`Login B Hi-Fi.dc.html` & langkah 1 di `SSO Flow Hi-Fi.dc.html`)
- **Purpose**: Pengguna masuk dengan email instansi + sandi.
- **Layout**: Split-banner. Kanan: judul "Masuk ke SSO" + subjudul, field Email, field Kata sandi (dengan tombol mata show/hide), baris "Ingat saya" (checkbox) + "Lupa sandi?", tombol primer "Masuk" (panah kanan), divider "atau", tombol outline "Masuk dengan akun instansi" (ikon gedung), footer "Belum punya akun?".
- **States**: focus ring biru pada field; toggle mata menukar tipe input `password`↔`text` & ikon eye/eye-off; checkbox toggle; hover tombol primer → `#014B86`; hover outline → border `#9DB2C9`, bg `#F5F8FC`.
- **Tweaks/props**: `showFederation` (tampilkan tombol login instansi), `showSecurityBadges` (tampilkan poin keamanan di panel).
- **Top-right**: pemilih bahasa pill ID/EN.

### 2. Verifikasi OTP / 2FA (langkah 2 di `SSO Flow Hi-Fi.dc.html`)
- **Purpose**: Verifikasi 2 langkah pasca-login.
- **Layout**: Ikon amplop (kotak `#EEF4FB`), judul "Verifikasi kode", subteks tujuan email, **6 kotak input OTP** (48×58px, radius 11px), tombol "Verifikasi", link "Kirim ulang".
- **Behavior**: ketik 1 digit → fokus pindah ke kotak berikutnya; Backspace pada kotak kosong → mundur; hanya menerima angka (`maxlength=1`, `inputmode=numeric`).

### 3. Pilih akun / multi-akun (langkah 3)
- **Purpose**: Memilih identitas saat satu pengguna punya >1 akun.
- **Layout**: Judul "Pilih akun" + tujuan ("Lanjut ke Portal Layanan ASN sebagai:"), daftar baris akun (avatar inisial, nama, email, chevron). Baris terakhir putus-putus "Gunakan akun lain" (ikon +).
- **States**: hover baris → border `#005598`, bg `#F5F8FC`. Klik baris → lanjut.

### 4. Persetujuan akses / consent (langkah 4)
- **Purpose**: Aplikasi pihak ketiga (mis. "SI-ASN") meminta akses ke akun.
- **Layout**: Dua avatar (app & PANRB) dihubungkan titik-titik; judul "<App> meminta akses"; subteks akun; label "APLIKASI INI AKAN DAPAT"; daftar 3 scope (ikon + teks): profil dasar, email instansi, riwayat kepegawaian; tombol "Tolak" (outline) + "Izinkan" (primer); disclaimer privasi.
- **Behavior**: Izinkan → layar berhasil; Tolak → kembali ke awal.

### 5. Berhasil (langkah 5)
- Lingkaran centang hijau (`#E8F5EC`/`#15803D`), "Berhasil masuk", subteks pengalihan, tombol "Buka Portal".

### 6. Lupa Password (`Lupa Password Hi-Fi.dc.html`) — alur 3 langkah + sukses
- **Step 1 Email**: ikon gembok, "Lupa kata sandi?", field email, "Kirim kode".
- **Step 2 OTP**: 6 kotak (sama seperti #2), "Verifikasi".
- **Step 3 Sandi baru**: field sandi baru (toggle mata) + **meter kekuatan** (3 bar: Lemah `#C0392B` / Sedang `#B45309` / Kuat `#15803D`, dihitung dari panjang ≥8/12 & variasi huruf-angka-simbol), field konfirmasi, "Simpan sandi baru".
- **Step 4 Sukses**: "Sandi diperbarui", tombol kembali ke masuk.
- Panel brand menampilkan progress 3 segmen + judul yang berubah per langkah. Tombol "Kembali" kiri-atas (label "Kembali masuk" di step 1).

### 7. Registrasi (`Registrasi Hi-Fi.dc.html`)
- **Purpose**: Pendaftaran akun ASN baru.
- **Layout**: Split-banner (panel kiri lebih sempit `40%`). Form: baris Nama lengkap + NIP (150px), Email instansi (ikon), Select Instansi/Kementerian (chevron custom), Kata sandi (toggle mata), checkbox setuju Syarat & Kebijakan, tombol "Daftar & verifikasi". Setelah submit → layar sukses "Akun dibuat" (tautan verifikasi dikirim ke email).
- **States**: focus field; toggle mata; checkbox agree; submit → layar sukses.

### 8. Portal SSO (`Portal SSO Hi-Fi.dc.html`)
- **Purpose**: Peluncur aplikasi pasca-login (semua app yang dapat diakses dengan satu akun).
- **Layout**:
  - **Top bar** navy 64px sticky: logo "PANRB Portal", search bar (bg `rgba(255,255,255,.14)`), bell (badge emas), profil (avatar emas + nama/instansi + chevron).
  - **Body** max-width 1080px: judul sambutan, subteks jumlah app, filter pill (Semua/Kepegawaian/Layanan Publik).
  - "SERING DIGUNAKAN": grid 3 kolom kartu app (ikon 48px, nama, deskripsi, ikon external-link). Hover → angkat + shadow biru.
  - "SEMUA APLIKASI": grid 4 kolom kartu app (ikon 52px berinisial + nama + deskripsi) + kartu putus-putus "Ajukan akses".
- **Data app** (lihat logika): SI-ASN, e-Kinerja, SIASN BKN (sering); LAPOR!, SP4N, JDIH, e-Office, SKP Online, Presensi, Diklat, Arsip (semua), tiap item punya `abbr`, `name`, `desc`, `color`.

### 9. Akun (`Akun Hi-Fi.dc.html`) — app dengan sidebar + 3 tab
- **Layout**: Sidebar navy 240px (logo, nav: Ringkasan / Keamanan / Aktivitas & Perangkat / Aplikasi terhubung, kartu user + keluar di bawah). Item aktif: `bg rgba(255,255,255,.16)`, `border-left:3px solid #F5C218`, teks putih; inaktif `rgba(255,255,255,.6)`.
- **Tab Ringkasan**: kartu profil (avatar, nama, NIP/jabatan/instansi, "Edit profil"), 3 kartu statistik (Aplikasi terhubung 9 / Sesi aktif 2 / Status 2FA Aktif), daftar "Aktivitas terakhir" (dot status + teks + waktu).
- **Tab Keamanan**: daftar (Kata sandi → Ubah; Autentikasi 2 langkah → **toggle switch** biru/abu yang berfungsi; Email pemulihan → Kelola) + banner merah muda "Keluar semua perangkat".
- **Tab Aktivitas & Perangkat**: daftar sesi (ikon perangkat, nama browser/OS, lokasi/waktu; perangkat ini ditandai hijau; lainnya punya tombol "Keluarkan" merah).

---

## Interactions & Behavior
- **Navigasi alur** (SSO Flow, Lupa Password): state `step` numerik; tombol primer memajukan langkah; tombol "Kembali" memundurkan (clamp ke 1). Progress bar & judul panel mengikuti `step`.
- **OTP**: auto-advance fokus saat input terisi, auto-back saat Backspace di kotak kosong, filter non-digit.
- **Show/hide password**: toggle boolean menukar `type` & ikon.
- **Toggle 2FA**: switch — track `#005598` (on) / `#C8D8EA` (off), knob 20px geser kiri↔kanan, `justify-content` flex-end/flex-start, transisi 150ms.
- **Tab Akun**: state `tab` ('ringkasan'|'keamanan'|'aktivitas') mengganti konten + gaya nav.
- **Transisi**: warna/border/shadow 150ms; hover kartu app `translateY(-2px)`.
- **Strength meter**: hitung dari panjang & variasi karakter → 0–3 → warna+label bar.

## State Management
- `step` (int) — alur autentikasi & reset.
- `showPw` (bool) — visibilitas sandi (per field).
- `remember` (bool) — ingat saya.
- `otp` (string[6]) — digit OTP + refs untuk fokus.
- `pw` (string) — nilai sandi baru (untuk strength).
- `agree` (bool) — persetujuan syarat (registrasi).
- `done` (bool) — status submit registrasi.
- `tab` ('ringkasan'|'keamanan'|'aktivitas'), `tfa` (bool) — layar Akun.
- **Data fetching nyata** yang dibutuhkan saat implementasi: autentikasi (email+password), pengiriman & verifikasi OTP, daftar akun pengguna, daftar scope consent + grant, daftar aplikasi SSO, daftar sesi/perangkat aktif + revoke, profil akun, reset sandi, registrasi + kirim email verifikasi.

## Responsive
Desain dibuat untuk desktop (lebar ~1280px). Pada mobile: panel brand split sebaiknya disembunyikan/ditumpuk di atas; form full-width; grid app turun ke 2 kolom; sidebar Akun jadi drawer/bottom-nav. Lihat band "Versi Mobile" di `Wireframe SSO PANRB.dc.html` untuk arah tata letak ponsel (login, OTP, portal).

## Assets
- **Ikon**: stroke SVG inline (gaya Lucide/Feather, stroke 1.8–2). Aman diganti dengan set ikon codebase.
- **Logo PANRB**: placeholder ring+"P". **Wajib diganti aset resmi.**
- **Font**: Google Fonts — Plus Jakarta Sans (600/700/800), Inter (400/500/600/700).
- Tidak ada gambar bitmap; semua warna solid/gradien CSS.

## Files
Disertakan dalam folder ini (referensi desain):
- `Login B Hi-Fi.dc.html` — layar login final.
- `SSO Flow Hi-Fi.dc.html` — alur lengkap Login→OTP→Pilih akun→Consent→Berhasil (interaktif).
- `Lupa Password Hi-Fi.dc.html` — alur reset sandi.
- `Registrasi Hi-Fi.dc.html` — form pendaftaran.
- `Portal SSO Hi-Fi.dc.html` — peluncur aplikasi.
- `Akun Hi-Fi.dc.html` — pengelolaan akun (sidebar + tab).
- `Wireframe SSO PANRB.dc.html` — eksplorasi low-fi (konteks; bukan acuan visual final).
- `support.js` — runtime preview Design Component (JANGAN dibawa ke produksi; hanya agar file `.dc.html` bisa dibuka di browser).

### Cara membuka file referensi
Buka file `.dc.html` mana pun langsung di browser (butuh `support.js` di folder yang sama). Itu menampilkan desain interaktif persis seperti yang dimaksud.
