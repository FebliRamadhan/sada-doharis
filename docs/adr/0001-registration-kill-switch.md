# 1. Pendaftaran mandiri ditutup lewat kill-switch, bukan dihapus dari kode

Tanggal: 2026-08-27

## Status

Diterima

## Konteks

Audit produksi menemukan sejumlah User bertipe `EXTERNAL`. Penelusuran menunjukkan
asalnya adalah `POST /auth/register` — form "Daftar" yang tertaut dari halaman
login, terbuka untuk siapa saja, tanpa verifikasi email, tanpa persetujuan admin,
dan langsung menerbitkan sesi penuh beserta access + refresh token.

Akun semacam itu bukan sekadar baris menganggur. Tidak ada pemeriksaan tipe user
di alur authorize, sehingga satu akun anonim dapat menyelesaikan authorization
code flow ke **setiap** client OAuth yang terdaftar. Yang membatasinya hanya
penyaringan scope (`internal` dan `government` di-drop) dan `email_verified:
false`. Dengan kata lain, perlindungan sesungguhnya berada di aplikasi klien —
dan aplikasi klien yang membaca "punya token dari SSO PANRB" sebagai "pegawai
PANRB" akan salah menerima mereka.

Pendaftaran mandiri tidak pernah menjadi jalur masuk yang dirancang untuk SADA
SSO. Jalur resminya adalah LDAP untuk pegawai (INTERNAL) dan SPLP untuk ASN
instansi lain (GOVERNMENT). Tidak ada satu pun mekanisme pendukung yang biasanya
menyertai pendaftaran publik yang pernah dibangun di sini.

## Keputusan

Pendaftaran mandiri ditutup di belakang env `REGISTRATION_ENABLED`, default
**mati**. Endpoint membalas 404 saat mati; hanya string persis `'true'` yang
membukanya.

auth-ui mengetahui status flag ini saat runtime melalui endpoint publik baru
`GET /auth/config`, bukan lewat konstanta build-time `VITE_*`.

Alternatif yang dipertimbangkan dan ditolak:

- **Menghapus endpoint dan halamannya dari kode.** Paling bersih dan menghapus
  permukaan sepenuhnya. Ditolak karena menghilangkan kemampuan membuka kembali
  tanpa siklus rilis, sementara kebutuhan akun masyarakat umum belum tentu tidak
  pernah muncul.
- **Menyembunyikan link "Daftar" saja.** Ditolak: itu menyembunyikan pintu, bukan
  menguncinya. Endpoint tetap dapat dipanggil langsung, dan temuan auditnya akan
  muncul lagi persis sama.
- **Flag build-time `VITE_REGISTRATION_ENABLED` untuk sisi UI.** Ditolak karena
  melahirkan dua sumber kebenaran: mengubah env hanya mematikan endpoint,
  sedangkan link "Daftar" tetap terpampang sampai image auth-ui dibangun ulang —
  pengguna mengklik, mengisi form, lalu ditolak 404. Ongkosnya adalah satu
  endpoint publik berisi satu boolean; itu dinilai lebih murah daripada UI yang
  berbohong tentang kondisi server.

Pembacaan flag sengaja dibuat ketat (`=== 'true'`) dan gagal ke arah tertutup,
termasuk pada sisi UI bila fetch config gagal. Nilai yang "kira-kira benar"
seperti `'1'`, `'yes'`, atau `'TRUE'` tetap dianggap tertutup, dan sifat ini
dikunci oleh tes.

## Konsekuensi

- Membuka kembali pendaftaran cukup dengan mengubah env dan me-restart
  auth-service; tidak perlu membangun ulang image.
- Ada kode yang tidak terpakai di produksi (`RegisterPage`, handler register).
  Ini konsekuensi yang diterima secara sadar sebagai harga dari reversibilitas.
- Muncul satu endpoint publik tanpa autentikasi, `GET /auth/config`. Isinya
  dibatasi pada flag; menambahkan apa pun yang bersifat sensitif ke sana akan
  membocorkannya ke pra-autentikasi.
- Social login (Google/Facebook) **tidak** ikut tertutup oleh keputusan ini dan
  tetap dapat melahirkan User bertipe EXTERNAL bila env-nya terisi.
- Keputusan ini tidak menyentuh MFA. `MFA_REQUIRED_INTERNAL` tetap menyala.
