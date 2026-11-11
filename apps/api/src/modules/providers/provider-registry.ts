import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { decrypt } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { Tx } from '../../database/db.service';
import { MockProvider } from './mock.provider';
import { PaymentProvider, ProviderAccountContext, ProviderMode } from './provider.interface';

export interface ProviderAccountRow {
  id: string;
  org_id: string;
  provider_code: string;
  mode: ProviderMode;
  label: string;
  credentials_enc: string;
  webhook_secret_enc: string;
  priority: number;
  status: 'active' | 'disabled';
}

/**
 * Registre des adaptateurs. Ajouter un prestataire = écrire un adaptateur qui implémente
 * PaymentProvider et l'enregistrer ici. Le reste du moteur n'en dépend pas.
 */
@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    mock: MockProvider,
  ) {
    if (config.MOCK_PSP_ENABLED) this.providers.set(mock.code, mock);
  }

  get(code: string): PaymentProvider {
    const p = this.providers.get(code);
    if (!p) throw Errors.notFound(`Provider ${code}`);
    return p;
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }

  /** Garde-fou réglementaire : un compte `live` n'est utilisable que si le mode live est autorisé. */
  assertModeAllowed(mode: ProviderMode): void {
    if (mode === 'live' && !this.config.PAYMENTS_LIVE_ENABLED) throw Errors.legalGate();
  }

  context(row: ProviderAccountRow): ProviderAccountContext {
    this.assertModeAllowed(row.mode);
    return {
      accountId: row.id,
      orgId: row.org_id,
      mode: row.mode,
      credentials: JSON.parse(decrypt(row.credentials_enc, this.config.encryptionKey)) as Record<string, string>,
      webhookSecret: decrypt(row.webhook_secret_enc, this.config.encryptionKey),
    };
  }

  async loadAccount(tx: Tx, accountId: string): Promise<ProviderAccountRow> {
    const row = await tx.maybeOne<ProviderAccountRow>('SELECT * FROM provider_accounts WHERE id = $1', [accountId]);
    if (!row) throw Errors.notFound('Provider account');
    return row;
  }

  webhookUrl(providerCode: string, accountId: string): string {
    return `${this.config.PUBLIC_API_URL}/webhooks/providers/${providerCode}/${accountId}`;
  }
}
