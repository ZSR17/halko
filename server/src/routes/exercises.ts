import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.ts';
import { resetExercise } from '../exercises.ts';
import { currentRev, revEvents } from '../sync.ts';

// Going back to the original version of a built-in exercise. The library itself, and creating or
// editing exercises, go through sync.
export function exerciseRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.delete<{ Params: { id: string } }>('/exercises/:id/override', async (request, reply) => {
    const { userId } = request.auth!;
    if (!resetExercise(db, userId, request.params.id)) return reply.code(404).send({ error: 'not_found' });
    revEvents.emit('rev', userId, currentRev(db));
    return { ok: true };
  });
}
