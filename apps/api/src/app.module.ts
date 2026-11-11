import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from './config';
import { ProblemFilter } from './common/problem.filter';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { AdminController } from './modules/admin/admin.controller';
import { AdminService } from './modules/admin/admin.service';
import { DevelopersController } from './modules/developers/developers.controller';
import { DevelopersService } from './modules/developers/developers.service';
import { EmailService } from './modules/email/email.service';
import { PgThrottlerStorage } from './modules/platform/pg-throttler.storage';
import { KeyRotationService } from './modules/security/key-rotation.service';
import { AccountCleanupService } from './modules/identity/account-cleanup.service';
import { EmailVerificationService } from './modules/identity/email-verification.service';
import { PasswordResetService } from './modules/identity/password-reset.service';
import { OrgInvitationsController, PublicInvitationsController } from './modules/organizations/invitations.controller';
import { InvitationsService } from './modules/organizations/invitations.service';
import { AdminKybDocumentsController, OrgKybDocumentsController } from './modules/organizations/kyb-documents.controller';
import { KybDocumentsService } from './modules/organizations/kyb-documents.service';
import { AdminBillingController, OrgBillingController } from './modules/billing/billing.controller';
import { BillingService } from './modules/billing/billing.service';
import { AdminAuthController, AuthController } from './modules/identity/auth.controller';
import { AuthService } from './modules/identity/auth.service';
import { SecurityGuard } from './modules/identity/security.guard';
import { JobsService } from './modules/jobs/jobs.service';
import { LedgerService } from './modules/ledger/ledger.service';
import { MockPspController } from './modules/mock-psp/mock-psp.controller';
import { MockPspService } from './modules/mock-psp/mock-psp.service';
import { SandboxToolsController } from './modules/mock-psp/sandbox-tools.controller';
import { TerminalsController } from './modules/payments/terminals.controller';
import { TerminalsService } from './modules/payments/terminals.service';
import { NotificationsConsumer } from './modules/notifications/notifications.consumer';
import { OrganizationsController } from './modules/organizations/organizations.controller';
import { OrganizationsService } from './modules/organizations/organizations.service';
import { PaymentsController, PublicPaymentsController } from './modules/payments/payments.controller';
import { PaymentsService } from './modules/payments/payments.service';
import { RefundsService } from './modules/payments/refunds.service';
import { PlatformModule } from './modules/platform/platform.module';
import { MockProvider } from './modules/providers/mock.provider';
import { ProviderRegistry } from './modules/providers/provider-registry';
import { ReceiptsService } from './modules/receipts/receipts.service';
import { ReconciliationService } from './modules/reconciliation/reconciliation.service';
import { WebhooksController } from './modules/webhooks/webhooks.controller';
import { WebhooksService } from './modules/webhooks/webhooks.service';

/**
 * Monolithe modulaire (ADR-001). Les frontières de modules sont matérialisées par les
 * dossiers `modules/*` ; un module n'accède aux tables d'un autre que via son service.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    @Module({
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    })
    class ConfigModule {}

    const throttlerStorage = new PgThrottlerStorage(config);
    const controllers: DynamicModule['controllers'] = [
      HealthController,
      AuthController,
      AdminAuthController,
      OrganizationsController,
      PaymentsController,
      PublicPaymentsController,
      WebhooksController,
      AdminController,
      AdminBillingController,
      OrgBillingController,
      OrgInvitationsController,
      PublicInvitationsController,
      OrgKybDocumentsController,
      AdminKybDocumentsController,
      DevelopersController,
      TerminalsController,
    ];
    if (config.MOCK_PSP_ENABLED) controllers.push(MockPspController, SandboxToolsController);

    return {
      module: AppModule,
      global: true,
      imports: [
        { module: ConfigModule, global: true },
        DatabaseModule,
        PlatformModule,
        ThrottlerModule.forRootAsync({
          useFactory: () => ({
            throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
            // Compteurs partagés par toutes les instances (PostgreSQL) : la limite ne se multiplie pas avec elles.
            storage: throttlerStorage,
            // [R6-3] Regroupement IPv6 par /56 (une allocation résidentielle) : pas de milliers de compteurs par client.
            ipv6SubnetPrefix: 56,
            // Les tests automatisés enchaînent des centaines d'appels : limitation désactivée en NODE_ENV=test uniquement.
            skipIf: () => config.NODE_ENV === 'test',
          }),
        }),
      ],
      controllers,
      providers: [
        AuthService,
        LedgerService,
        MockProvider,
        ProviderRegistry,
        MockPspService,
        TerminalsService,
        OrganizationsService,
        PaymentsService,
        RefundsService,
        WebhooksService,
        ReconciliationService,
        ReceiptsService,
        NotificationsConsumer,
        AdminService,
        BillingService,
        EmailService,
        PasswordResetService,
        EmailVerificationService,
        AccountCleanupService,
        KeyRotationService,
        InvitationsService,
        KybDocumentsService,
        DevelopersService,
        JobsService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: PgThrottlerStorage, useValue: throttlerStorage },
        { provide: APP_GUARD, useClass: SecurityGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
