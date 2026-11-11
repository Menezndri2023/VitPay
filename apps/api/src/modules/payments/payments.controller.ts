import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Errors } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Db } from '../../database/db.service';
import { Auth, Org, Public, RequireOrgPermission } from '../identity/decorators';
import { actorOf, AuthContext, clientInfo, OrgContext, VitpayRequest } from '../identity/session';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from '../platform/idempotency.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { money, PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

const UUID = z.string().uuid();
/** Référence de commande du commerçant : 1 à 64 caractères sûrs, unique par organisation. */
const MerchantRef = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:/#-]{1,64}$/, 'Use 1-64 characters: letters, digits and . _ : / # -')
  .refine((v) => !/^VP-/i.test(v), 'The VP- prefix is reserved for VITPAY references');
const CreateRequest = z.object({
  amount: z.string().trim().min(1).max(24),
  merchantReference: MerchantRef.optional(),
  currency: z.string().length(3).default('MAD'),
  description: z.string().trim().max(200).optional(),
  customerName: z.string().trim().max(120).optional(),
  customerContact: z.string().trim().max(120).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
  posId: UUID.optional(),
});
const ListQuery = z.object({
  status: z.enum(['open', 'paid', 'expired', 'cancelled']).optional(),
  q: z.string().max(80).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  posId: UUID.optional(),
  merchantReference: MerchantRef.optional(),
});
const Cancel = z.object({ reason: z.string().max(200).optional() });
const CreateRefund = z.object({ attemptId: UUID, amount: z.string().max(24).optional(), reason: z.string().trim().min(3).max(200) });
const StartAttempt = z.object({ method: z.enum(['card', 'bank_transfer', 'mobile_money']) });
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Protection contre l'injection de formules dans les tableurs (CSV injection). */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

@Controller('v1/orgs/:orgId')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly receipts: ReceiptsService,
    private readonly db: Db,
  ) {}

  @RequireOrgPermission('requests:create')
  @Post('payment-requests')
  async create(
    @Org() org: OrgContext,
    @Auth() a: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(CreateRequest)) body: z.infer<typeof CreateRequest>,
    @Req() req: VitpayRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.idempotency.run(`payment_request:${org.orgId}`, key, body, async () => ({
      status: 201,
      body: await this.payments.createRequest(org.orgId, actorOf(a, req), body),
    }));
    res.status(r.status);
    if (r.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @RequireOrgPermission('requests:read')
  @Get('payment-requests')
  list(@Org() org: OrgContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.payments.listRequests(org.orgId, q);
  }

  @RequireOrgPermission('requests:read')
  @Get('payment-requests/:id')
  get(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string) {
    return this.payments.getRequest(org.orgId, id);
  }

  /** Historique des événements de la transaction (journal d'audit chaîné, sans données techniques sensibles). */
  @RequireOrgPermission('requests:read')
  @Get('payment-requests/:id/events')
  events(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string) {
    return this.payments.getRequestEvents(org.orgId, id);
  }

  @RequireOrgPermission('requests:read')
  @Get('payment-requests/:id/qr.svg')
  async qr(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string, @Res() res: Response) {
    const r = await this.payments.getRequest(org.orgId, id);
    const svg = await QRCode.toString(r.payUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0B1F44', light: '#FFFFFF' } });
    res.type('image/svg+xml').setHeader('Cache-Control', 'private, max-age=300').send(svg);
  }

  @RequireOrgPermission('requests:cancel')
  @HttpCode(200)
  @Post('payment-requests/:id/cancel')
  cancel(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Cancel)) body: z.infer<typeof Cancel>, @Req() req: VitpayRequest) {
    return this.payments.cancelRequest(org.orgId, id, actorOf(a, req), body.reason);
  }

  @RequireOrgPermission('refunds:create')
  @Post('refunds')
  async refund(
    @Org() org: OrgContext,
    @Auth() a: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(CreateRefund)) body: z.infer<typeof CreateRefund>,
    @Req() req: VitpayRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.idempotency.run(`refund:${org.orgId}`, key, body, async () => ({
      status: 201,
      body: await this.refunds.create(org.orgId, actorOf(a, req), body),
    }));
    res.status(r.status);
    return r.body;
  }

  @RequireOrgPermission('requests:read')
  @Get('payments/:attemptId/receipt.pdf')
  async receipt(@Org() org: OrgContext, @Param('attemptId', new ZodPipe(UUID)) attemptId: string, @Res() res: Response) {
    const pdf = await this.receipts.forOrg(org.orgId, attemptId);
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="recu-${attemptId}.pdf"`).send(pdf);
  }

  @RequireOrgPermission('ledger:read')
  @Get('ledger/balances')
  async balances(@Org() org: OrgContext) {
    return { balances: await this.ledger.balances(org.orgId), trialBalance: await this.ledger.trialBalance(org.orgId) };
  }

  @RequireOrgPermission('requests:read')
  @Get('dashboard')
  async dashboard(@Org() org: OrgContext) {
    return this.db.forOrg(org.orgId, async (tx) => {
      const totals = await tx.query<{ currency: 'MAD'; status: string; count: string; sum: string }>(
        `SELECT currency, status, count(*)::text AS count, COALESCE(sum(amount_minor),0)::text AS sum
           FROM payment_requests WHERE created_at > now() - interval '30 days' GROUP BY currency, status`,
      );
      const daily = await tx.query<{ day: string; currency: 'MAD'; sum: string; count: string }>(
        // Jour calendaire marocain (le marché de référence), pas UTC.
        `SELECT to_char(date_trunc('day', succeeded_at AT TIME ZONE 'Africa/Casablanca'), 'YYYY-MM-DD') AS day, currency, sum(amount_minor)::text AS sum, count(*)::text AS count
           FROM payment_attempts WHERE status = 'succeeded' AND succeeded_at > now() - interval '30 days'
          GROUP BY 1, 2 ORDER BY 1`,
      );
      return {
        last30Days: totals.map((t) => ({ status: t.status, count: Number(t.count), total: money(t.sum, t.currency) })),
        dailyReceived: daily.map((d) => ({ day: d.day, count: Number(d.count), total: money(d.sum, d.currency) })),
      };
    });
  }

  @RequireOrgPermission('exports:read')
  @Get('exports/payments.csv')
  async exportCsv(@Org() org: OrgContext, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() res: Response) {
    const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
    if (!d.safeParse(from).success || !d.safeParse(to).success) throw Errors.validation({ range: 'from/to must be YYYY-MM-DD' });
    const rows = await this.db.forOrg(org.orgId, (tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT pr.reference, pr.merchant_reference, pr.created_at, pr.status AS request_status, a.status AS payment_status, a.amount_minor, a.currency,
                a.provider_fee_minor, a.vitpay_fee_minor, a.vitpay_fee_waived_minor, a.provider_code, a.provider_ref, a.succeeded_at, a.settlement_status,
                pr.description, pr.customer_name
           FROM payment_requests pr LEFT JOIN payment_attempts a ON a.payment_request_id = pr.id
          WHERE ($1::date IS NULL OR pr.created_at >= $1::date) AND ($2::date IS NULL OR pr.created_at < ($2::date + 1))
          ORDER BY pr.created_at DESC LIMIT 50000`,
        [from ?? null, to ?? null],
      ),
    );
    const header = Object.keys(rows[0] ?? { reference: '' });
    const body = [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h] instanceof Date ? (r[h] as Date).toISOString() : r[h])).join(','))].join('\n');
    res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', 'attachment; filename="vitpay-paiements.csv"').send(`﻿${body}`);
  }
}

/** Parcours payeur public (domaine pay.). Aucune authentification, données minimales, limitation de débit. */
@Controller('v1/public/requests')
export class PublicPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly receipts: ReceiptsService,
  ) {}

  private token(t: string): string {
    if (!TOKEN_RE.test(t)) throw Errors.notFound('Payment request');
    return t;
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  view(@Param('token') token: string) {
    return this.payments.publicView(this.token(token));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/attempts')
  start(@Param('token') token: string, @Body(new ZodPipe(StartAttempt)) body: z.infer<typeof StartAttempt>, @Req() req: VitpayRequest) {
    return this.payments.startAttempt(this.token(token), body.method, clientInfo(req));
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token/status')
  status(@Param('token') token: string) {
    return this.payments.publicStatus(this.token(token));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token/receipt.pdf')
  async receipt(@Param('token') token: string, @Res() res: Response) {
    const pdf = await this.receipts.forPublicToken(this.token(token));
    res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="recu-vitpay.pdf"').send(pdf);
  }
}
