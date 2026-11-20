// Exemple d'intégration VitPay : un logiciel (SaaS) qui encaisse ses factures.
// Parcours : facture → demande de paiement → page VitPay → webhook signé → facture payée.
// Volontairement sans framework (node:http) pour être lisible et facile à transposer.
import { createServer } from 'node:http';
import { VitPay, VitPaySignatureError } from '@vitpay/node';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {object} cfg
 * @param {string} cfg.apiUrl         adresse de l'API VitPay
 * @param {string} cfg.orgId          identifiant de l'organisation
 * @param {string} cfg.secretKey      clé vp_sk_test_… ou vp_sk_live_…
 * @param {string} cfg.webhookSecret  secret whsec_… de l'endpoint webhook
 * @param {string} cfg.publicUrl      adresse publique de CE logiciel (pour successUrl / cancelUrl)
 */
export function createSaasApp(cfg) {
  const vitpay = new VitPay({ apiKey: cfg.secretKey, orgId: cfg.orgId, baseUrl: cfg.apiUrl });

  // Votre base de données. Ici en mémoire, pour l'exemple.
  const invoices = new Map(
    [
      { id: 'INV-2026-0001', customer: 'Atlas Conseil', email: 'compta@atlas.example', label: 'Abonnement Pro – décembre', amount: '199.00' },
      { id: 'INV-2026-0002', customer: 'Riad Bleu', email: 'contact@riadbleu.example', label: 'Abonnement Équipe – décembre', amount: '490.00' },
    ].map((i) => [i.id, { ...i, status: 'unpaid', paymentRequestId: null, paidAt: null }]),
  );
  const processedEvents = new Set(); // déduplication des webhooks (livraison « au moins une fois »)

  const page = (title, body) =>
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<body style="font:16px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>${esc(title)}</h1>${body}</body></html>`;

  async function handle(req, res) {
    const url = new URL(req.url, cfg.publicUrl);
    const send = (status, html) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    };

    // 1. Liste des factures
    if (req.method === 'GET' && url.pathname === '/') {
      const rows = [...invoices.values()]
        .map((i) => `<tr><td>${esc(i.id)}</td><td>${esc(i.customer)}</td><td>${esc(i.amount)} MAD</td><td>${i.status === 'paid' ? '✅ payée' : `<form method="post" action="/invoices/${esc(i.id)}/pay"><button>Payer</button></form>`}</td></tr>`)
        .join('');
      return send(200, page('Mes factures', `<table cellpadding="6">${rows}</table>`));
    }

    // 2. « Payer » : création de la demande VitPay, puis redirection vers la page de paiement
    const pay = /^\/invoices\/([A-Za-z0-9-]+)\/pay$/.exec(url.pathname);
    if (req.method === 'POST' && pay) {
      const inv = invoices.get(pay[1]);
      if (!inv) return send(404, page('Facture introuvable', ''));
      if (inv.status === 'paid') return send(409, page('Déjà payée', '<a href="/">Retour</a>'));
      const r = await vitpay.paymentRequests.create(
        {
          amount: inv.amount,
          description: inv.label,
          merchantReference: inv.id,
          customerName: inv.customer,
          customerEmail: inv.email,
          successUrl: `${cfg.publicUrl}/merci`,
          cancelUrl: `${cfg.publicUrl}/`,
          metadata: { invoiceId: inv.id },
        },
        // Clé stable : un double clic ou un nouvel essai réutilise la même demande.
        { idempotencyKey: `facture-${inv.id}` },
      );
      inv.paymentRequestId = r.id;
      res.writeHead(303, { location: r.payUrl });
      return res.end();
    }

    // 3. Retour du client : on RELIT la demande chez VitPay, on ne croit pas l'URL
    if (req.method === 'GET' && url.pathname === '/merci') {
      const id = url.searchParams.get('vitpay_request_id') ?? '';
      if (!/^[0-9a-f-]{36}$/.test(id)) return send(400, page('Lien invalide', ''));
      const r = await vitpay.paymentRequests.retrieve(id).catch(() => null);
      if (r?.status === 'paid') return send(200, page('Merci, paiement reçu', `<p>Facture ${esc(r.merchantReference)} réglée. Un reçu vous a été délivré.</p><a href="/">Retour</a>`));
      return send(200, page('Paiement en cours de confirmation', '<p>Nous attendons la confirmation. Rechargez cette page dans quelques secondes.</p>'));
    }

    // 4. Webhook : vérification de la signature sur le corps BRUT, puis traitement idempotent
    if (req.method === 'POST' && url.pathname === '/webhooks/vitpay') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      let event;
      try {
        event = vitpay.webhooks.constructEvent(raw, req.headers['vitpay-signature'], cfg.webhookSecret);
      } catch (e) {
        res.writeHead(e instanceof VitPaySignatureError ? 400 : 500).end();
        return;
      }
      if (event.livemode !== (vitpay.mode === 'live') || processedEvents.has(event.id)) {
        res.writeHead(200).end(); // autre mode, ou déjà traité
        return;
      }
      if (event.type === 'payment.succeeded') {
        const inv = invoices.get(event.data.metadata?.invoiceId);
        if (inv && inv.status !== 'paid') {
          inv.status = 'paid';
          inv.paidAt = event.created;
          inv.paymentRequestId = event.data.requestId;
        }
      }
      processedEvents.add(event.id);
      res.writeHead(200).end();
      return;
    }

    send(404, page('Page introuvable', ''));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Erreur');
    });
  });
  return { server, invoices };
}
