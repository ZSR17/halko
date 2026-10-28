import { type LoginResponse, loginBody } from '@halko/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createDevice } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { devices } from '../db/schema.ts';
import { verifyPassword } from '../lib/password.ts';

export function authRoutes(app: FastifyInstance, { db, config, ownerId }: { db: Db; config: Config; ownerId: string }) {
  app.post(
    '/auth/login',
    { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = loginBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      if (!config.passwordHash || !(await verifyPassword(body.data.password, config.passwordHash))) {
        return reply.code(401).send({ error: 'bad_password' });
      }
      const res: LoginResponse = createDevice(db, ownerId, body.data.deviceName);
      return res;
    },
  );

  app.post('/auth/logout', async (request) => {
    db.update(devices).set({ revoked: true }).where(eq(devices.id, request.auth!.deviceId)).run();
    return { ok: true };
  });

  app.get('/devices', async (request) => {
    const rows = db
      .select({ id: devices.id, name: devices.name, createdAt: devices.createdAt, lastSeenAt: devices.lastSeenAt })
      .from(devices)
      .where(and(eq(devices.userId, request.auth!.userId), eq(devices.revoked, false)))
      .orderBy(desc(devices.lastSeenAt))
      .all();
    return rows.map((d) => ({ ...d, current: d.id === request.auth!.deviceId }));
  });

  app.delete<{ Params: { id: string } }>('/devices/:id', async (request, reply) => {
    const res = db
      .update(devices)
      .set({ revoked: true })
      .where(and(eq(devices.id, request.params.id), eq(devices.userId, request.auth!.userId)))
      .run();
    if (res.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
