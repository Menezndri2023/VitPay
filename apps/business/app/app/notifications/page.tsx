'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, EmptyState, errorText, formatDate, Icon, PageHeader, Skeleton } from '@vitpay/ui';
import { useOrg } from '../org-context';
import { useT } from '../../i18n';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  data: { requestId?: string };
}

export default function NotificationsPage() {
  const { orgApi } = useOrg();
  const { t, tag } = useT();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    orgApi<Notification[]>('/notifications')
      .then(setItems)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgApi]);

  const unread = items?.filter((n) => !n.readAt).length ?? 0;
  return (
    <div className="vp-stack-lg" style={{ maxWidth: 780 }}>
      <PageHeader
        title={t('notif.title')}
        subtitle={unread ? t('notif.unread', { n: unread }) : t('notif.subtitle')}
        actions={
          unread > 0 ? (
            <Button
              variant="ghost"
              icon="check"
              onClick={async () => {
                try {
                  await orgApi('/notifications/read', { method: 'POST' });
                  await load();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              {t('notif.markAll')}
            </Button>
          ) : undefined
        }
      />
      {error && <Alert kind="danger">{error}</Alert>}
      <Card>
        {!items ? (
          <div className="vp-stack">
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : !items.length ? (
          <EmptyState icon="bell" title={t('notif.empty')}>
            {t('notif.emptyText')}
          </EmptyState>
        ) : (
          <div className="vp-list">
            {items.map((n) => (
              <div key={n.id} className="vp-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12 }}>
                <span
                  aria-hidden="true"
                  style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 8, flex: 'none', background: n.readAt ? 'transparent' : 'var(--vp-attention)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="vp-row vp-between" style={{ gap: 8 }}>
                    <span style={{ fontWeight: n.readAt ? 500 : 700 }}>
                      {n.title}
                      {!n.readAt && <span className="vp-sr"> (non lue)</span>}
                    </span>
                    <span className="vp-muted vp-small">{formatDate(n.createdAt, tag)}</span>
                  </div>
                  <div className="vp-muted">
                    {n.body}{' '}
                    {n.data.requestId && (
                      <a href={`/app/requests/${n.data.requestId}`} style={{ whiteSpace: 'nowrap' }}>
                        {t('notif.see')} <Icon name="next" style={{ width: 14, height: 14, verticalAlign: 'middle' }} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
