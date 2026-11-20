import { Icon, Logo } from '@vitpay/ui';

export default function Home() {
  return (
    <div className="vp-pay">
      <main className="vp-pay-wrap" style={{ paddingTop: 64 }}>
        <div className="vp-ticket">
          <div className="vp-ticket-top vp-stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <Logo />
            <div className="vp-result-icon vp-result-neutral">
              <Icon name="link" />
            </div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Payer une demande</h1>
            <p className="vp-muted" style={{ margin: 0 }}>
              Ouvrez le lien de paiement reçu de votre commerçant (WhatsApp, SMS ou e-mail), ou scannez son QR code.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
