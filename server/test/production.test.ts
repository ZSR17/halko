import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, backupDatabase } from '../src/storage.ts';
import { makeTestApp, tempDir } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => {
  await ctx.cleanup();
});

// A fake client build: shell and a hashed asset.
function fakeDist(): string {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Halko</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  return dir;
}

describe('production', () => {
  it('serves the app, its client-side routes and the right cache headers', async () => {
    ctx = await makeTestApp({ STATIC_DIR: fakeDist() });
    const shell = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('Halko');
    expect(shell.headers['cache-control']).toBe('no-cache');

    const route = await ctx.app.inject({ method: 'GET', url: '/workouts/123' });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('Halko');

    expect((await ctx.app.inject({ method: 'GET', url: '/assets/index-abc123.js' })).headers['cache-control']).toContain('immutable');

    // API and media misses stay JSON 404s, never the app shell.
    const api = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
    const media = await ctx.app.inject({ method: 'GET', url: '/media/nope' });
    expect(media.statusCode).toBe(404);
    expect(media.json()).toEqual({ error: 'not_found' });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health' })).json().ok).toBe(true);
  });

  it('backs up the database once a day and keeps the last ones', async () => {
    ctx = await makeTestApp();
    const day = (d: number) => new Date(Date.UTC(2026, 0, d));
    for (let d = 1; d <= 10; d++) await backupDatabase(ctx.db, ctx.dataDir, day(d));
    // Same day again: nothing new.
    expect(await backupDatabase(ctx.db, ctx.dataDir, day(10))).toBeNull();
    const files = fs.readdirSync(path.join(ctx.dataDir, 'backups')).sort();
    expect(files).toHaveLength(BACKUPS_KEPT);
    expect(files.at(-1)).toBe('halko-2026-01-10.db');
    expect(fs.statSync(path.join(ctx.dataDir, 'backups', files[0]!)).size).toBeGreaterThan(0);
  });
});
