# 4. LDAP sekunder: dicoba hanya bila user tidak ada di primary, dan akun terikat ke direktorinya

Tanggal: 2026-10-29

## Status

Diterima

## Konteks

Sebagian pegawai PANRB (misalnya PPNPN) tidak punya akun di Zimbra primary; kredensial mereka ada di server Zimbra kedua. Kedua server memakai domain email yang sama, jadi SADA tidak bisa memilih direktori dari domain dan harus mencobanya berurutan. DN di kedua server juga berformat sama (`uid=…,ou=people,dc=menpan,dc=go,dc=id`), sehingga DN tidak menunjukkan asal direktori.

Pilihan yang dipertimbangkan:

- Coba secondary untuk setiap kegagalan di primary (user tidak ada, password salah, primary tidak terjangkau).
- Coba secondary hanya bila user tidak ditemukan di primary.
- Akun SADA mengikuti direktori tempat login terakhir berhasil, atau terikat ke direktori pertamanya.

## Keputusan

SADA mencari di primary dulu dan beralih ke secondary **hanya bila primary tidak punya user tersebut**. Password salah adalah login gagal; primary yang tidak terjangkau adalah login gagal (gagal tertutup), bukan alasan mencoba secondary.

Direktori pertama tempat user berhasil login **dicatat dan mengikat akun**. Bila user kemudian ditemukan di direktori lain, login ditolak (`LOGIN_DIRECTORY_MISMATCH`, tidak dihitung ke lockout) sampai admin menjalankan "Pindahkan direktori", yang juga mencabut semua sesi.

Alasannya: mencoba secondary saat password salah membuat satu tebakan menyerang dua direktori dan memungkinkan pemilik username kembar di secondary masuk dengan password miliknya sendiri; mencoba secondary saat primary mati memungkinkan pemilik username kembar mengambil alih akun pegawai primary selama gangguan. Ikatan direktori menutup sisa celah yang sama ketika identitas kembar muncul belakangan.

## Konsekuensi

- Jangan "memperbaiki" ini menjadi fallback untuk semua kegagalan demi kenyamanan login.
- Username dan email kembar di kedua direktori tetap harus dicegah oleh pengelola direktori; aturan ini membatasi dampaknya, tidak menghapusnya.
- Semua user INTERNAL yang sudah ada sebelum fitur ini dianggap terikat ke primary.
- Ganti password dan pembacaan `zimbraPasswordModifiedTime` diarahkan ke server Zimbra milik direktori user, sehingga secondary butuh URL SOAP dan akun bind sendiri.
- Perpindahan direktori yang sah (PPNPN diangkat lalu dibuatkan akun primary) selalu melalui admin.
