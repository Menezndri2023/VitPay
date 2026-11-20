import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { orgRoleHas } from '../identity/permissions';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, Org, RequireOrgPermission } from '../identity/decorators';
import { actorOf, AuthContext, OrgContext, VitpayRequest } from '../identity/session';
import { TerminalsService } from './terminals.service';

const UUID = z.string().uuid();
const CreateSandboxTerminal = z.object({ label: z.string().trim().min(2).max(60), posId: UUID.optional() });
const StartTerminalPayment = z.object({ terminalId: UUID });

/** Terminaux de paiement (TPE) et encaissements carte présente. */
@Controller('v1/orgs/:orgId')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  /** [R8-C3] Terminaux réservés aux sessions humaines : une clé API ne pousse jamais un montant vers un TPE. */
  private actor(a: AuthContext, req: VitpayRequest) {
    if (a.apiKeyId) throw Errors.forbidden('Terminals are not available to API keys');
    return { type: 'user' as const, ...actorOf(a, req) };
  }

  @RequireOrgPermission('requests:read')
  @Get('terminals')
  list(@Org() org: OrgContext, @Auth() a: AuthContext) {
    return this.terminals.list(org.orgId, !a.apiKeyId && orgRoleHas(org.role, 'requests:create'));
  }

  /** Sandbox : ajoute un TPE simulé (aucun terminal réel n'est disponible). */
  @RequireOrgPermission('pos:manage')
  @Post('terminals/sandbox')
  create(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(CreateSandboxTerminal)) b: z.infer<typeof CreateSandboxTerminal>, @Req() req: VitpayRequest) {
    return this.terminals.createSandboxTerminal(org.orgId, this.actor(a, req), b);
  }

  @RequireOrgPermission('pos:manage')
  @Delete('terminals/:id')
  async disable(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Req() req: VitpayRequest) {
    await this.terminals.disable(org.orgId, this.actor(a, req), id);
    return { ok: true };
  }

  /** Envoie le montant de la demande au terminal ; la confirmation arrive par notification du fournisseur. */
  @RequireOrgPermission('requests:create')
  @HttpCode(202)
  @Post('payment-requests/:id/terminal-payment')
  start(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(StartTerminalPayment)) b: z.infer<typeof StartTerminalPayment>, @Req() req: VitpayRequest) {
    return this.terminals.startPayment(org.orgId, this.actor(a, req), id, b.terminalId);
  }

  @RequireOrgPermission('requests:create')
  @HttpCode(200)
  @Post('terminal-payments/:attemptId/cancel')
  cancel(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('attemptId', new ZodPipe(UUID)) attemptId: string, @Req() req: VitpayRequest) {
    return this.terminals.cancelPayment(org.orgId, this.actor(a, req), attemptId);
  }
}
