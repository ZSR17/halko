import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Crop } from '@halko/shared';
import sharp, { type OutputInfo } from 'sharp';
import type { Db } from '../db/index.ts';
import { media } from '../db/schema.ts';

const IMAGE_MAX_SIZE = 480;
const IMAGE_QUALITY = 75;
// Uploaded videos and GIFs: 480p, 24 fps, no sound, first 15 seconds, H.264 CRF 28 (~0.3-0.8 MB).
const VIDEO_MAX_SIDE = 480;
const VIDEO_MAX_SECONDS = 15;

const run = promisify(execFile);

export function mediaDir(dataDir: string): string {
  return path.join(dataDir, 'media');
}

// Files live in media/<first 2 hex chars>/<sha256>.<ext> to keep directories small.
// Always "/"-separated: it is also handed to @fastify/static, which rejects "\" on Windows.
export function mediaRelPath(id: string, ext: string): string {
  return path.posix.join(id.slice(0, 2), `${id}.${ext}`);
}

export class UnsupportedMedia extends Error {}
export class TranscoderUnavailable extends Error {}

interface FileInfo {
  mime: 'image/webp' | 'video/mp4';
  width?: number;
  height?: number;
  durationMs?: number;
}

// Stores already-compressed bytes once: the name is their hash, so duplicates are free.
async function saveFile(db: Db, dataDir: string, data: Buffer, info: FileInfo): Promise<string> {
  const id = createHash('sha256').update(data).digest('hex');
  const file = path.join(mediaDir(dataDir), mediaRelPath(id, info.mime === 'video/mp4' ? 'mp4' : 'webp'));
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
  db.insert(media)
    .values({
      id,
      mime: info.mime,
      bytes: data.length,
      width: info.width ?? null,
      height: info.height ?? null,
      durationMs: info.durationMs ?? null,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
  return id;
}

// Compresses an image to a small WebP, keeping only `crop` of it when given (taken from the full-size
// picture, so cropping costs no quality).
export async function storeImage(db: Db, dataDir: string, input: Buffer, crop?: Crop): Promise<string> {
  let out: { data: Buffer; info: OutputInfo };
  try {
    let image = sharp(input).rotate();
    if (crop) {
      const upright = await image.toBuffer({ resolveWithObject: true });
      const { width, height } = upright.info;
      const left = Math.min(width - 1, Math.round(crop.x * width));
      const top = Math.min(height - 1, Math.round(crop.y * height));
      image = sharp(upright.data).extract({
        left,
        top,
        width: Math.max(1, Math.min(width - left, Math.round(crop.w * width))),
        height: Math.max(1, Math.min(height - top, Math.round(crop.h * height))),
      });
    }
    out = await image
      .resize({ width: IMAGE_MAX_SIZE, height: IMAGE_MAX_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: IMAGE_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new UnsupportedMedia('image');
  }
  return saveFile(db, dataDir, out.data, { mime: 'image/webp', width: out.info.width, height: out.info.height });
}

interface Tools {
  ffmpegPath: string;
  ffprobePath: string;
}

async function tool(bin: string, args: string[], encoding: 'buffer' | 'utf8' = 'utf8') {
  try {
    return (await run(bin, args, { encoding, maxBuffer: 32 * 1024 * 1024 })).stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new TranscoderUnavailable(bin);
    throw new UnsupportedMedia('video');
  }
}

// Converts a video or an animated GIF to a short silent MP4, plus a poster image for lists.
// Returns [video id, poster id]. The uploaded original is never kept.
async function storeVideo(db: Db, dataDir: string, input: Buffer, tools: Tools): Promise<string[]> {
  const tmp = path.join(dataDir, 'tmp');
  await fs.mkdir(tmp, { recursive: true });
  const src = path.join(tmp, `${randomUUID()}.in`);
  const dst = path.join(tmp, `${randomUUID()}.mp4`);
  try {
    await fs.writeFile(src, input);
    // Short side at most 480 px, even sizes for H.264, landscape or portrait alike.
    const side = `trunc(min(${VIDEO_MAX_SIDE},%s)/2)*2`;
    const scale = `scale='if(lt(iw,ih),${side.replace('%s', 'iw')},-2)':'if(lt(iw,ih),-2,${side.replace('%s', 'ih')})'`;
    await tool(tools.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-t', String(VIDEO_MAX_SECONDS), '-an',
      '-vf', `${scale},fps=24,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', '+faststart',
      dst,
    ]);
    const probe = JSON.parse(
      String(
        await tool(tools.ffprobePath, [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height:format=duration', '-of', 'json', dst,
        ]),
      ),
    ) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const poster = (await tool(
      tools.ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-i', dst, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'],
      'buffer',
    )) as Buffer;
    const video = await fs.readFile(dst);
    const stream = probe.streams?.[0];
    const videoId = await saveFile(db, dataDir, video, {
      mime: 'video/mp4',
      width: stream?.width,
      height: stream?.height,
      durationMs: probe.format?.duration ? Math.round(Number(probe.format.duration) * 1000) : undefined,
    });
    return [videoId, await storeImage(db, dataDir, poster)];
  } finally {
    await fs.rm(src, { force: true });
    await fs.rm(dst, { force: true });
  }
}

// Videos and animated GIFs (stored as videos) move; any other picture is a still photo.
export async function isMotion(input: Buffer, mime: string): Promise<boolean> {
  if (mime.startsWith('video/')) return true;
  if (mime !== 'image/gif') return false;
  const pages = await sharp(input)
    .metadata()
    .then((m) => m.pages ?? 1)
    .catch(() => 1);
  return pages > 1;
}

// Photos become WebP (cropped to `crop` if given); videos and animated GIFs become MP4 with a poster image.
export async function storeUpload(db: Db, dataDir: string, input: Buffer, mime: string, tools: Tools, crop?: Crop): Promise<string[]> {
  if (!mime.startsWith('image/') && !mime.startsWith('video/')) throw new UnsupportedMedia(mime);
  if (await isMotion(input, mime)) return storeVideo(db, dataDir, input, tools);
  return [await storeImage(db, dataDir, input, crop)];
}
