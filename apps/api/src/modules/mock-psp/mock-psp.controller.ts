import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { formatMinor, isCurrency } from '@vitpay/money';
import { ZodPipe } from '../../common/zod.pipe';
import { Public } from '../identity/decorators';
import { CheckoutAction, MockPspService } from './mock-psp.service';

const CreateMerchant = z.object({ webhookUrl: z.string().url() });
const CreatePayment = z.object({
  externalRef: z.string().min(1).max(100),
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  description: z.string().max(500).optional(),
  returnUrl: z.string().url(),
});
const CreateRefund = z.object({ externalRef: z.string().min(1).max(100), amountMinor: z.string().regex(/^\d+$/) });

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** API du prestataire simulé (contrat inspiré des API de PSP courantes, sans prétendre en reproduire une). */
// Système EXTERNE simulé : il porte sa propre authentification (clé API), pas celle de VITPAY.
@Public()
@Controller('mock-psp')
export class MockPspController {
  constructor(private readonly psp: MockPspService) {}

  @Post('api/merchants')
  createMerchant(@Body(new ZodPipe(CreateMerchant)) body: z.infer<typeof CreateMerchant>) {
    return this.psp.createMerchant(body.webhookUrl);
  }

  @Post('api/payments')
  async createPayment(@Headers('authorization') auth: string, @Body(new ZodPipe(CreatePayment)) body: z.infer<typeof CreatePayment>) {
    const merchantId = await this.psp.authenticate(auth);
    const p = await this.psp.createPayment(merchantId, body);
    return this.view(p);
  }

  @Get('api/payments/:id')
  async getPayment(@Headers('authorization') auth: string, @Param('id') id: string) {
    const merchantId = await this.psp.authenticate(auth);
    return this.view(await this.psp.getPayment(merchantId, id));
  }

  @Post('api/payments/:id/refunds')
  async refund(@Headers('authorization') auth: string, @Param('id') id: string, @Body(new ZodPipe(CreateRefund)) body: z.infer<typeof CreateRefund>) {
    const merchantId = await this.psp.authenticate(auth);
    return this.psp.refund(merchantId, id, body);
  }

  @Get('api/refunds/:id')
  async getRefund(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.psp.getRefund(await this.psp.authenticate(auth), id);
  }

  @Get('api/disputes/:id')
  async getDispute(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.psp.getDispute(await this.psp.authenticate(auth), id);
  }

  @Get('api/settlements')
  async settlements(@Headers('authorization') auth: string, @Query('date') date: string) {
    return this.psp.settlementReport(await this.psp.authenticate(auth), date);
  }

  // --- Outils de simulation (sandbox) ---
  @Post('simulate/payments/:id/dispute')
  openDispute(@Param('id') id: string) {
    return this.psp.openDispute(id);
  }

  /** Réponse différée de la banque pour un paiement « en cours » (formulaire de la page hébergée ou appel direct). */
  @Post('simulate/payments/:id/resolve/:outcome')
  async resolvePayment(@Param('id') id: string, @Param('outcome') outcome: string, @Query('return') ret: string | undefined, @Res() res: Response) {
    if (outcome !== 'succeeded' && outcome !== 'failed') {
      res.status(400).json({ error: 'outcome must be succeeded|failed' });
      return;
    }
    const r = await this.psp.resolvePayment(id, outcome);
    if (ret === 'page') res.redirect(303, `/mock-psp/checkout/${encodeURIComponent(id)}`);
    else res.json(r);
  }

  @Post('simulate/disputes/:id/:outcome')
  async resolveDispute(@Param('id') id: string, @Param('outcome') outcome: string) {
    if (outcome !== 'won' && outcome !== 'lost') return { error: 'outcome must be won|lost' };
    await this.psp.resolveDispute(id, outcome);
    return { ok: true };
  }

  // --- Page de paiement hébergée (aucune donnée de carte) ---
  @Get('checkout/:id')
  async checkout(@Param('id') id: string, @Query('step') step: string | undefined, @Res() res: Response) {
    const p = await this.psp.getPayment(null, id);
    const amount = isCurrency(p.currency) ? formatMinor(p.amount_minor, p.currency, 'fr-MA') : `${p.amount_minor} ${p.currency}`;
    const open = p.status === 'pending' || p.status === 'requires_action';
    const btn = (action: CheckoutAction, label: string, style = '') =>
      `<form method="post" action="/mock-psp/checkout/${esc(p.id)}/${action}"><button style="${style}">${esc(label)}</button></form>`;
    const actions =
      step === '3ds'
        ? `<p><strong>Authentification 3-D Secure simulée</strong></p>${btn('succeed', 'Valider l’authentification')}${btn('decline', 'Échec de l’authentification', 'background:#b42318')}`
        : `${btn('succeed', 'Payer — scénario succès')}${btn('challenge', 'Payer — avec 3-D Secure', 'background:#344054')}${btn('pending', 'Payer — confirmation différée (en attente)', 'background:#b54708')}${btn('decline', 'Carte refusée', 'background:#b42318')}${btn('cancel', 'Abandonner', 'background:#667085')}`;
    const resolve = (outcome: 'succeeded' | 'failed', label: string, style = '') =>
      `<form method="post" action="/mock-psp/simulate/payments/${esc(p.id)}/resolve/${outcome}?return=page"><button style="${style}">${esc(label)}</button></form>`;
    const processing =
      p.status === 'processing'
        ? `<p><strong>Paiement en cours de traitement par la banque (simulé).</strong></p>${resolve('succeeded', 'Simuler : la banque confirme')}${resolve('failed', 'Simuler : la banque refuse', 'background:#b42318')}`
        : '';
    // La soumission redirige vers la page de retour (autre origine) : la CSP doit l'autoriser explicitement.
    let returnOrigin = '';
    try {
      returnOrigin = new URL(p.return_url).origin;
    } catch {
      /* URL invalide : seule l'origine courante est autorisée */
    }
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${returnOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prestataire simulé — Sandbox</title>
<style>body{font-family:system-ui,sans-serif;background:#f2f4f7;margin:0;padding:16px;color:#101828}
.card{max-width:420px;margin:40px auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.badge{display:inline-block;background:#fef0c7;color:#93370d;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600}
.amount{font-size:32px;font-weight:700;margin:16px 0}
button{width:100%;padding:12px;margin:6px 0;border:0;border-radius:8px;background:#027a48;color:#fff;font-size:15px;cursor:pointer}
small{color:#667085}</style></head><body><div class="card">
<span class="badge">SANDBOX — AUCUN PAIEMENT RÉEL</span>
<h1 style="font-size:18px">Prestataire de paiement simulé</h1>
<div class="amount">${esc(amount)}</div>
<p>${esc(p.description ?? '')}</p>
<p><small>Statut : ${esc(p.status)} · Réf. ${esc(p.id)}</small></p>
${open ? actions : processing || `<p>Ce paiement est terminé.</p><a href="${esc(p.return_url)}">Retour</a>`}
<p><small>Cette page simule un prestataire agréé. Aucune donnée de carte n’est saisie ni traitée.</small></p>
</div></body></html>`);
  }

  @Post('checkout/:id/:action')
  async checkoutAction(@Param('id') id: string, @Param('action') action: string, @Res() res: Response) {
    const allowed: CheckoutAction[] = ['succeed', 'decline', 'challenge', 'cancel', 'pending'];
    if (!allowed.includes(action as CheckoutAction)) {
      res.status(400).send('Invalid action');
      return;
    }
    const redirect = await this.psp.checkoutAction(id, action as CheckoutAction);
    res.redirect(303, redirect);
  }

  private view(p: Awaited<ReturnType<MockPspService['getPayment']>>) {
    return {
      id: p.id,
      external_ref: p.external_ref,
      amount_minor: p.amount_minor,
      currency: p.currency,
      status: p.status,
      fee_minor: p.fee_minor,
      failure_code: p.failure_code,
      checkout_url: this.psp.checkoutUrl(p.id),
    };
  }
}
