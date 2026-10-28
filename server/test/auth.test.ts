import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { hashPassword, isPasswordHash, verifyPassword } from '../src/lib/password.ts';
import { TEST_PASSWORD, makeTestApp } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
});
afterEach(async () => {
  await ctx.cleanup();
});

async function login(deviceName = 'Firefox') {
  return ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: TEST_PASSWORD, deviceName } });
}

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('Secret', hash)).toBe(false);
    expect(await verifyPassword('secret', 'garbage')).toBe(false);
  });

  it('spots a hash mangled by "$" substitution and accepts quoted values', async () => {
    const hash = await hashPassword('secret');
    expect(isPasswordHash(hash)).toBe(true);
    // What Docker Compose makes of an unquoted hash: "$<salt>" and "$<key>" become empty.
    expect(isPasswordHash(hash.split('$').slice(0, 4).join('$') + '$$')).toBe(false);
    expect(loadConfig({ APP_PASSWORD_HASH: `'${hash}'` }).passwordHash).toBe(hash);
    expect(loadConfig({ APP_PASSWORD_HASH: hash }).passwordHash).toBe(hash);
  });
});

describe('auth', () => {
  it('health is public', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('rejects API calls without a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/devices' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'nope', deviceName: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('issues a device token that unlocks the API until revoked', async () => {
    const { token } = (await login()).json();
    const headers = { authorization: `Bearer ${token}` };

    const devices = await ctx.app.inject({ method: 'GET', url: '/api/v1/devices', headers });
    expect(devices.statusCode).toBe(200);
    expect(devices.json()).toEqual([expect.objectContaining({ name: 'Firefox', current: true })]);

    const logout = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
    expect(logout.statusCode).toBe(200);
    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/devices', headers });
    expect(after.statusCode).toBe(401);
  });

  it('can revoke another device', async () => {
    const pc = (await login('PC')).json();
    const other = (await login('Firefox')).json();
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${other.deviceId}`,
      headers: { authorization: `Bearer ${pc.token}` },
    });
    expect(res.statusCode).toBe(200);
    const otherCall = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(otherCall.statusCode).toBe(401);
  });
});
