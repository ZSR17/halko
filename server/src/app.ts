import fs from 'node:fs';
import path from 'node:path';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, type HealthResponse } from '@halko/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { authHook } from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { mediaDir, mediaRelPath } from './lib/media.ts';
import { authRoutes } from './routes/auth.ts';
import { exerciseRoutes } from './routes/exercises.ts';
import { mediaRoutes } from './routes/media.ts';
import { syncRoutes } from './routes/sync.ts';

// The version of the whole repository (its root package.json, also in the Docker image).
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

interface AppDeps {
  config: Config;
  db: Db;
  ownerId: string;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ config, db, ownerId, logger = false }: AppDeps) {
  // On close, drop open connections too: the live sync streams never end by themselves, and waiting for
  // them blocked restarts (dev reload, container stop). Apps reconnect on their own.
  const app = Fastify({ logger, trustProxy: config.trustProxy, forceCloseConnections: true });
  await app.register(rateLimit, { global: false });

  fs.mkdirSync(mediaDir(config.dataDir), { recursive: true });
  await app.register(fastifyStatic, { root: mediaDir(config.dataDir), serve: false });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    db.$client.prepare('SELECT 1').get();
    return { ok: true, version: VERSION };
  });

  // Media is content-addressed (sha256 names) and never changes, so it is cached forever.
  // Left unauthenticated so <img>/<video> tags work; names are unguessable and the app is LAN/VPN only.
  app.get<{ Params: { file: string } }>('/media/:file', async (request, reply) => {
    const match = /^([0-9a-f]{64})\.(webp|mp4)$/.exec(request.params.file);
    if (!match) return reply.code(404).send({ error: 'not_found' });
    return reply.sendFile(mediaRelPath(match[1]!, match[2]!), { maxAge: '365d', immutable: true });
  });

  if (config.staticDir) {
    // The app itself. Its shell must always be revalidated so updates show up; hashed assets never change.
    await app.register(fastifyStatic, {
      root: config.staticDir,
      decorateReply: false,
      setHeaders: (res, file) => {
        if (path.basename(file) === 'index.html') {
          res.header('cache-control', 'no-cache');
        } else if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.header('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    });
    // Client-side routes (/workouts/..., /settings) all load the app shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.startsWith('/media/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html', config.staticDir);
    });
  }

  await app.register(
    async (api) => {
      api.addHook('onRequest', authHook(db));
      authRoutes(api, { db, config, ownerId });
      exerciseRoutes(api, { db });
      mediaRoutes(api, { db, config });
      syncRoutes(api, { db });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
