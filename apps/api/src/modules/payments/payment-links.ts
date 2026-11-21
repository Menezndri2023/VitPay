import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Currency, isCurrency, Money } from '@vitpay/money';
import { Errors } from '../../common/errors';
import { randomToken } from '../../common/crypto';
import { ZodPipe } from '../../common/zod.pipe';
import { Db } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { Auth, Org, Public, RequireOrgPermission } from '../identity/decorators';
import { actorOf, AuthContext, clientInfo, OrgContext, VitpayRequest } from '../identity/session';
import { money, PaymentsService } from './payments.service';

/** Validité d'une demande ouverte depuis un lien : le client paie dans la foulée. */
const LINK_REQUEST_TTL_HOURS = 1;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const UUID = z.string().uuid();

interface LinkRow {
  id: string;
  org_id: string;
  created_by: string;
  public_token: string;
  title: string;
  description: string | null;
  amount_minor: string | null;
  currency: Currency;
  mode: 'sandbox' | 'live';
  status: 'active' | 'disabled';
  created_at: Date;
  disabled_at: Date | null;
}

const CreateLink = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
  /** Absent : montant libre, saisi par le client. */
  amount: z.string().trim().min(1).max(24).optional(),
  currency: z.string().length(3).default('MAD'),
});
const OpenFromLink = z.object({ amount: z.string().trim().min(1).max(24).optional() });

function parseAmount(raw: string, currency: Currency): Money {
  let m: Money;
  try {
    m = Money.fromMajor(raw.replace(',', '.').replace(/\s/g, ''), currency);
  } catch (e) {
    throw Errors.validation({ amount: (e as Error).message });
  }
  if (!m.isPositive()) throw Errors.validation({ amount: 'Amount must be positive' });
  return m;
}

@Injectable()
export class PaymentLinksService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  linkUrl(token: string): string {
    return this.payments.payUrl(token).replace(/\/r\/([^/]+)$/, '/l/$1');
  }

  private view(r: LinkRow & { paid_count?: number; paid_minor?: string | null }) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      amount: r.amount_minor ? money(r.amount_minor, r.currency) : null,
      currency: r.currency,
      mode: r.mode,
      status: r.status,
      url: this.linkUrl(r.public_token),
      createdAt: r.created_at.toISOString(),
      paidCount: Number(r.paid_count ?? 0),
      paidTotal: money(r.paid_minor ?? '0', r.currency),
    };
  }

  async create(orgId: string, actor: ReturnType<typeof actorOf>, input: z.infer<typeof CreateLink>, forcedMode?: 'sandbox' | 'live') {
    if (!isCurrency(input.currency)) throw Errors.validation({ currency: 'Unsupported currency' });
    const amount = input.amount ? parseAmount(input.amount, input.currency) : null;
    // Mode fixé maintenant : sandbox tant que le réel n'est pas ouvert pour cette organisation.
    const mode = await this.payments.currentMode(orgId, input.currency, forcedMode);
    return this.db.forOrg(orgId, async (tx) => {
      const org = await tx.one<{ status: string }>('SELECT status FROM organizations WHERE id = $1', [orgId]);
      if (org.status !== 'active') throw Errors.forbidden('Organization is not active');
      const row = await tx.one<LinkRow>(
        `INSERT INTO payment_links (org_id, created_by, public_token, title, description, amount_minor, currency, mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [orgId, actor.userId, randomToken(16), input.title, input.description ?? null, amount?.minor.toString() ?? null, input.currency, mode],
      );
      await this.audit.record(tx, {
        actor: { type: actor.apiKeyId ? 'api_key' : 'user', ...actor },
        orgId,
        action: 'payment_link.created',
        targetType: 'payment_link',
        targetId: row.id,
        after: { title: row.title, amount: amount?.toJSON() ?? null, mode },
      });
      return this.view(row);
    });
  }

  list(orgId: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const rows = await tx.query<LinkRow & { paid_count: number; paid_minor: string | null }>(
        `SELECT l.*,
                (SELECT count(*) FROM payment_requests r WHERE r.payment_link_id = l.id AND r.status = 'paid')::int AS paid_count,
                (SELECT sum(r.amount_minor) FROM payment_requests r WHERE r.payment_link_id = l.id AND r.status = 'paid')::text AS paid_minor
           FROM payment_links l ORDER BY l.status = 'active' DESC, l.created_at DESC LIMIT 200`,
      );
      return rows.map((r) => this.view(r));
    });
  }

  async disable(orgId: string, actor: ReturnType<typeof actorOf>, id: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const row = await tx.maybeOne<LinkRow>(`UPDATE payment_links SET status = 'disabled', disabled_at = now() WHERE id = $1 AND status = 'active' RETURNING *`, [id]);
      if (!row) throw Errors.notFound('Active payment link');
      await this.audit.record(tx, { actor: { type: actor.apiKeyId ? 'api_key' : 'user', ...actor }, orgId, action: 'payment_link.disabled', targetType: 'payment_link', targetId: id });
      return this.view(row);
    });
  }

  async publicToken(orgId: string, id: string): Promise<string> {
    const r = await this.db.forOrg(orgId, (tx) => tx.maybeOne<{ public_token: string }>('SELECT public_token FROM payment_links WHERE id = $1', [id]));
    if (!r) throw Errors.notFound('Payment link');
    return r.public_token;
  }

  private async byToken(token: string) {
    const r = await this.db.system((tx) =>
      tx.maybeOne<LinkRow & { display_name: string; kyb_status: string; org_status: string }>(
        `SELECT l.*, o.display_name, o.kyb_status, o.status AS org_status FROM payment_links l JOIN organizations o ON o.id = l.org_id WHERE l.public_token = $1`,
        [token],
      ),
    );
    if (!r) throw Errors.notFound('Payment link');
    return r;
  }

  async publicView(token: string) {
    const r = await this.byToken(token);
    return {
      title: r.title,
      description: r.description,
      beneficiary: { displayName: r.display_name, verified: r.kyb_status === 'verified' },
      amount: r.amount_minor ? money(r.amount_minor, r.currency) : null,
      currency: r.currency,
      sandbox: r.mode === 'sandbox',
      active: r.status === 'active' && r.org_status === 'active',
    };
  }

  /** Le client ouvre le lien : une demande ordinaire est créée pour lui, dans le mode du lien. */
  async open(token: string, input: z.infer<typeof OpenFromLink>, client: { ip: string | null; userAgent: string | null }) {
    const link = await this.byToken(token);
    if (link.status !== 'active' || link.org_status !== 'active') throw Errors.invalidState('This payment link is no longer active');
    const amount = link.amount_minor ? Money.of(link.amount_minor, link.currency) : input.amount ? parseAmount(input.amount, link.currency) : null;
    if (!amount) throw Errors.validation({ amount: 'Amount is required for this payment link' });
    const req = await this.payments.createRequest(
      link.org_id,
      // Attribuée au créateur du lien (la demande est ouverte par un client, sans compte VITPAY).
      { userId: link.created_by, ...client },
      {
        amount: amount.toMajorString(),
        currency: link.currency,
        description: link.title,
        expiresInHours: LINK_REQUEST_TTL_HOURS,
        paymentLinkId: link.id,
        metadata: { paymentLink: link.id },
      },
      link.mode,
    );
    return { payUrl: req.payUrl, token: req.payUrl.split('/r/')[1] };
  }
}

@Controller('v1/orgs/:orgId/payment-links')
export class PaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  @RequireOrgPermission('requests:read')
  @Get()
  list(@Org() org: OrgContext) {
    return this.links.list(org.orgId);
  }

  @RequireOrgPermission('requests:create')
  @Post()
  create(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(CreateLink)) body: z.infer<typeof CreateLink>, @Req() req: VitpayRequest) {
    return this.links.create(org.orgId, actorOf(a, req), body, a.apiKeyMode);
  }

  @RequireOrgPermission('requests:cancel')
  @HttpCode(200)
  @Post(':id/disable')
  disable(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Req() req: VitpayRequest) {
    return this.links.disable(org.orgId, actorOf(a, req), id);
  }

  @RequireOrgPermission('requests:read')
  @Get(':id/qr.svg')
  async qr(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string, @Res() res: Response) {
    const url = this.links.linkUrl(await this.links.publicToken(org.orgId, id));
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3d2e', light: '#ffffff' } }));
  }
}

/** Côté client (domaine pay.) : aucune authentification, données minimales, débit limité. */
@Controller('v1/public/links')
export class PublicPaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  private token(t: string): string {
    if (!TOKEN_RE.test(t)) throw Errors.notFound('Payment link');
    return t;
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  view(@Param('token') token: string) {
    return this.links.publicView(this.token(token));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/requests')
  open(@Param('token') token: string, @Body(new ZodPipe(OpenFromLink)) body: z.infer<typeof OpenFromLink>, @Req() req: VitpayRequest) {
    return this.links.open(this.token(token), body, clientInfo(req));
  }
}
