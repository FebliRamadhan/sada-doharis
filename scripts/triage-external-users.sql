-- =============================================================================
-- Triase user EXTERNAL di produksi
-- =============================================================================
-- READ ONLY. Seluruh isi berjalan di dalam transaksi read-only dan diakhiri
-- ROLLBACK, jadi skrip ini tidak bisa mengubah data walau salah dijalankan.
--
-- Tujuan: memastikan asal-usul baris ber-userType EXTERNAL sebelum ada yang
-- dihapus. Kolom userType TIDAK dapat dipercaya begitu saja: jalur find-or-create
-- LDAP (user.service.ts:162-170, 280-283) tidak pernah memperbaiki userType, jadi
-- pegawai yang dulu mendaftar lewat form Daftar akan selamanya tercatat EXTERNAL.
--
-- Cara pakai (di server produksi):
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-sada_db}" \
--     -v internal_domain=menpan.go.id \
--     -v admin_emails=febli.ramadhani@menpan.go.id \
--     -f - < scripts/triage-external-users.sql
--
-- admin_emails: samakan persis dengan env ADMIN_EMAILS milik auth-service
-- (dipisah koma bila lebih dari satu). Nilai di bawah hanya default lokal.
-- =============================================================================

\if :{?internal_domain}
\else
\set internal_domain 'menpan.go.id'
\endif

\if :{?admin_emails}
\else
\set admin_emails 'febli.ramadhani@menpan.go.id'
\endif

\pset pager off
\timing off

BEGIN;
SET TRANSACTION READ ONLY;

\echo ''
\echo '=== 0. Parameter yang dipakai ==================================='
SELECT :'internal_domain' AS internal_domain,
       string_to_array(lower(:'admin_emails'), ',') AS admin_emails;

\echo ''
\echo '=== 1. Sebaran seluruh user per tipe dan provider ================'
-- Gambaran umum: seberapa besar porsi EXTERNAL dibanding INTERNAL/GOVERNMENT,
-- dan lewat provider apa mereka masuk.
SELECT "userType",
       COALESCE(provider, '(null)') AS provider,
       COUNT(*)                     AS jumlah,
       COUNT(*) FILTER (WHERE "isActive")   AS aktif,
       COUNT(*) FILTER (WHERE "mfaEnabled") AS mfa_on,
       MIN("createdAt")::date       AS pertama,
       MAX("createdAt")::date       AS terakhir
FROM "User"
GROUP BY "userType", provider
ORDER BY "userType", jumlah DESC;

\echo ''
\echo '=== 2. Daftar lengkap user EXTERNAL + jejak pendaftarannya ======='
-- ip dan userAgent berasal dari AuditLog action=REGISTER (auth.routes.ts:435).
-- Baris tanpa jejak REGISTER berarti user itu TIDAK lahir dari form Daftar
-- (kemungkinan social login, insert manual, atau audit log sudah dirotasi).
SELECT u.email,
       u.name,
       COALESCE(u.provider, '(null)') AS provider,
       u."isActive",
       u."mfaEnabled",
       (u.password IS NOT NULL)       AS punya_password,
       (u."ldapDn" IS NOT NULL)       AS pernah_ldap,
       u."createdAt",
       a.ip                           AS ip_daftar,
       LEFT(COALESCE(a."userAgent", ''), 60) AS ua_daftar
FROM "User" u
LEFT JOIN LATERAL (
  SELECT ip, "userAgent"
  FROM "AuditLog"
  WHERE "userId" = u.id AND action = 'REGISTER'
  ORDER BY "createdAt"
  LIMIT 1
) a ON TRUE
WHERE u."userType" = 'EXTERNAL'
ORDER BY u."createdAt";

\echo ''
\echo '=== 3. Pola pendaftaran per hari dan per IP ======================'
-- Membedakan "beberapa orang salah pintu masuk" dari "satu sumber mendaftar
-- berulang kali". Kalau satu ip menyumbang banyak akun, itu pola otomatis.
SELECT a."createdAt"::date AS tanggal,
       COALESCE(a.ip, '(tidak tercatat)') AS ip,
       COUNT(*) AS jumlah_pendaftaran
FROM "AuditLog" a
WHERE a.action = 'REGISTER'
GROUP BY tanggal, ip
ORDER BY tanggal DESC, jumlah_pendaftaran DESC;

\echo ''
\echo '=== 4. Apakah akun EXTERNAL dipakai SSO ke aplikasi klien ========'
-- Ini penentu taruhannya. Akun dengan token yang masih berlaku berarti sedang
-- dipakai orang di aplikasi klien; menghapusnya = memutus akses mereka.
SELECT u.email,
       c.name AS aplikasi_klien,
       COUNT(*) AS total_token,
       COUNT(*) FILTER (
         WHERE t."accessTokenExpiresAt" > now()
            OR t."refreshTokenExpiresAt" > now()
       ) AS token_masih_berlaku,
       MAX(t."createdAt") AS token_terakhir
FROM "OAuthToken" t
JOIN "User" u        ON u.id = t."userId"
JOIN "OAuthClient" c ON c.id = t."clientId"
WHERE u."userType" = 'EXTERNAL'
GROUP BY u.email, c.name
ORDER BY token_terakhir DESC NULLS LAST;

\echo ''
\echo '=== 5. KLASIFIKASI: tindakan yang disarankan per akun ============'
-- Label di sini SAMA PERSIS dengan aturan scripts/cleanup-external-users.sql,
-- supaya rencana yang Anda baca di sini adalah yang benar-benar dieksekusi nanti.
-- Konservatif: apa pun yang menyerempet admin, domain internal, social login,
-- atau sesi aktif tidak pernah masuk kandidat hapus.
--
-- 1b muncul karena callback Google/Facebook menerbitkan token tanpa melewati
-- MFA; menaikkannya ke INTERNAL secara otomatis akan memberi klaim pegawai
-- kepada identitas yang tidak pernah diverifikasi LDAP. Putuskan satu per satu.
WITH admin_list AS (
  SELECT lower(trim(e)) AS email
  FROM unnest(string_to_array(:'admin_emails', ',')) AS e
),
token_aktif AS (
  SELECT "userId", COUNT(*) AS n
  FROM "OAuthToken"
  WHERE "accessTokenExpiresAt" > now() OR "refreshTokenExpiresAt" > now()
  GROUP BY "userId"
)
SELECT
  CASE
    WHEN lower(u.email) IN (SELECT email FROM admin_list)
      THEN '0. JANGAN SENTUH - akun admin (ADMIN_EMAILS)'
    WHEN u.provider IS DISTINCT FROM 'local' AND u."ldapDn" IS NULL
         AND lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
      THEN '1b. TINJAU MANUAL - social login beremail domain internal'
    WHEN (u.provider = 'local' OR u."ldapDn" IS NOT NULL)
         AND (lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
              OR u."ldapDn" IS NOT NULL)
      THEN '1. REPAIR ke INTERNAL - pegawai yang salah pintu masuk'
    WHEN COALESCE(ta.n, 0) > 0
      THEN '2. TAHAN - masih punya sesi aktif di aplikasi klien'
    WHEN u.provider IS DISTINCT FROM 'local'
      THEN '2b. DIAM - social login, bukan lahir dari form Daftar'
    ELSE '3. KANDIDAT HAPUS - dari form Daftar, di luar organisasi, tanpa sesi aktif'
  END AS tindakan,
  u.email,
  COALESCE(u.provider, '(null)') AS provider,
  u."isActive",
  COALESCE(ta.n, 0) AS token_aktif,
  u."createdAt",
  u.id
FROM "User" u
LEFT JOIN token_aktif ta ON ta."userId" = u.id
WHERE u."userType" = 'EXTERNAL'
ORDER BY tindakan, u."createdAt";

\echo ''
\echo '=== 6. Rekap jumlah per tindakan ================================='
WITH admin_list AS (
  SELECT lower(trim(e)) AS email
  FROM unnest(string_to_array(:'admin_emails', ',')) AS e
),
token_aktif AS (
  SELECT "userId", COUNT(*) AS n
  FROM "OAuthToken"
  WHERE "accessTokenExpiresAt" > now() OR "refreshTokenExpiresAt" > now()
  GROUP BY "userId"
)
SELECT
  CASE
    WHEN lower(u.email) IN (SELECT email FROM admin_list) THEN '0. JANGAN SENTUH'
    WHEN u.provider IS DISTINCT FROM 'local' AND u."ldapDn" IS NULL
         AND lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
      THEN '1b. TINJAU MANUAL'
    WHEN (u.provider = 'local' OR u."ldapDn" IS NOT NULL)
         AND (lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
              OR u."ldapDn" IS NOT NULL)
      THEN '1. REPAIR'
    WHEN COALESCE(ta.n, 0) > 0 THEN '2. TAHAN'
    WHEN u.provider IS DISTINCT FROM 'local' THEN '2b. DIAM'
    ELSE '3. KANDIDAT HAPUS'
  END AS tindakan,
  COUNT(*) AS jumlah
FROM "User" u
LEFT JOIN token_aktif ta ON ta."userId" = u.id
WHERE u."userType" = 'EXTERNAL'
GROUP BY tindakan
ORDER BY tindakan;

\echo ''
\echo '=== 7. Verifikasi asumsi: adakah EXTERNAL yang ber-MFA? =========='
-- Penegakan MFA hanya menyasar INTERNAL (login-issuer.service.ts:97), sehingga
-- hasil yang diharapkan adalah 0 baris. Kalau ternyata ada isinya, asumsi itu
-- salah dan perlu ditelusuri ulang sebelum menyentuh apa pun soal MFA.
SELECT email, provider, "mfaEnabled", "mfaEnabledAt"
FROM "User"
WHERE "userType" = 'EXTERNAL' AND "mfaEnabled" = TRUE;

\echo ''
\echo '=== 8. Efek samping bila kandidat hapus jadi dieksekusi =========='
-- Token dan authorization code ikut terhapus otomatis (onDelete: Cascade).
-- AuditLog TIDAK punya foreign key, jadi jejak auditnya tetap tinggal.
SELECT
  (SELECT COUNT(*) FROM "OAuthToken" t
     JOIN "User" u ON u.id = t."userId" WHERE u."userType" = 'EXTERNAL')
    AS token_ikut_terhapus,
  (SELECT COUNT(*) FROM "OAuthAuthorizationCode" ac
     JOIN "User" u ON u.id = ac."userId" WHERE u."userType" = 'EXTERNAL')
    AS authcode_ikut_terhapus,
  (SELECT COUNT(*) FROM "AuditLog" a
     JOIN "User" u ON u.id = a."userId" WHERE u."userType" = 'EXTERNAL')
    AS auditlog_tetap_tinggal;

ROLLBACK;

\echo ''
\echo 'Selesai. Tidak ada data yang diubah (transaksi read-only, di-rollback).'
\echo 'Langkah berikutnya: kirim hasil bagian 5 dan 6 untuk menyusun skrip perbaikan.'
