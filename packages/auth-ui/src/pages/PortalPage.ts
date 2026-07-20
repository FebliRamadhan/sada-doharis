/**
 * Portal SSO — post-login app launcher, per SSO PANRB handoff #8.
 * Sticky navy top bar (logo, search, bell, profile), welcome heading, filter
 * pills, "SERING DIGUNAKAN" (3-col) and "SEMUA APLIKASI" (4-col) grids.
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
    color: '#005598',
    category: 'kepegawaian',
    frequent: true,
  },
  {
    abbr: 'eK',
    name: 'e-Kinerja',
    desc: 'Penilaian kinerja pegawai',
    color: '#01347C',
    category: 'kepegawaian',
    frequent: true,
  },
  {
    abbr: 'SB',
    name: 'SIASN BKN',
    desc: 'Layanan kepegawaian BKN',
    color: '#2894D9',
    category: 'kepegawaian',
    frequent: true,
  },
  {
    abbr: 'LP',
    name: 'LAPOR!',
    desc: 'Pengaduan layanan publik',
    color: '#C1272D',
    category: 'layanan',
  },
  {
    abbr: 'SP',
    name: 'SP4N',
    desc: 'Sistem pengelolaan pengaduan',
    color: '#15803D',
    category: 'layanan',
  },
  {
    abbr: 'JD',
    name: 'JDIH',
    desc: 'Dokumentasi & informasi hukum',
    color: '#7C3AED',
    category: 'layanan',
  },
  {
    abbr: 'eO',
    name: 'e-Office',
    desc: 'Perkantoran elektronik',
    color: '#0F766E',
    category: 'kepegawaian',
  },
  {
    abbr: 'SK',
    name: 'SKP Online',
    desc: 'Sasaran kinerja pegawai',
    color: '#B45309',
    category: 'kepegawaian',
  },
  {
    abbr: 'PR',
    name: 'Presensi',
    desc: 'Kehadiran & absensi',
    color: '#005598',
    category: 'kepegawaian',
  },
  {
    abbr: 'DK',
    name: 'Diklat',
    desc: 'Pendidikan & pelatihan',
    color: '#01347C',
    category: 'kepegawaian',
  },
  {
    abbr: 'AR',
    name: 'Arsip',
    desc: 'Manajemen arsip digital',
    color: '#5E7896',
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

function render(app: HTMLElement, user: User): void {
  const initial = user.name.charAt(0).toUpperCase();
  app.innerHTML = `
    <div style="position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;background:var(--color-background);overflow-y:auto;">
      ${topbar(user, initial)}
      <div style="flex:1;">
        <div style="max-width:1080px;margin:0 auto;padding:var(--space-8) var(--space-6);">
          <div style="margin-bottom:var(--space-6);">
            <h1 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:var(--font-3xl);font-weight:800;color:var(--panrb-navy);letter-spacing:-0.02em;">Selamat datang, ${user.name.split(' ')[0]}</h1>
            <p style="color:var(--color-text-muted);font-size:var(--font-sm);margin-top:4px;" id="app-count"></p>
          </div>

          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-8);flex-wrap:wrap;" id="filters">
            ${pill('semua', 'Semua')}
            ${pill('kepegawaian', 'Kepegawaian')}
            ${pill('layanan', 'Layanan Publik')}
          </div>

          <div id="frequent-section">
            <div style="font-size:var(--font-xs);font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:var(--space-4);">Sering Digunakan</div>
            <div id="frequent-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--space-4);margin-bottom:var(--space-8);"></div>
          </div>

          <div>
            <div style="font-size:var(--font-xs);font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:var(--space-4);">Semua Aplikasi</div>
            <div id="all-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-4);"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  wireTopbar();
  wireFilters(app, user);
  renderGrids();
}

function topbar(user: User, initial: string): string {
  return `
    <header class="portal-topbar" style="position:sticky;top:0;z-index:10;background:var(--panrb-navy);box-shadow:0 2px 12px rgba(0,35,90,.25);">
     <div class="portal-topbar-inner" style="max-width:1080px;margin:0 auto;width:100%;box-sizing:border-box;height:72px;display:flex;align-items:center;gap:var(--space-5);padding:0 var(--space-6);">
      <div style="display:flex;align-items:center;gap:12px;white-space:nowrap;flex-shrink:0;">
        <span style="display:inline-flex;align-items:center;background:#fff;border-radius:9px;padding:5px 10px;">
          <img src="/logo-panrb.png" alt="Logo Kementerian PANRB" style="height:30px;width:auto;display:block;">
        </span>
        <span class="portal-logo-text" style="color:#fff;font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:1.0625rem;border-left:1px solid rgba(255,255,255,.22);padding-left:12px;">Portal Layanan</span>
      </div>
      <div class="portal-search-wrap" style="flex:1;min-width:0;max-width:420px;position:relative;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="portal-search" type="text" placeholder="Cari aplikasi..." aria-label="Cari aplikasi"
               style="width:100%;box-sizing:border-box;height:38px;border:none;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;padding:0 12px 0 36px;font-size:var(--font-sm);outline:none;">
      </div>
      <button type="button" aria-label="Notifikasi" style="position:relative;background:none;border:none;cursor:pointer;color:#fff;display:flex;padding:6px;flex-shrink:0;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:var(--panrb-gold);border:1.5px solid var(--panrb-navy);"></span>
      </button>
      <div style="position:relative;flex-shrink:0;">
        <button type="button" id="profile-btn" aria-haspopup="true" style="display:flex;align-items:center;gap:var(--space-2);background:none;border:none;cursor:pointer;color:#fff;">
          <span style="width:34px;height:34px;border-radius:50%;background:var(--panrb-gold);color:var(--panrb-navy);display:flex;align-items:center;justify-content:center;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;flex-shrink:0;">${initial}</span>
          <span style="text-align:left;line-height:1.2;display:none;" class="portal-profile-text">
            <span style="display:block;font-size:var(--font-sm);font-weight:600;">${user.name}</span>
            <span style="display:block;font-size:11px;color:rgba(255,255,255,.6);">${user.email}</span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div id="profile-menu" style="display:none;position:absolute;right:0;top:46px;background:#fff;border:1px solid var(--color-border);border-radius:12px;box-shadow:0 12px 32px rgba(1,52,124,.18);min-width:210px;padding:8px;z-index:30;">
          <div style="padding:8px 10px;border-bottom:1px solid var(--color-border-subtle);margin-bottom:4px;">
            <div style="font:600 13px 'Inter';color:var(--color-text);">${user.name}</div>
            <div style="font:400 12px 'Inter';color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;">${user.email}</div>
          </div>
          ${user.isAdmin ? `<a href="/admin" style="display:block;padding:8px 10px;border-radius:8px;font:600 13px 'Inter';color:var(--color-text);text-decoration:none;">Admin Panel</a>` : ''}
          <button type="button" id="portal-logout" style="width:100%;text-align:left;padding:8px 10px;border:none;background:none;cursor:pointer;border-radius:8px;font:600 13px 'Inter';color:#C0392B;">Keluar</button>
        </div>
      </div>
     </div>
    </header>
  `;
}

function pill(value: string, label: string): string {
  const active = value === activeFilter;
  return `<button type="button" class="portal-pill" data-filter="${value}"
    style="padding:8px 16px;border-radius:999px;border:1.5px solid ${active ? 'var(--panrb-blue)' : 'var(--color-border)'};
    background:${active ? 'var(--panrb-blue)' : 'var(--color-surface)'};color:${active ? '#fff' : 'var(--color-text-secondary)'};
    font-size:var(--font-sm);font-weight:600;cursor:pointer;transition:all .15s;">${label}</button>`;
}

function appCard(a: AppItem, big: boolean): string {
  const size = big ? 52 : 48;
  return `
    <a href="${a.url ?? '#'}" class="portal-app-card"
       style="display:block;background:var(--color-surface);border:1px solid var(--color-border-subtle);border-radius:var(--radius-xl);
       padding:var(--space-5);text-decoration:none;transition:transform .15s,box-shadow .15s;box-shadow:0 1px 3px rgba(13,27,42,.04);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:var(--space-3);">
        <span style="width:${size}px;height:${size}px;border-radius:14px;background:${a.color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-family:'Plus Jakarta Sans',sans-serif;">${a.abbr}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;color:var(--color-text);margin-bottom:2px;">${a.name}</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);line-height:1.5;">${a.desc}</div>
    </a>
  `;
}

function requestCard(): string {
  return `
    <a href="#" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:transparent;border:1.5px dashed var(--color-border);border-radius:var(--radius-xl);padding:var(--space-5);text-decoration:none;color:var(--color-text-muted);min-height:120px;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span style="font-size:var(--font-sm);font-weight:600;">Ajukan akses</span>
    </a>
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
  if (allGrid) allGrid.innerHTML = list.map((a) => appCard(a, true)).join('') + requestCard();

  // Hover lift.
  document.querySelectorAll<HTMLElement>('.portal-app-card').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      el.style.transform = 'translateY(-2px)';
      el.style.boxShadow = '0 10px 24px -10px rgba(1,52,124,.28)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'none';
      el.style.boxShadow = '0 1px 3px rgba(13,27,42,.04)';
    });
  });
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
