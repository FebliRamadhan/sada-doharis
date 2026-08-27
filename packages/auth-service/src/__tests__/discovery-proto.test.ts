import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Discovery OIDC menyusun seluruh alamatnya dari `req.protocol`. TLS
 * diterminasi di reverse proxy, jadi tanpa `trust proxy` nilainya selalu
 * 'http' — dan klien yang patuh akan mengirim `client_secret` miliknya ke
 * `http://.../oauth/token` sebagai teks polos.
 *
 * Kebocorannya senyap: alurnya tetap berhasil, sehingga tidak ada yang memberi
 * tahu. Karena itu perilakunya dikunci di sini.
 *
 * Memakai server sungguhan + fetch (pola tes integrasi repo ini), bukan
 * supertest, agar tidak menambah dependensi hanya demi satu berkas tes.
 */
function buildApp(trustProxy: boolean) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.get('/oauth/.well-known/openid-configuration', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ issuer: baseUrl, token_endpoint: `${baseUrl}/oauth/token` });
  });
  return app;
}

function listen(app: express.Express): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe('discovery OIDC — skema yang diiklankan', () => {
  let dipercaya: { server: Server; port: number };
  let tidakDipercaya: { server: Server; port: number };

  beforeAll(async () => {
    dipercaya = await listen(buildApp(true));
    tidakDipercaya = await listen(buildApp(false));
  });

  afterAll(async () => {
    dipercaya.server.close();
    tidakDipercaya.server.close();
  });

  const ambil = async (port: number, headers: Record<string, string>) => {
    const r = await fetch(`http://127.0.0.1:${port}/oauth/.well-known/openid-configuration`, {
      headers,
    });
    return r.json() as Promise<{ issuer: string; token_endpoint: string }>;
  };

  it('menghormati X-Forwarded-Proto saat proxy dipercaya', async () => {
    const d = await ambil(dipercaya.port, { 'X-Forwarded-Proto': 'https' });
    // Host tidak diuji: fetch selalu menuliskannya sendiri dari URL. Yang
    // menentukan bocor-tidaknya client_secret adalah SKEMA-nya.
    expect(d.issuer.startsWith('https://')).toBe(true);
    expect(d.token_endpoint.startsWith('https://')).toBe(true);
  });

  it('token_endpoint TIDAK pernah http saat permintaan datang lewat https', async () => {
    const d = await ambil(dipercaya.port, { 'X-Forwarded-Proto': 'https' });
    // Inilah alamat yang menerima client_secret. Ia tidak boleh plaintext.
    expect(d.token_endpoint.startsWith('http://')).toBe(false);
  });

  it('membuktikan regresinya: tanpa trust proxy, https diiklankan sebagai http', async () => {
    const d = await ambil(tidakDipercaya.port, { 'X-Forwarded-Proto': 'https' });
    expect(d.issuer.startsWith('http://')).toBe(true);
  });

  it('permintaan http asli tetap diiklankan http (bukan dipaksa https)', async () => {
    const d = await ambil(dipercaya.port, {});
    expect(d.issuer.startsWith('http://')).toBe(true);
  });
});
