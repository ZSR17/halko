import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { MAX_UPLOAD_BYTES } from '@halko/shared';

// Downloads a picture, GIF or video from a link pasted in the app, for the server to store it like an upload.
// The server sits on a private network: a link must not make it fetch something inside it (router,
// other services), so private, loopback and link-local addresses are refused, after every redirect.

// Pictures are small; GIFs and videos may weigh as much as an uploaded file.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;
// Some sites refuse requests that do not say who they come from.
const USER_AGENT = 'Mozilla/5.0 (compatible; Halko; +https://github.com/ZSR17/halko)';

export class MediaFetchError extends Error {
  constructor(readonly reason: 'invalid_url' | 'fetch_failed' | 'not_media' | 'too_large') {
    super(reason);
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

function isPublic(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const ip = mapped ?? address;
  return !blocked.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaFetchError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new MediaFetchError('invalid_url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new MediaFetchError('fetch_failed');
  if (!addresses.every(isPublic)) throw new MediaFetchError('invalid_url');
  return url;
}

// Some sites send videos as plain binary data: their first bytes tell what they are.
function sniff(data: Buffer): string {
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (data.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  return '';
}

const BINARY = new Set(['application/octet-stream', 'binary/octet-stream']);
const isMedia = (mime: string) => mime.startsWith('image/') || mime.startsWith('video/');
const maxBytes = (mime: string) => (mime.startsWith('image/') && mime !== 'image/gif' ? MAX_IMAGE_BYTES : MAX_UPLOAD_BYTES);

// Returns the bytes and their type (image/... or video/..., as announced by the site or read from the bytes).
export async function fetchMedia(raw: string): Promise<{ data: Buffer; mime: string }> {
  let url = await checkUrl(raw);
  let res: Response;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let redirects = 0; ; redirects++) {
    try {
      res = await fetch(url, { redirect: 'manual', signal, headers: { accept: 'image/*,video/*', 'user-agent': USER_AGENT } });
    } catch {
      throw new MediaFetchError('fetch_failed');
    }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) break;
    if (redirects >= MAX_REDIRECTS) throw new MediaFetchError('fetch_failed');
    url = await checkUrl(new URL(location, url).href);
  }
  if (!res.ok || !res.body) throw new MediaFetchError('fetch_failed');
  let mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!isMedia(mime) && !BINARY.has(mime)) throw new MediaFetchError('not_media');
  const limit = isMedia(mime) ? maxBytes(mime) : MAX_UPLOAD_BYTES;
  if (Number(res.headers.get('content-length') ?? 0) > limit) throw new MediaFetchError('too_large');

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > limit) throw new MediaFetchError('too_large');
      chunks.push(Buffer.from(chunk));
    }
  } catch (err) {
    throw err instanceof MediaFetchError ? err : new MediaFetchError('fetch_failed');
  }
  const data = Buffer.concat(chunks);
  if (BINARY.has(mime)) mime = sniff(data);
  if (!isMedia(mime)) throw new MediaFetchError('not_media');
  if (size > maxBytes(mime)) throw new MediaFetchError('too_large');
  return { data, mime };
}
