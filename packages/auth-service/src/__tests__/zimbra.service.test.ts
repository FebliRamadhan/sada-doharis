import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zimbraService } from '../services/zimbra.service.js';

/**
 * ChangePasswordRequest Zimbra (docs/adr/0002): akun + password lama user,
 * tanpa token admin. Fault Zimbra yang bisa diperbaiki user harus menjadi
 * pesan yang menempel di isian form yang tepat; sisanya 503 tanpa membocorkan
 * pesan mentah Zimbra.
 */
const fetchMock = vi.fn();

function fault(code: string, status = 500) {
  return new Response(
    JSON.stringify({
      Body: { Fault: { Reason: { Text: `raw ${code}` }, Detail: { Error: { Code: code } } } },
    }),
    { status }
  );
}

beforeEach(() => {
  process.env['ZIMBRA_SOAP_URL'] = 'https://mail.example.go.id/service/soap';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('zimbraService.changePassword', () => {
  it('mengirim ChangePasswordRequest atas nama user, tanpa authToken admin', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ Body: { ChangePasswordResponse: { authToken: [] } } }))
    );
    await zimbraService.changePassword('budi@menpan.go.id', 'lama', 'baru');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://mail.example.go.id/service/soap');
    const sent = JSON.parse(init.body as string);
    expect(sent.Header.context.authToken).toBeUndefined();
    expect(sent.Body.ChangePasswordRequest).toMatchObject({
      _jsns: 'urn:zimbraAccount',
      account: { by: 'name', _content: 'budi@menpan.go.id' },
      oldPassword: { _content: 'lama' },
      password: { _content: 'baru' },
    });
  });

  it.each([
    ['account.AUTH_FAILED', 'old_password'],
    ['account.PASSWORD_RECENTLY_USED', 'new_password'],
    ['account.PASSWORD_CHANGE_TOO_SOON', 'new_password'],
    ['account.INVALID_PASSWORD', 'new_password'],
  ])('%s menjadi 422 pada isian %s', async (code, field) => {
    fetchMock.mockResolvedValue(fault(code));
    const err = await zimbraService.changePassword('a@b.c', 'x', 'y').catch((e) => e);
    expect(err.statusCode).toBe(422);
    expect(err.details[field]).toBeDefined();
    expect(err.message).not.toContain('raw');
  });

  it('fault lain menjadi 503 tanpa pesan mentah Zimbra', async () => {
    fetchMock.mockResolvedValue(fault('service.FAILURE'));
    const err = await zimbraService.changePassword('a@b.c', 'x', 'y').catch((e) => e);
    expect(err.statusCode).toBe(503);
    expect(err.message).not.toContain('raw');
  });

  it('Zimbra tidak terjangkau menjadi 503', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const err = await zimbraService.changePassword('a@b.c', 'x', 'y').catch((e) => e);
    expect(err.statusCode).toBe(503);
  });

  it('tanpa ZIMBRA_SOAP_URL tidak pernah mencoba menghubungi apa pun', async () => {
    delete process.env['ZIMBRA_SOAP_URL'];
    const err = await zimbraService.changePassword('a@b.c', 'x', 'y').catch((e) => e);
    expect(err.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
