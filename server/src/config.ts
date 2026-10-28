import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  // scrypt hash produced by `npm run hash-password`; login is refused while it is empty.
  passwordHash: string;
  // Proxies whose X-Forwarded-For header is trusted (the reverse proxy in front of the app).
  trustProxy: string[];
  // Built web app (client/dist) served by this server in production; empty in development (Vite serves it).
  staticDir: string;
  // Video conversion tools (installed in the Docker image; optional in development).
  ffmpegPath: string;
  ffprobePath: string;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    // Quotes are kept by `docker run --env-file`; Compose removes them.
    passwordHash: (env.APP_PASSWORD_HASH ?? '').trim().replace(/^'(.*)'$|^"(.*)"$/, '$1$2'),
    trustProxy: list(env.TRUST_PROXY, ['127.0.0.1/32', '172.16.0.0/12']),
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : '',
    ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH ?? 'ffprobe',
  };
}
