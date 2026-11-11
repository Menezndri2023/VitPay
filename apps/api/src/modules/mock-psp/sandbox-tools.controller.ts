import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Errors } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Db } from '../../database/db.service';
import { Org, RequireOrgPermission } from '../identity/decorators';
import { OrgContext } from '../identity/session';
import { MockPspService } from './mock-psp.service';

const UUID = z.string().uuid();
const Resolve = z.object({ outcome: z.enum(['succeeded', 'failed']) });

/**
 * Outils de simulation pour l'espace Business (sandbox uniquement, enregistré seulement si le
 * prestataire simulé est actif). Contrairement aux outils bruts du prestataire simulé, l'accès
 * exige une session du commerçant et la tentative doit appartenir à SON organisation.
 */
@Controller('v1/orgs/:orgId/sandbox')
export class SandboxToolsController {
  constructor(
    private readonly db: Db,
    private readonly psp: MockPspService,
  ) {}

  /** Réponse différée de la banque (simulée) pour un paiement en attente. Le résultat arrive ensuite par notification. */
  @RequireOrgPermission('requests:create')
  @HttpCode(202)
  @Post('attempts/:attemptId/resolve')
  async resolve(@Org() org: OrgContext, @Param('attemptId', new ZodPipe(UUID)) attemptId: string, @Body(new ZodPipe(Resolve)) b: z.infer<typeof Resolve>) {
    const a = await this.db.forOrg(org.orgId, (tx) =>
      tx.maybeOne<{ provider_ref: string | null; provider_code: string; mode: string }>(
        `SELECT a.provider_ref, a.provider_code, pr.mode FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id WHERE a.id = $1`,
        [attemptId],
      ),
    );
    if (!a) throw Errors.notFound('Payment attempt');
    if (a.mode !== 'sandbox' || a.provider_code !== 'mock' || !a.provider_ref) throw Errors.invalidState('Only sandbox attempts on the mock provider can be simulated');
    return this.psp.resolvePayment(a.provider_ref, b.outcome);
  }
}
