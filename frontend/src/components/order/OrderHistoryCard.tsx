import classNames from 'classnames';
import { Printer, Receipt } from 'lucide-react';
import type { Order, OrderStatus } from '@/types/api';
import { formatCOP } from '@/lib/format';
import { formatTime } from '@/lib/date';
import { reprintOrderDocument } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';

const statusStyles: Record<OrderStatus, string> = {
  PENDING: 'bg-warning-bg text-warning',
  PRINTING: 'bg-warning-bg text-warning',
  ACTIVE: 'bg-brand-500/10 text-brand-600',
  COMPLETED: 'bg-success-bg text-success',
};

const statusLabels: Record<OrderStatus, string> = {
  PENDING: 'Pendiente',
  PRINTING: 'Imprimiendo',
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
};

function orderSubtitle(order: Order): string {
  if (order.orderType === 'dine_in') return `Mesa ${order.tableNumber}`;
  if (order.orderType === 'delivery') return `Domicilio - ${order.customerName}`;
  return `Para llevar - ${order.customerName}`;
}

interface OrderHistoryCardProps {
  order: Order;
}

export function OrderHistoryCard({ order }: OrderHistoryCardProps) {
  const pushToast = useToastStore((s) => s.push);

  const handleReprint = async (kind: 'kitchen_ticket' | 'bill') => {
    try {
      await reprintOrderDocument(order.id, kind);
      pushToast('Reimpresión enviada');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo reimprimir', 'error');
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">Orden #{order.id}</span>
          <span className={classNames('rounded-full px-2 py-0.5 text-xs font-medium', statusStyles[order.status])}>{statusLabels[order.status]}</span>
        </div>
        <p className="text-sm text-text-secondary">
          {orderSubtitle(order)} · {formatTime(order.createdAt)}
        </p>
      </div>

      <div className="flex items-center gap-4">
        {(() => {
          const gross = order.total + (order.tip ?? 0) + (order.deliveryFee ?? 0);
          const discount = order.discount ?? 0;
          if (discount > 0) {
            return (
              <span className="flex items-baseline gap-1.5">
                <span className="text-sm text-text-secondary line-through">{formatCOP(gross)}</span>
                <span className="font-semibold text-success">{formatCOP(gross - discount)}</span>
              </span>
            );
          }
          return <span className="font-semibold text-brand-700">{formatCOP(gross)}</span>;
        })()}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => handleReprint('kitchen_ticket')}
            title="Reimprimir comanda"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary hover:border-brand-400 hover:text-brand-600"
          >
            <Printer size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleReprint('bill')}
            title="Reimprimir factura"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary hover:border-brand-400 hover:text-brand-600"
          >
            <Receipt size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
