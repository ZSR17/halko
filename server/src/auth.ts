import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db/index.ts';
import { devices } from './db/schema.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; deviceId: string };
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Long-lived bearer token per device: the app keeps it so queued syncs never hit a login wall.
export function createDevice(db: Db, userId: string, name: string): { token: string; deviceId: string } {
  const token = randomBytes(32).toString('base64url');
  const deviceId = randomUUID();
  const now = Date.now();
  db.insert(devices)
    .values({ id: deviceId, userId, name, tokenHash: hashToken(token), createdAt: now, lastSeenAt: now })
    .run();
  return { token, deviceId };
}

export function authHook(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.routeOptions.config.public) return;
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const device = token
      ? db
          .select()
          .from(devices)
          .where(and(eq(devices.tokenHash, hashToken(token)), eq(devices.revoked, false)))
          .get()
      : undefined;
    if (!device) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const now = Date.now();
    if (now - device.lastSeenAt > LAST_SEEN_RESOLUTION_MS) {
      db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id)).run();
    }
    request.auth = { userId: device.userId, deviceId: device.id };
  };
}
