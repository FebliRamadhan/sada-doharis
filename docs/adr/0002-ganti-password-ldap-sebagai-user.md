# 2. Ganti Password LDAP dilakukan sebagai user sendiri lewat Zimbra, bukan reset oleh admin

Tanggal: 2026-10-07 (direvisi 2026-10-09)

## Status

Diterima

## Konteks

Saat Masa Berlaku Password habis, SADA memaksa user INTERNAL mengganti Password LDAP. Direktori PANRB adalah OpenLDAP bawaan Zimbra; kebijakan password (panjang minimum, history, minimum age) hidup di COS Zimbra, bukan di ppolicy OpenLDAP, dan ACL Zimbra hanya mengizinkan `cn=admins,cn=zimbra` menulis `userPassword`.

Pilihan yang dipertimbangkan:

- LDAP Password Modify sebagai user — kemungkinan ditolak ACL Zimbra, dan bila lolos melewati kebijakan COS serta tidak memperbarui `zimbraPasswordModifiedTime`.
- Zimbra admin `SetPasswordRequest` setelah SADA memverifikasi password lama — SADA memegang kunci yang bisa mengganti password seluruh pegawai.
- Zimbra `ChangePasswordRequest` dengan akun + password lama user — jalur yang sama dengan webmail.

## Keputusan

SADA memanggil SOAP Zimbra `ChangePasswordRequest` (HTTPS) dengan akun, password lama, dan password baru milik user. Tidak ada token admin yang dipakai untuk mengganti password.

Alasannya: kebijakan COS Zimbra (history, panjang, minimum age) tetap ditegakkan Zimbra, `zimbraPasswordModifiedTime` ikut diperbarui sehingga perubahan lewat SADA dan lewat webmail terbaca sama, dan SADA tidak menjadi kunci untuk mengganti password orang lain.

## Konsekuensi

- Password lama dibutuhkan saat langkah ganti password. User mengetiknya ulang di form ganti password (lama / baru / konfirmasi); SADA tidak menahan password dalam bentuk apa pun di antara login, MFA, dan langkah ganti password.
- Penolakan dari Zimbra (history, kualitas, minimum age) harus diteruskan ke user sebagai pesan yang bisa dipahami.
- Jangan "memperbaiki" ini menjadi reset oleh admin demi kemudahan.
- Bind LDAP untuk pencarian saat ini masih memakai akun admin Zimbra lewat `ldap://` tanpa TLS — risiko yang sudah ada sebelum keputusan ini dan perlu ditangani terpisah.
