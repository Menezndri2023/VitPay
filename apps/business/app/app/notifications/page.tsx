'use client';

import { useEffect, useState } from 'react';
import { Button, Card, formatDate } from '@vitpay/ui';
import { useOrg } from '../org-context';

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
  const [items, setItems] = useState<Notification[]>([]);
  const load = () => orgApi<Notification[]>('/notifications').then(setItems);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgApi]);

  return (
    <div className="vp-stack" style={{ maxWidth: 760 }}>
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Notifications</h1>
        <Button variant="ghost" onClick={async () => { await orgApi('/notifications/read', { method: 'POST' }); await load(); }}>
          Tout marquer comme lu
        </Button>
      </div>
      <Card>
        {!items.length && <p className="vp-muted">Aucune notification.</p>}
        {items.map((n) => (
          <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--vp-border)', fontWeight: n.readAt ? 400 : 600 }}>
            <div className="vp-row vp-between">
              <span>{n.title}</span>
              <span className="vp-muted vp-small">{formatDate(n.createdAt)}</span>
            </div>
            <div className="vp-muted">
              {n.body} {n.data.requestId && <a href={`/app/requests/${n.data.requestId}`}>Voir</a>}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
