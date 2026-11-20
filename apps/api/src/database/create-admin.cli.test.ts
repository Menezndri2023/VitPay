import { describe, expect, it } from 'vitest';
import { parseArgs } from './create-admin.cli';

describe('create-admin : arguments', () => {
  it('accepte une demande valide', () => {
    expect(parseArgs(['Ops@VitPay-ma.com', ' Manassé N’DRI ', 'super_admin'])).toEqual({ email: 'ops@vitpay-ma.com', fullName: 'Manassé N’DRI', role: 'super_admin' });
  });
  it('refuse les entrées invalides', () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(() => parseArgs(['pas-un-email', 'Nom Complet', 'admin'])).toThrow(/invalide/);
    expect(() => parseArgs(['a@b.ma', 'Nom Complet', 'root'])).toThrow(/Rôle inconnu/);
  });
});
