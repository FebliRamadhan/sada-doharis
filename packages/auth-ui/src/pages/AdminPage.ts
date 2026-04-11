/**
 * Admin Page — OAuth Client Management + Audit Log
 * Design: "Architectural Vault" adapted for PANRB Government palette
 * Principles: Tonal layering, editorial typography, generous whitespace
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
} from '../api';
import { router } from '../router';

// ─── State ────────────────────────────────────────────────────────────────────

interface AdminState {
    view: 'clients' | 'logs';
    user: User | null;
    clients: OAuthClient[];
    clientsMeta: { page: number; limit: number; total: number; totalPages: number };
    clientsLoading: boolean;
    logs: AuditLog[];
    logsMeta: { page: number; limit: number; total: number; totalPages: number };
    logsLoading: boolean;
    logsClientId: string | null;
    logsClientName: string;
    logsActionFilter: string;
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
};

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function AdminPage(): Promise<void> {
    if (!getStoredToken()) {
        router.navigate('/login');
        return;
    }

    const meResult = await apiRequest<User>(endpoints.me);
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
    const name  = state.user?.name  ?? 'Admin';
    const email = state.user?.email ?? '';
    const init  = name.charAt(0).toUpperCase();

    return `
<div data-theme="light"
     style="display:flex;width:100%;height:100%;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#EDEEF0">

  <!-- Sidebar -->
  <aside style="width:16rem;flex-shrink:0;display:flex;flex-direction:column;padding:2rem 1rem;background:#F5F6F8">

    <div style="margin-bottom:2.5rem;padding:0 0.5rem">
      <div style="display:flex;align-items:center;gap:0.75rem">
        <div style="width:2.25rem;height:2.25rem;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.875rem;color:#fff;background:#01347C">S</div>
        <div>
          <div style="font-size:1.125rem;font-weight:800;letter-spacing:-0.025em;color:#01347C;font-family:'Plus Jakarta Sans',Manrope,sans-serif">SADA</div>
          <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94A3B8;letter-spacing:0.15em">Admin Panel</div>
        </div>
      </div>
    </div>

    <nav style="flex:1 1 0%;display:flex;flex-direction:column;gap:0.25rem" id="admin-nav">
      <button id="nav-clients" data-view="clients"
        class="admin-nav-btn"
        style="width:100%;display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0.75rem;font-size:0.875rem;cursor:pointer"
        aria-label="OAuth Clients">
        ${iconMonitor(20)}
        <span>OAuth Clients</span>
      </button>

      <button id="nav-logs" data-view="logs"
        class="admin-nav-btn"
        style="width:100%;display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0.75rem;font-size:0.875rem;cursor:pointer"
        aria-label="Log Aktivitas">
        ${iconLog(20)}
        <span>Log Aktivitas</span>
      </button>
    </nav>

    <div style="margin-top:auto;padding:0 0.25rem">
      <button id="admin-logout"
        class="admin-nav-btn"
        style="width:100%;display:flex;align-items:center;gap:0.625rem;padding:0.5rem 0.75rem;font-size:0.875rem;cursor:pointer;margin-bottom:1.25rem"
        aria-label="Keluar">
        ${iconLogout(18)}
        <span>Keluar</span>
      </button>

      <div style="padding-top:1rem;display:flex;align-items:center;gap:0.75rem;padding-left:0.25rem;padding-right:0.25rem;border-top:1px solid rgba(148,163,184,0.15)">
        <div style="width:2.25rem;height:2.25rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0;background:rgba(1,52,124,0.07);color:#01347C">${init}</div>
        <div style="min-width:0">
          <div style="font-size:0.75rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#191C1D">${escHtml(name)}</div>
          <div style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94A3B8">${escHtml(email)}</div>
        </div>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <div style="flex:1 1 0%;display:flex;flex-direction:column;overflow:hidden">
    <main id="admin-content" style="flex:1;overflow-y:auto;padding:2.5rem">
      <div style="display:flex;align-items:center;justify-content:center;height:100%">
        <div class="admin-spinner"></div>
      </div>
    </main>
  </div>

  <!-- Toast -->
  <div id="admin-toast" style="display:none;position:fixed;top:1rem;right:1rem;z-index:50">
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
    document.querySelectorAll<HTMLElement>('.admin-nav-btn').forEach(el => {
        if (el.dataset['view']) {
            el.classList.toggle('is-active', el.dataset['view'] === view);
        }
    });
}

// ─── Inline style tokens (Tailwind v4 layer issues — inline is most reliable) ─

const S = {
    card: 'background:#FFF;border-radius:1rem;box-shadow:0 4px 20px -4px rgba(1,52,124,0.05);border:1px solid rgba(1,52,124,0.06)',
    th:   'padding:1rem 1.5rem;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748B',
    row:  'border-bottom:1px solid rgba(1,52,124,0.04)',
    badge:'display:inline-flex;align-items:center;gap:0.375rem;padding:0.25rem 0.625rem;border-radius:9999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em',
    label:'display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#64748B;margin-bottom:0.5rem',
    input:'width:100%;padding:0.75rem 1rem;border-radius:0.75rem;font-size:0.875rem;font-weight:500;background:#F0F1F3;color:#191C1D;border:none;outline:2px solid transparent',
} as const;

// ─── Main content renderer ────────────────────────────────────────────────────

function renderMain(): void {
    const el = document.getElementById('admin-content');
    if (!el) return;

    if (state.view === 'clients') {
        el.innerHTML = renderClientsView();
        attachClientsEvents();
    } else {
        el.innerHTML = renderLogsView();
        attachLogsEvents();
    }
}

// ─── Clients View ─────────────────────────────────────────────────────────────

function renderClientsView(): string {
    const active   = state.clients.filter(c => c.isActive).length;
    const inactive = state.clientsMeta.total - active;

    const header = `
    <header style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1.5rem;margin-bottom:2.5rem">
      <div>
        <h2 style="font-size:1.875rem;font-weight:800;letter-spacing:-0.025em;margin-bottom:0.375rem;color:#01347C;font-family:'Plus Jakarta Sans',Manrope,sans-serif">
          OAuth Clients
        </h2>
        <p style="font-size:0.875rem;font-weight:500;color:#64748B">
          Kelola dan pantau aplikasi OAuth yang terhubung ke SSO.
        </p>
      </div>
      <button id="btn-create"
        style="display:flex;align-items:center;gap:0.5rem;padding:0.625rem 1.25rem;color:#fff;font-size:0.875rem;font-weight:600;border-radius:0.75rem;cursor:pointer;flex-shrink:0;border:none;background:linear-gradient(135deg,#01347C,#005598);box-shadow:0 4px 14px rgba(1,52,124,0.28)">
        ${iconPlus(16)} Tambah Client
      </button>
    </header>`;

    if (state.clientsLoading) return header + loadingHTML();

    return `${header}

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem;margin-bottom:2.5rem">
      ${statCard(String(state.clientsMeta.total), 'Total Client', 'Terdaftar di sistem', '#01347C')}
      ${statCard(String(active), 'Aktif', 'Client berjalan', '#15803D')}
      ${statCardFeatured(String(inactive), 'Nonaktif', 'Memerlukan perhatian')}
    </div>

    <!-- Table -->
    <div style="${S.card};overflow:hidden">
      <div style="overflow-x:auto">
        <table style="width:100%;text-align:left;border-collapse:collapse" id="clients-table">
          <thead>
            <tr style="background:rgba(1,52,124,0.02)">
              <th style="${S.th}">Nama Aplikasi</th>
              <th style="${S.th}">Status</th>
              <th style="${S.th}">Client ID</th>
              <th style="${S.th}">Scopes</th>
              <th style="${S.th}">Dibuat</th>
              <th style="${S.th};text-align:right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${state.clients.length === 0
                ? `<tr><td colspan="6">${emptyState('Belum ada OAuth client terdaftar.')}</td></tr>`
                : state.clients.map(renderClientRow).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination(state.clientsMeta, 'clients')}
    </div>`;
}

function statCard(value: string, title: string, desc: string, color: string): string {
    return `
    <div style="${S.card};padding:1.5rem">
      <p style="${S.label};margin-bottom:0.25rem">${title}</p>
      <p style="font-size:2.25rem;font-weight:800;color:${color};font-family:'Plus Jakarta Sans',Manrope,sans-serif;line-height:1.1">${value}</p>
      <p style="font-size:0.75rem;font-weight:500;color:#94A3B8;margin-top:0.75rem">${desc}</p>
    </div>`;
}

function statCardFeatured(value: string, title: string, desc: string): string {
    return `
    <div style="padding:1.5rem;border-radius:1rem;position:relative;overflow:hidden;background:linear-gradient(135deg,#01347C,#005598);box-shadow:0 8px 30px -4px rgba(1,52,124,0.2)">
      <div style="position:relative;z-index:1">
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:0.25rem;color:rgba(255,255,255,0.5);letter-spacing:0.15em">${title}</p>
        <p style="font-size:2.25rem;font-weight:800;color:#FFF;font-family:'Plus Jakarta Sans',Manrope,sans-serif;line-height:1.1">${value}</p>
        <p style="font-size:0.75rem;font-weight:500;margin-top:0.75rem;color:rgba(255,255,255,0.45)">${desc}</p>
      </div>
      <div style="position:absolute;top:0;right:0;margin-right:-2rem;margin-top:-2rem;width:8rem;height:8rem;border-radius:50%;background:rgba(255,255,255,0.06);filter:blur(40px)"></div>
    </div>`;
}

function renderClientRow(c: OAuthClient): string {
    const initials = (c.name.charAt(0) + (c.name.split(/\s/)[1]?.charAt(0) || c.name.charAt(1) || '')).toUpperCase();

    const statusBadge = c.isActive
        ? `<span style="${S.badge};background:rgba(1,52,124,0.06);color:#01347C">
             <span style="width:6px;height:6px;border-radius:50%;background:#01347C"></span>Aktif
           </span>`
        : `<span style="${S.badge};background:#EDEEEF;color:#64748B">
             <span style="width:6px;height:6px;border-radius:50%;background:#94A3B8"></span>Nonaktif
           </span>`;

    const grantSub = c.grants.map(g => g.replace(/_/g, ' ')).join(' \u2022 ');

    const scopePills = c.scopes.slice(0, 3)
        .map(s => `<span style="display:inline-block;padding:0.125rem 0.5rem;border-radius:0.25rem;font-size:10px;font-weight:600;background:rgba(1,52,124,0.05);color:#354E6B">${s}</span>`)
        .join(' ') + (c.scopes.length > 3
            ? ` <span style="font-size:10px;font-weight:600;color:#94A3B8">+${c.scopes.length - 3}</span>`
            : '');

    const created = new Date(c.createdAt).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
    });

    return `
    <tr class="vault-row" style="${S.row}">
      <td style="padding:1.25rem 1.5rem">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div style="width:2.5rem;height:2.5rem;border-radius:0.5rem;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.875rem;flex-shrink:0;background:rgba(1,52,124,0.06);color:#01347C">${escHtml(initials)}</div>
          <div style="min-width:0">
            <p style="font-weight:700;font-size:0.875rem;color:#191C1D;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.name)}</p>
            <p style="font-size:0.75rem;color:#94A3B8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(grantSub)}</p>
          </div>
        </div>
      </td>
      <td style="padding:1.25rem 1.5rem">${statusBadge}</td>
      <td style="padding:1.25rem 1.5rem">
        <code style="font-size:0.75rem;font-family:ui-monospace,monospace;color:#64748B;user-select:all">${escHtml(c.clientId)}</code>
      </td>
      <td style="padding:1.25rem 1.5rem"><div style="display:flex;flex-wrap:wrap;gap:0.25rem">${scopePills}</div></td>
      <td style="padding:1.25rem 1.5rem;font-size:0.75rem;white-space:nowrap;color:#94A3B8">${created}</td>
      <td style="padding:1.25rem 1.5rem">
        <div class="row-actions" style="display:flex;align-items:center;justify-content:flex-end;gap:0.25rem;opacity:0.3;transition:opacity 200ms">
          <button class="vault-icon-btn" style="padding:0.375rem;border-radius:0.5rem;color:#64748B;cursor:pointer;border:none;background:transparent" data-action="view-logs" data-id="${c.id}" data-name="${escHtml(c.name)}"
                  title="Lihat Log" aria-label="Lihat Log">${iconLog(15)}</button>
          <button class="vault-icon-btn" style="padding:0.375rem;border-radius:0.5rem;color:#64748B;cursor:pointer;border:none;background:transparent" data-action="edit" data-id="${c.id}"
                  title="Edit" aria-label="Edit">${iconEdit(15)}</button>
          <button class="vault-icon-btn" style="padding:0.375rem;border-radius:0.5rem;color:#64748B;cursor:pointer;border:none;background:transparent" data-action="regen" data-id="${c.id}" data-name="${escHtml(c.name)}"
                  title="Regenerasi Secret" aria-label="Regenerasi Secret">${iconRefresh(15)}</button>
          <button class="vault-icon-btn" style="padding:0.375rem;border-radius:0.5rem;color:#DC2626;cursor:pointer;border:none;background:transparent" data-action="delete" data-id="${c.id}" data-name="${escHtml(c.name)}"
                  title="Hapus" aria-label="Hapus">${iconTrash(15)}</button>
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
            const c = state.clients.find(x => x.id === id);
            if (c) openEditModal(c);
        } else if (action === 'delete') {
            openDeleteConfirm(id, name);
        } else if (action === 'regen') {
            openRegenConfirm(id, name);
        } else if (action === 'view-logs') {
            state.logsClientId  = id;
            state.logsClientName = name;
            state.view = 'logs';
            setNavActive('logs');
            await loadLogs(1);
            renderMain();
        }
    });

    paginationListeners('clients', async (p) => { await loadClients(p); renderMain(); });
}

// ─── Logs View ────────────────────────────────────────────────────────────────

const LOG_STYLE: Record<string, { color: string; bg: string }> = {
    LOGIN:           { color: '#01347C', bg: 'rgba(1,52,124,0.06)' },
    LOGIN_LDAP:      { color: '#01347C', bg: 'rgba(1,52,124,0.06)' },
    LOGIN_SPLP:      { color: '#01347C', bg: 'rgba(1,52,124,0.06)' },
    LOGIN_GOOGLE:    { color: '#01347C', bg: 'rgba(1,52,124,0.06)' },
    LOGIN_FACEBOOK:  { color: '#01347C', bg: 'rgba(1,52,124,0.06)' },
    REGISTER:        { color: '#15803D', bg: 'rgba(21,128,61,0.06)' },
    LOGIN_FAILED:    { color: '#DC2626', bg: 'rgba(220,38,38,0.06)' },
    LOGOUT:          { color: '#64748B', bg: 'rgba(100,116,139,0.08)' },
    TOKEN_ISSUED:    { color: '#005598', bg: 'rgba(0,85,152,0.06)' },
    TOKEN_REFRESHED: { color: '#005598', bg: 'rgba(0,85,152,0.06)' },
    TOKEN_REVOKED:   { color: '#B45309', bg: 'rgba(180,83,9,0.06)' },
    CLIENT_CREATED:  { color: '#01347C', bg: 'rgba(1,52,124,0.06)' },
    CLIENT_DELETED:  { color: '#DC2626', bg: 'rgba(220,38,38,0.06)' },
    CLIENT_SECRET_REGENERATED: { color: '#B45309', bg: 'rgba(180,83,9,0.06)' },
};

function renderLogsView(): string {
    const back = state.logsClientId ? `
    <button id="logs-back" style="display:inline-flex;align-items:center;gap:0.375rem;font-size:0.875rem;font-weight:500;cursor:pointer;margin-bottom:1.5rem;color:#005598;background:none;border:none">
      ${iconChevronLeft(16)} Kembali ke Clients
    </button>` : '';

    const title = state.logsClientId
        ? `Log &mdash; <span style="color:#005598">${escHtml(state.logsClientName)}</span>`
        : 'Log Aktivitas';
    const subtitle = state.logsClientId
        ? 'Riwayat aktivitas untuk client ini.'
        : 'Pantau semua aktivitas autentikasi dan manajemen.';

    const header = `
    ${back}
    <header style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1.5rem;margin-bottom:2rem">
      <div>
        <h2 style="font-size:1.875rem;font-weight:800;letter-spacing:-0.025em;margin-bottom:0.375rem;color:#01347C;font-family:'Plus Jakarta Sans',Manrope,sans-serif">${title}</h2>
        <p style="font-size:0.875rem;font-weight:500;color:#64748B">${subtitle}</p>
      </div>
      ${!state.logsClientId ? `
      <div style="display:flex;align-items:center;gap:0.75rem;flex-shrink:0">
        <select id="logs-filter" style="${S.input};width:auto;padding:0.625rem 1rem;cursor:pointer">
          <option value="">Semua Aksi</option>
          ${['LOGIN','LOGIN_FAILED','LOGIN_LDAP','LOGIN_SPLP','LOGIN_GOOGLE','LOGOUT',
             'REGISTER','TOKEN_ISSUED','TOKEN_REFRESHED','TOKEN_REVOKED',
             'CLIENT_CREATED','CLIENT_DELETED','CLIENT_SECRET_REGENERATED']
              .map(a => `<option value="${a}" ${state.logsActionFilter === a ? 'selected' : ''}>${a}</option>`)
              .join('')}
        </select>
        <span style="font-size:0.75rem;font-weight:500;color:#94A3B8">${state.logsMeta.total} entri</span>
      </div>` : ''}
    </header>`;

    if (state.logsLoading) return header + loadingHTML();

    return `${header}
    <div style="${S.card};overflow:hidden">
      <div style="overflow-x:auto">
        <table style="width:100%;text-align:left;border-collapse:collapse" id="logs-table">
          <thead>
            <tr style="background:rgba(1,52,124,0.02)">
              <th style="${S.th}">Waktu</th>
              <th style="${S.th}">Aksi</th>
              <th style="${S.th}">User ID</th>
              <th style="${S.th}">Client ID</th>
              <th style="${S.th}">IP</th>
              <th style="${S.th}">Detail</th>
            </tr>
          </thead>
          <tbody>
            ${state.logs.length === 0
                ? `<tr><td colspan="6">${emptyState('Tidak ada log untuk ditampilkan.')}</td></tr>`
                : state.logs.map(renderLogRow).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination(state.logsMeta, 'logs')}
    </div>`;
}

function renderLogRow(log: AuditLog): string {
    const dt = new Date(log.createdAt).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const s = LOG_STYLE[log.action] ?? { color: '#64748B', bg: 'rgba(100,116,139,0.08)' };
    const detailStr = log.details ? JSON.stringify(log.details) : '\u2014';

    return `
    <tr class="vault-row" style="${S.row}">
      <td style="padding:1rem 1.5rem;white-space:nowrap;font-family:ui-monospace,monospace;font-size:11px;color:#94A3B8">${dt}</td>
      <td style="padding:1rem 1.5rem">
        <span style="${S.badge};white-space:nowrap;background:${s.bg};color:${s.color}">${escHtml(log.action)}</span>
      </td>
      <td style="padding:1rem 1.5rem;font-family:ui-monospace,monospace;font-size:11px;color:#94A3B8">
        ${log.userId ? `<span title="${escHtml(log.userId)}">${log.userId.slice(0, 8)}\u2026</span>` : '\u2014'}
      </td>
      <td style="padding:1rem 1.5rem;font-family:ui-monospace,monospace;font-size:11px;color:#94A3B8">
        ${log.clientId ? `<span title="${escHtml(log.clientId)}">${log.clientId.slice(0, 8)}\u2026</span>` : '\u2014'}
      </td>
      <td style="padding:1rem 1.5rem;font-size:11px;color:#94A3B8">${log.ip ? escHtml(log.ip) : '\u2014'}</td>
      <td style="padding:1rem 1.5rem">
        <div style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:10px;cursor:default;color:#CBD5E1"
             title="${escHtml(detailStr)}">${escHtml(detailStr)}</div>
      </td>
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

    paginationListeners('logs', async (p) => { await loadLogs(p); renderMain(); });
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function renderPagination(
    meta: { page: number; limit: number; total: number; totalPages: number },
    ns: string
): string {
    if (meta.totalPages <= 1 && meta.total === 0) return '';
    const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
    const to   = Math.min(meta.page * meta.limit, meta.total);

    const pages: number[] = [];
    const start = Math.max(1, meta.page - 2);
    const end   = Math.min(meta.totalPages, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);

    const pageBtnBase = 'padding:0.25rem 0.75rem;font-size:0.75rem;font-weight:700;border-radius:0.25rem;border:none;cursor:pointer';
    const pageButtons = pages.map(p => p === meta.page
        ? `<button style="${pageBtnBase};background:#01347C;color:#FFF">${p}</button>`
        : `<button class="${ns}-page" style="${pageBtnBase};background:transparent;color:#354E6B" data-page="${p}">${p}</button>`
    ).join('');

    const navBtn = (disabled: boolean) => `padding:0.25rem;border-radius:0.25rem;border:none;background:transparent;cursor:${disabled ? 'default' : 'pointer'};color:#64748B;opacity:${disabled ? '0.3' : '1'}`;

    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;background:rgba(1,52,124,0.015)">
      <p style="font-size:0.75rem;font-weight:500;color:#94A3B8">
        Menampilkan ${from}\u2013${to} dari <strong style="color:#191C1D">${meta.total}</strong>
      </p>
      <div style="display:flex;align-items:center;gap:0.25rem">
        <button style="${navBtn(meta.page <= 1)}" id="${ns}-prev"
                ${meta.page <= 1 ? 'disabled' : ''}
                aria-label="Sebelumnya">
          ${iconChevronLeft(18)}
        </button>
        ${pageButtons}
        <button style="${navBtn(meta.page >= meta.totalPages)}" id="${ns}-next"
                ${meta.page >= meta.totalPages ? 'disabled' : ''}
                aria-label="Berikutnya">
          ${iconChevronRight(18)}
        </button>
      </div>
    </div>`;
}

function paginationListeners(ns: string, cb: (page: number) => Promise<void>): void {
    const meta = ns === 'clients' ? state.clientsMeta : state.logsMeta;
    document.getElementById(`${ns}-prev`)?.addEventListener('click', async () => {
        if (meta.page > 1) await cb(meta.page - 1);
    });
    document.getElementById(`${ns}-next`)?.addEventListener('click', async () => {
        if (meta.page < meta.totalPages) await cb(meta.page + 1);
    });
    document.querySelectorAll<HTMLElement>(`.${ns}-page`).forEach(btn => {
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
const ALL_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'read', 'write', 'internal', 'government'];

function checkboxGroup(items: string[], name: string, checked: string[]): string {
    return `<div style="display:flex;flex-wrap:wrap;column-gap:1rem;row-gap:0.625rem">
      ${items.map(v => `
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;user-select:none;font-size:0.875rem">
        <input type="checkbox" name="${name}" value="${v}"
          class="admin-checkbox"
          ${checked.includes(v) ? 'checked' : ''}>
        <span style="color:#354E6B">${v.replace(/_/g, ' ')}</span>
      </label>`).join('')}
    </div>`;
}

function openCreateModal(): void {
    openModal(`
    <h3 style="font-size:1.25rem;font-weight:800;margin-bottom:1.5rem;color:#01347C;font-family:'Plus Jakarta Sans',Manrope,sans-serif">
      Tambah OAuth Client
    </h3>

    <div style="display:flex;flex-direction:column;gap:1.25rem">
      <div>
        <label style="${S.label}">Nama Aplikasi <span style="color:#DC2626">*</span></label>
        <input id="f-name" type="text" style="${S.input}" placeholder="Contoh: Portal PANRB">
      </div>

      <div>
        <label style="${S.label}">Redirect URIs <span style="color:#DC2626">*</span></label>
        <textarea id="f-uris" rows="3" style="${S.input};font-family:ui-monospace,monospace;font-size:0.75rem;resize:vertical"
          placeholder="https://app.menpan.go.id/callback"></textarea>
        <p style="font-size:10px;margin-top:0.375rem;color:#94A3B8">Satu URI per baris</p>
      </div>

      <div>
        <label style="${S.label}">Grant Types <span style="color:#DC2626">*</span></label>
        ${checkboxGroup(ALL_GRANTS, 'grant', ['authorization_code'])}
      </div>

      <div>
        <label style="${S.label}">Scopes <span style="color:#DC2626">*</span></label>
        ${checkboxGroup(ALL_SCOPES, 'scope', ['openid', 'profile', 'email', 'offline_access'])}
      </div>

      <div id="create-err" style="display:none;border-radius:0.75rem;padding:0.75rem 1rem;font-size:0.875rem;background:rgba(220,38,38,0.06);color:#DC2626">
        <span id="create-err-msg"></span>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.75rem;margin-top:2rem">
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#64748B;background:transparent;border:none;cursor:pointer" id="modal-cancel">Batal</button>
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#FFF;background:linear-gradient(135deg,#01347C,#005598);border:none;cursor:pointer" id="modal-submit">
        <span id="modal-submit-txt">Buat Client</span>
      </button>
    </div>`);

    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-submit')?.addEventListener('click', async () => {
        const name = (document.getElementById('f-name') as HTMLInputElement).value.trim();
        const uris = (document.getElementById('f-uris') as HTMLTextAreaElement).value
            .split('\n').map(s => s.trim()).filter(Boolean);
        const grants = [...document.querySelectorAll<HTMLInputElement>('input[name="grant"]:checked')].map(e => e.value);
        const scopes = [...document.querySelectorAll<HTMLInputElement>('input[name="scope"]:checked')].map(e => e.value);

        const errEl  = document.getElementById('create-err')!;
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
    openModal(`
    <h3 style="font-size:1.25rem;font-weight:800;margin-bottom:1.5rem;color:#01347C;font-family:'Plus Jakarta Sans',Manrope,sans-serif">
      Edit Client
    </h3>

    <div style="display:flex;flex-direction:column;gap:1.25rem">
      <div>
        <label style="${S.label}">Nama Aplikasi <span style="color:#DC2626">*</span></label>
        <input id="f-name" type="text" style="${S.input}" value="${escHtml(c.name)}">
      </div>

      <div>
        <label style="${S.label}">Redirect URIs <span style="color:#DC2626">*</span></label>
        <textarea id="f-uris" rows="3" style="${S.input};font-family:ui-monospace,monospace;font-size:0.75rem;resize:vertical"
        >${escHtml(c.redirectUris.join('\n'))}</textarea>
        <p style="font-size:10px;margin-top:0.375rem;color:#94A3B8">Satu URI per baris</p>
      </div>

      <div>
        <label style="${S.label}">Grant Types <span style="color:#DC2626">*</span></label>
        ${checkboxGroup(ALL_GRANTS, 'grant', c.grants)}
      </div>

      <div>
        <label style="${S.label}">Scopes <span style="color:#DC2626">*</span></label>
        ${checkboxGroup(ALL_SCOPES, 'scope', c.scopes)}
      </div>

      <div id="create-err" style="display:none;border-radius:0.75rem;padding:0.75rem 1rem;font-size:0.875rem;background:rgba(220,38,38,0.06);color:#DC2626">
        <span id="create-err-msg"></span>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.75rem;margin-top:2rem">
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#64748B;background:transparent;border:none;cursor:pointer" id="modal-cancel">Batal</button>
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#FFF;background:linear-gradient(135deg,#01347C,#005598);border:none;cursor:pointer" id="modal-submit">
        <span id="modal-submit-txt">Simpan</span>
      </button>
    </div>`);

    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-submit')?.addEventListener('click', async () => {
        const name   = (document.getElementById('f-name') as HTMLInputElement).value.trim();
        const uris   = (document.getElementById('f-uris') as HTMLTextAreaElement).value.split('\n').map(s => s.trim()).filter(Boolean);
        const grants = [...document.querySelectorAll<HTMLInputElement>('input[name="grant"]:checked')].map(e => e.value);
        const scopes = [...document.querySelectorAll<HTMLInputElement>('input[name="scope"]:checked')].map(e => e.value);

        const errEl  = document.getElementById('create-err')!;
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
    openModal(`
    <div style="text-align:center;padding:0.5rem 0">
      <div style="width:3.5rem;height:3.5rem;border-radius:1rem;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;background:rgba(220,38,38,0.06)">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.5" style="color:#DC2626">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <h3 style="font-size:1.25rem;font-weight:800;margin-bottom:0.5rem;color:#191C1D;font-family:'Plus Jakarta Sans',Manrope,sans-serif">Hapus Client?</h3>
      <p style="font-size:0.875rem;margin-bottom:0.25rem;color:#64748B">
        Yakin ingin menghapus <strong style="color:#191C1D">${escHtml(name)}</strong>?
      </p>
      <p style="font-size:0.75rem;color:#94A3B8">Semua token aktif untuk client ini akan ikut dihapus.</p>
    </div>
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem">
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#64748B;background:transparent;border:none;cursor:pointer" id="modal-cancel">Batal</button>
      <button style="padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#fff;cursor:pointer;border:none;background:#DC2626" id="modal-submit">
        <span id="modal-submit-txt">Hapus</span>
      </button>
    </div>`);

    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-submit')?.addEventListener('click', async () => {
        setSubmitLoading(true);
        const r = await apiRequest(`${endpoints.clients}/${id}`, { method: 'DELETE' });
        setSubmitLoading(false);
        if (!r.success) { showToast(r.error ?? 'Gagal menghapus.', 'error'); return; }
        closeModal();
        showToast('Client dihapus.', 'success');
        await loadClients(Math.max(1, state.clients.length === 1 ? state.clientsMeta.page - 1 : state.clientsMeta.page));
        renderMain();
    });
}

// ─── Regenerate Secret ────────────────────────────────────────────────────────

function openRegenConfirm(id: string, name: string): void {
    openModal(`
    <div style="text-align:center;padding:0.5rem 0">
      <div style="width:3.5rem;height:3.5rem;border-radius:1rem;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;background:rgba(180,83,9,0.06)">
        <span style="color:#B45309">${iconRefresh(28)}</span>
      </div>
      <h3 style="font-size:1.25rem;font-weight:800;margin-bottom:0.5rem;color:#191C1D;font-family:'Plus Jakarta Sans',Manrope,sans-serif">Regenerasi Secret?</h3>
      <p style="font-size:0.875rem;margin-bottom:0.25rem;color:#64748B">
        Regenerasi secret untuk <strong style="color:#191C1D">${escHtml(name)}</strong>.
      </p>
      <p style="font-size:0.75rem;color:#94A3B8">Secret lama langsung tidak berlaku.</p>
    </div>
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem">
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#64748B;background:transparent;border:none;cursor:pointer" id="modal-cancel">Batal</button>
      <button style="padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#fff;cursor:pointer;border:none;background:#B45309" id="modal-submit">
        <span id="modal-submit-txt">Regenerasi</span>
      </button>
    </div>`);

    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-submit')?.addEventListener('click', async () => {
        setSubmitLoading(true);
        const r = await apiRequest<OAuthClient>(`${endpoints.clients}/${id}/regenerate-secret`, { method: 'POST' });
        setSubmitLoading(false);
        if (!r.success) { showToast(r.error ?? 'Gagal regenerasi.', 'error'); return; }
        closeModal();
        if (r.data?.clientSecret) {
            const client = state.clients.find(c => c.id === id);
            showSecretModal(client?.clientId ?? id, r.data.clientSecret);
        }
    });
}

// ─── Secret reveal ────────────────────────────────────────────────────────────

function showSecretModal(clientId: string, secret: string): void {
    openModal(`
    <h3 style="font-size:1.25rem;font-weight:800;margin-bottom:1.25rem;color:#01347C;font-family:'Plus Jakarta Sans',Manrope,sans-serif">
      Client Secret
    </h3>

    <div style="border-radius:0.75rem;padding:0.75rem 1rem;margin-bottom:1.25rem;display:flex;align-items:flex-start;gap:0.75rem;font-size:0.875rem;background:rgba(180,83,9,0.06);color:#B45309">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:0.125rem">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>Simpan secret ini sekarang \u2014 <strong>tidak akan ditampilkan lagi</strong>.</span>
    </div>

    <div style="display:flex;flex-direction:column;gap:1rem">
      <div>
        <p style="${S.label}">Client ID</p>
        <div style="${S.input};background:#F0F1F3;color:#64748B;padding:0.625rem 1rem;font-family:ui-monospace,monospace;font-size:0.75rem;user-select:all">
          ${escHtml(clientId)}
        </div>
      </div>
      <div>
        <p style="${S.label}">Client Secret</p>
        <div id="secret-box"
          style="${S.input};background:#F0F1F3;color:#01347C;font-weight:700;padding:0.625rem 1rem;height:auto;font-family:ui-monospace,monospace;font-size:0.75rem;user-select:all;word-break:break-all">
          ${escHtml(secret)}
        </div>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem">
      <button id="btn-copy-secret" style="display:inline-flex;align-items:center;justify-content:center;gap:0.375rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#64748B;background:transparent;border:none;cursor:pointer">${iconCopy(14)} Salin Secret</button>
      <button style="display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.625rem 1.25rem;border-radius:0.75rem;font-size:0.875rem;font-weight:600;color:#FFF;background:linear-gradient(135deg,#01347C,#005598);border:none;cursor:pointer" id="modal-cancel">Sudah Disimpan</button>
    </div>`);

    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('btn-copy-secret')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(secret);
        const btn = document.getElementById('btn-copy-secret')!;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:#15803D"><polyline points="20 6 9 17 4 12"/></svg> Tersalin!`;
        btn.style.color = '#15803D';
    });
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const toast = document.getElementById('admin-toast');
    const alert = document.getElementById('admin-toast-alert');
    if (!toast || !alert) return;

    const styles: Record<string, { bg: string; color: string }> = {
        success: { bg: 'rgba(21,128,61,0.06)', color: '#15803D' },
        error:   { bg: 'rgba(220,38,38,0.06)', color: '#DC2626' },
        info:    { bg: 'rgba(1,52,124,0.06)',   color: '#01347C' },
    };
    const s = styles[type] ?? styles.info;
    alert.style.cssText = `border-radius:0.75rem;padding:0.75rem 1.25rem;font-size:0.875rem;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.1);background:${s.bg};color:${s.color};border:1px solid rgba(1,52,124,0.06)`;
    alert.innerHTML = `<span>${escHtml(msg)}</span>`;
    toast.style.display = 'flex';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setSubmitLoading(loading: boolean): void {
    const btn = document.getElementById('modal-submit') as HTMLButtonElement | null;
    const lbl = document.getElementById('modal-submit-txt');
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.6' : '1';
    if (lbl) lbl.textContent = loading ? 'Memproses...' : lbl.textContent ?? '';
}

function loadingHTML(): string {
    return `<div style="display:flex;align-items:center;justify-content:center;padding:5rem 0">
      <div class="admin-spinner"></div>
    </div>`;
}

function emptyState(msg: string): string {
    return `<div style="padding:4rem 0;text-align:center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1" style="color:#CBD5E1;margin:0 auto 0.75rem">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p style="font-size:0.875rem;font-weight:500;color:#94A3B8">${msg}</p>
    </div>`;
}

function escHtml(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

const svg = (body: string, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const iconMonitor   = (s=16) => svg(`<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`,s);
const iconLog       = (s=16) => svg(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,s);
const iconLogout    = (s=14) => svg(`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,s);
const iconEdit      = (s=14) => svg(`<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,s);
const iconTrash     = (s=14) => svg(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>`,s);
const iconRefresh   = (s=14) => svg(`<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,s);
const iconPlus      = (s=16) => svg(`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,s);
const iconCopy      = (s=14) => svg(`<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,s);
const iconChevronLeft  = (s=14) => svg(`<polyline points="15 18 9 12 15 6"/>`,s);
const iconChevronRight = (s=14) => svg(`<polyline points="9 18 15 12 9 6"/>`,s);
