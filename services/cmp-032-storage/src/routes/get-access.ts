import type { FastifyInstance } from 'fastify';
import { authorize, authzInput } from '../authz.js';
import { withContextTx } from '../db/tx.js';
import { Cmp032Error } from '../errors.js';
import { accessObject } from '../service/access-object.js';
import type { RouteDeps } from './helpers.js';

export function registerGetAccess(app: FastifyInstance, deps: RouteDeps): void {
  app.get<{ Params: { id: string } }>('/storage/objects/:id/access', async (request, reply) => {
    const ctx = request.sfContext!;
    const objectId = request.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Cmp032Error('SF-SYS-003');

    await authorize(deps.authorizer, authzInput(ctx, 'STORAGE_OBJECT_ACCESS', 'StorageObject'));

    const body = await withContextTx(deps.pool, ctx, (client) =>
      accessObject(
        client,
        {
          ctx,
          config: deps.config,
          store: deps.store,
          secrets: deps.secrets,
          now: deps.clock(),
        },
        objectId,
      ),
    );
    return reply.code(200).send(body);
  });
}
