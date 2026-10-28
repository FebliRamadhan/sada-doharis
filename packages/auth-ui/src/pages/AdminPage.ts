/**
 * Admin Page — OAuth clients, audit log, users and MFA.
 * Sidebar shell; each view is a page head, a stat row, a toolbar and a
 * full-width table. Styling lives in style.css under "ADMIN" (classes adm-*).
 */
import {
  endpoints,
  apiRequest,
  getStoredToken,
  getStoredUser,
  clearAuthStorage,
  type OAuthClient,
  type AuditLog,
  type User,
  type PaginatedResponse,
  type PasswordExpiry,
} from '../api';
import { router } from '../router';

// ─── Session guard ────────────────────────────────────────────────────────────

/**
 * Handles the one failure the admin console must never swallow: the session is
 * over. `apiRequest` has already tried renewing from the SSO cookie by the time
 * a 401 reaches us, so a 401 here means there is nothing left to renew.
 *
 * Every other failure is left alone — a 500 or a dropped connection must not
 * log anyone out.
 *
 * Returns true when the caller should stop what it is doing immediately.
 */
function goneIfUnauthorized(status: number): boolean {
  if (status !== 401) return false;

  clearAuthStorage();
  document.getElementById('admin-overlay')?.remove();
  document.querySelector('.auth-container')?.classList.remove('admin-mode');
  router.navigate('/login?expired=1');
  return true;
}

// ─── State ────────────────────────────────────────────────────────────────────

interface MfaUser {
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  userType: string;
  isActive: boolean;
  provider: string | null;
  mfaEnabled: boolean;
  passwordChangedAt: string | null;
  passwordMustChange: boolean;
  passwordExpiry?: PasswordExpiry;
  createdAt: string;
}

interface AdminState {
  view: 'clients' | 'logs' | 'mfa' | 'users';
  user: User | null;
  clients: OAuthClient[];
  clientsMeta: PaginatedResponse<unknown>['meta'];
  clientsLoading: boolean;
  logs: AuditLog[];
  logsMeta: { page: number; limit: number; total: number; totalPages: number };
  logsLoading: boolean;
  logsClientId: string | null;
  logsClientName: string;
  logsActionFilter: string;
  mfaUsers: MfaUser[];
  mfaMeta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    enabledCount?: number;
    pendingCount?: number;
  };
  mfaLoading: boolean;
  users: AdminUser[];
  usersMeta: PaginatedResponse<unknown>['meta'];
  usersLoading: boolean;
  usersSearch: string;
  usersStatus: 'all' | 'active' | 'inactive';
  usersType: 'all' | 'INTERNAL' | 'GOVERNMENT' | 'EXTERNAL';
  usersMfa: 'all' | 'enabled' | 'pending';
  usersPassword: 'all' | 'ok' | 'warning' | 'expired';
  mfaSearch: string;
  mfaFilter: 'all' | 'enabled' | 'pending';
}

const state: AdminState = {
  view: 'clients',
  user: null,
  clients: [],
  clientsMeta: { page: 1, limit: 10, total: 0, totalPages: 1 },
  clientsLoading: false,
  logs: [],
  logsMeta: { page: 1, limit: 20, total: 0, totalPages: 1 },
  logsLoading: false,
  logsClientId: null,
  logsClientName: '',
  logsActionFilter: '',
  mfaUsers: [],
  mfaMeta: { page: 1, limit: 20, total: 0, totalPages: 1 },
  mfaLoading: false,
  users: [],
  usersMeta: { page: 1, limit: 20, total: 0, totalPages: 1 },
  usersLoading: false,
  usersSearch: '',
  usersStatus: 'all',
  usersType: 'all',
  usersMfa: 'all',
  usersPassword: 'all',
  mfaSearch: '',
  mfaFilter: 'all',
};

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function AdminPage(): Promise<void> {
  if (!getStoredToken()) {
    router.navigate('/login');
    return;
  }

  const meResult = await apiRequest<User>(endpoints.me);

  // A 401 here means neither the access token nor the SSO session survived —
  // apiRequest already tried to renew. Falling back to the cached user would
  // render the whole admin console for someone the server no longer knows.
  if (goneIfUnauthorized(meResult.status)) return;

  // The cached user is still the right answer when the server was simply
  // unreachable (status 0): that is a network blip, not a lost session.
  const currentUser = meResult.success && meResult.data ? meResult.data : getStoredUser();

  if (!currentUser?.isAdmin) {
    router.navigate('/');
    return;
  }

  state.user = currentUser;

  let overlay = document.getElementById('admin-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'admin-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = buildShell();
  attachSidebarNav();
  setNavActive('clients');
  attachLogout();
  await loadClients(1);
  renderMain();
}

// ─── Shell ───────────────────────────────────────────────────────────────────

function buildShell(): string {
  const name = state.user?.name ?? 'Admin';
  const email = state.user?.email ?? '';
  const init = name.charAt(0).toUpperCase();

  const navItem = (view: string, label: string, icon: string) => `
      <button type="button" id="nav-${view}" data-view="${view}" class="admin-nav-btn" aria-label="${label}">
        ${icon}
        <span>${label}</span>
      </button>`;

  return `
<div class="adm">
  <aside class="adm-side">
    <div class="adm-brand">
      <span class="adm-brand-mark" aria-hidden="true">S</span>
      <span class="adm-brand-text">
        <span class="adm-brand-name">SADA</span>
        <span class="adm-brand-sub">Admin panel</span>
      </span>
    </div>

    <nav class="adm-nav" id="admin-nav" aria-label="Menu admin">
      ${navItem('clients', 'OAuth clients', iconMonitor(18))}
      ${navItem('logs', 'Log aktivitas', iconLog(18))}
      ${navItem('users', 'Manajemen user', iconUsers(18))}
      ${navItem('mfa', 'Manajemen MFA', iconShield(18))}
    </nav>

    <div class="adm-side-foot">
      <div class="adm-me">
        <span class="adm-avatar" aria-hidden="true">${init}</span>
        <span class="adm-me-text">
          <span class="adm-me-name">${escHtml(name)}</span>
          <span class="adm-me-email">${escHtml(email)}</span>
        </span>
      </div>
      <button type="button" id="admin-logout" class="admin-nav-btn" aria-label="Keluar">
        ${iconLogout(18)}
        <span>Keluar</span>
      </button>
    </div>
  </aside>

  <main id="admin-content" class="adm-main">
    <div class="adm-loading"><div class="admin-spinner"></div></div>
  </main>

  <div id="admin-toast" class="adm-toast" style="display:none" role="status" aria-live="polite">
    <div id="admin-toast-alert"></div>
  </div>
</div>`;
}

// ─── Sidebar handlers ─────────────────────────────────────────────────────────

function attachSidebarNav(): void {
  document.getElementById('admin-nav')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
    if (!btn) return;
    const view = btn.dataset['view'] as AdminState['view'];
    if (view === state.view && !state.logsClientId) return;

    state.view = view;
    state.logsClientId = null;
    setNavActive(view);

    if (view === 'logs') {
      await loadLogs(1);
    } else if (view === 'mfa') {
      await loadMfaUsers(1);
    } else if (view === 'users') {
      await loadUsers(1);
    } else {
      await loadClients(state.clientsMeta.page);
    }
    renderMain();
  });
}

function attachLogout(): void {
  document.getElementById('admin-logout')?.addEventListener('click', async () => {
    await apiRequest(endpoints.logout, { method: 'POST' });
    clearAuthStorage();
    document.getElementById('admin-overlay')?.remove();
    document.querySelector('.auth-container')?.classList.remove('admin-mode');
    router.navigate('/login');
  });
}

function setNavActive(view: string): void {
  document.querySelectorAll<HTMLElement>('.admin-nav-btn').forEach((el) => {
    if (el.dataset['view']) {
      el.classList.toggle('is-active', el.dataset['view'] === view);
    }
  });
}

// ─── Inline style tokens (Tailwind v4 layer issues — inline is most reliable) ─

/** Kepala halaman: judul dan keterangan di kiri, aksi di kanan. */
function pageHead(title: string, sub: string, actions = ''): string {
  return `
    <header class="adm-head">
      <div class="adm-head-text">
        <h1>${title}</h1>
        <p>${sub}</p>
      </div>
      ${actions ? `<div class="adm-head-actions">${actions}</div>` : ''}
    </header>`;
}

/** Baris angka: angka dan labelnya, tanpa kartu. */
function statRow(
  items: Array<{ value: string; label: string; note: string; tone?: Tone }>
): string {
  return `<dl class="adm-stats">${items
    .map(
      (i) => `<div class="adm-stat">
        <dt>${i.label}</dt>
        <dd class="adm-stat-value${i.tone ? ` is-${i.tone}` : ''}">${i.value}</dd>
        <dd class="adm-stat-note">${i.note}</dd>
      </div>`
    )
    .join('')}</dl>`;
}

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/** Label status: tinta berwarna di atas warna samar; tanpa titik. */
function tag(label: string, tone: Tone, title = ''): string {
  return `<span class="adm-tag is-${tone}"${title ? ` title="${escHtml(title)}"` : ''}>${label}</span>`;
}

function tableWrap(id: string, head: string[], body: string, alignLastRight = true): string {
  return `
    <div class="adm-table-wrap">
      <table class="adm-table" id="${id}">
        <thead>
          <tr>${head
            .map(
              (h, i) =>
                `<th scope="col"${alignLastRight && i === head.length - 1 ? ' class="is-end"' : ''}>${h}</th>`
            )
            .join('')}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// ─── Main content renderer ────────────────────────────────────────────────────

function renderMain(): void {
  const el = document.getElementById('admin-content');
  if (!el) return;

  if (state.view === 'clients') {
    el.innerHTML = renderClientsView();
    attachClientsEvents();
  } else if (state.view === 'mfa') {
    el.innerHTML = renderMfaView();
    attachMfaEvents();
  } else if (state.view === 'users') {
    el.innerHTML = renderUsersView();
    attachUsersEvents();
  } else {
    el.innerHTML = renderLogsView();
    attachLogsEvents();
  }
}

// ─── Clients View ─────────────────────────────────────────────────────────────

function renderClientsView(): string {
  // Dari server, dihitung atas seluruh client. Sebelumnya `active` dihitung dari
  // baris yang kebetulan sedang dipegang halaman ini lalu dikurangkan dari total
  // global — campuran yang membuat angka "Nonaktif" tidak merujuk apa pun.
  const active = state.clientsMeta.activeCount ?? 0;
  const inactive = state.clientsMeta.inactiveCount ?? 0;

  const header = pageHead(
    'OAuth clients',
    'Kelola dan pantau aplikasi OAuth yang terhubung ke SSO.',
    `<button type="button" id="btn-create" class="vault-btn-primary">${iconPlus(16)} Tambah client</button>`
  );

  if (state.clientsLoading) return header + loadingHTML();

  return `${header}
    ${statRow([
      {
        value: String(state.clientsMeta.total),
        label: 'Total client',
        note: 'Terdaftar di sistem',
      },
      { value: String(active), label: 'Aktif', note: 'Client berjalan', tone: 'success' },
      {
        value: String(inactive),
        label: 'Nonaktif',
        note: 'Memerlukan perhatian',
        tone: inactive ? 'warning' : undefined,
      },
    ])}
    ${tableWrap(
      'clients-table',
      ['Nama aplikasi', 'Status', 'Client ID', 'Scopes', 'Dibuat', 'Aksi'],
      state.clients.length === 0
        ? `<tr><td colspan="6">${emptyState('Belum ada OAuth client terdaftar.')}</td></tr>`
        : state.clients.map(renderClientRow).join('')
    )}
    ${renderPagination(state.clientsMeta, 'clients')}`;
}

/** Dropdown filter. Nilainya dikirim ke server, tidak pernah menyaring di browser. */
function filterSelect(
  id: string,
  label: string,
  current: string,
  options: Array<[string, string]>
): string {
  return `<select id="${id}" aria-label="${label}" class="vault-input adm-select">
    ${options
      .map(
        ([value, text]) =>
          `<option value="${value}"${value === current ? ' selected' : ''}>${text}</option>`
      )
      .join('')}
  </select>`;
}

function renderClientRow(c: OAuthClient): string {
  const initials = (
    c.name.charAt(0) + (c.name.split(/\s/)[1]?.charAt(0) || c.name.charAt(1) || '')
  ).toUpperCase();

  const statusBadge = c.isActive ? tag('Aktif', 'success') : tag('Nonaktif', 'neutral');
  const grantSub = c.grants.map((g) => g.replace(/_/g, ' ')).join(', ');

  const scopePills =
    c.scopes
      .slice(0, 3)
      .map((s) => `<span class="adm-chip">${escHtml(s)}</span>`)
      .join('') +
    (c.scopes.length > 3 ? `<span class="adm-chip-more">+${c.scopes.length - 3}</span>` : '');

  const created = new Date(c.createdAt).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return `
    <tr class="vault-row">
      <td data-label="Nama aplikasi">
        <div class="adm-ident">
          <span class="adm-mono" aria-hidden="true">${escHtml(initials)}</span>
          <span class="adm-ident-text">
            <span class="adm-ident-name">${escHtml(c.name)}</span>
            <span class="adm-ident-sub">${escHtml(grantSub)}</span>
          </span>
        </div>
      </td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Client ID"><code class="adm-code">${escHtml(c.clientId)}</code></td>
      <td data-label="Scopes"><div class="adm-chips">${scopePills}</div></td>
      <td data-label="Dibuat" class="adm-muted num">${created}</td>
      <td data-label="Aksi" class="is-end">
        <div class="row-actions">
          <button type="button" class="vault-icon-btn" data-action="view-logs" data-id="${c.id}" data-name="${escHtml(c.name)}"
                  title="Lihat log" aria-label="Lihat log ${escHtml(c.name)}">${iconLog(16)}</button>
          <button type="button" class="vault-icon-btn" data-action="edit" data-id="${c.id}"
                  title="Edit" aria-label="Edit ${escHtml(c.name)}">${iconEdit(16)}</button>
          <button type="button" class="vault-icon-btn" data-action="regen" data-id="${c.id}" data-name="${escHtml(c.name)}"
                  title="Regenerasi secret" aria-label="Regenerasi secret ${escHtml(c.name)}">${iconRefresh(16)}</button>
          <button type="button" class="vault-icon-btn is-danger" data-action="delete" data-id="${c.id}" data-name="${escHtml(c.name)}"
                  title="Hapus" aria-label="Hapus ${escHtml(c.name)}">${iconTrash(16)}</button>
        </div>
      </td>
    </tr>`;
}

function attachClientsEvents(): void {
  document.getElementById('btn-create')?.addEventListener('click', () => openCreateModal());

  document.getElementById('clients-table')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!btn) return;
    const { action, id, name } = btn.dataset as { action: string; id: string; name: string };

    if (action === 'edit') {
      const c = state.clients.find((x) => x.id === id);
      if (c) openEditModal(c);
    } else if (action === 'delete') {
      openDeleteConfirm(id, name);
    } else if (action === 'regen') {
      openRegenConfirm(id, name);
    } else if (action === 'view-logs') {
      state.logsClientId = id;
      state.logsClientName = name;
      state.view = 'logs';
      setNavActive('logs');
      await loadLogs(1);
      renderMain();
    }
  });

  paginationListeners('clients', async (p) => {
    await loadClients(p);
    renderMain();
  });
}

// ─── Logs View ────────────────────────────────────────────────────────────────

const LOG_TONE: Record<string, Tone> = {
  LOGIN: 'info',
  LOGIN_LDAP: 'info',
  LOGIN_SPLP: 'info',
  LOGIN_GOOGLE: 'info',
  LOGIN_FACEBOOK: 'info',
  REGISTER: 'success',
  LOGIN_FAILED: 'error',
  LOGOUT: 'neutral',
  TOKEN_ISSUED: 'info',
  TOKEN_REFRESHED: 'info',
  TOKEN_REVOKED: 'warning',
  CLIENT_CREATED: 'info',
  CLIENT_DELETED: 'error',
  CLIENT_SECRET_REGENERATED: 'warning',
};

function renderLogsView(): string {
  const back = state.logsClientId
    ? `
    <button type="button" id="logs-back" class="adm-back">
      ${iconChevronLeft(16)} Kembali ke clients
    </button>`
    : '';

  const title = state.logsClientId ? `Log ${escHtml(state.logsClientName)}` : 'Log aktivitas';
  const subtitle = state.logsClientId
    ? 'Riwayat aktivitas untuk client ini.'
    : 'Pantau semua aktivitas autentikasi dan manajemen.';

  const toolbar = !state.logsClientId
    ? `
    <div class="adm-toolbar">
      <select id="logs-filter" class="vault-input adm-select" aria-label="Filter aksi">
        <option value="">Semua aksi</option>
        ${[
          'LOGIN',
          'LOGIN_FAILED',
          'LOGIN_LDAP',
          'LOGIN_SPLP',
          'LOGIN_GOOGLE',
          'LOGOUT',
          'REGISTER',
          'TOKEN_ISSUED',
          'TOKEN_REFRESHED',
          'TOKEN_REVOKED',
          'CLIENT_CREATED',
          'CLIENT_DELETED',
          'CLIENT_SECRET_REGENERATED',
        ]
          .map(
            (a) =>
              `<option value="${a}" ${state.logsActionFilter === a ? 'selected' : ''}>${a}</option>`
          )
          .join('')}
      </select>
      <span class="adm-count num">${state.logsMeta.total} entri</span>
    </div>`
    : '';

  const header = `${back}${pageHead(title, subtitle)}${toolbar}`;

  if (state.logsLoading) return header + loadingHTML();

  return `${header}
    ${tableWrap(
      'logs-table',
      ['Waktu', 'Aksi', 'User ID', 'Client ID', 'IP', 'Detail'],
      state.logs.length === 0
        ? `<tr><td colspan="6">${emptyState('Tidak ada log untuk ditampilkan.')}</td></tr>`
        : state.logs.map(renderLogRow).join(''),
      false
    )}
    ${renderPagination(state.logsMeta, 'logs')}`;
}

function renderLogRow(log: AuditLog): string {
  const dt = new Date(log.createdAt).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const tone = LOG_TONE[log.action] ?? 'neutral';
  const detailStr = log.details ? JSON.stringify(log.details) : '—';
  const shortId = (id: string | null) =>
    id ? `<span title="${escHtml(id)}">${escHtml(id.slice(0, 8))}…</span>` : '—';

  return `
    <tr class="vault-row">
      <td data-label="Waktu" class="adm-code adm-nowrap">${dt}</td>
      <td data-label="Aksi">${tag(escHtml(log.action), tone)}</td>
      <td data-label="User ID" class="adm-code">${shortId(log.userId)}</td>
      <td data-label="Client ID" class="adm-code">${shortId(log.clientId)}</td>
      <td data-label="IP" class="adm-code">${log.ip ? escHtml(log.ip) : '—'}</td>
      <td data-label="Detail"><div class="adm-detail adm-code" title="${escHtml(detailStr)}">${escHtml(detailStr)}</div></td>
    </tr>`;
}

function attachLogsEvents(): void {
  document.getElementById('logs-back')?.addEventListener('click', async () => {
    state.logsClientId = null;
    state.view = 'clients';
    setNavActive('clients');
    await loadClients(state.clientsMeta.page);
    renderMain();
  });

  document.getElementById('logs-filter')?.addEventListener('change', async (e) => {
    state.logsActionFilter = (e.target as HTMLSelectElement).value;
    await loadLogs(1);
    renderMain();
  });

  paginationListeners('logs', async (p) => {
    await loadLogs(p);
    renderMain();
  });
}

// ─── User Management View ─────────────────────────────────────────────────────

async function loadUsers(page: number): Promise<void> {
  state.usersLoading = true;
  renderMain();
  // Seluruh penyaringan dikirim ke server. Menyaring di browser hanya akan
  // menyaring 20 baris yang kebetulan sedang dipegang halaman ini.
  const q = new URLSearchParams({
    page: String(page),
    limit: String(state.usersMeta.limit),
  });
  if (state.usersSearch) q.set('search', state.usersSearch);
  if (state.usersStatus !== 'all') q.set('status', state.usersStatus);
  if (state.usersType !== 'all') q.set('type', state.usersType);
  if (state.usersMfa !== 'all') q.set('mfa', state.usersMfa);
  if (state.usersPassword !== 'all') q.set('password', state.usersPassword);
  const r = await apiRequest<AdminUser[]>(`${endpoints.users}?${q.toString()}`);
  state.usersLoading = false;
  if (goneIfUnauthorized(r.status)) return;
  if (r.success && r.data) {
    state.users = r.data;
    if (r.meta) state.usersMeta = r.meta;
  } else {
    state.users = [];
    showToast(r.error ?? 'Gagal memuat pengguna.', 'error');
  }
}

function renderUsersView(): string {
  const activeTotal = state.usersMeta.activeCount ?? 0;
  const inactiveTotal = state.usersMeta.inactiveCount ?? 0;
  // Hitungan server mengikuti filter yang sama dengan daftarnya, jadi
  // keterangannya harus ikut berubah begitu ada filter apa pun yang menyala —
  // kalau tidak, angkanya akan mengaku mewakili seluruh akun.
  const menyaring =
    state.usersSearch !== '' ||
    state.usersStatus !== 'all' ||
    state.usersType !== 'all' ||
    state.usersMfa !== 'all' ||
    state.usersPassword !== 'all';
  const cakupan = menyaring ? 'Sesuai filter' : 'Seluruh akun terdaftar';

  const header = `${pageHead(
    'Manajemen user',
    'Kelola seluruh akun pengguna SSO: cari, aktifkan, atau nonaktifkan akses.'
  )}
    <div class="adm-toolbar">
      <div class="adm-search">
        ${iconSearch(16)}
        <input id="users-search" type="text" class="vault-input" placeholder="Cari nama atau email" value="${escHtml(state.usersSearch)}" aria-label="Cari pengguna">
      </div>
      ${filterSelect('users-status', 'Filter status akun', state.usersStatus, [
        ['all', 'Semua status'],
        ['active', 'Aktif'],
        ['inactive', 'Nonaktif'],
      ])}
      ${filterSelect('users-type', 'Filter tipe pengguna', state.usersType, [
        ['all', 'Semua tipe'],
        ['INTERNAL', 'Internal'],
        ['GOVERNMENT', 'Pemerintah'],
        ['EXTERNAL', 'Eksternal'],
      ])}
      ${filterSelect('users-mfa', 'Filter status MFA', state.usersMfa, [
        ['all', 'Semua MFA'],
        ['enabled', 'MFA aktif'],
        ['pending', 'Belum enroll'],
      ])}
      ${filterSelect('users-password', 'Filter masa berlaku password', state.usersPassword, [
        ['all', 'Semua password'],
        ['ok', 'Password berlaku'],
        ['warning', 'Segera kedaluwarsa'],
        ['expired', 'Kedaluwarsa'],
      ])}
      <button type="button" id="users-search-btn" class="vault-btn-ghost is-outline">Cari</button>
    </div>`;

  if (state.usersLoading) return header + loadingHTML();

  return `${header}
    ${statRow([
      { value: String(state.usersMeta.total), label: 'Total pengguna', note: cakupan },
      { value: String(activeTotal), label: 'Aktif', note: cakupan, tone: 'success' },
      {
        value: String(inactiveTotal),
        label: 'Nonaktif',
        note: cakupan,
        tone: inactiveTotal ? 'warning' : undefined,
      },
    ])}
    ${tableWrap(
      'users-table',
      ['Pengguna', 'Email', 'Tipe', 'Status', 'Password', 'Aksi'],
      state.users.length === 0
        ? `<tr><td colspan="6">${emptyState('Tidak ada pengguna ditemukan.')}</td></tr>`
        : state.users.map(renderUserRow).join('')
    )}
    ${renderPagination(state.usersMeta, 'users')}`;
}

function renderUserRow(u: AdminUser): string {
  const initials = (u.name?.charAt(0) || u.email.charAt(0) || '?').toUpperCase();
  const isSelf = state.user?.id === u.id;

  const status = u.isActive ? tag('Aktif', 'success') : tag('Nonaktif', 'warning');

  const action = isSelf
    ? `<span class="adm-muted">Akun Anda</span>`
    : u.isActive
      ? `<button type="button" class="vault-icon-btn is-text is-danger" data-action="toggle-user" data-id="${u.id}" data-active="false" data-name="${escHtml(u.name || u.email)}">Nonaktifkan</button>`
      : `<button type="button" class="vault-icon-btn is-text is-success" data-action="toggle-user" data-id="${u.id}" data-active="true" data-name="${escHtml(u.name || u.email)}">Aktifkan</button>`;

  // Wajibkan Ganti Password: hanya INTERNAL, bukan diri sendiri, dan belum diwajibkan.
  const requireChange =
    u.userType === 'INTERNAL' && !isSelf && !u.passwordMustChange
      ? `<button type="button" class="vault-icon-btn is-text is-warning" title="Cabut semua sesi dan wajibkan ganti password saat login berikutnya" data-action="require-password-change" data-id="${u.id}">Wajibkan ganti</button>`
      : '';

  return `
    <tr class="vault-row">
      <td data-label="Pengguna">
        <div class="adm-ident">
          <span class="adm-avatar is-sm" aria-hidden="true">${initials}</span>
          <span class="adm-ident-name">${escHtml(u.name || '—')}</span>
        </div>
      </td>
      <td data-label="Email" class="adm-muted">${escHtml(u.email)}</td>
      <td data-label="Tipe" class="adm-muted">${escHtml(u.userType)}</td>
      <td data-label="Status">${status}</td>
      <td data-label="Password">${passwordBadge(u)}</td>
      <td data-label="Aksi" class="is-end">
        <div class="row-actions is-stack">${requireChange}${action}</div>
      </td>
    </tr>`;
}

/** Status Masa Berlaku Password; hanya bermakna bagi user INTERNAL. */
function passwordBadge(u: AdminUser): string {
  const e = u.passwordExpiry;
  if (!e || e.daysLeft === null) return `<span class="adm-muted">—</span>`;
  const changed = u.passwordChangedAt
    ? `Diganti ${new Date(u.passwordChangedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : 'Tanggal ganti tidak diketahui';
  const [label, tone]: [string, Tone] =
    e.status === 'expired'
      ? [u.passwordMustChange ? 'Diwajibkan ganti' : 'Kedaluwarsa', 'error']
      : e.status === 'warning'
        ? [`${e.daysLeft} hari lagi`, 'warning']
        : ['Berlaku', 'success'];
  return tag(label, tone, changed);
}

function attachUsersEvents(): void {
  const doSearch = async () => {
    const input = document.getElementById('users-search') as HTMLInputElement | null;
    state.usersSearch = input?.value.trim() ?? '';
    await loadUsers(1);
    renderMain();
  };
  document.getElementById('users-search-btn')?.addEventListener('click', doSearch);
  document.getElementById('users-search')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doSearch();
  });

  // Setiap perubahan filter kembali ke halaman 1: bertahan di halaman 7 dari
  // hasil lama akan menampilkan tabel kosong tanpa sebab yang terlihat.
  const onFilter = (id: string, apply: (v: string) => void) => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      apply((e.target as HTMLSelectElement).value);
      await loadUsers(1);
      renderMain();
    });
  };
  onFilter('users-status', (v) => (state.usersStatus = v as typeof state.usersStatus));
  onFilter('users-type', (v) => (state.usersType = v as typeof state.usersType));
  onFilter('users-mfa', (v) => (state.usersMfa = v as typeof state.usersMfa));
  onFilter('users-password', (v) => (state.usersPassword = v as typeof state.usersPassword));

  // Wajibkan Ganti Password mencabut semua sesi user — butuh klik kedua untuk
  // konfirmasi (tanpa dialog browser).
  document.getElementById('users-table')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-action="require-password-change"]'
    );
    if (!btn) return;
    if (btn.dataset['armed'] !== 'true') {
      btn.dataset['armed'] = 'true';
      btn.textContent = 'Klik lagi untuk konfirmasi';
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.dataset['armed'] = 'false';
        btn.textContent = 'Wajibkan ganti';
      }, 4000);
      return;
    }
    btn.disabled = true;
    const r = await apiRequest(endpoints.userRequirePasswordChange(btn.dataset['id'] ?? ''), {
      method: 'POST',
    });
    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      showToast(r.error ?? 'Gagal mewajibkan ganti password.', 'error');
      btn.disabled = false;
      return;
    }
    showToast('Sesi pengguna dicabut; ganti password diwajibkan saat login berikutnya.', 'success');
    await loadUsers(state.usersMeta.page);
    renderMain();
  });

  document.getElementById('users-table')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="toggle-user"]');
    if (!btn) return;
    const id = btn.dataset['id'] ?? '';
    const isActive = btn.dataset['active'] === 'true';
    btn.disabled = true;
    const r = await apiRequest(endpoints.userStatus(id), {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      showToast(r.error ?? 'Gagal mengubah status.', 'error');
      btn.disabled = false;
      return;
    }
    showToast(isActive ? 'Pengguna diaktifkan.' : 'Pengguna dinonaktifkan.', 'success');
    await loadUsers(state.usersMeta.page);
    renderMain();
  });

  paginationListeners('users', async (p) => {
    await loadUsers(p);
    renderMain();
  });
}

// ─── MFA Management View ──────────────────────────────────────────────────────

async function loadMfaUsers(page: number): Promise<void> {
  state.mfaLoading = true;
  const r = await apiRequest<{
    users: MfaUser[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    enabledCount?: number;
    pendingCount?: number;
  }>(
    (() => {
      const p = new URLSearchParams({ page: String(page), limit: String(state.mfaMeta.limit) });
      if (state.mfaSearch) p.set('search', state.mfaSearch);
      if (state.mfaFilter !== 'all') p.set('mfa', state.mfaFilter);
      return `${endpoints.adminMfaUsers}?${p.toString()}`;
    })()
  );
  state.mfaLoading = false;
  if (goneIfUnauthorized(r.status)) return;
  if (r.success && r.data) {
    state.mfaUsers = r.data.users ?? [];
    state.mfaMeta = {
      page: r.data.page,
      limit: r.data.limit,
      total: r.data.total,
      totalPages: r.data.totalPages,
      enabledCount: r.data.enabledCount ?? 0,
      pendingCount: r.data.pendingCount ?? 0,
    };
  }
}

function renderMfaView(): string {
  // Dari server, atas seluruh pengguna internal yang cocok dengan filter —
  // bukan dari baris yang kebetulan masuk halaman ini.
  const enabledTotal = state.mfaMeta.enabledCount ?? 0;
  const pendingTotal = state.mfaMeta.pendingCount ?? 0;
  const menyaring = state.mfaSearch !== '' || state.mfaFilter !== 'all';
  const cakupanMfa = menyaring ? 'Sesuai filter' : 'Seluruh pengguna internal';

  const header = `${pageHead(
    'Manajemen MFA',
    'MFA wajib untuk semua pengguna internal. Reset bila pengguna kehilangan perangkat; mereka akan dipaksa enroll ulang saat login berikutnya.'
  )}
    <div class="adm-toolbar">
      <div class="adm-search">
        ${iconSearch(16)}
        <input id="mfa-search" type="text" class="vault-input" placeholder="Cari nama atau email" value="${escHtml(state.mfaSearch)}" aria-label="Cari pengguna internal">
      </div>
      ${filterSelect('mfa-filter', 'Filter status MFA', state.mfaFilter, [
        ['all', 'Semua status'],
        ['enabled', 'MFA aktif'],
        ['pending', 'Belum enroll'],
      ])}
      <button type="button" id="mfa-search-btn" class="vault-btn-ghost is-outline">Cari</button>
    </div>`;

  if (state.mfaLoading) return header + loadingHTML();

  return `${header}
    ${statRow([
      { value: String(state.mfaMeta.total), label: 'Total internal', note: cakupanMfa },
      { value: String(enabledTotal), label: 'MFA aktif', note: cakupanMfa, tone: 'success' },
      {
        value: String(pendingTotal),
        label: 'Belum enroll',
        note: cakupanMfa,
        tone: pendingTotal ? 'warning' : undefined,
      },
    ])}
    ${tableWrap(
      'mfa-table',
      ['Pengguna', 'Email', 'Status MFA', 'Aktif sejak', 'Aksi'],
      state.mfaUsers.length === 0
        ? `<tr><td colspan="5">${emptyState(
            menyaring
              ? 'Tidak ada pengguna yang cocok dengan filter ini.'
              : 'Belum ada pengguna internal.'
          )}</td></tr>`
        : state.mfaUsers.map(renderMfaRow).join('')
    )}
    ${renderPagination(state.mfaMeta, 'mfa')}`;
}

function renderMfaRow(u: MfaUser): string {
  const initials = (u.name?.charAt(0) || u.email.charAt(0) || '?').toUpperCase();
  const badge = u.mfaEnabled ? tag('Aktif', 'success') : tag('Belum enroll', 'warning');

  const since = u.mfaEnabledAt
    ? new Date(u.mfaEnabledAt).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

  const action = u.mfaEnabled
    ? `<button type="button" class="vault-icon-btn is-text is-danger"
              data-action="reset-mfa" data-id="${u.id}" data-name="${escHtml(u.name || u.email)}"
              aria-label="Reset MFA ${escHtml(u.name || u.email)}">Reset MFA</button>`
    : `<span class="adm-muted">—</span>`;

  return `
    <tr class="vault-row">
      <td data-label="Pengguna">
        <div class="adm-ident">
          <span class="adm-avatar is-sm" aria-hidden="true">${initials}</span>
          <span class="adm-ident-name">${escHtml(u.name || '—')}</span>
        </div>
      </td>
      <td data-label="Email" class="adm-muted">${escHtml(u.email)}</td>
      <td data-label="Status MFA">${badge}</td>
      <td data-label="Aktif sejak" class="adm-muted num">${since}</td>
      <td data-label="Aksi" class="is-end">
        <div class="row-actions">${action}</div>
      </td>
    </tr>`;
}

function attachMfaEvents(): void {
  const doSearch = async () => {
    const input = document.getElementById('mfa-search') as HTMLInputElement | null;
    state.mfaSearch = input?.value.trim() ?? '';
    await loadMfaUsers(1);
    renderMain();
  };
  document.getElementById('mfa-search-btn')?.addEventListener('click', doSearch);
  document.getElementById('mfa-search')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doSearch();
  });
  document.getElementById('mfa-filter')?.addEventListener('change', async (e) => {
    state.mfaFilter = (e.target as HTMLSelectElement).value as typeof state.mfaFilter;
    await loadMfaUsers(1);
    renderMain();
  });

  document.getElementById('mfa-table')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="reset-mfa"]');
    if (!btn) return;
    openMfaResetConfirm(btn.dataset['id'] ?? '', btn.dataset['name'] ?? '');
  });

  paginationListeners('mfa', async (p) => {
    await loadMfaUsers(p);
    renderMain();
  });
}

function confirmDialog(opts: {
  title: string;
  body: string;
  note: string;
  submit: string;
  tone: 'danger' | 'warning';
}): string {
  return `
    <div class="adm-dialog-head">
      <h2>${opts.title}</h2>
      <p>${opts.body}</p>
      <p class="adm-dialog-note">${opts.note}</p>
    </div>
    <div class="adm-dialog-actions">
      <button type="button" class="vault-btn-ghost" id="modal-cancel">Batal</button>
      <button type="button" class="vault-btn-primary is-${opts.tone}" id="modal-submit">
        <span id="modal-submit-txt">${opts.submit}</span>
      </button>
    </div>`;
}

function openMfaResetConfirm(id: string, name: string): void {
  openModal(
    confirmDialog({
      title: 'Reset MFA?',
      body: `Reset MFA untuk <strong>${escHtml(name)}</strong>.`,
      note: 'Pengguna akan dipaksa mendaftarkan ulang authenticator saat login berikutnya.',
      submit: 'Reset MFA',
      tone: 'warning',
    })
  );

  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-submit')?.addEventListener('click', async () => {
    setSubmitLoading(true);
    const r = await apiRequest(endpoints.adminMfaDisable(id), { method: 'POST' });
    setSubmitLoading(false);
    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      showToast(r.error ?? 'Gagal mereset MFA.', 'error');
      return;
    }
    closeModal();
    showToast('MFA pengguna direset.', 'success');
    await loadMfaUsers(state.mfaMeta.page);
    renderMain();
  });
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function renderPagination(
  meta: { page: number; limit: number; total: number; totalPages: number },
  ns: string
): string {
  if (meta.totalPages <= 1 && meta.total === 0) return '';
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  const pages: number[] = [];
  const start = Math.max(1, meta.page - 2);
  const end = Math.min(meta.totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  const pageButtons = pages
    .map((p) =>
      p === meta.page
        ? `<button type="button" class="vault-page-btn is-current" aria-current="page">${p}</button>`
        : `<button type="button" class="vault-page-btn ${ns}-page" data-page="${p}" aria-label="Halaman ${p}">${p}</button>`
    )
    .join('');

  return `
    <nav class="adm-pager" aria-label="Halaman">
      <p class="num">Menampilkan ${from}–${to} dari <strong>${meta.total}</strong></p>
      <div class="adm-pager-btns">
        <button type="button" class="vault-page-nav" id="${ns}-prev"
                ${meta.page <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">
          ${iconChevronLeft(18)}
        </button>
        ${pageButtons}
        <button type="button" class="vault-page-nav" id="${ns}-next"
                ${meta.page >= meta.totalPages ? 'disabled' : ''} aria-label="Berikutnya">
          ${iconChevronRight(18)}
        </button>
      </div>
    </nav>`;
}

function paginationListeners(ns: string, cb: (page: number) => Promise<void>): void {
  const meta = ns === 'clients' ? state.clientsMeta : ns === 'mfa' ? state.mfaMeta : state.logsMeta;
  document.getElementById(`${ns}-prev`)?.addEventListener('click', async () => {
    if (meta.page > 1) await cb(meta.page - 1);
  });
  document.getElementById(`${ns}-next`)?.addEventListener('click', async () => {
    if (meta.page < meta.totalPages) await cb(meta.page + 1);
  });
  document.querySelectorAll<HTMLElement>(`.${ns}-page`).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = Number(btn.dataset['page']);
      if (p && p !== meta.page) await cb(p);
    });
  });
}

// ─── Data loaders ─────────────────────────────────────────────────────────────

async function loadClients(page: number): Promise<void> {
  state.clientsLoading = true;
  const r = await apiRequest<OAuthClient[]>(
    `${endpoints.clients}?page=${page}&limit=${state.clientsMeta.limit}`
  );
  state.clientsLoading = false;
  if (goneIfUnauthorized(r.status)) return;
  if (r.success && r.data) {
    state.clients = r.data;
    if (r.meta) state.clientsMeta = r.meta;
  }
}

async function loadLogs(page: number): Promise<void> {
  state.logsLoading = true;
  const url = state.logsClientId
    ? `${endpoints.clientLogs(state.logsClientId)}?page=${page}&limit=${state.logsMeta.limit}`
    : `${endpoints.auditLogs}?page=${page}&limit=${state.logsMeta.limit}${state.logsActionFilter ? '&action=' + encodeURIComponent(state.logsActionFilter) : ''}`;
  const r = await apiRequest<AuditLog[]>(url);
  state.logsLoading = false;
  if (goneIfUnauthorized(r.status)) return;
  if (r.success && r.data) {
    state.logs = r.data;
    if (r.meta) state.logsMeta = r.meta;
  }
}

// ─── Modals (DaisyUI <dialog>) ────────────────────────────────────────────────

const MODAL_ID = 'admin-modal';

function openModal(html: string): void {
  closeModal();
  const el = document.createElement('dialog');
  el.id = MODAL_ID;
  el.innerHTML = html;
  document.body.appendChild(el);
  el.showModal();
  el.addEventListener('click', (e) => {
    if (e.target === el) closeModal();
  });
}

function closeModal(): void {
  const el = document.getElementById(MODAL_ID) as HTMLDialogElement | null;
  el?.close();
  el?.remove();
}

// ─── Create Client ────────────────────────────────────────────────────────────

const ALL_GRANTS = ['authorization_code', 'client_credentials', 'refresh_token'];
const ALL_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'read',
  'write',
  'internal',
  'government',
  'pegawai',
];

function checkboxGroup(items: string[], name: string, checked: string[]): string {
  return `<div class="adm-checks">
      ${items
        .map(
          (v) => `
      <label class="adm-check">
        <input type="checkbox" name="${name}" value="${v}" class="admin-checkbox"
          ${checked.includes(v) ? 'checked' : ''}>
        <span>${v.replace(/_/g, ' ')}</span>
      </label>`
        )
        .join('')}
    </div>`;
}

/** Isi form tambah/edit client. Nilai awal kosong untuk tambah. */
function clientForm(title: string, submit: string, c?: OAuthClient): string {
  return `
    <div class="adm-dialog-head">
      <h2>${title}</h2>
    </div>

    <div class="adm-form">
      <div class="adm-field">
        <label class="vault-label" for="f-name">Nama aplikasi <span class="adm-req" aria-hidden="true">*</span></label>
        <input id="f-name" type="text" class="vault-input" required ${c ? `value="${escHtml(c.name)}"` : 'placeholder="Contoh: Portal PANRB"'}>
      </div>

      <div class="adm-field">
        <label class="vault-label" for="f-uris">Redirect URI <span class="adm-req" aria-hidden="true">*</span></label>
        <textarea id="f-uris" rows="3" class="vault-input adm-code" required aria-describedby="f-uris-help"
          ${c ? '' : 'placeholder="https://app.menpan.go.id/callback"'}>${c ? escHtml(c.redirectUris.join('\n')) : ''}</textarea>
        <p class="adm-help" id="f-uris-help">Satu URI per baris</p>
      </div>

      <fieldset class="adm-field">
        <legend class="vault-label">Grant types <span class="adm-req" aria-hidden="true">*</span></legend>
        ${checkboxGroup(ALL_GRANTS, 'grant', c ? c.grants : ['authorization_code'])}
      </fieldset>

      <fieldset class="adm-field">
        <legend class="vault-label">Scopes <span class="adm-req" aria-hidden="true">*</span></legend>
        ${checkboxGroup(ALL_SCOPES, 'scope', c ? c.scopes : ['openid', 'profile', 'email', 'offline_access'])}
      </fieldset>

      <div id="create-err" class="alert alert-error" style="display:none" role="alert">
        <span id="create-err-msg"></span>
      </div>
    </div>

    <div class="adm-dialog-actions">
      <button type="button" class="vault-btn-ghost" id="modal-cancel">Batal</button>
      <button type="button" class="vault-btn-primary" id="modal-submit">
        <span id="modal-submit-txt">${submit}</span>
      </button>
    </div>`;
}

function openCreateModal(): void {
  openModal(clientForm('Tambah OAuth client', 'Buat client'));

  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-submit')?.addEventListener('click', async () => {
    const name = (document.getElementById('f-name') as HTMLInputElement).value.trim();
    const uris = (document.getElementById('f-uris') as HTMLTextAreaElement).value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const grants = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="grant"]:checked'),
    ].map((e) => e.value);
    const scopes = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="scope"]:checked'),
    ].map((e) => e.value);

    const errEl = document.getElementById('create-err')!;
    const errMsg = document.getElementById('create-err-msg')!;

    if (!name || !uris.length || !grants.length || !scopes.length) {
      errMsg.textContent = 'Isi semua field yang wajib.';
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';
    setSubmitLoading(true);

    const r = await apiRequest<OAuthClient>(endpoints.clients, {
      method: 'POST',
      body: JSON.stringify({ name, redirectUris: uris, grants, scopes }),
    });
    setSubmitLoading(false);

    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      errMsg.textContent = r.error ?? 'Gagal membuat client.';
      errEl.style.display = 'block';
      return;
    }

    closeModal();
    showToast('Client berhasil dibuat!', 'success');
    if (r.data?.clientSecret) showSecretModal(r.data.clientId, r.data.clientSecret);
    await loadClients(1);
    renderMain();
  });
}

// ─── Edit Client ──────────────────────────────────────────────────────────────

function openEditModal(c: OAuthClient): void {
  openModal(clientForm('Edit client', 'Simpan', c));

  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-submit')?.addEventListener('click', async () => {
    const name = (document.getElementById('f-name') as HTMLInputElement).value.trim();
    const uris = (document.getElementById('f-uris') as HTMLTextAreaElement).value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const grants = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="grant"]:checked'),
    ].map((e) => e.value);
    const scopes = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="scope"]:checked'),
    ].map((e) => e.value);

    const errEl = document.getElementById('create-err')!;
    const errMsg = document.getElementById('create-err-msg')!;
    if (!name || !uris.length || !grants.length || !scopes.length) {
      errMsg.textContent = 'Isi semua field yang wajib.';
      errEl.style.display = 'block';
      return;
    }
    setSubmitLoading(true);
    const r = await apiRequest<OAuthClient>(`${endpoints.clients}/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, redirectUris: uris, grants, scopes }),
    });
    setSubmitLoading(false);

    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      errMsg.textContent = r.error ?? 'Gagal menyimpan.';
      errEl.style.display = 'block';
      return;
    }
    closeModal();
    showToast('Perubahan disimpan!', 'success');
    await loadClients(state.clientsMeta.page);
    renderMain();
  });
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function openDeleteConfirm(id: string, name: string): void {
  openModal(
    confirmDialog({
      title: 'Hapus client?',
      body: `Yakin ingin menghapus <strong>${escHtml(name)}</strong>?`,
      note: 'Semua token aktif untuk client ini akan ikut dihapus.',
      submit: 'Hapus',
      tone: 'danger',
    })
  );

  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-submit')?.addEventListener('click', async () => {
    setSubmitLoading(true);
    const r = await apiRequest(`${endpoints.clients}/${id}`, { method: 'DELETE' });
    setSubmitLoading(false);
    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      showToast(r.error ?? 'Gagal menghapus.', 'error');
      return;
    }
    closeModal();
    showToast('Client dihapus.', 'success');
    await loadClients(
      Math.max(1, state.clients.length === 1 ? state.clientsMeta.page - 1 : state.clientsMeta.page)
    );
    renderMain();
  });
}

// ─── Regenerate Secret ────────────────────────────────────────────────────────

function openRegenConfirm(id: string, name: string): void {
  openModal(
    confirmDialog({
      title: 'Regenerasi secret?',
      body: `Regenerasi secret untuk <strong>${escHtml(name)}</strong>.`,
      note: 'Secret lama langsung tidak berlaku.',
      submit: 'Regenerasi',
      tone: 'warning',
    })
  );

  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-submit')?.addEventListener('click', async () => {
    setSubmitLoading(true);
    const r = await apiRequest<OAuthClient>(`${endpoints.clients}/${id}/regenerate-secret`, {
      method: 'POST',
    });
    setSubmitLoading(false);
    if (goneIfUnauthorized(r.status)) return;
    if (!r.success) {
      showToast(r.error ?? 'Gagal regenerasi.', 'error');
      return;
    }
    closeModal();
    if (r.data?.clientSecret) {
      const client = state.clients.find((c) => c.id === id);
      showSecretModal(client?.clientId ?? id, r.data.clientSecret);
    }
  });
}

// ─── Secret reveal ────────────────────────────────────────────────────────────

function showSecretModal(clientId: string, secret: string): void {
  openModal(`
    <div class="adm-dialog-head">
      <h2>Client secret</h2>
    </div>

    <div class="alert adm-alert-warning" role="status">
      <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>Simpan secret ini sekarang. <strong>Secret tidak akan ditampilkan lagi.</strong></span>
    </div>

    <div class="adm-form">
      <div class="adm-field">
        <p class="vault-label">Client ID</p>
        <div class="adm-readout adm-code">${escHtml(clientId)}</div>
      </div>
      <div class="adm-field">
        <p class="vault-label">Client secret</p>
        <div id="secret-box" class="adm-readout adm-code is-strong">${escHtml(secret)}</div>
      </div>
    </div>

    <div class="adm-dialog-actions">
      <button type="button" id="btn-copy-secret" class="vault-btn-ghost">${iconCopy(14)} Salin secret</button>
      <button type="button" class="vault-btn-primary" id="modal-cancel">Sudah disimpan</button>
    </div>`);

  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('btn-copy-secret')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(secret);
    const btn = document.getElementById('btn-copy-secret')!;
    btn.innerHTML = `${svg('<polyline points="20 6 9 17 4 12"/>', 14)} Tersalin`;
    btn.classList.add('is-done');
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const toast = document.getElementById('admin-toast');
  const alert = document.getElementById('admin-toast-alert');
  if (!toast || !alert) return;

  alert.className = `adm-toast-body is-${type}`;
  alert.innerHTML = `<span>${escHtml(msg)}</span>`;
  toast.style.display = 'flex';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setSubmitLoading(loading: boolean): void {
  const btn = document.getElementById('modal-submit') as HTMLButtonElement | null;
  const lbl = document.getElementById('modal-submit-txt');
  if (!btn) return;
  btn.disabled = loading;
  btn.setAttribute('aria-busy', String(loading));
  if (lbl) lbl.textContent = loading ? 'Memproses…' : (lbl.textContent ?? '');
}

function loadingHTML(): string {
  return `<div class="adm-loading" role="status" aria-label="Memuat"><div class="admin-spinner"></div></div>`;
}

function emptyState(msg: string): string {
  return `<div class="adm-empty"><p>${msg}</p></div>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

const svg = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const iconMonitor = (s = 16) =>
  svg(`<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`, s);
const iconLog = (s = 16) =>
  svg(
    `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
    s
  );
const iconLogout = (s = 14) =>
  svg(
    `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
    s
  );
const iconEdit = (s = 14) =>
  svg(
    `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    s
  );
const iconTrash = (s = 14) =>
  svg(
    `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>`,
    s
  );
const iconRefresh = (s = 14) =>
  svg(
    `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
    s
  );
const iconPlus = (s = 16) =>
  svg(`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`, s);
const iconCopy = (s = 14) =>
  svg(
    `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
    s
  );
const iconChevronLeft = (s = 14) => svg(`<polyline points="15 18 9 12 15 6"/>`, s);
const iconChevronRight = (s = 14) => svg(`<polyline points="9 18 15 12 9 6"/>`, s);
const iconUsers = (s = 16) =>
  svg(
    `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>`,
    s
  );
const iconShield = (s = 16) =>
  svg(`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>`, s);
const iconSearch = (s = 16) => svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`, s);
