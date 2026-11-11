import { Footer, Logo } from '@vitpay/ui';

export default function Home() {
  return (
    <main className="vp-narrow" style={{ paddingTop: 64 }}>
      <div className="vp-card vp-stack" style={{ textAlign: 'center' }}>
        <Logo />
        <h1>One platform. Every payment.</h1>
        <p className="vp-muted">Ouvrez le lien de paiement que vous avez reçu pour régler une demande.</p>
      </div>
      <Footer />
    </main>
  );
}
