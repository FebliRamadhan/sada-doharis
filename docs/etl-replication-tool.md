# Rancangan Aplikasi Sinkronisasi Data Antar-Database

Tool internal untuk menyalin data dari satu database (source) ke database lain (tujuan) lintas DBMS, dengan pemicu manual (tombol) maupun terjadwal (scheduler). Dibangun dengan Node.js/TypeScript.

> **Ringkasan singkat:** ini pada dasarnya *ETL / replication tool ringan* dengan UI sendiri — semacam versi mini dari fitur data transfer, dibuat sesuai kebutuhan spesifik. Fokusnya: heterogen (MySQL ⇄ PostgreSQL), streaming, idempotent (aman di-rerun), kredensial terenkripsi, dan pemetaan kolom/tabel yang bisa di-rename bebas.

---

## 1. Ruang Lingkup & Konteks

| Aspek | Keputusan |
|---|---|
| DBMS source & tujuan | Heterogen: **MySQL ⇄ PostgreSQL** |
| Pemicu | Tombol manual **dan** scheduler (cron) |
| Volume saat ini | Kecil, tapi data transaksi terus bertambah tiap hari |
| Sifat operasi | Berulang (data ditarik hari ini, ditarik lagi besok dengan transaksi terbaru) |

**Metadata store:** konfigurasi aplikasi (koneksi, definisi job, mapping, log) disimpan di **PostgreSQL** milik aplikasi sendiri — terpisah dari database source/tujuan yang datanya dipindah.

---

## 2. Keputusan Desain (Ringkasan)

| # | Aspek | Keputusan |
|---|---|---|
| DBMS | Source & tujuan | Heterogen: MySQL ⇄ PostgreSQL |
| Strategi | Mode copy | Full **dan** incremental, dipilih per-job |
| Full copy | Jenis | **Additive** (upsert semua baris, tidak truncate) |
| Transport | Cara pindah | **Streaming** (server-side cursor), penulisan per-batch |
| Idempotency | Anti-duplikat | **Upsert** (`ON CONFLICT` / `ON DUPLICATE KEY UPDATE`) |
| Mapping | Rename field & tabel | Eksplisit di config; nama tujuan ditentukan bebas |
| Type | Konversi lintas dialek | Hint `type` per kolom |
| Skema tujuan | Pembuatan | Mode A (manual/DBA) **dan** B (tombol Setup); **DDL & DML dipisah keras** |
| DDL | Sifat tombol Setup | **Additive-only** (tidak drop/alter destruktif) |
| Kredensial | Penyimpanan | Enkripsi at-rest **AES-256-GCM** |
| Kegagalan | Recovery | Re-run dari awal (aman karena idempotent) |
| Watermark | Commit | Sekali di akhir, **hanya jika run sukses penuh** |
| Transaksi | Cakupan | **Commit per-batch** |
| Concurrency | Overlap run | **Lock per-job** (`locked_at`), dilepas di `finally` |
| Timezone | Watermark waktu | UTC+7, konsisten di kedua sisi |
| Observability | Pemantauan | Log run ke DB + **UI monitoring job** |
| FK ordering | Relasi tujuan | Di luar scope — tujuan flat/denormalized |

---

## 3. Konsep Kunci (Agar Tidak Tertukar)

Ada dua sumbu yang berbeda dan sering dikira sama:

- **Strategi** — *baris mana* yang dipindah tiap run: **full** vs **incremental**.
- **Transport** — *cara* memindahkan: **streaming/cursor** vs muat-semua-ke-memory.

Keduanya **orthogonal**. Streaming menyelesaikan masalah memory baik pada mode full maupun incremental.

**Full vs incremental — inti trade-off-nya:**

- **Full (additive):** upsert semua baris tiap run. Menangkap update baris lama, self-healing (run rusak diperbaiki run berikutnya), tidak butuh state. Harganya: biaya per run sebanding dengan *total* ukuran tabel → makin berat tiap hari untuk data yang terus tumbuh. **Tidak menangkap DELETE** (baris terhapus di source tetap ada di tujuan).
- **Incremental:** hanya memindah baris baru/berubah via `WHERE updated_at >= :watermark`. Ringan, bisa jalan lebih sering. Butuh penanda perubahan andal. Untuk data transaksi (append-only) ketidakmampuan menangkap delete umumnya bukan masalah.

**Wawasan desain:** *incremental itu sebenarnya full copy dengan watermark yang bergerak.* Code path-nya sama; bedanya hanya ada/tidaknya filter `WHERE`. Karena itu menyediakan **kedua mode hampir gratis** — cukup satu enum `mode` + kolom watermark. Menulis kodenya identik; yang perlu ditambah untuk incremental hanya satu `WHERE`.

---

## 4. Arsitektur Komponen

```
┌─────────────┐    ┌──────────────┐    ┌──────────┐    ┌───────────────┐
│  Connector  │ →  │ Reader Stream│ →  │  Mapper  │ →  │ Upsert Writer │
│ (source DB) │    │ (cursor)     │    │ (row→row)│    │  (target DB)  │
└─────────────┘    └──────────────┘    └──────────┘    └───────────────┘
        ▲                                                       │
        │                                                       ▼
  ┌───────────┐   ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
  │ Scheduler │   │ Config store│   │ Run logger   │   │ UI Monitoring│
  │ (cron)    │   │ (metadata)  │   │ (run_logs)   │   │ (baca logs)  │
  └───────────┘   └─────────────┘   └──────────────┘   └──────────────┘
```

**Rekomendasi stack:**

- **Query builder:** **Knex** — menangani dua dialek (MySQL & PG) sekaligus: quoting, placeholder, dan terutama upsert lintas dialek lewat `.onConflict().merge()`. Alternatif: driver mentah `pg` + `mysql2` (perlu menulis adapter dialek sendiri).
- **Streaming baca:** `pg-query-stream` (Postgres), `.stream()` di `mysql2` (MySQL).
- **Scheduler:** `node-cron` untuk skala kecil (jalan in-process). Untuk lebih andal: simpan jadwal di DB + worker, atau job queue seperti BullMQ.
- **Backend/UI:** Express / Fastify / NestJS.

**Pola streaming + backpressure (inti transport):**

```ts
for await (const row of readStream) {
  batch.push(mapRow(row));
  if (batch.length >= BATCH_SIZE) {
    await upsertBatch(batch);   // read stream otomatis "menahan" selama await ini
    batch = [];
  }
}
if (batch.length) await upsertBatch(batch);
```

Async iterator memberi **backpressure otomatis** — stream baca tidak menarik baris baru selama `await upsertBatch` berjalan. Memory yang terpakai hanya sebesar satu batch, tidak peduli source sedang bertumbuh.

---

## 5. Mapping: Rename Field & Rename Tabel

Rename **tabel** dan **field** keduanya hanya **data di config**, bukan kode.

- **Rename tabel:** cukup beda nama `target_table`.
- **Rename field:** daftar pemetaan kolom `source → target`. Nama tujuan **ditentukan bebas**, tidak terikat nama source.

Contoh gambaran logis satu job:

```yaml
source_table: "trx_transaksi"
target_table: "fact_transaction"      # rename TABEL — cukup di sini
primary_key: ["id"]                   # kolom TUJUAN, untuk conflict target upsert
watermark_column: "updated_at"        # kolom SOURCE, untuk filter incremental
mode: incremental
columns:
  - { source: "id_trx",  target: "transaction_id",   type: "integer"   }
  - { source: "nm_pgw",  target: "employee_name",    type: "text"      }
  - { source: "tgl",     target: "transaction_date", type: "timestamp" }
  - { source: "nilai",   target: "amount",           type: "numeric"   }
```

`mapRow()` berjalan di atas daftar `columns`: baris masuk pakai nama source, keluar pakai nama target. Fungsinya *pure* (row in → row out, tanpa I/O) sehingga mudah di-unit-test lepas dari DB.

### ⚠ Asimetri penting: baca = nama SOURCE, tulis = nama TARGET

- **Filter sisi-baca** (`WHERE updated_at >= ...`) berjalan di **source** → pakai **nama kolom source**.
- **Conflict sisi-tulis** (`ON CONFLICT (transaction_id)`) berjalan di **tujuan** → pakai **nama kolom target**.

Pegang aturan ini agar tidak tertukar saat kolom watermark/PK ikut di-rename.

### Type coercion

Field `type` per kolom ada karena MySQL↔PG tidak selalu mulus: `TINYINT(1)`→`BOOLEAN`, `DATETIME`→`TIMESTAMP`, unsigned int, ENUM/JSON. Mapper memaksa konversi berdasarkan hint ini, alih-alih bergantung pada tebakan driver yang kadang berbeda lintas dialek. `type` juga dipakai saat pembuatan kolom (mode DDL/Setup).

---

## 6. Skema Tujuan: Mode A & B, Pemisahan DDL/DML

Dua skenario pembuatan struktur tujuan, keduanya disediakan:

- **Mode A — target sudah ada** (dibuat manual/DBA). Tool hanya menulis data. Kredensial tujuan **tidak perlu hak DDL**. *Direkomendasikan sebagai default* — auditable, perimeter keamanan ketat.
- **Mode B — target dibuat tool.** Tool menjalankan DDL (`CREATE TABLE`/`ALTER TABLE ADD COLUMN`) dari definisi mapping. Praktis untuk bootstrap tujuan baru; harganya kredensial tujuan butuh hak DDL.

### Prinsip wajib: pisahkan DDL dari DML sebagai dua fase

Satu job punya **dua aksi terpisah**, bukan satu:

```
[Setup target schema]   ← Mode B: manual, sekali (atau saat skema berubah), butuh DDL
[Run copy]              ← Fase data: manual/scheduled, berulang, DML-only
```

Tiga alasan pemisahan keras ini:

1. **Hak akses beda.** Run harian cukup DML-only (INSERT/UPDATE); hak DDL hanya dipakai sekali saat Setup. Perimeter tetap terkunci, bukan menganga tiap job.
2. **Auto-DDL tiap run berbahaya.** Jika B jalan otomatis: source rename kolom → tool kira "kolom baru" → diam-diam `ADD COLUMN` → tujuan punya kolom hantu, data lama terbelah. Diam dan baru ketahuan saat data sudah kacau. **DDL harus selalu tindakan sadar manusia.**
3. **Model mental bersih:** "struktur diurus sekali, data diurus berulang."

### Validasi awal run — titik temu A & B

Setiap "Run copy", **sebelum** menulis data, memvalidasi struktur tujuan: *"apakah semua kolom target di mapping ada di DB tujuan?"*

- Ada yang kurang → **gagal berisik**, sebutkan kolom mana yang hilang. Tool **tidak** menambal sendiri.
- Remedy untuk Mode A: perbaiki di DB manual. Untuk Mode B: jalankan "Setup" lagi.

**Langkah validasinya identik untuk A dan B** — yang beda hanya *siapa yang membuat struktur*. Karena itu dua mode ini **tidak menjadi dua code path** — hanya satu path data, dengan satu langkah setup opsional di depan.

### ⚠ Tombol Setup harus additive-only

Buat tabel/kolom yang belum ada — boleh. **Jangan** auto-`DROP COLUMN` atau ubah tipe kolom yang sudah terisi (bisa membuang data diam-diam). Perubahan destruktif adalah keputusan yang layak dilakukan manusia langsung di DB. Additive-only membuat tombol Setup aman diulang berkali-kali.

### ⚠ Config mapping ≠ kenyataan skema DB

Mengubah `target: "id"` → `target: "transaction_id"` di config **tidak** me-rename kolom di DB tujuan — hanya membuat writer mengarah ke kolom baru yang mungkin belum ada, lalu gagal. Rename di mapping dan rename kolom di DB adalah dua tindakan terpisah yang harus dijaga sinkron. Langkah validasi awal run yang menangkap ketidaksinkronan ini.

---

## 7. Skema Tabel Konfigurasi (Metadata Store)

Empat tabel. Acuan: PostgreSQL.

### 7.1 `connections` — satu baris = satu database

```sql
CREATE TABLE connections (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            TEXT NOT NULL,                    -- label manusia, mis. "SIPPN Prod"
    dbms            TEXT NOT NULL CHECK (dbms IN ('mysql','postgres')),
    host            TEXT NOT NULL,
    port            INTEGER NOT NULL,
    database_name   TEXT NOT NULL,
    username        TEXT NOT NULL,
    -- kredensial AES-256-GCM — tidak pernah plaintext
    password_ciphertext  BYTEA NOT NULL,
    password_iv          BYTEA NOT NULL,              -- nonce/IV per record
    password_auth_tag    BYTEA NOT NULL,              -- GCM auth tag
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Satu koneksi bisa dipakai sebagai source di satu job dan target di job lain. Tiga kolom crypto (ciphertext + IV + auth tag) adalah bentuk baku AES-GCM; master key hidup di env/secrets manager, tidak pernah menyentuh tabel.

### 7.2 `jobs` — inti konfigurasi

```sql
CREATE TABLE jobs (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                 TEXT NOT NULL,
    source_connection_id BIGINT NOT NULL REFERENCES connections(id),
    target_connection_id BIGINT NOT NULL REFERENCES connections(id),
    source_table         TEXT NOT NULL,
    target_table         TEXT NOT NULL,               -- rename TABEL: cukup beda di sini

    mode                 TEXT NOT NULL CHECK (mode IN ('full','incremental')),
    watermark_column     TEXT,                         -- nama kolom SOURCE (wajib jika incremental)
    last_watermark       TEXT,                         -- high-water mark tersimpan (text, di-cast sesuai tipe)
    overlap_seconds      INTEGER NOT NULL DEFAULT 300, -- jaring pengaman TZ/DST/baris tepi
    batch_size           INTEGER NOT NULL DEFAULT 1000,

    -- concurrency lock
    locked_at            TIMESTAMPTZ,                  -- NULL = bebas; terisi = sedang jalan
    lock_owner           TEXT,                         -- opsional: id worker pemegang lock

    -- scheduler
    schedule_cron        TEXT,                         -- ekspresi cron; NULL = manual saja
    enabled              BOOLEAN NOT NULL DEFAULT true,-- scheduling aktif?

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- incremental WAJIB punya watermark_column
    CONSTRAINT incremental_needs_watermark
        CHECK (mode = 'full' OR watermark_column IS NOT NULL)
);
```

Dua keputusan dikunci sebagai constraint agar dijaga DB, bukan sekadar diingat:

- `CHECK incremental_needs_watermark` — mustahil membuat job incremental tanpa watermark column.
- `locked_at` memakai **timestamp**, bukan boolean — agar bisa menerapkan aturan "locked_at > X jam = stale, boleh diambil alih". Boolean tidak bisa membedakan "sedang jalan beneran" vs "nyangkut karena crash".

### 7.3 `column_mappings` — mapping kolom per job

```sql
CREATE TABLE column_mappings (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id         BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    source_column  TEXT NOT NULL,                     -- nama di SOURCE
    target_column  TEXT NOT NULL,                     -- nama di TUJUAN (bebas ditentukan)
    type           TEXT NOT NULL,                     -- hint: 'integer','timestamp','boolean','numeric',...
    is_primary_key BOOLEAN NOT NULL DEFAULT false,    -- kolom TUJUAN pembentuk conflict target upsert
    ordinal        INTEGER,                           -- urutan kolom (opsional, untuk DDL rapi)
    UNIQUE (job_id, target_column)
);
```

`source_column` + `target_column` yang independen = jawaban rename field & penentuan nama tujuan bebas. `is_primary_key` menandai kolom pembentuk conflict target upsert (ingat: nama **target**). `type` load-bearing untuk dua hal: coercion lintas dialek (DML) dan pembuatan kolom saat Setup (DDL).

### 7.4 `run_logs` — audit + sumber data UI monitoring

```sql
CREATE TABLE run_logs (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id           BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status           TEXT NOT NULL CHECK (status IN ('running','success','failed','skipped')),
    triggered_by     TEXT NOT NULL CHECK (triggered_by IN ('manual','scheduler')),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,                      -- NULL selama running
    rows_read        BIGINT NOT NULL DEFAULT 0,
    rows_written     BIGINT NOT NULL DEFAULT 0,
    watermark_before TEXT,                             -- watermark sebelum run
    watermark_after  TEXT,                             -- watermark sesudah (jika sukses & maju)
    error_message    TEXT                              -- terisi jika failed
);

CREATE INDEX idx_run_logs_job_started ON run_logs (job_id, started_at DESC);
```

Tiap kolom dipakai UI: `status` (termasuk `skipped` untuk kasus overlap), `rows_read/written` untuk progress, `watermark_before/after` untuk jejak audit pergerakan watermark, `error_message` untuk sebab gagal. Index penting karena UI sering menanyakan "run terakhir per job".

### Relasi antar tabel

```
connections ──┬──< jobs >──── column_mappings
              │      │
              └──────┤ (source & target sama-sama merujuk connections)
                     │
                     └──< run_logs
```

---

## 8. Alur Eksekusi Satu Run

1. **Trigger** (tombol/scheduler) mengambil job → cek `locked_at`. Terisi & belum stale → tulis `run_logs` status `skipped`, selesai. *(concurrency)*
2. Set `locked_at = now()`, tulis `run_logs` status `running`.
3. Baca `column_mappings` → bangun `SELECT` pakai nama **source** + filter `WHERE watermark_column >= last_watermark - overlap` jika incremental.
4. **Stream baca** → `mapRow` (source→target) → **batch upsert**, conflict target dari kolom `is_primary_key`, **commit per batch**.
5. **Sukses** → update `last_watermark`, `run_logs` jadi `success` + isi rows. **Gagal** → `failed` + `error_message`, **watermark tidak maju**.
6. **`finally`:** `locked_at = NULL`. *(lepas lock apa pun yang terjadi)*

**Setup schema (Mode B)** adalah operasi terpisah yang membaca `jobs` + `column_mappings` lalu menerbitkan DDL ke target — tidak menyentuh `run_logs`, tidak jalan tiap run.

---

## 9. Catatan Implementasi Kritis

### 🔴 Non-negotiable (paling sulit dinalar belakangan)

**Commit watermark.** Hanya boleh maju **setelah run sukses penuh**, di-commit **sekali di akhir**, bukan per-batch. Jika gagal di tengah tapi watermark terlanjur maju → baris yang belum terpindah hilang permanen di run berikutnya.

**Lock per-job.** Wajib ada untuk mencegah run yang sama jalan dobel saat jadwal menumpuk (mis. run 02:00 makan 70 menit, trigger 03:00 menyala). Dua instance membaca watermark sama → kerja dobel + berebut commit watermark. Pelepasan lock **wajib di `finally`** — jika crash dan lock tidak lepas, job terkunci selamanya. `locked_at` timestamp memungkinkan deteksi lock stale.

### 🟡 Penting

**Kegagalan di tengah run → re-run dari awal.** Aman karena upsert idempotent — batch yang sudah masuk tertimpa nilai sama. Run yang gagal jangan memajukan watermark.

**Transaksi per-batch.** Commit tiap N baris (lebih enteng, praktik lazim untuk data besar). Konsekuensi: run gagal meninggalkan tujuan "terisi sebagian" — diperbaiki rerun idempotent.

**Watermark berikutnya jangan `NOW()`.** Set ke `max(updated_at)` dari baris yang *benar-benar terbaca*, dengan **overlap window** (mundur beberapa menit). Rerun menarik ulang sedikit baris tepi — tidak duplikat karena idempotent. *Overlap menjamin tidak ada yang terlewat; idempotency menjamin tarik-ulang aman — keduanya sepasang.*

**Timezone UTC+7.** MySQL dan PG berbeda perlakuan timezone. Normalisasi semua `updated_at` ke satu acuan saat dibandingkan. Overlap window juga meredam beda TZ/DST di baris tepi.

**Kredensial AES-256-GCM.** Karena ada scheduler, password **wajib** tersimpan (job jam 2 pagi tidak bisa dimintai input) → enkripsi at-rest non-negotiable. Yang masuk DB hanya ciphertext + IV + auth tag; master key di env/secrets manager. Perimeter keamanan efektif pindah ke **kontrol akses aplikasi + audit trail** karena tool ini efektif jadi kunci ke banyak DB sekaligus.

**Observability.** Log run ke `run_logs`. Pertimbangkan notif (email/dsb.) saat gagal — untuk scheduled job yang jalan tanpa ditunggui, "diam berarti aman" adalah asumsi bahaya (job bisa mati seminggu tanpa disadari). Kolom `status` + `error_message` adalah prasyaratnya (sudah ada di skema).

---

## 10. Di Luar Scope (Sengaja Tidak Dibangun Sekarang)

- **FK ordering / relasi antar tabel tujuan.** Asumsi tujuan **flat/denormalized** (gaya reporting/konsolidasi) — tiap tabel berdiri sendiri, dipindah independen, urutan bebas, tidak ada FK violation. Jika nanti butuh tujuan relasional ber-FK, itu keputusan terpisah (urutan induk→anak / defer constraint) yang bisa ditambah tanpa membongkar yang ada.
- **True mirror (truncate + reload).** Mode ketiga terpisah jika ada kebutuhan tujuan jadi cermin persis source (menangkap delete). Jika dibuat, pakai pola **staging-then-swap**, bukan truncate langsung ke tabel produksi. Untuk data append-only, additive full sudah cukup.
- Retry policy otomatis, throttling beban ke source, kompatibilitas versi DB, handling perubahan primary key di source, cred DDL terpisah dari cred DML. Dicatat, tidak dibangun (over-engineering untuk skala saat ini).

---

## 11. Keputusan Implementasi di Monorepo `sada-api` (24 Agu 2026)

Hasil sesi diskusi implementasi; melengkapi rancangan generik di atas dengan keputusan spesifik repo ini.

| # | Aspek | Keputusan |
|---|---|---|
| 1 | Penempatan backend | Package baru **`@sada/etl-service`** (port 3003) — proses terpisah dari auth-service. Alasan utama: blast radius & keamanan — tool ini memegang kredensial banyak DB, tidak boleh satu proses dengan authorization server yang menghadap publik |
| 2 | Autentikasi | Menumpang SADA SSO: etl-service terdaftar sebagai **Client OAuth2** (Authorization Code + PKCE via auth-ui), dengan **Allowed Providers = LDAP** → hanya user INTERNAL yang bisa masuk |
| 3 | Otorisasi | LDAP-only belum cukup (= semua pegawai). Tambahan **allowlist** di metadata store dengan role `admin`/`operator`: admin = semua (connections, Setup Schema, CRUD job); operator = monitoring + trigger Run manual. Seed admin pertama via env/migration |
| 4 | UI | Package baru **`@sada/etl-ui`** — React + Vite + **Ant Design**; deploy SPA statis via Nginx (pola sama dengan auth-ui). Divergensi stack dari auth-ui (vanilla TS + DaisyUI) diterima karena bounded context berbeda. Desain tampilan dikerjakan lewat skill ui-ux, bukan antd default |
| 5 | Metadata store | Database logis baru **`etl`** di instance Postgres yang sama; schema Prisma `prisma/databases/etl/schema.prisma` + `DATABASE_ETL_URL`, mengikuti pola multi-DB `auth`/`main`/`reporting` yang sudah ada |
| 6 | ORM split | **Prisma hanya untuk metadata store.** Data plane (baca source, upsert target) memakai **Knex** — Prisma tidak cocok untuk query dinamis lintas dialek |
| 7 | Data plane | Knex: upsert lintas dialek `.onConflict().merge()`, streaming `.stream()`, dan **quoting identifier wajib** lewat Knex — nama tabel/kolom berasal dari config yang diketik user, tidak pernah dirangkai string manual (anti SQL injection via config). Type coercion tetap manual di `mapRow` sesuai hint `type` |
| 8 | Scheduler | **Poller DB** (tick tiap 30–60 dtk) + `cron-parser`, bukan node-cron/BullMQ. DB satu-satunya sumber kebenaran jadwal — menghilangkan kelas bug sinkronisasi registry in-memory vs `jobs.schedule_cron`. Presisi menit cukup untuk ETL |

### Konsekuensi terhadap skema metadata (§7)

- `jobs.next_run_at TIMESTAMPTZ` — kolom baru; poller mengklaim job dengan `next_run_at <= now()`, lalu dihitung ulang tiap selesai run / cron diubah.
- Tabel baru **`tool_users`** (allowlist otorisasi): identitas user SSO (email/NIP) + `role TEXT CHECK (role IN ('admin','operator'))`, dikelola admin lewat UI.
- Pertimbangan lanjutan (belum final): catat identitas pemicu manual di `run_logs` (mis. `triggered_by_user`) — audit trail "siapa menekan tombol Run" tersedia gratis dari token SSO.

---

## 12. Langkah Berikutnya

- [ ] Scaffold package `@sada/etl-service` + `@sada/etl-ui` di monorepo
- [ ] Schema Prisma `prisma/databases/etl/` + script `db:generate:etl` / `db:migrate:etl`
- [ ] Registrasi Client OAuth2 untuk etl-ui (Allowed Providers = LDAP) + middleware allowlist/role
- [ ] ERD visual relasi tabel
- [ ] Struktur kode engine (connector → reader stream → mapper → writer)
- [ ] Rancangan UI monitoring job (baca `run_logs`)
- [ ] Modul enkripsi kredensial (AES-256-GCM)
- [ ] Adapter dialek MySQL/PG (atau setup Knex)