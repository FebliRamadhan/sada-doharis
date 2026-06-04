# CI/CD untuk Pemula — Dari Nol sampai Jalan

Dokumen ini untuk kamu yang **baru pertama kali** belajar CI/CD. Tujuannya: paham
konsepnya dulu, lalu menyiapkan semuanya dari awal (fresh) untuk proyek **sada-doharis**,
langkah demi langkah, plus kesalahan umum yang sering bikin gagal.

> Sudah paham konsep & cuma butuh referensi cepat? Lihat [`cicd.md`](./cicd.md).

---

## Bagian 1 — Apa itu CI/CD?

CI/CD adalah cara **mengotomatiskan** proses dari "menulis kode" sampai "kode jalan di
server", supaya tidak dikerjakan manual satu per satu.

Bayangkan tanpa CI/CD, tiap kali ada perubahan kamu harus:
1. Jalankan test manual
2. Build aplikasi manual
3. Upload ke server manual (FTP/SCP)
4. Restart service manual

Capek, lambat, dan gampang lupa langkah. CI/CD membuat semua itu **otomatis** begitu kamu
`git push`.

### CI = Continuous Integration (Integrasi Berkelanjutan)
Setiap kali kode masuk, **otomatis dicek**: apakah lolos lint, type-check, build, dan test?
Tujuannya menangkap error **sebelum** sampai ke produksi.

> Analogi: satpam di pintu masuk yang memeriksa setiap kode — kalau cacat, ditolak.

### CD = Continuous Delivery/Deployment (Pengiriman Berkelanjutan)
Setelah lolos CI, kode **otomatis dikemas dan dikirim** ke server produksi.

> Analogi: kurir yang otomatis mengantar paket (aplikasi) ke alamat (server) begitu lolos
> pemeriksaan.

### Alur besar di proyek ini
```
kamu git push ke "main"
        │
        ▼
   [CI]  cek lint + build + test                (workflow: ci.yml)
        │
        ▼
 [Release] build Docker image → simpan ke GHCR  (workflow: release.yml)
        │
        ▼
 [Deploy]  SSH ke server → tarik image → restart (workflow: deploy.yml)
        │
        ▼
   Aplikasi versi baru hidup di https://auth.menpan.go.id
```

---

## Bagian 2 — Istilah yang Wajib Dikenal Dulu

| Istilah | Penjelasan sederhana |
|---------|----------------------|
| **Repository (repo)** | Tempat kode disimpan di GitHub. |
| **GitHub Actions** | Mesin otomatisasi bawaan GitHub yang menjalankan CI/CD. Gratis untuk repo. |
| **Workflow** | Satu file resep (`.github/workflows/*.yml`) berisi langkah-langkah otomatis. |
| **Job / Step** | Workflow terdiri dari beberapa *job*, tiap job punya banyak *step* (perintah). |
| **Trigger** | Pemicu workflow, mis. `push ke main`, `buka PR`, atau manual. |
| **Runner** | Komputer yang menjalankan workflow. Ada 2 jenis (lihat di bawah). |
| **Docker image** | Aplikasi yang sudah "dibungkus" lengkap dengan dependensinya, siap jalan di mana saja. |
| **Registry (GHCR)** | Gudang penyimpanan Docker image. GHCR = GitHub Container Registry. |
| **Secret** | Nilai rahasia (password, token, SSH key) yang disimpan terenkripsi di GitHub. |
| **Variable** | Nilai non-rahasia (mis. URL) yang disimpan di GitHub. |
| **Environment** | Pengelompokan deploy (mis. `production`) dengan secret/aturannya sendiri. |

### Runner: Cloud vs Self-Hosted (PENTING)
- **Cloud runner** (`runs-on: ubuntu-latest`): komputer milik GitHub di internet. Cocok
  untuk CI & build image. **Tidak bisa** menjangkau jaringan privat kamu.
- **Self-hosted runner** (`runs-on: self-hosted`): komputer milik **kamu** (mis. server
  produksi) yang didaftarkan ke GitHub. **Wajib** kalau server target ber-IP privat
  (mis. `192.168.x.x`), karena cloud runner tak bisa SSH ke LAN.

> Di proyek ini server `192.168.66.74` adalah IP privat → **deploy memakai self-hosted runner**.

---

## Bagian 3 — Gambaran Komponen Fisik

```
┌─────────────┐   git push    ┌──────────────────┐
│  Laptop     │ ────────────▶ │   GitHub (cloud) │
│  (kamu)     │               │  Actions + GHCR  │
└─────────────┘               └──────────────────┘
                                      │
                       Deploy job jalan di self-hosted runner
                                      │ (runner ADA di server)
                                      ▼
                         ┌─────────────────────────────┐
                         │ Server 192.168.66.74        │
                         │  - self-hosted runner       │
                         │  - Docker + compose         │
                         │  - /root/apps/sada-doharis  │
                         │    (.env, compose, data DB) │
                         └─────────────────────────────┘
                                      ▲
                          LB eksternal (terminasi SSL)
                                      ▲
                           https://auth.menpan.go.id
```

---

## Bagian 4 — Persiapan dari NOL (Step by Step)

Urutan: **(A) prasyarat → (B) sisi GitHub → (C) sisi server → (D) cek workflow → (E) jalan pertama**.

### A. Prasyarat (siapkan dulu)
- [ ] Akun GitHub + repo sudah ada (`FebliRamadhan/sada-doharis`)
- [ ] `gh` CLI ter-install di laptop, lalu login: `gh auth login`
- [ ] Akses SSH ke server produksi (`ssh root@192.168.66.74`)
- [ ] Server sudah ada **Docker** + **Docker Compose v2** (`docker compose version`)
- [ ] Domain `auth.menpan.go.id` mengarah ke LB, LB meneruskan ke server **port 80**

### B. Sisi GitHub

**B1. Buat Personal Access Token (PAT) untuk tarik image dari GHCR**
GitHub → Settings → Developer settings → Personal access tokens → buat token dengan scope
**`read:packages`**. Simpan tokennya.

**B2. Daftarkan Secrets** (rahasia — terenkripsi). Jalankan dari folder repo:
```bash
gh secret set PROD_HOST        --body "192.168.66.74"
gh secret set PROD_USER        --body "root"
gh secret set PROD_DEPLOY_PATH --body "/root/apps/sada-doharis"   # ← lihat "Kesalahan Umum" #1
gh secret set GHCR_USER        --body "FebliRamadhan"
gh secret set GHCR_TOKEN       --body "ghp_xxxxx"                 # PAT dari B1
gh secret set PROD_SSH_KEY     < ~/.ssh/id_ed25519_deploy         # private key, via file
# (opsional) gh secret set PROD_SSH_PORT --body "22"
```
> **Aturan emas:** jangan pernah mengetik nilai secret langsung yang bisa terlihat orang
> lain (chat, screen-share). Gunakan `< file` untuk key. Kalau telanjur bocor → **revoke
> & ganti**.

**B3. Daftarkan Variable** (non-rahasia):
```bash
gh variable set PROD_URL --body "https://auth.menpan.go.id"
```

**B4. SSH key untuk deploy**
Server perlu mengizinkan runner/CI masuk via SSH. Buat keypair khusus deploy (jangan pakai
key pribadimu):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_deploy -C "gh-deploy" -N ""
ssh-copy-id -i ~/.ssh/id_ed25519_deploy.pub root@192.168.66.74   # daftarkan public key
ssh -i ~/.ssh/id_ed25519_deploy root@192.168.66.74 'echo OK'      # tes: harus "OK" tanpa password
```
Lalu set private key-nya: `gh secret set PROD_SSH_KEY < ~/.ssh/id_ed25519_deploy`.

### C. Sisi Server

**C1. Pasang self-hosted runner** (karena IP privat). Ambil token registrasi dari laptop:
```bash
gh api -X POST repos/FebliRamadhan/sada-doharis/actions/runners/registration-token -q .token
```
Di server:
```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64-2.323.0.tar.gz
tar xzf runner.tar.gz
export RUNNER_ALLOW_RUNASROOT=1     # karena user root
./config.sh --url https://github.com/FebliRamadhan/sada-doharis --token <TOKEN> --labels self-hosted
./svc.sh install && ./svc.sh start  # jalan sebagai service (auto-start)
```
Cek online: `gh api repos/FebliRamadhan/sada-doharis/actions/runners -q '.runners[].status'`

**C2. Siapkan folder deploy + `.env`**
```bash
mkdir -p /root/apps/sada-doharis && cd /root/apps/sada-doharis
# salin template lalu isi nilai ASLI (DB, JWT, LDAP, MySQL, dst)
# .env ini TIDAK ikut dikirim CI — kamu yang menyiapkannya di server.
nano .env
```
Isi minimal yang wajib (kalau kosong → service gagal start):
```
POSTGRES_USER=...  POSTGRES_PASSWORD=...  POSTGRES_DB=...
REDIS_PASSWORD=...
JWT_SECRET=<acak ≥32 char>   SESSION_COOKIE_SECRET=<acak ≥32 char, beda dari JWT>
OIDC_ISSUER=https://auth.menpan.go.id
CORS_ORIGIN=https://*.menpan.go.id     # wildcard subdomain didukung
AUTH_UI_PORT=80                        # ← lihat "Kesalahan Umum" #2
ADMIN_EMAILS=febli.ramadhani@menpan.go.id
INTERNAL_EMAIL_DOMAIN=menpan.go.id
LDAP_URL=ldap://ldap-d.menpan.go.id:389   # + LDAP_BIND_DN/PASSWORD/SEARCH_BASE
MYSQL_HOST=192.168.66.28                   # untuk scope pegawai
```
Buat dua string acak: `openssl rand -hex 32`

**C3. Tes login GHCR di server** (sekali, untuk pastikan PAT benar):
```bash
echo "ghp_xxxxx" | docker login ghcr.io -u FebliRamadhan --password-stdin
```

### D. Cek File Workflow (sudah ada di repo)
Tidak perlu menulis dari nol — sudah tersedia di `.github/workflows/`:
| File | Fungsi |
|------|--------|
| `ci.yml` | Cek lint, type-check, build, test tiap push/PR |
| `release.yml` | Build Docker image → push ke GHCR (saat push `main`) |
| `deploy.yml` | SSH ke server → tarik image → migrate → restart (pakai `self-hosted`) |
| `preview.yml` | Deploy sementara per-PR (opsional) |

### E. Jalan Pertama & Verifikasi
```bash
git push origin main          # memicu CI → Release → Deploy otomatis
# atau deploy manual tanpa push:
gh workflow run deploy.yml

# pantau:
gh run watch
gh run list --workflow deploy.yml --limit 3
```
Sukses jika healthcheck hijau: `curl -i https://auth.menpan.go.id/health` → `200`.

---

## Bagian 5 — Membuat File Workflow dari Nol (Template Generik)

Kalau proyekmu **belum punya** folder `.github/workflows/`, ini cara membuatnya. Contoh di
bawah memakai nama generik (`myapp`, `/srv/apps/myapp`) — **ganti sesuai proyekmu**.

### 5.1 Anatomi sebuah workflow
Setiap workflow adalah file YAML dengan 4 bagian inti:
```yaml
name: CI                 # 1) nama workflow (muncul di tab Actions)
on:                      # 2) PEMICU — kapan workflow jalan
  push:
    branches: [main]
jobs:                    # 3) JOBS — daftar pekerjaan
  build:                 #    nama job (bebas)
    runs-on: ubuntu-latest   # mesin yang menjalankannya
    steps:               # 4) STEPS — perintah berurutan
      - uses: actions/checkout@v4   # "uses" = pakai action siap pakai
      - run: echo "halo"            # "run" = jalankan perintah shell
```
> ⚠️ YAML **sensitif indentasi** — pakai **spasi** (2 spasi), jangan TAB.

### 5.2 Buat foldernya
```bash
mkdir -p .github/workflows
```
Lalu buat file di dalamnya (`.github/workflows/ci.yml`, dst).

### 5.3 Template `ci.yml` — cek kode tiap push/PR
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci          # install dependensi
      - run: npm run lint    # cek gaya kode
      - run: npm test        # jalankan test
      - run: npm run build   # pastikan bisa di-build
```

### 5.4 Template `release.yml` — build image & push ke GHCR
```yaml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: write          # izin push image ke GHCR
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}   # token bawaan, tak perlu dibuat
      - id: meta
        uses: docker/metadata-action@v5
        with:
          # github.repository = <owner>/<repo> otomatis (huruf besar di-lowercase oleh action ini)
          images: ghcr.io/${{ github.repository }}/myapp
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
```
> Tidak menulis nama owner/repo manual — pakai variabel bawaan `${{ github.repository }}`
> supaya template ini bisa dipakai di proyek mana pun.

### 5.5 Template `deploy.yml` — kirim ke server via SSH
```yaml
name: Deploy
on:
  workflow_run:                 # jalan otomatis setelah "Release" selesai
    workflows: [Release]
    types: [completed]
  workflow_dispatch:            # bisa juga dipicu manual
    inputs:
      image_tag:
        description: 'Override tag image (kosong = sha commit pemicu Release)'
        required: false
        default: ''
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'   # hindari deprecation Node 20
jobs:
  deploy:
    # self-hosted kalau server ber-IP privat; ganti ke ubuntu-latest kalau server publik
    runs-on: self-hosted
    steps:
      - name: Tentukan tag image
        id: tag
        run: |
          if [ -n "${{ inputs.image_tag }}" ]; then
            echo "tag=${{ inputs.image_tag }}" >> "$GITHUB_OUTPUT"
          else
            # PENTING: pakai head_sha (commit yang MEMICU Release), BUKAN github.sha —
            # github.sha saat workflow_run bisa "lagging" → deploy image lama. (lihat Kesalahan #8)
            SHA="${{ github.event.workflow_run.head_sha || github.sha }}"
            echo "tag=sha-${SHA}" >> "$GITHUB_OUTPUT"
          fi
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.PROD_HOST }}
          username: ${{ secrets.PROD_USER }}
          key: ${{ secrets.PROD_SSH_KEY }}
          port: ${{ secrets.PROD_SSH_PORT || 22 }}
          script: |
            set -euo pipefail
            cd "${{ secrets.PROD_DEPLOY_PATH }}"        # mis. /srv/apps/myapp
            REPO_LC="$(echo "${{ github.repository }}" | tr '[:upper:]' '[:lower:]')"
            export VERSION="${{ steps.tag.outputs.tag }}"   # dipakai compose: image:${VERSION}
            export APP_IMAGE="ghcr.io/${REPO_LC}/myapp"
            echo "${{ secrets.GHCR_TOKEN }}" | docker login ghcr.io -u "${{ secrets.GHCR_USER }}" --password-stdin
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
```
> `docker-compose.yml` di server merujuk image versi spesifik, mis.
> `image: ${APP_IMAGE}:${VERSION}` — supaya yang ditarik **persis** tag hasil build, bukan
> selalu `latest` (yang bisa salah/lama).

### 5.6 Aktifkan: commit & push
```bash
git add .github/workflows
git commit -m "ci: add CI/CD workflows"
git push
```
Buka tab **Actions** di GitHub → workflow akan langsung muncul & jalan. Itu saja — file di
`.github/workflows/` otomatis terdeteksi GitHub, tidak perlu "mendaftarkan" apa pun.

### 5.7 Tips memvalidasi sebelum push
- Cek indentasi/format YAML (mis. editor dengan plugin YAML, atau `yamllint file.yml`).
- Mulai kecil: bikin `ci.yml` dulu, pastikan hijau, baru tambah `release.yml` & `deploy.yml`.
- Salah satu step gagal → lihat lognya: `gh run view <id> --log-failed`.

---

## Bagian 6 — Operasi Sehari-hari
```bash
# Deploy manual / ulang
gh workflow run deploy.yml

# Lihat status run
gh run list --limit 5
gh run view <run-id> --log-failed     # log step yang gagal

# Di server: cek container & log
cd /root/apps/sada-doharis
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=50 auth-service
```

---

## Bagian 7 — Kesalahan Umum (dari pengalaman nyata proyek ini)

1. **Salah folder deploy.** `PROD_DEPLOY_PATH` harus folder yang benar-benar berisi `.env`
   & data: **`/root/apps/sada-doharis`** (bukan `/apps/sada-doharis`). Salah folder →
   `.env` placeholder kebaca → LDAP kosong, login gagal, dll.
2. **Port salah → 502.** LB meneruskan ke **port 80**, jadi `AUTH_UI_PORT=80` di `.env`.
   Kalau 3002 (default), LB tak dapat upstream → `502 Bad Gateway`.
3. **`.env` lokal ≠ `.env` server.** `.env` di laptop **tidak** ikut deploy (gitignore).
   Yang dipakai produksi hanya `/root/apps/sada-doharis/.env` di server. Edit di sana.
4. **Nama image GHCR harus huruf kecil.** `FebliRamadhan` → harus jadi `febliramadhan`.
   (deploy.yml sudah otomatis lowercase.)
5. **Volume DB beda antar compose.** `prod.yml` pakai volume `postgres_prod_data`,
   `single-domain.yml` pakai `postgres_data`. Salah file = DB "kosong" padahal data ada di
   volume lain. Jangan campur dua compose untuk stack yang sama.
6. **Secret bocor.** Jangan paste token/password mentah di chat/log. Kalau telanjur →
   revoke & ganti.
7. **IP privat + cloud runner.** Cloud runner tak bisa SSH ke `192.168.x.x`. Wajib
   self-hosted runner.
8. **Deploy image lama (tag "lagging").** Saat `deploy.yml` dipicu `workflow_run`,
   `${{ github.sha }}` = HEAD default-branch yang bisa **tertinggal** dari commit yang
   memicu Release → deploy menarik image **versi lama** padahal Release build versi baru.
   Gejala: "deploy success" tapi perubahan tak muncul, container tak restart. **Solusi:**
   resolve tag dari `${{ github.event.workflow_run.head_sha }}` (lihat template 5.5), atau
   deploy manual dengan tag eksplisit: `gh workflow run deploy.yml -f image_tag=sha-<commit>`.
   Selalu **verifikasi** image yang jalan: `docker compose ps <svc> --format '{{.Image}}'`.
9. **MySQL/integrasi tak terisi di server.** Fitur yang butuh sumber luar (mis. lookup NIP
   pegawai ke MySQL) diam-diam mati kalau `MYSQL_*` kosong di `.env` server. Pool dibuat
   *lazy* — cek log saat fitur dipanggil: `docker compose logs auth-service | grep -i mysql`.

---

## Bagian 8 — Checklist Akhir (centang sebelum bilang "selesai")
- [ ] Semua secret & variable terdaftar (`gh secret list`, `gh variable list`)
- [ ] Self-hosted runner **online**
- [ ] `.env` server terisi nilai asli (bukan placeholder)
- [ ] `AUTH_UI_PORT=80`, `PROD_DEPLOY_PATH=/root/apps/sada-doharis`
- [ ] `ssh -i key root@server 'echo OK'` berhasil tanpa password
- [ ] `docker login ghcr.io` berhasil di server
- [ ] `gh workflow run deploy.yml` → semua step hijau
- [ ] `curl https://auth.menpan.go.id/health` → `200`

Selamat — CI/CD kamu sudah jalan. 🎉
