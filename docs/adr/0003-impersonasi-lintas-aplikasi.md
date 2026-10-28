# 3. Impersonasi menjangkau semua aplikasi klien, ditandai `act`, dan penolakan menjadi tanggung jawab klien

Tanggal: 2026-10-26

## Status

Diterima

## Konteks

Admin SADA membutuhkan cara untuk melihat dan menggunakan aplikasi klien persis seperti yang dialami seorang user, untuk keperluan troubleshooting. SADA adalah IdP, jadi Impersonasi di SADA tidak berhenti di Portal: aplikasi klien menerima identitas user itu dan bertindak atas namanya. Banyak aplikasi klien adalah sistem pemerintahan yang mencatat tindakan pegawai (persetujuan, tanda tangan, kepegawaian).

Pilihan yang dipertimbangkan:

- Impersonasi hanya di dalam SADA (Portal) — aman, tapi tidak menjawab kebutuhan troubleshooting di aplikasi klien.
- Impersonasi lintas aplikasi tanpa penanda — token identik dengan login asli; aplikasi klien dan jejaknya tidak bisa membedakan admin dari pegawai.
- Impersonasi lintas aplikasi dengan penanda, hanya untuk klien yang ikut serta (opt-in per klien, default mati).
- Impersonasi lintas aplikasi dengan penanda, untuk semua klien.

## Keputusan

Impersonasi menjangkau **semua** aplikasi klien. `sub` tetap target sehingga aplikasi yang sudah ada berjalan tanpa diubah, tetapi access token, ID token, dan UserInfo selalu membawa claim `act` (RFC 8693) yang berisi identitas admin. SADA tidak menyaring klien. Aplikasi klien yang menganggap suatu aksi terlalu sensitif untuk dilakukan saat Impersonasi bertanggung jawab membaca `act` dan menolaknya.

Alasannya: kebutuhan troubleshooting mencakup semua aplikasi, dan mengelola daftar izin per klien dinilai lebih mahal daripada manfaatnya. Penanda `act` menjaga agar Impersonasi tidak pernah menyamar sebagai login asli.

## Konsekuensi

- Aplikasi klien yang mengabaikan claim yang tidak dikenalnya **tidak bisa** membedakan Impersonasi dari login asli user. Pemilik aplikasi harus diberi tahu saat fitur ini dirilis, dan panduan integrasi (`docs/sso-integration-golang-gin.md`) harus menjelaskan `act`.
- Karena perlindungan di sisi klien tidak dijamin, pengaman di sisi SADA menjadi wajib, bukan opsional: alasan dan step-up TOTP untuk memulai, batas keras 30 menit, tanpa refresh token, `exp` tidak melewati akhir Impersonasi, audit yang mencatat admin dan target, serta riwayat yang terlihat oleh target.
- Pencabutan token hanya efektif bagi klien yang memakai `/oauth/introspect`. Klien yang memverifikasi JWT secara lokal hanya dilindungi oleh `exp`.
- Jangan "menyederhanakan" ini dengan menghapus `act` atau membuat token Impersonasi tanpa penanda. Mengubah ke opt-in per klien di kemudian hari tetap mungkin, tetapi akan memutus alur kerja admin di aplikasi yang belum ikut serta.
