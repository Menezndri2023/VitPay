-- VITPAY — 014 : corrections de la troisième revue indépendante (11/11/2026).

-- [R3-8] Le rôle applicatif n'écrit plus de jeton de vérification e-mail (créé par le rôle système
-- après l'inscription) : une injection SQL sous ce rôle ne peut pas valider un compte arbitraire.
REVOKE INSERT ON email_verifications FROM vitpay_app;

-- [R3-1] Les comptes d'administration créés ou mis à jour par le CLI ont une adresse vérifiée.
UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE platform_role IS NOT NULL;
