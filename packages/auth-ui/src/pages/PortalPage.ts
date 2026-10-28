/**
 * Portal SSO — post-login app launcher.
 * Sticky navy top bar (logo, bell, profile); a page head with the greeting and
 * the search; a segmented filter; a strip of frequent apps; and the app
 * directory as rows. Styling lives in style.css under "PORTAL".
 *
 * Full-bleed: reuses the `.admin-mode` container override (hides the split
 * banner, makes #app full-height). main.ts clears `.admin-mode` on navigation.
 *
 * App list is STATIC for now — replace `APPS` with a real "my applications"
 * endpoint when available.
 */
import {
  endpoints,
  apiRequest,
  getStoredToken,
  getStoredUser,
  clearAuthStorage,
  type User,
} from '../api';
import { router, getAppContainer } from '../router';

type Category = 'kepegawaian' | 'layanan';

interface AppItem {
  abbr: string;
  name: string;
  desc: string;
  color: string;
  category: Category;
  frequent?: boolean;
  url?: string;
}

const APPS: AppItem[] = [
  {
    abbr: 'SA',
    name: 'SI-ASN',
    desc: 'Sistem Informasi ASN',
    color: 'var(--panrb-blue)',
    category: 'kepegawaian',
    frequent: true,
  },
  {
    abbr: 'eK',
    name: 'e-Kinerja',
    desc: 'Penilaian kinerja pegawai',
    color: 'var(--panrb-navy)',
    category: 'kepegawaian',
    frequent: true,
  },
  {
    abbr: 'SB',
    name: 'SIASN BKN',
    desc: 'Layanan kepegawaian BKN',
    color: 'var(--panrb-blue-light)',
    category: 'kepegawaian',
    frequent: true,
  },
  {
    abbr: 'LP',
    name: 'LAPOR!',
    desc: 'Pengaduan layanan publik',
    color: 'var(--panrb-red)',
    category: 'layanan',
  },
  {
    abbr: 'SP',
    name: 'SP4N',
    desc: 'Sistem pengelolaan pengaduan',
    color: 'var(--color-success)',
    category: 'layanan',
  },
  {
    abbr: 'JD',
    name: 'JDIH',
    desc: 'Dokumentasi & informasi hukum',
    color: 'var(--color-type-external)',
    category: 'layanan',
  },
  {
    abbr: 'eO',
    name: 'e-Office',
    desc: 'Perkantoran elektronik',
    color: 'var(--color-type-gov)',
    category: 'kepegawaian',
  },
  {
    abbr: 'SK',
    name: 'SKP Online',
    desc: 'Sasaran kinerja pegawai',
    color: 'var(--color-warning)',
    category: 'kepegawaian',
  },
  {
    abbr: 'PR',
    name: 'Presensi',
    desc: 'Kehadiran & absensi',
    color: 'var(--panrb-blue)',
    category: 'kepegawaian',
  },
  {
    abbr: 'DK',
    name: 'Diklat',
    desc: 'Pendidikan & pelatihan',
    color: 'var(--panrb-navy)',
    category: 'kepegawaian',
  },
  {
    abbr: 'AR',
    name: 'Arsip',
    desc: 'Manajemen arsip digital',
    color: 'var(--color-text-muted)',
    category: 'layanan',
  },
];

let activeFilter: 'semua' | Category = 'semua';
let searchTerm = '';

export async function PortalPage(): Promise<void> {
  const app = getAppContainer();

  // Resolve user (Bearer → /auth/me → storage); bounce anonymous to login.
  const token = getStoredToken();
  let user: User | null = getStoredUser();
  if (token) {
    try {
      const r = await apiRequest<User>(endpoints.me);
      if (r.success && r.data) user = r.data;
    } catch {
      /* ignore */
    }
  }
  if (!user) {
    router.navigate('/login', true);
    return;
  }

  document.querySelector('.auth-container')?.classList.add('admin-mode');
  activeFilter = 'semua';
  searchTerm = '';
  render(app, user);
}

const CATEGORY_LABEL: Record<Category, string> = {
  kepegawaian: 'Kepegawaian',
  layanan: 'Layanan publik',
};

const ICON_OPEN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';

function render(app: HTMLElement, user: User): void {
  const initial = user.name.charAt(0).toUpperCase();
  app.innerHTML = `
    <div class="portal">
      ${topbar(user, initial)}
      <main class="portal-main">
        ${passwordBanner(user)}
        <div class="portal-head">
          <div class="portal-head-text">
            <h1>Selamat datang, ${user.name.split(' ')[0]}</h1>
            <p id="app-count"></p>
          </div>
          <div class="portal-search">
            <svg class="portal-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="portal-search" type="text" placeholder="Cari aplikasi" aria-label="Cari aplikasi" autocomplete="off" value="${searchTerm.replace(/"/g, '&quot;')}">
          </div>
        </div>

        <div class="portal-filters" id="filters" role="group" aria-label="Filter kategori">
          ${pill('semua', 'Semua')}
          ${pill('kepegawaian', CATEGORY_LABEL.kepegawaian)}
          ${pill('layanan', CATEGORY_LABEL.layanan)}
        </div>

        <section id="frequent-section" class="portal-section" aria-labelledby="frequent-title">
          <h2 id="frequent-title">Sering digunakan</h2>
          <div id="frequent-grid" class="portal-frequent"></div>
        </section>

        <section class="portal-section" aria-labelledby="all-title">
          <h2 id="all-title">Semua aplikasi</h2>
          <div id="all-grid" class="portal-directory"></div>
        </section>
      </main>
    </div>
  `;

  wireTopbar();
  wireFilters(app, user);
  renderGrids();
}

function topbar(user: User, initial: string): string {
  return `
    <header class="portal-topbar">
      <div class="portal-topbar-inner">
        <div class="portal-brand">
          <span class="portal-logo"><img src="/logo-panrb.png" alt="Logo Kementerian PANRB" width="139" height="30"></span>
          <span class="portal-logo-text">Portal Layanan</span>
        </div>
        <div class="portal-topbar-actions">
          <button type="button" class="portal-icon-btn" aria-label="Notifikasi">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          </button>
          <div class="portal-profile">
            <button type="button" id="profile-btn" class="portal-profile-btn" aria-haspopup="true" aria-label="Menu akun ${user.name}">
              <span class="portal-avatar" aria-hidden="true">${initial}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div id="profile-menu" class="portal-menu" style="display:none;">
              <div class="portal-menu-who">
                <div class="portal-menu-name">${user.name}</div>
                <div class="portal-menu-email">${user.email}</div>
              </div>
              ${user.userType === 'INTERNAL' ? `<a class="portal-menu-item" href="/password/change">Ganti password</a>` : ''}
              ${user.isAdmin ? `<a class="portal-menu-item" href="/admin">Admin panel</a>` : ''}
              <button type="button" id="portal-logout" class="portal-menu-item is-danger">Keluar</button>
            </div>
          </div>
        </div>
      </div>
    </header>
  `;
}

/** Peringatan Masa Berlaku Password (hari ke-76 s.d. 89). */
function passwordBanner(user: User): string {
  const expiry = user.passwordExpiry;
  if (!expiry || expiry.status !== 'warning' || expiry.daysLeft === null) return '';
  return `
    <div role="status" class="portal-notice">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="portal-notice-text">Password Anda kedaluwarsa dalam <b>${expiry.daysLeft} hari</b>.</span>
      <a class="text-link" href="/password/change">Ganti sekarang</a>
    </div>
  `;
}

function pill(value: string, label: string): string {
  const active = value === activeFilter;
  return `<button type="button" class="portal-pill" data-filter="${value}" aria-pressed="${active}">${label}</button>`;
}

/** big = baris direktori (Semua aplikasi); kecil = ubin peluncur (Sering digunakan). */
function appCard(a: AppItem, big: boolean): string {
  if (!big) {
    return `
      <a href="${a.url ?? '#'}" class="portal-app-card portal-tile">
        <span class="portal-mono" aria-hidden="true">${a.abbr}</span>
        <span class="portal-tile-name">${a.name}</span>
      </a>
    `;
  }
  return `
    <a href="${a.url ?? '#'}" class="portal-app-card portal-row">
      <span class="portal-mono" aria-hidden="true">${a.abbr}</span>
      <span class="portal-row-text">
        <span class="portal-row-name">${a.name}</span>
        <span class="portal-row-desc">${a.desc}</span>
      </span>
      <span class="portal-row-cat">${CATEGORY_LABEL[a.category]}</span>
      <span class="portal-row-open">${ICON_OPEN}</span>
    </a>
  `;
}

function requestCard(): string {
  return `
    <p class="portal-request">Aplikasi yang Anda cari belum ada? <a class="text-link" href="#">Ajukan akses</a></p>
  `;
}

function emptyState(): string {
  const term = searchTerm.trim();
  return `
    <div class="portal-empty">
      <p class="portal-empty-title">${term ? `Tidak ada aplikasi yang cocok dengan “${term.replace(/</g, '&lt;')}”.` : 'Belum ada aplikasi di kategori ini.'}</p>
      <p>Coba kata lain atau pilih kategori Semua.</p>
    </div>
  `;
}

function visible(): AppItem[] {
  const term = searchTerm.trim().toLowerCase();
  return APPS.filter((a) => {
    const matchFilter = activeFilter === 'semua' || a.category === activeFilter;
    const matchTerm =
      !term || a.name.toLowerCase().includes(term) || a.desc.toLowerCase().includes(term);
    return matchFilter && matchTerm;
  });
}

function renderGrids(): void {
  const list = visible();
  const frequent = list.filter((a) => a.frequent);
  const freqSection = document.getElementById('frequent-section');
  const freqGrid = document.getElementById('frequent-grid');
  const allGrid = document.getElementById('all-grid');
  const count = document.getElementById('app-count');

  if (count) count.textContent = `${list.length} aplikasi tersedia untuk akun Anda`;

  // Hide the "frequent" section when filtering/searching narrows it out.
  if (freqSection) freqSection.style.display = frequent.length ? 'block' : 'none';
  if (freqGrid) freqGrid.innerHTML = frequent.map((a) => appCard(a, false)).join('');
  if (allGrid)
    allGrid.innerHTML =
      (list.length ? list.map((a) => appCard(a, true)).join('') : emptyState()) + requestCard();
}

function wireFilters(app: HTMLElement, user: User): void {
  document.querySelectorAll<HTMLElement>('.portal-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = (btn.dataset.filter as 'semua' | Category) ?? 'semua';
      render(app, user); // re-render to refresh pill styles + grids
    });
  });
}

function wireTopbar(): void {
  const search = document.getElementById('portal-search') as HTMLInputElement | null;
  search?.addEventListener('input', () => {
    searchTerm = search.value;
    renderGrids();
  });

  const profile = document.getElementById('profile-btn');
  const menu = document.getElementById('profile-menu');
  profile?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  // Close the menu when clicking elsewhere.
  document.addEventListener('click', () => {
    if (menu) menu.style.display = 'none';
  });

  document.getElementById('portal-logout')?.addEventListener('click', async () => {
    try {
      await apiRequest(endpoints.logout, { method: 'POST' });
    } catch {
      /* ignore */
    }
    clearAuthStorage();
    router.navigate('/login');
  });
}
