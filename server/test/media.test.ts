import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextRev } from '../src/db/index.ts';
import { exercises, media } from '../src/db/schema.ts';
import { mediaDir, mediaRelPath, storeImage } from '../src/lib/media.ts';
import { CLEANUP_GRACE_MS, cleanupMedia } from '../src/storage.ts';
import { TEST_PASSWORD, makeTestApp, tempDir } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.cleanup();
});

async function start(env: Record<string, string> = {}) {
  ctx = await makeTestApp(env);
  const { token } = (
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: TEST_PASSWORD, deviceName: 'A' } })
  ).json();
  return { authorization: `Bearer ${token}` };
}

const upload = (headers: Record<string, string>, body: Buffer, type: string) =>
  ctx.app.inject({ method: 'POST', url: '/api/v1/media', headers: { ...headers, 'content-type': type }, payload: body });

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('media', () => {
  it('compresses uploaded photos to small WebP files', async () => {
    const headers = await start();
    const jpg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3a86ff' } }).jpeg().toBuffer();
    const res = await upload(headers, jpg, 'image/jpeg');
    expect(res.statusCode).toBe(200);
    const { ids, urls } = res.json();
    expect(urls).toEqual([`/media/${ids[0]}.webp`]);
    const row = ctx.db.select().from(media).get()!;
    expect(row).toMatchObject({ mime: 'image/webp', width: 480, height: 320 });

    // Same picture again: stored once.
    expect((await upload(headers, jpg, 'image/jpeg')).json().ids).toEqual(ids);
    expect(ctx.db.select().from(media).all()).toHaveLength(1);
  });

  it('stores a picture from a link, and refuses links to private addresses', async () => {
    const headers = await start();
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff4d2e' } }).png().toBuffer();
    // Stand-in for the remote site; an IP address avoids a DNS lookup.
    const remote = vi.fn(async (url: URL) => {
      if (url.pathname === '/photo.png') return new Response(png, { headers: { 'content-type': 'image/png' } });
      if (url.pathname === '/page') return new Response('<html>', { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/moved') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.png' } });
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', remote);
    const fromUrl = (url: string) => ctx.app.inject({ method: 'POST', url: '/api/v1/media/from-url', headers, payload: { url } });

    const ok = await fromUrl('https://93.184.216.34/photo.png');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().urls).toEqual([`/media/${ok.json().ids[0]}.webp`]);
    expect(ctx.db.select().from(media).get()).toMatchObject({ mime: 'image/webp', width: 480, height: 360 });

    expect((await fromUrl('https://93.184.216.34/page')).statusCode).toBe(415);
    expect((await fromUrl('https://93.184.216.34/missing.png')).statusCode).toBe(502);
    expect((await fromUrl('ftp://93.184.216.34/photo.png')).statusCode).toBe(400);
    expect((await fromUrl('not an address')).statusCode).toBe(400);
    // Private networks, directly or through a redirect, are never fetched.
    const calls = remote.mock.calls.length;
    expect((await fromUrl('http://192.168.1.1/photo.png')).statusCode).toBe(400);
    expect((await fromUrl('http://[::1]/photo.png')).statusCode).toBe(400);
    expect(remote.mock.calls.length).toBe(calls);
    expect((await fromUrl('https://93.184.216.34/moved')).statusCode).toBe(400);
    expect(remote.mock.calls.map(([u]) => String(u))).not.toContain('http://127.0.0.1/secret.png');
  });

  it('takes GIFs and videos from a link too, and asks to frame a still photo first', async () => {
    // Without ffmpeg, a moving picture is answered 503: that shows it went to the video conversion.
    const headers = await start({ FFMPEG_PATH: path.join(tempDir(), 'missing-ffmpeg') });
    const frame = (color: string) => sharp({ create: { width: 20, height: 20, channels: 3, background: color } }).png().toBuffer();
    const gif = await sharp([await frame('#ff0000'), await frame('#0000ff')], { join: { animated: true } }).gif().toBuffer();
    const png = await frame('#00ff00');
    vi.stubGlobal('fetch', async (url: URL) => {
      if (url.pathname === '/move.gif') return new Response(gif, { headers: { 'content-type': 'image/gif' } });
      if (url.pathname === '/clip') return new Response(gif, { headers: { 'content-type': 'application/octet-stream' } });
      if (url.pathname === '/blob') return new Response('hello', { headers: { 'content-type': 'application/octet-stream' } });
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    });
    const fromUrl = (url: string, frameFirst?: boolean) =>
      ctx.app.inject({ method: 'POST', url: '/api/v1/media/from-url', headers, payload: { url, frameFirst } });

    expect((await fromUrl('https://93.184.216.34/move.gif', true)).statusCode).toBe(503);
    // Sent as plain binary data: recognised from its first bytes.
    expect((await fromUrl('https://93.184.216.34/clip', true)).statusCode).toBe(503);
    expect((await fromUrl('https://93.184.216.34/blob', true)).json()).toEqual({ error: 'not_media' });

    const still = await fromUrl('https://93.184.216.34/photo.png', true);
    expect([still.statusCode, still.json()]).toEqual([422, { error: 'needs_framing' }]);
    expect(ctx.db.select().from(media).all()).toHaveLength(0);
    expect((await fromUrl('https://93.184.216.34/photo.png')).statusCode).toBe(200);
  });

  it('crops photos to the part chosen in the app before compressing them', async () => {
    const headers = await start();
    // Left half red, right half blue: keeping the right third must give only blue.
    const left = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const img = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#0000ff' } })
      .composite([{ input: left, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/media?crop=0.6,0.2,0.4,0.6',
      headers: { ...headers, 'content-type': 'image/png' },
      payload: img,
    });
    expect(res.statusCode).toBe(200);
    // 480 x 540 kept, then reduced to fit 480 px.
    const row = ctx.db.select().from(media).get()!;
    expect([row.width, row.height]).toEqual([427, 480]);
    const file = path.join(mediaDir(ctx.dataDir), mediaRelPath(row.id, 'webp'));
    const { dominant } = await sharp(fs.readFileSync(file)).stats();
    expect(dominant.b).toBeGreaterThan(200);
    expect(dominant.r).toBeLessThan(50);

    vi.stubGlobal('fetch', async () => new Response(img, { headers: { 'content-type': 'image/png' } }));
    const fromLink = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/media/from-url',
      headers,
      payload: { url: 'https://93.184.216.34/a.png', crop: { x: 0, y: 0, w: 0.5, h: 2 / 3 } },
    });
    expect(fromLink.statusCode).toBe(200);
    expect(ctx.db.select().from(media).all().find((m) => m.id === fromLink.json().ids[0])).toMatchObject({ width: 480, height: 480 });

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/media?crop=0.8,0,0.5,1',
      headers: { ...headers, 'content-type': 'image/png' },
      payload: img,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('refuses files that are not photos or videos', async () => {
    const headers = await start();
    expect((await upload(headers, Buffer.from('hello'), 'text/plain')).statusCode).toBe(415);
    expect((await upload(headers, Buffer.from('not a picture'), 'image/png')).statusCode).toBe(415);
    const anonymous = await ctx.app.inject({ method: 'POST', url: '/api/v1/media', headers: { 'content-type': 'image/png' }, payload: Buffer.from('x') });
    expect(anonymous.statusCode).toBe(401);
  });

  it('says when video conversion is not installed', async () => {
    const headers = await start({ FFMPEG_PATH: path.join(tempDir(), 'missing-ffmpeg') });
    expect((await upload(headers, Buffer.from('fake video'), 'video/mp4')).statusCode).toBe(503);
  });

  it.skipIf(!hasFfmpeg)('converts a video to a short, light 480p MP4 with a poster', async () => {
    const headers = await start();
    const src = path.join(tempDir(), 'in.mp4');
    // 20 s of 1080p test pattern with sound.
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine',
      '-t', '20', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-shortest', src,
    ]);
    const res = await upload(headers, fs.readFileSync(src), 'video/mp4');
    expect(res.statusCode).toBe(200);
    const { ids, urls } = res.json();
    expect(urls).toEqual([`/media/${ids[0]}.mp4`, `/media/${ids[1]}.webp`]);
    const video = ctx.db.select().from(media).all().find((m) => m.id === ids[0])!;
    expect(video).toMatchObject({ mime: 'video/mp4', height: 480, width: 854 });
    expect(video.durationMs).toBeLessThanOrEqual(15_100);
    expect(video.bytes).toBeLessThan(fs.statSync(src).size / 4);
    const served = await ctx.app.inject({ method: 'GET', url: urls[0] });
    expect(served.headers['content-type']).toBe('video/mp4');
  });

  it('deletes media no exercise uses anymore, after a grace period', async () => {
    const headers = await start();
    const img = (color: string) => sharp({ create: { width: 10, height: 10, channels: 3, background: color } }).png().toBuffer();
    const used = await storeImage(ctx.db, ctx.dataDir, await img('#f00'));
    const unused = await storeImage(ctx.db, ctx.dataDir, await img('#0f0'));
    const T = Date.now();
    ctx.db
      .insert(exercises)
      .values({
        id: 'e', userId: null, source: 'builtin', sourceRef: 'e', name: 'e', sport: 'strength', exerciseType: 'bw_reps',
        category: null, level: null, equipment: [], primaryMuscles: [], secondaryMuscles: [], instructions: [],
        mediaIds: [used], createdAt: T, updatedAt: T, rev: nextRev(ctx.db),
      })
      .run();

    // Fresh uploads may not be attached yet.
    expect((await cleanupMedia(ctx.db, ctx.dataDir)).files).toBe(0);
    const later = T + CLEANUP_GRACE_MS + 1000;
    expect((await cleanupMedia(ctx.db, ctx.dataDir, later)).files).toBe(1);
    expect(ctx.db.select().from(media).all().map((m) => m.id)).toEqual([used]);
    expect(fs.existsSync(path.join(mediaDir(ctx.dataDir), mediaRelPath(unused, 'webp')))).toBe(false);
    expect(fs.existsSync(path.join(mediaDir(ctx.dataDir), mediaRelPath(used, 'webp')))).toBe(true);

    const storage = (await ctx.app.inject({ method: 'GET', url: '/api/v1/storage', headers })).json();
    expect(storage.media.files).toBe(1);
    expect(storage.databaseBytes).toBeGreaterThan(0);
  });
});
