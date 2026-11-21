'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Espace commerçant bilingue : français (par défaut) et arabe (écriture de droite à gauche).
 * Couvre les écrans du quotidien (connexion, tableau de bord, demandes, caisse, notifications).
 * Les écrans d'administration de l'organisation (paramètres, développeurs) restent en français.
 * Traductions arabes à faire relire par un locuteur natif avant l'ouverture au public.
 */
export type Lang = 'fr' | 'ar';

const M = {
  // Coque
  'nav.dashboard': ['Tableau de bord', 'لوحة القيادة'],
  'nav.requests': ['Demandes', 'طلبات الدفع'],
  'nav.links': ['Liens de paiement', 'روابط الدفع'],
  'nav.pos': ['Caisse', 'الصندوق'],
  'nav.notifications': ['Notifications', 'الإشعارات'],
  'nav.config': ['Configuration', 'الإعدادات العامة'],
  'nav.settings': ['Paramètres', 'الإعدادات'],
  'nav.developers': ['Développeurs', 'المطورون'],
  'nav.new': ['Nouvelle demande', 'طلب جديد'],
  'nav.logout': ['Se déconnecter', 'تسجيل الخروج'],
  'nav.switchOrg': ['Changer d’organisation', 'تغيير المؤسسة'],
  'nav.language': ['Langue', 'اللغة'],
  'banner.verify': ['Confirmez votre adresse {email} avec le lien reçu par e-mail. D’ici là, la connexion d’un prestataire, l’équipe, les intégrations et le dossier KYB restent bloqués.', 'يرجى تأكيد عنوانك {email} عبر الرابط المرسل بالبريد الإلكتروني. إلى حين ذلك، يبقى ربط مزود الدفع والفريق والتكاملات وملف التحقق مقفلة.'],
  'banner.resend': ['Renvoyer le lien', 'إعادة إرسال الرابط'],
  'banner.sent': ['Nouveau lien envoyé.', 'تم إرسال رابط جديد.'],
  'banner.sendFailed': ['Envoi impossible pour l’instant, réessayez plus tard.', 'تعذر الإرسال حاليًا، حاول لاحقًا.'],
  'banner.suspended': ['Votre organisation est suspendue. Les nouvelles opérations sont bloquées. Contactez le support VITPAY.', 'تم تعليق مؤسستك. العمليات الجديدة موقوفة. يرجى الاتصال بدعم VITPAY.'],
  'common.loadFailed': ['VITPAY est momentanément injoignable. Vérifiez votre connexion.', 'تعذر الوصول إلى VITPAY حاليًا. تحقق من اتصالك.'],
  'common.retry': ['Réessayer', 'إعادة المحاولة'],
  'common.test': ['Test', 'اختبار'],
  'common.testMode': ['Mode test', 'وضع الاختبار'],
  'common.seeAll': ['Tout voir', 'عرض الكل'],
  'common.back': ['Retour', 'رجوع'],
  'common.noOrg': ['Votre compte n’est rattaché à aucune organisation (accès retiré ou invitation non acceptée). Contactez l’administrateur de votre organisation ou le support VITPAY.', 'حسابك غير مرتبط بأي مؤسسة. يرجى الاتصال بمسؤول مؤسستك أو بدعم VITPAY.'],
  'common.disclaimer': ['Les montants reflètent les confirmations reçues de votre prestataire de paiement. Les fonds sont détenus et reversés par votre prestataire, pas par VITPAY.', 'تعكس المبالغ التأكيدات الواردة من مزود الدفع الخاص بك. يحتفظ مزودك بالأموال ويحولها إليك، وليس VITPAY.'],

  // Tableau de bord
  'dash.hello': ['Bonjour, {name}', 'مرحبًا، {name}'],
  'dash.subtitle': ['{org} — activité des 30 derniers jours', '{org} — نشاط آخر 30 يومًا'],
  'dash.ready': ['Prêt à encaisser', 'جاهز للتحصيل'],
  'dash.steps': ['{done} sur {total} étapes', '{done} من {total} خطوات'],
  'dash.step.email': ['Confirmer votre adresse e-mail', 'تأكيد بريدك الإلكتروني'],
  'dash.step.email.text': ['Le lien vous a été envoyé à l’inscription.', 'تم إرسال الرابط إليك عند التسجيل.'],
  'dash.step.email.action': ['Voir le bandeau', 'عرض التنبيه'],
  'dash.step.provider': ['Connecter votre prestataire de paiement', 'ربط مزود الدفع الخاص بك'],
  'dash.step.provider.text': ['Les fonds vont directement de votre client à votre compte chez le prestataire.', 'تنتقل الأموال مباشرة من زبونك إلى حسابك لدى المزود.'],
  'dash.step.provider.action': ['Connecter', 'ربط'],
  'dash.step.kyb': ['Envoyer votre dossier entreprise (KYB)', 'إرسال ملف المقاولة (KYB)'],
  'dash.step.kyb.text': ['Raison sociale, ICE, RC et justificatifs : requis pour passer en paiements réels.', 'الاسم التجاري، ICE، السجل التجاري والوثائق: مطلوبة للانتقال إلى المدفوعات الحقيقية.'],
  'dash.step.kyb.action': ['Compléter', 'إكمال'],
  'dash.step.first': ['Créer votre première demande de paiement', 'إنشاء أول طلب دفع'],
  'dash.step.first.text': ['Un lien et un QR code à envoyer par WhatsApp, SMS ou e-mail.', 'رابط ورمز QR للإرسال عبر واتساب أو الرسائل القصيرة أو البريد الإلكتروني.'],
  'dash.step.first.action': ['Créer', 'إنشاء'],
  'dash.collected': ['Encaissé (30 jours)', 'المحصَّل (30 يومًا)'],
  'dash.confirmed': ['{n} paiement(s) confirmé(s)', '{n} دفعة مؤكدة'],
  'dash.open': ['En attente de paiement', 'في انتظار الدفع'],
  'dash.noOpen': ['Aucune demande ouverte', 'لا توجد طلبات مفتوحة'],
  'dash.closed': ['Expirées ou annulées', 'منتهية أو ملغاة'],
  'dash.30days': ['Sur 30 jours', 'خلال 30 يومًا'],
  'dash.chart': ['Encaissements confirmés par jour', 'التحصيلات المؤكدة يوميًا'],
  'dash.chart.empty': ['Aucun encaissement sur 30 jours', 'لا توجد تحصيلات خلال 30 يومًا'],
  'dash.chart.emptyText': ['Les paiements confirmés par votre prestataire apparaîtront ici, jour par jour.', 'ستظهر هنا المدفوعات التي يؤكدها مزودك، يومًا بيوم.'],
  'dash.today': ['Aujourd’hui', 'اليوم'],
  'dash.recent': ['Dernières demandes', 'آخر الطلبات'],
  'dash.recent.empty': ['Aucune demande pour l’instant', 'لا توجد طلبات حاليًا'],
  'dash.recent.emptyText': ['Créez un lien de paiement, envoyez-le à votre client : il paie par carte depuis son téléphone.', 'أنشئ رابط دفع وأرسله إلى زبونك: يدفع بالبطاقة من هاتفه.'],
  'dash.create': ['Créer une demande', 'إنشاء طلب'],

  // Liste des demandes
  'req.title': ['Demandes de paiement', 'طلبات الدفع'],
  'req.subtitle': ['Chaque demande est un lien unique que votre client paie par carte.', 'كل طلب هو رابط فريد يدفعه زبونك بالبطاقة.'],
  'req.export': ['Export CSV', 'تصدير CSV'],
  'req.search': ['Référence, motif, client…', 'المرجع، السبب، الزبون…'],
  'req.searchLabel': ['Rechercher une demande', 'البحث عن طلب'],
  'req.filter': ['Filtrer par statut', 'التصفية حسب الحالة'],
  'req.f.all': ['Toutes', 'الكل'],
  'req.f.open': ['En attente', 'في الانتظار'],
  'req.f.paid': ['Payées', 'مدفوعة'],
  'req.f.expired': ['Expirées', 'منتهية'],
  'req.f.cancelled': ['Annulées', 'ملغاة'],
  'req.col.ref': ['Référence', 'المرجع'],
  'req.col.reason': ['Motif', 'السبب'],
  'req.col.status': ['Statut', 'الحالة'],
  'req.col.created': ['Créée le', 'تاريخ الإنشاء'],
  'req.col.amount': ['Montant', 'المبلغ'],
  'req.none': ['Aucune demande pour le moment', 'لا توجد طلبات حاليًا'],
  'req.noneText': ['Créez un lien de paiement et partagez-le par WhatsApp, SMS ou e-mail.', 'أنشئ رابط دفع وشاركه عبر واتساب أو الرسائل القصيرة أو البريد الإلكتروني.'],
  'req.noMatch': ['Aucune demande ne correspond', 'لا يوجد طلب مطابق'],
  'req.noMatchText': ['Essayez une autre référence ou un autre statut.', 'جرّب مرجعًا أو حالة أخرى.'],
  'req.clear': ['Effacer les filtres', 'مسح عوامل التصفية'],
  'req.more': ['Afficher plus', 'عرض المزيد'],

  // Nouvelle demande
  'new.title': ['Nouvelle demande de paiement', 'طلب دفع جديد'],
  'new.subtitle': ['Vous obtenez un lien et un QR code. Votre client paie par carte, depuis son téléphone.', 'ستحصل على رابط ورمز QR. يدفع زبونك بالبطاقة من هاتفه.'],
  'new.amount': ['Montant (MAD)', 'المبلغ (درهم)'],
  'new.amountHint': ['Virgule ou point pour les centimes.', 'استعمل الفاصلة أو النقطة للسنتيمات.'],
  'new.reason': ['Motif (visible par le payeur)', 'السبب (يراه الدافع)'],
  'new.reasonPh': ['Ex. Facture n° 2026-104, acompte commande…', 'مثال: فاتورة رقم 2026-104، تسبيق طلبية…'],
  'new.ref': ['Référence de commande (facultatif, unique)', 'مرجع الطلبية (اختياري، فريد)'],
  'new.refHint': ['Une commande ne donne lieu qu’à une seule demande : protège contre les doublons.', 'طلبية واحدة = طلب دفع واحد: حماية من التكرار.'],
  'new.more': ['Plus d’options', 'خيارات إضافية'],
  'new.customer': ['Nom du client (privé)', 'اسم الزبون (خاص)'],
  'new.customerHint': ['Pour vos recherches ; jamais affiché au payeur.', 'لعمليات البحث فقط؛ لا يظهر للدافع.'],
  'new.customerEmail': ['E-mail du client (facultatif)', 'البريد الإلكتروني للزبون (اختياري)'],
  'new.customerEmailHint': ['Le reçu lui est envoyé automatiquement après le paiement.', 'يُرسل إليه الوصل تلقائيًا بعد الدفع.'],
  'new.validity': ['Validité du lien', 'صلاحية الرابط'],
  'new.v24': ['24 heures', '24 ساعة'],
  'new.v72': ['3 jours', '3 أيام'],
  'new.v168': ['7 jours', '7 أيام'],
  'new.v720': ['30 jours', '30 يومًا'],
  'new.submit': ['Générer le lien et le QR code', 'إنشاء الرابط ورمز QR'],
  'new.badAmount': ['Montant invalide : saisissez par exemple 500 ou 500,50 (minimum 1 MAD).', 'مبلغ غير صالح: أدخل مثلًا 500 أو 500,50 (الحد الأدنى 1 درهم).'],
  'new.openSettings': ['Ouvrir les paramètres', 'فتح الإعدادات'],
  'new.created': ['Demande créée — {amount}', 'تم إنشاء الطلب — {amount}'],
  'new.createdSub': ['Référence {ref}{reason}. Envoyez le lien ou faites scanner le QR code.', 'المرجع {ref}{reason}. أرسل الرابط أو اطلب مسح رمز QR.'],
  'new.testNote': ['Mode test : le paiement passera par le prestataire simulé. Aucun argent réel ne circule.', 'وضع الاختبار: سيتم الدفع عبر المزود التجريبي. لا تُتداول أموال حقيقية.'],
  'new.share': ['Partager avec votre client', 'المشاركة مع زبونك'],
  'new.follow': ['Suivre le paiement', 'تتبع الدفع'],
  'new.again': ['Nouvelle demande', 'طلب جديد'],

  // Partage
  'share.link': ['Lien de paiement', 'رابط الدفع'],
  'share.copy': ['Copier', 'نسخ'],
  'share.copied': ['Copié', 'تم النسخ'],
  'share.qr': ['Télécharger le QR', 'تحميل رمز QR'],
  'share.other': ['Partager…', 'مشاركة…'],
  'share.note': ['Le lien n’affiche que votre nom commercial, le montant et le motif. Votre client paie sur la page sécurisée de votre prestataire.', 'لا يعرض الرابط سوى اسمك التجاري والمبلغ والسبب. يدفع زبونك على الصفحة الآمنة لمزودك.'],
  'share.message': ['Demande de paiement de {amount}{reason} : {url}', 'طلب دفع بمبلغ {amount}{reason}: {url}'],

  // Détail
  'det.cancel': ['Annuler la demande', 'إلغاء الطلب'],
  'det.cancelConfirm': ['Annuler cette demande ? Le lien ne sera plus payable.', 'إلغاء هذا الطلب؟ لن يعود الرابط قابلًا للدفع.'],
  'det.cancelled': ['Demande annulée.', 'تم إلغاء الطلب.'],
  'det.receipt': ['Reçu {n}', 'الوصل {n}'],
  'det.order': ['commande {ref}', 'الطلبية {ref}'],
  'det.testNote': ['Demande en mode test (prestataire simulé) : aucun argent réel.', 'طلب في وضع الاختبار (مزود تجريبي): لا أموال حقيقية.'],
  'det.details': ['Détails', 'التفاصيل'],
  'det.reason': ['Motif', 'السبب'],
  'det.customer': ['Client', 'الزبون'],
  'det.created': ['Créée le', 'تاريخ الإنشاء'],
  'det.paidAt': ['Payée le', 'تاريخ الدفع'],
  'det.expires': ['Expire le', 'تنتهي في'],
  'det.validity': ['Validité', 'الصلاحية'],
  'det.share': ['Partager', 'مشاركة'],
  'det.attempts': ['Tentatives de paiement', 'محاولات الدفع'],
  'det.attemptsDesc': ['Un paiement n’est « confirmé » qu’après vérification par VITPAY auprès du prestataire.', 'لا يُعتبر الدفع «مؤكدًا» إلا بعد تحقق VITPAY منه لدى المزود.'],
  'det.noAttempt': ['Le client n’a pas encore ouvert le paiement.', 'لم يفتح الزبون صفحة الدفع بعد.'],
  'det.col.date': ['Date', 'التاريخ'],
  'det.col.provider': ['Prestataire', 'المزود'],
  'det.col.fee': ['Frais prestataire', 'رسوم المزود'],
  'det.col.settlement': ['Règlement', 'التسوية'],
  'det.cardPresent': ['Carte présente (TPE)', 'بطاقة حاضرة (جهاز الدفع)'],
  'det.simOk': ['Simuler : banque confirme', 'محاكاة: البنك يؤكد'],
  'det.simKo': ['Simuler : banque refuse', 'محاكاة: البنك يرفض'],
  'det.simDone': ['Réponse de la banque simulée : la confirmation arrive par notification du prestataire.', 'تمت محاكاة رد البنك: يصل التأكيد عبر إشعار المزود.'],
  'det.refunds': ['Remboursements', 'الاستردادات'],
  'det.refundsDesc': ['Le remboursement est exécuté par votre prestataire, sur la carte du client.', 'ينفذ مزودك الاسترداد على بطاقة الزبون.'],
  'det.refundOnlyAdmin': ['Seul un administrateur de l’organisation peut rembourser.', 'وحده مسؤول المؤسسة يمكنه الاسترداد.'],
  'det.refundAmount': ['Montant (vide = total)', 'المبلغ (فارغ = الكل)'],
  'det.refundReason': ['Raison', 'السبب'],
  'det.refundReasonPh': ['Ex. article retourné', 'مثال: منتج مُرجع'],
  'det.refund': ['Rembourser', 'استرداد'],
  'det.refundConfirm': ['Rembourser {what} au client ? Cette opération est transmise au prestataire et ne peut pas être annulée.', 'استرداد {what} للزبون؟ تُرسل هذه العملية إلى المزود ولا يمكن إلغاؤها.'],
  'det.refundAll': ['la totalité ({amount})', 'المبلغ كاملًا ({amount})'],
  'det.refundOk': ['Remboursement confirmé par le prestataire.', 'أكد المزود الاسترداد.'],
  'det.refundSent': ['Remboursement transmis au prestataire.', 'تم إرسال الاسترداد إلى المزود.'],
  'det.disputes': ['Litiges', 'النزاعات'],
  'det.disputeDefault': ['Contestation du payeur', 'اعتراض الدافع'],
  'det.history': ['Historique des événements', 'سجل الأحداث'],
  'det.historyDesc': ['Journal infalsifiable (chaîné) : chaque changement de statut est tracé.', 'سجل غير قابل للتزوير (متسلسل): يُسجَّل كل تغيير في الحالة.'],
  'det.backToList': ['Retour aux demandes', 'العودة إلى الطلبات'],

  // Caisse
  'pos.title': ['Caisse', 'الصندوق'],
  'pos.subtitle': ['Saisissez le montant : le client scanne le QR code ou paie sur le TPE.', 'أدخل المبلغ: يمسح الزبون رمز QR أو يدفع عبر جهاز الدفع.'],
  'pos.amount': ['Montant à encaisser', 'المبلغ المراد تحصيله'],
  'pos.generate': ['Générer le QR d’encaissement', 'إنشاء رمز QR للتحصيل'],
  'pos.tip': ['Astuce : sur ordinateur, tapez le montant au clavier puis Entrée.', 'نصيحة: على الحاسوب، اكتب المبلغ بلوحة المفاتيح ثم اضغط Entrée.'],
  'pos.sound': ['Signal sonore à la confirmation : {state}', 'تنبيه صوتي عند التأكيد: {state}'],
  'pos.on': ['activé', 'مفعّل'],
  'pos.off': ['désactivé', 'معطّل'],
  'pos.erase': ['Effacer', 'مسح'],
  'pos.pointOfSale': ['Point de vente', 'نقطة البيع'],
  'pos.scan': ['Le client scanne ce QR code avec son téléphone pour payer.', 'يمسح الزبون رمز QR هذا بهاتفه للدفع.'],
  'pos.waiting': ['En attente de la confirmation du prestataire…', 'في انتظار تأكيد المزود…'],
  'pos.sentTo': ['Montant envoyé au TPE « {name} »', 'تم إرسال المبلغ إلى جهاز الدفع «{name}»'],
  'pos.authorizing': ['Autorisation en cours…', 'التفويض جارٍ…'],
  'pos.presentCard': ['Le client présente ou insère sa carte sur le terminal.', 'يقدم الزبون بطاقته أو يدخلها في الجهاز.'],
  'pos.openSim': ['Ouvrir le TPE simulé (sandbox)', 'فتح جهاز الدفع التجريبي'],
  'pos.cancelOnTerminal': ['Annuler sur le TPE', 'إلغاء على جهاز الدفع'],
  'pos.orTerminal': ['Ou encaisser par carte sur un TPE', 'أو التحصيل بالبطاقة عبر جهاز الدفع'],
  'pos.terminal': ['Terminal', 'الجهاز'],
  'pos.sendToTerminal': ['Envoyer au TPE{name}', 'إرسال إلى جهاز الدفع{name}'],
  'pos.abandon': ['Abandonner', 'التخلي'],
  'pos.inProgress': ['Un paiement est en cours : attendez sa confirmation ou son échec.', 'هناك دفع جارٍ: انتظر تأكيده أو فشله.'],
  'pos.paid': ['Paiement confirmé', 'تم تأكيد الدفع'],
  'pos.reference': ['référence {ref}', 'المرجع {ref}'],
  'pos.again': ['Nouvel encaissement', 'تحصيل جديد'],
  'pos.seeDetail': ['Voir le détail et le reçu', 'عرض التفاصيل والوصل'],
  'pos.expired': ['Demande expirée.', 'انتهت صلاحية الطلب.'],
  'pos.cancelled': ['Demande annulée.', 'تم إلغاء الطلب.'],
  'pos.restart': ['Recommencer', 'البدء من جديد'],

  // Notifications
  'notif.title': ['Notifications', 'الإشعارات'],
  'notif.unread': ['{n} non lue(s)', '{n} غير مقروءة'],
  'notif.subtitle': ['Paiements confirmés, échecs, remboursements et alertes de votre organisation.', 'المدفوعات المؤكدة والفاشلة والاستردادات وتنبيهات مؤسستك.'],
  'notif.markAll': ['Tout marquer comme lu', 'تعليم الكل كمقروء'],
  'notif.empty': ['Aucune notification', 'لا توجد إشعارات'],
  'notif.emptyText': ['Vous serez prévenu ici dès qu’un client paie ou qu’un paiement échoue.', 'ستُخطَر هنا فور دفع زبون أو فشل دفعة.'],
  'notif.see': ['Voir la demande', 'عرض الطلب'],

  // Authentification
  'auth.tagline': ['Encaissez vos clients en un lien.', 'حصّل مدفوعات زبائنك برابط واحد.'],
  'auth.pitch': ['VITPAY relie votre activité à votre prestataire de paiement agréé, sans détenir vos fonds.', 'تربط VITPAY نشاطك بمزود الدفع المعتمد الخاص بك، دون الاحتفاظ بأموالك.'],
  'auth.p1': ['Liens et QR codes de paiement par carte, partagés par WhatsApp, SMS ou e-mail', 'روابط ورموز QR للدفع بالبطاقة، تُشارك عبر واتساب أو الرسائل أو البريد الإلكتروني'],
  'auth.p2': ['Votre propre compte prestataire : les fonds vous sont versés directement', 'حسابك الخاص لدى المزود: تُحوَّل الأموال إليك مباشرة'],
  'auth.p3': ['Suivi en temps réel, reçus, remboursements et export comptable', 'تتبع فوري، وصولات، استردادات وتصدير محاسبي'],
  'auth.product': ['VITPAY · un produit VIT GLOBAL TECHNOLOGIES', 'VITPAY · منتج من VIT GLOBAL TECHNOLOGIES'],
  'auth.netError': ['Connexion impossible. Vérifiez votre accès à Internet puis réessayez.', 'تعذر الاتصال. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.'],
  'login.title': ['Connexion', 'تسجيل الدخول'],
  'login.subtitle': ['Accédez à votre espace commerçant.', 'ادخل إلى فضاء التاجر الخاص بك.'],
  'login.email': ['E-mail', 'البريد الإلكتروني'],
  'login.password': ['Mot de passe', 'كلمة المرور'],
  'login.forgot': ['Mot de passe oublié ?', 'نسيت كلمة المرور؟'],
  'login.submit': ['Se connecter', 'تسجيل الدخول'],
  'login.noAccount': ['Pas encore de compte ?', 'ليس لديك حساب بعد؟'],
  'login.create': ['Créer un compte', 'إنشاء حساب'],
  'login.locked': ['Compte temporairement verrouillé. Réessayez dans 15 minutes.', 'الحساب مقفل مؤقتًا. أعد المحاولة بعد 15 دقيقة.'],
  'login.bad': ['E-mail ou mot de passe incorrect.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
  'reg.title': ['Créer un compte', 'إنشاء حساب'],
  'reg.subtitle': ['Essayez tout en mode test, puis connectez votre prestataire de paiement.', 'جرّب كل شيء في وضع الاختبار، ثم اربط مزود الدفع الخاص بك.'],
  'reg.name': ['Nom complet', 'الاسم الكامل'],
  'reg.email': ['E-mail professionnel', 'البريد الإلكتروني المهني'],
  'reg.password': ['Mot de passe', 'كلمة المرور'],
  'reg.passwordHint': ['12 caractères minimum. Une phrase de passe est plus simple à retenir.', '12 حرفًا على الأقل. عبارة المرور أسهل في التذكر.'],
  'reg.org': ['Nom commercial', 'الاسم التجاري'],
  'reg.orgHint': ['Affiché aux payeurs sur la page de paiement', 'يظهر للدافعين في صفحة الدفع'],
  'reg.type': ['Type de compte', 'نوع الحساب'],
  'reg.business': ['Entreprise / indépendant', 'مقاولة / مستقل'],
  'reg.personal': ['Particulier', 'فرد'],
  'reg.submit': ['Créer mon compte', 'إنشاء حسابي'],
  'reg.terms': ['En créant un compte, vous acceptez les conditions d’utilisation de VITPAY (à publier après validation juridique).', 'بإنشاء حساب، فإنك توافق على شروط استخدام VITPAY (ستُنشر بعد المصادقة القانونية).'],
  'reg.already': ['Déjà inscrit ?', 'مسجل بالفعل؟'],
  'reg.weak': ['Mot de passe trop faible : 12 caractères minimum, sans votre e-mail.', 'كلمة المرور ضعيفة: 12 حرفًا على الأقل، دون بريدك الإلكتروني.'],
  'reg.check': ['Vérifiez les champs du formulaire.', 'تحقق من حقول الاستمارة.'],
  'reg.failed': ['Inscription impossible. Vérifiez vos informations.', 'تعذر التسجيل. تحقق من معلوماتك.'],
} as const satisfies Record<string, readonly [string, string]>;

export type MsgKey = keyof typeof M;

const STATUS_AR: Record<string, string> = {
  open: 'في الانتظار',
  paid: 'مدفوعة',
  expired: 'منتهية',
  cancelled: 'ملغاة',
  partially_refunded: 'استرداد جزئي',
  refunded: 'مستردة',
  disputed: 'متنازع عليها',
  succeeded: 'مؤكد',
  failed: 'فاشل',
  pending: 'جارٍ',
  processing: 'قيد المعالجة',
  requires_action: 'إجراء مطلوب',
  created: 'منشأ',
  settled: 'تمت التسوية',
  unsettled: 'غير مسوى',
  requested: 'مطلوب',
  opened: 'مفتوح',
  won: 'مربوح',
  lost: 'خاسر',
};
const ROLE_AR: Record<string, string> = { owner: 'المالك', admin: 'مسؤول', cashier: 'أمين الصندوق', viewer: 'اطلاع فقط' };
const EVENT_AR: Record<string, string> = {
  'payment_request.created': 'تم إنشاء الطلب',
  'payment_request.cancelled': 'تم إلغاء الطلب',
  'payment_request.expired': 'انتهت صلاحية الطلب',
  'payment_attempt.created': 'فتح محاولة دفع',
  'payment_attempt.status_changed': 'حالة المحاولة',
  'payment_attempt.cancel_requested': 'طلب الإلغاء على الجهاز',
  'refund.requested': 'طلب استرداد',
  'refund.status_changed': 'حالة الاسترداد',
  'dispute.opened': 'فتح نزاع',
  'dispute.status_changed': 'حالة النزاع',
  'billing.fee_waived': 'إلغاء عمولة VITPAY',
};
const ACTOR_AR: Record<string, string> = { user: 'مستخدم', api_key: 'مفتاح API', public: 'الدافع', provider: 'المزود', system: 'النظام', admin: 'إدارة VITPAY' };

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: MsgKey, vars?: Record<string, string | number>) => string;
  /** Libellé arabe d'un statut / rôle / événement, ou le libellé français fourni. */
  tr: (kind: 'status' | 'role' | 'event' | 'actor', key: string, fr: string) => string;
  /** Format des dates et montants (chiffres latins en arabe, usage marocain). */
  tag: string;
}

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('fr');
  useEffect(() => {
    try {
      if (localStorage.getItem('vp_biz_lang') === 'ar') setLangState('ar');
    } catch {
      /* stockage indisponible */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('vp_biz_lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback(
    (k: MsgKey, vars?: Record<string, string | number>) => {
      let s: string = M[k][lang === 'ar' ? 1 : 0];
      if (vars) for (const [n, v] of Object.entries(vars)) s = s.replaceAll(`{${n}}`, String(v));
      return s;
    },
    [lang],
  );
  const tr = useCallback(
    (kind: 'status' | 'role' | 'event' | 'actor', key: string, fr: string) => {
      if (lang !== 'ar') return fr;
      const map = kind === 'status' ? STATUS_AR : kind === 'role' ? ROLE_AR : kind === 'event' ? EVENT_AR : ACTOR_AR;
      return map[key] ?? fr;
    },
    [lang],
  );
  return <LangCtx.Provider value={{ lang, setLang, t, tr, tag: lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA' }}>{children}</LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useT outside LangProvider');
  return c;
}

/** Sélecteur Français / العربية. */
export function LangSwitch({ dark }: { dark?: boolean }) {
  const { lang, setLang, t } = useT();
  return (
    <div className="vp-row" role="group" aria-label={t('nav.language')} style={{ gap: 4 }}>
      {(['fr', 'ar'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className="vp-btn vp-btn-sm"
          style={{
            minHeight: 30,
            padding: '2px 10px',
            background: lang === l ? (dark ? 'rgba(255,255,255,.16)' : 'var(--vp-primary-soft)') : 'transparent',
            color: dark ? '#fff' : 'var(--vp-text)',
            border: `1px solid ${dark ? 'rgba(255,255,255,.2)' : 'var(--vp-border-strong)'}`,
          }}
        >
          {l === 'fr' ? 'Français' : 'العربية'}
        </button>
      ))}
    </div>
  );
}
