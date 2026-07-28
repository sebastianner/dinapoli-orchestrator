import { useEffect } from 'react';
import { mutate } from 'swr';
import { orderSocketClient } from '@/lib/orderSocket';
import { fetchOrder } from '@/lib/api';
import { useOrderStore } from '@/store/useOrderStore';

/**
 * Keeps every screen live without a manual refresh: connects the shared
 * order socket for the life of the session and reacts to the server's
 * broadcasts (order_updated, tables_updated - see server/src/ws/broadcast.ts)
 * instead of each page polling on its own. Renders nothing.
 */
export function LiveOrderUpdates() {
  const upsertActiveOrder = useOrderStore((s) => s.upsertActiveOrder);
  const removeActiveOrder = useOrderStore((s) => s.removeActiveOrder);

  useEffect(() => {
    orderSocketClient.connectPersistent();

    return orderSocketClient.listen((msg) => {
      if (msg.type === 'order_updated') {
        fetchOrder(msg.orderId)
          .then((order) => {
            upsertActiveOrder(order);
            mutate(`/orders/${msg.orderId}`, order, { revalidate: false });
          })
          .catch(() => {
            // 404 means the order was deleted (see orderService.deleteOrder) -
            // drop it everywhere instead of leaving stale data behind.
            removeActiveOrder(msg.orderId);
            mutate(`/orders/${msg.orderId}`, undefined, { revalidate: false });
          });
        mutate((key) => typeof key === 'string' && key.startsWith('/orders?'));
      } else if (msg.type === 'tables_updated') {
        mutate('/tables');
      }
    });
  }, [upsertActiveOrder, removeActiveOrder]);

  return null;
}
