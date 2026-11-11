/** Internationalisation (FR par défaut, AR en RTL, EN). Espagnol prévu (phase 9). */

export type Locale = 'fr' | 'ar' | 'en';
export const LOCALES: Locale[] = ['fr', 'ar', 'en'];
export const LOCALE_TAGS: Record<Locale, string> = { fr: 'fr-MA', ar: 'ar-MA', en: 'en-GB' };
export const isRtl = (l: Locale) => l === 'ar';

const fr = {
  'pay.title': 'Demande de paiement',
  'pay.beneficiary': 'Bénéficiaire',
  'pay.verified': 'Entreprise vérifiée',
  'pay.reason': 'Motif',
  'pay.reference': 'Référence',
  'pay.choose': 'Choisissez votre moyen de paiement',
  'pay.method.card': 'Payer par carte bancaire',
  'pay.method.bank_transfer': 'Payer par virement',
  'pay.method.mobile_money': 'Payer par Mobile Money',
  'pay.redirect': 'Vous allez être redirigé vers la page sécurisée du prestataire de paiement.',
  'pay.never': 'VITPAY ne vous demandera jamais votre code PIN, votre mot de passe bancaire ou un code OTP.',
  'pay.expires': 'Valable jusqu’au',
  'pay.status.paid': 'Paiement confirmé',
  'pay.status.paid.desc': 'Le prestataire de paiement a confirmé votre paiement.',
  'pay.status.expired': 'Cette demande a expiré',
  'pay.status.cancelled': 'Cette demande a été annulée',
  'pay.status.pending': 'Vérification en cours…',
  'pay.status.pending.desc': 'Nous attendons la confirmation du prestataire. Cette page se met à jour automatiquement.',
  'pay.status.failed': 'Le paiement n’a pas abouti',
  'pay.status.failed.desc': 'Aucun montant n’a été confirmé. Vous pouvez réessayer.',
  'pay.retry': 'Réessayer',
  'pay.receipt': 'Télécharger le reçu',
  'pay.notfound': 'Demande introuvable',
  'pay.unavailable': 'Cette demande ne peut pas être payée pour le moment.',
  'pay.processedBy': 'Paiement traité par un prestataire de paiement agréé. VITPAY ne conserve aucune donnée de carte.',
  'pay.sandbox': 'ENVIRONNEMENT DE TEST — AUCUN PAIEMENT RÉEL',
  'common.loading': 'Chargement…',
  'common.error': 'Une erreur est survenue. Réessayez.',
} as const;

export type MessageKey = keyof typeof fr;

const ar: Record<MessageKey, string> = {
  'pay.title': 'طلب دفع',
  'pay.beneficiary': 'المستفيد',
  'pay.verified': 'شركة موثقة',
  'pay.reason': 'السبب',
  'pay.reference': 'المرجع',
  'pay.choose': 'اختر وسيلة الدفع',
  'pay.method.card': 'الدفع بالبطاقة البنكية',
  'pay.method.bank_transfer': 'الدفع بالتحويل',
  'pay.method.mobile_money': 'الدفع عبر المحفظة الإلكترونية',
  'pay.redirect': 'سيتم تحويلك إلى الصفحة الآمنة لمزود الدفع.',
  'pay.never': 'لن تطلب منك VITPAY أبدًا رمزك السري أو كلمة مرور البنك أو رمز OTP.',
  'pay.expires': 'صالح حتى',
  'pay.status.paid': 'تم تأكيد الدفع',
  'pay.status.paid.desc': 'أكد مزود الدفع عملية الدفع.',
  'pay.status.expired': 'انتهت صلاحية هذا الطلب',
  'pay.status.cancelled': 'تم إلغاء هذا الطلب',
  'pay.status.pending': 'جارٍ التحقق…',
  'pay.status.pending.desc': 'ننتظر تأكيد مزود الدفع. يتم تحديث هذه الصفحة تلقائيًا.',
  'pay.status.failed': 'لم تتم عملية الدفع',
  'pay.status.failed.desc': 'لم يتم تأكيد أي مبلغ. يمكنك المحاولة مرة أخرى.',
  'pay.retry': 'إعادة المحاولة',
  'pay.receipt': 'تحميل الإيصال',
  'pay.notfound': 'الطلب غير موجود',
  'pay.unavailable': 'لا يمكن دفع هذا الطلب حاليًا.',
  'pay.processedBy': 'تتم معالجة الدفع من طرف مزود دفع معتمد. لا تحتفظ VITPAY بأي بيانات للبطاقة.',
  'pay.sandbox': 'بيئة اختبار — لا يوجد دفع حقيقي',
  'common.loading': 'جارٍ التحميل…',
  'common.error': 'حدث خطأ. حاول مرة أخرى.',
};

const en: Record<MessageKey, string> = {
  'pay.title': 'Payment request',
  'pay.beneficiary': 'Beneficiary',
  'pay.verified': 'Verified business',
  'pay.reason': 'Reason',
  'pay.reference': 'Reference',
  'pay.choose': 'Choose your payment method',
  'pay.method.card': 'Pay by card',
  'pay.method.bank_transfer': 'Pay by bank transfer',
  'pay.method.mobile_money': 'Pay with Mobile Money',
  'pay.redirect': 'You will be redirected to the payment provider’s secure page.',
  'pay.never': 'VITPAY will never ask for your PIN, online banking password or OTP code.',
  'pay.expires': 'Valid until',
  'pay.status.paid': 'Payment confirmed',
  'pay.status.paid.desc': 'The payment provider has confirmed your payment.',
  'pay.status.expired': 'This request has expired',
  'pay.status.cancelled': 'This request was cancelled',
  'pay.status.pending': 'Verifying…',
  'pay.status.pending.desc': 'We are waiting for the provider’s confirmation. This page updates automatically.',
  'pay.status.failed': 'The payment did not go through',
  'pay.status.failed.desc': 'No amount was confirmed. You can try again.',
  'pay.retry': 'Try again',
  'pay.receipt': 'Download receipt',
  'pay.notfound': 'Request not found',
  'pay.unavailable': 'This request cannot be paid at the moment.',
  'pay.processedBy': 'Payment processed by a licensed payment provider. VITPAY stores no card data.',
  'pay.sandbox': 'TEST ENVIRONMENT — NO REAL PAYMENT',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong. Please try again.',
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { fr, ar, en };

export function translator(locale: Locale) {
  return (key: MessageKey) => DICTS[locale][key] ?? fr[key];
}

export function pickLocale(input: string | null | undefined): Locale {
  const l = (input ?? '').slice(0, 2).toLowerCase();
  return (LOCALES as string[]).includes(l) ? (l as Locale) : 'fr';
}
