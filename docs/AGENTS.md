# VITPAY — Organisation des agents IA

Voir le rapport initial §10 pour la justification. Règles appliquées :

- **Vagues de 3 à 5 agents** au maximum. Zones de fichiers exclusives par agent (voir le tableau). Une branche, ou un worktree, par tâche.
- Les modules `ledger`, `payments`, `providers`, `webhooks`, `identity`, `platform` et `migrations` exigent **une revue indépendante (agent sécurité/finance) et une validation humaine**.
- Aucun agent n'a accès aux secrets de production ni ne déclenche de transaction réelle. Le garde-fou `PAYMENTS_LIVE_ENABLED` est codé.
- L'orchestrateur tient `docs/ROADMAP.md` à jour : terminé, bloqué, prochaines étapes.

| Agent | Zone |
|---|---|
| 01 Architecte | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, interfaces `providers/provider.interface.ts` |
| 02 Backend | `apps/api/src/modules/{identity,organizations,admin,receipts,notifications}` |
| 03 Frontend | `apps/{pay,business,admin}`, `packages/ui` |
| 05 Intégrations | `apps/api/src/modules/{providers,webhooks,mock-psp}` |
| 06 Finance & ledger | `packages/money`, `apps/api/src/modules/{ledger,payments,reconciliation}`, `migrations/003*` |
| 07 Sécurité & conformité | `docs/SECURITY.md`, `docs/COMPLIANCE.md`, `migrations/005*`, `identity/security.guard.ts` (revue) |
| 08 QA | `apps/api/test`, `**/*.test.ts`, `scripts/smoke.sh` |
| 09 DevOps | `docker-compose.yml`, `infra/`, `.github/` |
| 10 Produit & doc | `docs/*` (hors ADR) |

Le MVP actuel a été produit par un agent principal unique, pour garantir la cohérence du cœur financier. Une **revue indépendante** des modules finance et sécurité a été confiée à un agent distinct sans accès au contexte de conception.
