# CI/CD — Panduan Step by Step

Dokumen ini menjelaskan cara setup dan mengoperasikan pipeline CI/CD untuk
SADA SSO. Stack: GitHub Actions + GHCR + Docker Compose di server (VM).

## Arsitektur Pipeline

```
┌────────────────────────────────────────────────────────────────┐
│  Developer push / open PR                                      │
└──────────────┬─────────────────────────────────────────────────┘
               │
               ▼
       ┌──────────────────┐
       │  ci.yml          │  lint + format + typecheck + test
       │  (PR + push)     │  + docker build smoke (3 image)
       └──────┬───────────┘
              │
   ┌──────────┼────────────┐
   ▼                       ▼
┌─────────────────┐  ┌──────────────────┐
│ preview.yml     │  │ release.yml      │  push ke main / tag v*
│ (PR only)       │  │ (main only)      │  → build & push image
│                 │  │                  │     ke GHCR
│ build → deploy  │  └────────┬─────────┘
│ ke preview VM,  │           │
│ comment URL     │           ▼
│ di PR           │  ┌──────────────────┐
└─────────────────┘  │ deploy.yml       │  trigger otomatis
                     │ (production env) │  setelah release sukses
                     │                  │
                     │ SSH → pull →     │
                     │ migrate → up →   │
                     │ healthcheck      │
                     └──────────────────┘
```

## File-file yang Terlibat

| File | Peran |
|---|---|
| `.github/workflows/ci.yml` | Lint, typecheck, unit/integration test, docker build smoke |
| `.github/workflows/release.yml` | Build & push 3 image ke GHCR (push main / tag `v*`) |
| `.github/workflows/deploy.yml` | Rollout otomatis ke server produksi via SSH |
| `.github/workflows/preview.yml` | Build + deploy stack isolated per-PR, teardown saat PR ditutup |
| `docker-compose.prod.yml` | Compose untuk produksi (image dari GHCR) |
| `docker-compose.preview.yml` | Compose stack preview per-PR (label Traefik) |

---

## 1. Persiapan Repository (GitHub)

### 1.1 Aktifkan GitHub Packages (GHCR)

1. Buka **Repository → Settings → Actions → General**
2. Bagian **Workflow permissions**: pilih **Read and write permissions**
3. Centang **Allow GitHub Actions to create and approve pull requests**

### 1.2 Buat Personal Access Token untuk Pull dari GHCR di Server

Server perlu PAT (bukan `GITHUB_TOKEN`) untuk `docker login` dan `docker pull`:

1. Buka https://github.com/settings/tokens (classic)
2. **Generate new token (classic)** dengan scope:
   - `read:packages`
   - `write:packages` (opsional, kalau ingin push manual dari server)
3. Simpan token-nya — tidak bisa dilihat lagi setelah ditutup.

### 1.3 Daftarkan Secrets

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Kegunaan |
|---|---|
| `GHCR_USER` | Username GitHub Anda |
| `GHCR_TOKEN` | PAT dari langkah 1.2 |
| `PROD_HOST` | Hostname/IP server produksi |
| `PROD_USER` | SSH user (mis. `deploy`) |
| `PROD_SSH_KEY` | Isi private key (`cat ~/.ssh/id_ed25519`) |
| `PROD_SSH_PORT` | Opsional, default 22 |
| `PROD_DEPLOY_PATH` | Path absolut di server (mis. `/opt/sada-api`) |
| `PREVIEW_HOST` | Hostname/IP preview VM |
| `PREVIEW_USER` | SSH user di preview VM |
| `PREVIEW_SSH_KEY` | Private key untuk preview VM |
| `PREVIEW_SSH_PORT` | Opsional, default 22 |
| `PREVIEW_DEPLOY_PATH` | Path induk preview di server (mis. `/opt/sada-previews`) |

### 1.4 Daftarkan Variables (bukan Secret)

**Settings → Secrets and variables → Actions → Variables**

| Variable | Contoh |
|---|---|
| `PROD_URL` | `https://sso.panrb.go.id` |
| `PREVIEW_DOMAIN` | `preview.sso.panrb.go.id` |
| `VITE_DEFAULT_APP_URL` | `https://app1.panrb.go.id` |

### 1.5 Buat Environment `production` & `preview`

**Settings → Environments → New environment**

1. **`production`**
   - (Opsional) **Required reviewers** — minta approval manual sebelum deploy
   - **Deployment branches**: hanya `main`
2. **`preview`**
   - Tidak perlu reviewer (auto deploy semua PR)

---

## 2. Persiapan Server Produksi

### 2.1 Pre-requisites di Server

```bash
# Sebagai root atau via sudo
apt update && apt install -y ca-certificates curl gnupg

# Install Docker Engine + Compose v2
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# User dedicated buat deploy (tanpa sudo)
useradd -m -s /bin/bash deploy
usermod -aG docker deploy

# Tambah SSH public key
mkdir -p /home/deploy/.ssh
cat >> /home/deploy/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAA... deploy-github-actions
EOF
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 2.2 Siapkan Direktori & `.env` Produksi

```bash
sudo -u deploy bash <<'EOF'
mkdir -p /opt/sada-api/keys
cd /opt/sada-api

# Salin .env.example → .env, isi semua secret produksi
# (workflow tidak menyentuh file ini — dia hanya menggantikan compose & prisma)
cat > .env <<'ENV'
POSTGRES_USER=sada_user
POSTGRES_PASSWORD=<random-strong>
POSTGRES_DB=sada_db
REDIS_PASSWORD=<random-strong>
JWT_SECRET=<random-64-char>
SESSION_COOKIE_SECRET=<random-64-char-different>
OIDC_ISSUER=https://sso.panrb.go.id
CORS_ORIGIN=https://sso.panrb.go.id
ADMIN_EMAILS=admin@menpan.go.id
INTERNAL_EMAIL_DOMAIN=menpan.go.id
# LDAP / MySQL / SPLP credentials...
ENV
chmod 600 .env
EOF
```

### 2.3 Login GHCR di Server (Sekali, untuk Test)

```bash
sudo -u deploy docker login ghcr.io
# Username: <github-username>
# Password: <PAT dari langkah 1.2>
```

Workflow `deploy.yml` juga melakukan login sendiri pakai `GHCR_USER` + `GHCR_TOKEN`, jadi langkah ini cuma untuk test manual.

### 2.4 Reverse Proxy + SSL (Caddy/Nginx)

Workflow tidak mengelola TLS — Anda pasang sendiri (Caddy/Nginx + Let's Encrypt) di depan port `${GATEWAY_PORT:-3000}` atau `${AUTH_UI_PORT:-3002}` sesuai topologi.

---

## 3. Persiapan Server Preview (Khusus Preview Deploy)

Preview butuh **Traefik** dengan wildcard cert agar tiap PR otomatis dapat sub-domain `pr-<N>.preview.sso.panrb.go.id`.

### 3.1 Wildcard DNS

Tambahkan record DNS:
```
*.preview.sso.panrb.go.id  A  <PREVIEW_HOST_IP>
```

### 3.2 Setup Traefik (sekali saja)

Buat `/opt/traefik/docker-compose.yml`:

```yaml
services:
  traefik:
    image: traefik:v3.1
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=traefik
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.dnschallenge=true
      - --certificatesresolvers.le.acme.dnschallenge.provider=<your-dns-provider>
      - --certificatesresolvers.le.acme.email=ops@menpan.go.id
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    environment:
      - <DNS_PROVIDER_API_KEY>=...
    networks:
      - traefik

networks:
  traefik:
    name: traefik
```

```bash
sudo -u deploy bash -c "mkdir -p /opt/traefik && cd /opt/traefik && docker compose up -d"
```

### 3.3 Direktori Preview

```bash
sudo -u deploy mkdir -p /opt/sada-previews
```

Tiap PR akan dapat subfolder `/opt/sada-previews/pr-<N>` yang dibuat & dihapus oleh workflow.

---

## 4. Cara Kerja Pipeline (Run-Through)

### 4.1 Saat Buka / Update PR

1. **`ci.yml`** trigger:
   - Postgres + Redis sebagai service container
   - `pnpm install` (cached via `cache: pnpm`)
   - `prisma migrate deploy` ke DB test
   - `pnpm format:check`, `pnpm lint`, `tsc --noEmit`
   - `pnpm build`, `pnpm test`, `pnpm test:integration`
   - 3× `docker build` (smoke, tidak di-push)
2. **`preview.yml`** trigger paralel:
   - Build & push 3 image ke `ghcr.io/.../<name>:pr-<N>-<sha>`
   - SCP compose + prisma ke `${PREVIEW_DEPLOY_PATH}/pr-<N>` di preview VM
   - SSH: `docker compose pull` → `prisma migrate deploy` → `up -d`
   - Tunggu `https://pr-<N>.${PREVIEW_DOMAIN}/health` (max 3 menit)
   - Comment URL ke PR (sticky, di-update kalau di-redeploy)

### 4.2 Saat Merge ke `main` (atau Tag `v*`)

1. **`ci.yml`** jalan lagi (gate keamanan)
2. **`release.yml`** trigger:
   - Build 3 image, push ke GHCR dengan tag:
     - `sha-<full-commit>`
     - `latest` (kalau push ke `main`)
     - `v1.2.3`, `v1.2` (kalau tag `v1.2.3`)
3. **`deploy.yml`** otomatis menyusul (via `workflow_run`):
   - SCP compose + prisma ke `${PROD_DEPLOY_PATH}`
   - SSH login GHCR
   - `docker compose pull`
   - `docker compose run --rm auth-service prisma migrate deploy`
   - `docker compose up -d --remove-orphans`
   - `docker image prune -f`
   - Poll `${PROD_URL}/health` (max 2 menit)
   - Kalau **environment `production`** punya required reviewer → tunggu approval manual dulu

### 4.3 Saat PR Ditutup (Merged / Closed)

1. **`preview.yml` → teardown** job:
   - SSH ke preview VM
   - `docker compose down -v --remove-orphans` (volume hilang)
   - Hapus `pr-<N>/` folder
   - Update PR comment menjadi "Preview removed"

---

## 5. Operasional Sehari-hari

### 5.1 Trigger Deploy Manual (Hotfix)

**Actions → Deploy → Run workflow** → input `image_tag` (mis. `sha-abc123` atau `v1.2.4`)

### 5.2 Rollback

```
Actions → Deploy → Run workflow
  image_tag: sha-<commit-versi-stabil-sebelumnya>
```

Atau langsung di server:
```bash
sudo -u deploy bash -c "cd /opt/sada-api && \
  VERSION=sha-<commit-lama> \
  AUTH_SERVICE_IMAGE=ghcr.io/<owner>/<repo>/auth-service \
  GATEWAY_IMAGE=ghcr.io/<owner>/<repo>/gateway \
  AUTH_UI_IMAGE=ghcr.io/<owner>/<repo>/auth-ui \
  docker compose -f docker-compose.prod.yml up -d"
```

### 5.3 Cek Log Service

```bash
# Di server
docker compose -f docker-compose.prod.yml logs -f auth-service
docker compose -f docker-compose.prod.yml logs --tail=200 gateway
```

### 5.4 Mengganti `VITE_DEFAULT_APP_URL`

`VITE_*` di-inline saat build, bukan runtime. Untuk ganti:
1. Update value di **Settings → Variables → `VITE_DEFAULT_APP_URL`**
2. Trigger ulang **Release** workflow (atau push commit kosong ke `main`)
3. Deploy akan otomatis ambil image baru

### 5.5 Memperbarui Migration Schema

Migration dijalankan otomatis pada step deploy. Pastikan migration file ter-commit (`prisma/migrations/<timestamp>_*/`). Kalau migration destruktif (drop column), sebaiknya buat 2 deploy:
1. Deploy 1: deprecate kolom, app tidak pakai lagi
2. Deploy 2: drop kolom

---

## 6. Troubleshooting

| Gejala | Kemungkinan Penyebab | Cara Cek |
|---|---|---|
| `docker pull` 401 di server | PAT expired / scope `read:packages` tidak ada | Regenerate PAT, update secret `GHCR_TOKEN` |
| Migration step gagal | DB connection / schema conflict | `docker compose logs auth-service`; jalankan `prisma migrate status` manual di server |
| Healthcheck timeout | Container start-up lambat / OOM | `docker compose ps`, `docker stats`, naikkan resource limit |
| Preview URL 502 | Traefik tidak detect label / DNS belum propagasi | `docker logs traefik`, cek `dig pr-<N>.preview.sso.panrb.go.id` |
| Cookie SSO tidak terbawa antar app | `SESSION_COOKIE_DOMAIN` tidak di-set / SameSite | Pastikan `.env` set `SESSION_COOKIE_DOMAIN=.panrb.go.id` kalau multi-subdomain |
| CI fail di `format:check` | Code belum di-prettier | Run `pnpm format` lokal, commit ulang |
| Preview stack PR lama numpuk | Workflow `closed` event tidak fire (mis. PR dihapus paksa) | Manual: `docker compose -f docker-compose.preview.yml -p pr-<N> down -v` di preview VM |

---

## 7. Checklist Onboarding Tim

- [ ] Repo memiliki semua secret & variable yang tercantum di §1.3 & §1.4
- [ ] Server produksi: Docker terpasang, user `deploy`, `.env` lengkap, GHCR login OK
- [ ] Server preview: Traefik jalan dengan wildcard cert, network `traefik` ada
- [ ] DNS: `${PROD_URL}` & `*.${PREVIEW_DOMAIN}` mengarah ke server yang benar
- [ ] Test 1× full cycle: buka PR → preview muncul → merge → deploy prod sukses
- [ ] Atur required reviewer di environment `production` jika perlu approval
- [ ] Backup strategy untuk volume `postgres_prod_data` (di luar pipeline)
