import { syncRequest } from '@halko/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.ts';
import { revEvents, sync } from '../sync.ts';

const HEARTBEAT_MS = 25_000;

export function syncRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.post('/sync', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const body = syncRequest.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return sync(
      db,
      request.auth!.userId,
      body.data.since,
      body.data.changes as Record<string, unknown[] | undefined>,
      body.data.instance,
    );
  });

  // Server-sent events: one `{"rev":N}` message whenever this user's data changes, so open apps
  // pull right away. Read with fetch() (EventSource cannot send the Authorization header).
  app.get('/events', async (request, reply) => {
    const userId = request.auth!.userId;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (u: string, rev: number) => {
      if (u === userId) res.write(`data: {"rev":${rev}}\n\n`);
    };
    res.write(': connected\n\n');
    revEvents.on('rev', send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      revEvents.off('rev', send);
    });
  });
}
