'use client';

import { useEffect, useState } from 'react';
import { isRtl, Locale, LOCALE_TAGS, pickLocale, translator } from '@vitpay/ui';

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>('fr');
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('vp_locale');
    } catch {
      /* stockage indisponible */
    }
    setLocaleState(pickLocale(stored ?? navigator.language));
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('vp_locale', l);
    } catch {
      /* ignore */
    }
  };
  return { locale, setLocale, t: translator(locale), tag: LOCALE_TAGS[locale] };
}

export interface PublicRequest {
  reference: string;
  beneficiary: { displayName: string; verified: boolean };
  amount: { minor: string; value: string; currency: string };
  description: string | null;
  status: 'open' | 'paid' | 'expired' | 'cancelled';
  payable: boolean;
  sandbox: boolean;
  expiresAt: string;
  paidAt: string | null;
  methods: ('card' | 'bank_transfer' | 'mobile_money')[];
  latestAttempt: { status: string; failureCode: string | null } | null;
}
