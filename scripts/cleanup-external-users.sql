-- =============================================================================
-- Pembersihan user EXTERNAL hasil pendaftaran mandiri
-- =============================================================================
-- DRY-RUN secara default. Tanpa -v commit=true, seluruh perubahan di-ROLLBACK
-- dan skrip ini hanya memperlihatkan apa yang AKAN terjadi.
--
-- Jalankan scripts/triage-external-users.sql lebih dulu dan baca hasilnya.
-- Skrip ini menerapkan keputusan yang sudah disepakati, bukan menggantikan
-- pemeriksaannya:
--
--   HAPUS  : userType=EXTERNAL, provider='local' (lahir dari form Daftar),
--            domain email BUKAN domain internal, TIDAK ada di admin_emails,
--            dan TIDAK punya token yang masih berlaku.
--   REPAIR : userType=EXTERNAL tapi berdomain internal ATAU punya ldapDn —
--            ini pegawai yang salah pintu masuk. Diubah jadi INTERNAL.
--   DIAM   : social login (google/facebook), akun admin, dan siapa pun yang
--            masih punya token berlaku. Tidak disentuh sama sekali.
--
-- Cara pakai:
--   # 1. lihat rencananya (aman, tidak mengubah apa pun)
--   docker compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-sada_db}" \
--     -v internal_domain=menpan.go.id \
--     -v admin_emails=email.admin@menpan.go.id \
--     -f - < scripts/cleanup-external-users.sql
--
--   # 2. eksekusi sungguhan (setelah rencananya Anda setujui)
--   ... -v commit=true ... -f - < scripts/cleanup-external-users.sql
--
-- Baris yang dihapus disalin dulu ke tabel "arsip_user_external", dan setiap
-- tindakan dicatat di "AuditLog". Jadi keputusan ini bisa ditelusuri balik —
-- dan, kalau ternyata salah sasaran, identitasnya bisa dibentuk ulang.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

\if :{?internal_domain}
\else
\set internal_domain 'menpan.go.id'
\endif

\if :{?commit}
\else
\set commit false
\endif

-- admin_emails TIDAK punya nilai default: menjalankan ini tanpa daftar admin
-- yang benar berisiko menghapus akun yang memegang kunci console.
\if :{?admin_emails}
\else
\echo '!! BERHENTI: -v admin_emails=... wajib diisi, samakan dengan env ADMIN_EMAILS.'
\echo '!! Tanpa itu akun admin bisa ikut terhapus.'
\quit
\endif

BEGIN;

\echo ''
\echo '=== Parameter ==================================================='
SELECT :'internal_domain' AS internal_domain,
       string_to_array(lower(:'admin_emails'), ',') AS admin_emails,
       :'commit' AS commit_mode;

-- ---------------------------------------------------------------------------
-- Menentukan sasaran. Dihitung sekali di awal supaya angka yang ditampilkan
-- dan baris yang disentuh dijamin himpunan yang sama.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _admin (email text) ON COMMIT DROP;
INSERT INTO _admin
SELECT lower(trim(e)) FROM unnest(string_to_array(:'admin_emails', ',')) AS e;

CREATE TEMP TABLE _token_aktif ON COMMIT DROP AS
SELECT "userId", COUNT(*) AS n
FROM "OAuthToken"
WHERE "accessTokenExpiresAt" > now() OR "refreshTokenExpiresAt" > now()
GROUP BY "userId";

-- Social login SENGAJA tidak ikut di-repair meski beremail domain internal.
-- Callback Google/Facebook menerbitkan token tanpa melewati MFA sama sekali,
-- jadi menaikkan baris semacam itu ke INTERNAL akan memberi klaim pegawai
-- kepada identitas yang tidak pernah diverifikasi LDAP maupun faktor kedua.
-- Baris seperti itu dilaporkan di bagian "tidak disentuh" untuk ditinjau manual.
-- Akun admin juga TIDAK ikut di-repair otomatis. Repair menaikkan seseorang ke
-- INTERNAL, dan INTERNAL wajib MFA — artinya admin akan diminta enroll TOTP
-- pada login berikutnya. Orang yang menjalankan skrip ini adalah admin itu
-- sendiri; mengunci dirinya di tengah pembersihan adalah kegagalan yang paling
-- mahal di sini. Repair akun admin sebaiknya dilakukan tersendiri, saat
-- authenticator-nya sudah siap.
CREATE TEMP TABLE _repair ON COMMIT DROP AS
SELECT u.id, u.email, u.provider, u."createdAt"
FROM "User" u
WHERE u."userType" = 'EXTERNAL'
  AND lower(u.email) NOT IN (SELECT email FROM _admin)
  AND (u.provider = 'local' OR u."ldapDn" IS NOT NULL)
  AND (
    lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
    OR u."ldapDn" IS NOT NULL
  );

CREATE TEMP TABLE _hapus ON COMMIT DROP AS
SELECT u.id, u.email, u.provider, u."createdAt"
FROM "User" u
LEFT JOIN _token_aktif t ON t."userId" = u.id
WHERE u."userType" = 'EXTERNAL'
  AND u.provider = 'local'                                   -- lahir dari form Daftar
  AND lower(split_part(u.email, '@', 2)) <> lower(:'internal_domain')
  AND u."ldapDn" IS NULL
  AND lower(u.email) NOT IN (SELECT email FROM _admin)
  AND COALESCE(t.n, 0) = 0                                   -- tanpa sesi aktif
  AND u.id NOT IN (SELECT id FROM _repair);

\echo ''
\echo '=== Akan DIHAPUS ================================================'
SELECT email, provider, "createdAt" FROM _hapus ORDER BY "createdAt";

\echo ''
\echo '=== Akan di-REPAIR jadi INTERNAL ================================'
\echo '(setelah ini mereka masuk cakupan MFA dan akan diminta setup TOTP)'
SELECT email, provider, "createdAt" FROM _repair ORDER BY "createdAt";

\echo ''
\echo '=== Sengaja TIDAK disentuh ======================================'
SELECT u.email,
       COALESCE(u.provider, '(null)') AS provider,
       CASE
         WHEN lower(u.email) IN (SELECT email FROM _admin)
              AND (lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
                   OR u."ldapDn" IS NOT NULL)
           THEN 'akun admin — sebenarnya layak REPAIR, lakukan terpisah saat authenticator siap'
         WHEN lower(u.email) IN (SELECT email FROM _admin) THEN 'akun admin'
         WHEN COALESCE(t.n, 0) > 0 THEN 'masih punya token berlaku'
         WHEN u.provider IS DISTINCT FROM 'local'
              AND lower(split_part(u.email, '@', 2)) = lower(:'internal_domain')
           THEN 'TINJAU MANUAL: social login beremail domain internal'
         WHEN u.provider IS DISTINCT FROM 'local' THEN 'bukan dari form Daftar (social login)'
         ELSE 'tidak memenuhi kriteria hapus'
       END AS alasan
FROM "User" u
LEFT JOIN _token_aktif t ON t."userId" = u.id
WHERE u."userType" = 'EXTERNAL'
  AND u.id NOT IN (SELECT id FROM _hapus)
  AND u.id NOT IN (SELECT id FROM _repair)
ORDER BY u.email;

-- ---------------------------------------------------------------------------
-- Arsip. Dibuat sebelum penghapusan supaya identitas yang dibuang masih bisa
-- direkonstruksi bila keputusannya ternyata keliru. Token TIDAK diarsipkan:
-- itu kredensial yang memang harus mati bersama akunnya.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "arsip_user_external" AS
SELECT *, now() AS "arsipAt", ''::text AS "arsipAlasan" FROM "User" WHERE false;

INSERT INTO "arsip_user_external"
SELECT u.*, now(), 'pendaftaran mandiri ditutup — pembersihan temuan audit'
FROM "User" u JOIN _hapus h ON h.id = u.id;

-- ---------------------------------------------------------------------------
-- Jejak audit. AuditLog tidak punya foreign key ke User, jadi catatan ini tetap
-- tinggal setelah barisnya hilang. id harus diisi sendiri: default cuid milik
-- Prisma dibuat di sisi aplikasi, bukan di database.
-- ---------------------------------------------------------------------------
INSERT INTO "AuditLog" (id, action, "userId", details, "createdAt")
SELECT gen_random_uuid()::text,
       'USER_PURGED',
       h.id,
       jsonb_build_object(
         'email', h.email,
         'provider', h.provider,
         'registeredAt', h."createdAt",
         'reason', 'self-registration closed; audit finding cleanup'
       ),
       now()
FROM _hapus h;

INSERT INTO "AuditLog" (id, action, "userId", details, "createdAt")
SELECT gen_random_uuid()::text,
       'USER_TYPE_REPAIRED',
       r.id,
       jsonb_build_object('email', r.email, 'from', 'EXTERNAL', 'to', 'INTERNAL'),
       now()
FROM _repair r;

-- ---------------------------------------------------------------------------
-- Eksekusi
-- ---------------------------------------------------------------------------
UPDATE "User" SET "userType" = 'INTERNAL', "updatedAt" = now()
WHERE id IN (SELECT id FROM _repair);

-- OAuthToken dan OAuthAuthorizationCode ikut terhapus lewat ON DELETE CASCADE.
DELETE FROM "User" WHERE id IN (SELECT id FROM _hapus);

\echo ''
\echo '=== Ringkasan ==================================================='
SELECT (SELECT COUNT(*) FROM _hapus)  AS dihapus,
       (SELECT COUNT(*) FROM _repair) AS direpair,
       (SELECT COUNT(*) FROM "User" WHERE "userType" = 'EXTERNAL') AS sisa_external,
       (SELECT COUNT(*) FROM "arsip_user_external")                AS total_arsip;

\if :commit
COMMIT;
\echo ''
\echo '>> COMMIT. Perubahan sudah permanen.'
\echo '>> Lanjutkan dengan membersihkan sesi Redis milik akun yang dihapus'
\echo '>> (lihat catatan di akhir berkas ini).'
\else
ROLLBACK;
\echo ''
\echo '>> DRY-RUN. Tidak ada yang berubah.'
\echo '>> Bila rencana di atas sudah benar, ulangi dengan: -v commit=true'
\endif

-- =============================================================================
-- Setelah COMMIT: sesi Redis
-- =============================================================================
-- Sesi SSO disimpan di Redis sebagai `session:<sid>` berisi userId, dan TIDAK
-- ikut terhapus bersama baris User. Sisa sesi milik akun yang sudah dihapus
-- akan gagal sendiri saat dipakai, tapi lebih bersih bila dibuang langsung:
--
--   docker compose -f docker-compose.prod.yml exec -T redis sh -c '
--     redis-cli --scan --pattern "session:*" | while read k; do
--       v=$(redis-cli get "$k")
--       # cocokkan $v dengan daftar id di tabel arsip_user_external
--       echo "$k -> $v"
--     done'
--
-- Daftar id-nya:
--   SELECT id FROM "arsip_user_external";
-- =============================================================================
