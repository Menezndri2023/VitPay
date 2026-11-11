import { Money } from '@vitpay/money';
import { ProviderAccountContext, ProviderMode, ProviderPaymentStatus } from './provider.interface';

/**
 * Contrat PRÉPARATOIRE pour de futurs terminaux de paiement électronique (TPE) — P6.
 *
 * ⚠ Aucune implémentation n'existe et AUCUNE ne doit être écrite sans :
 *   1. la documentation technique officielle du fournisseur de terminaux ou de l'acquéreur
 *      (aucun protocole supposé, aucun format de message deviné) ;
 *   2. le contrat et l'autorisation correspondants (docs/COMPLIANCE.md, section G) ;
 *   3. la confirmation du périmètre PCI (PTS / CPoC / MPoC selon le matériel).
 *
 * Principes imposés à toute future implémentation :
 *   - Les données de carte (PAN, piste, PIN) restent dans le terminal certifié et chez
 *     l'acquéreur : VITPAY ne les reçoit JAMAIS, ni en clair ni chiffrées.
 *   - VITPAY déclenche un encaissement sur un terminal identifié et en suit l'état ; la
 *     confirmation n'est acquise que par relecture serveur (`getTerminalPayment`), comme pour
 *     les paiements en ligne (règle absolue : aucune confirmation sans preuve serveur).
 *   - Chaque encaissement terminal est une `payment_attempt` (méthode `card_present` à ajouter
 *     au schéma le moment venu), soumise aux mêmes machines à états, à l'idempotence, au ledger
 *     miroir, au rapprochement et à l'audit.
 *   - Modèle A : identifiants et terminaux du commerçant, jamais un compte VITPAY.
 */

export interface TerminalCapabilities {
  /** Encaissement déclenché à distance depuis VITPAY (sinon : saisie sur le terminal). */
  remoteInitiation: boolean;
  /** Annulation d'un encaissement en cours depuis VITPAY. */
  remoteCancel: boolean;
  /** Remboursement sur terminal (carte présente) ou à distance. */
  refunds: 'none' | 'card_present' | 'remote';
  /** Notifications serveur à serveur (webhooks) des changements d'état. */
  webhooks: boolean;
  /** Rapports de règlement exploitables pour le rapprochement. */
  settlementReports: boolean;
}

export interface TerminalInfo {
  /** Identifiant du terminal chez le fournisseur (jamais un numéro de série inventé). */
  terminalRef: string;
  label: string;
  status: 'online' | 'offline' | 'busy' | 'unknown';
}

export interface CreateTerminalPaymentInput {
  /** Référence VITPAY de la tentative, transmise au fournisseur (clé d'idempotence). */
  attemptId: string;
  terminalRef: string;
  amount: Money;
  /** Libellé affiché sur le terminal (court, sans donnée personnelle). */
  label: string;
}

export interface TerminalPayment {
  providerRef: string;
  terminalRef: string;
  amount: Money;
  status: ProviderPaymentStatus;
  failureCode?: string;
  /** Données NON sensibles éventuellement fournies : 4 derniers chiffres, marque, code d'autorisation. */
  receiptData?: { last4?: string; brand?: string; authorizationCode?: string };
}

/**
 * Interface qu'un futur adaptateur de terminaux devra implémenter. Ne déclarer que les
 * capacités vérifiées dans la documentation officielle du fournisseur.
 */
export interface TerminalProvider {
  readonly code: string;
  readonly displayName: string;
  readonly modes: readonly ProviderMode[];
  readonly capabilities: TerminalCapabilities;

  listTerminals(ctx: ProviderAccountContext): Promise<TerminalInfo[]>;
  createTerminalPayment(ctx: ProviderAccountContext, input: CreateTerminalPaymentInput): Promise<TerminalPayment>;
  /** Seule source de vérité de l'état d'un encaissement terminal. */
  getTerminalPayment(ctx: ProviderAccountContext, providerRef: string): Promise<TerminalPayment>;
  cancelTerminalPayment?(ctx: ProviderAccountContext, providerRef: string): Promise<TerminalPayment>;
  /** Authentifie une notification ; l'état est ensuite relu via getTerminalPayment. */
  verifyWebhook?(ctx: ProviderAccountContext, rawBody: Buffer, headers: Record<string, string | undefined>): boolean;
}

/** Registre volontairement vide : aucune intégration TPE n'est disponible à ce jour. */
export const TERMINAL_PROVIDERS: readonly TerminalProvider[] = [];
