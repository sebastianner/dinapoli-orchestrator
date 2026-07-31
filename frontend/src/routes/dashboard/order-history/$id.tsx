import { createFileRoute, useNavigate } from '@tanstack/react-router';
import classNames from 'classnames';
import { Printer, Receipt, CreditCard } from 'lucide-react';
import { useMenu, useOrder } from '@/lib/queries';
import { reprintOrderDocument } from '@/lib/api';
import { groupOrderItems } from '@/lib/pricing';
import { formatCOP } from '@/lib/format';
import { formatDateTime, formatTime } from '@/lib/date';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';
import type { Order, OrderStatus, PaymentMethod } from '@/types/api';

export const Route = createFileRoute('/dashboard/order-history/$id')({
  component: OrderDetailPage,
});

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

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'PENDING', label: 'Pendiente' },
  { status: 'PRINTING', label: 'Imprimiendo' },
  { status: 'ACTIVE', label: 'Activa' },
  { status: 'COMPLETED', label: 'Completada' },
];

function orderSubtitle(order: Order): string {
  if (order.orderType === 'dine_in') return `Mesa ${order.tableNumber}`;
  if (order.orderType === 'delivery') return `Domicilio - ${order.customerName}`;
  return `Para llevar - ${order.customerName}`;
}

function StatusTimeline({ order }: { order: Order }) {
  const currentIndex = Math.max(
    STEPS.findIndex((s) => s.status === order.status),
    0,
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex">
        {STEPS.map((step, i) => (
          <div key={step.status} className="relative flex flex-1 flex-col items-center gap-1">
            {i > 0 && (
              <div
                className={classNames('absolute top-[7px] h-[2px]', i <= currentIndex ? 'bg-success' : 'bg-border')}
                style={{ width: 'calc(100% - 14px)', right: 'calc(50% + 7px)' }}
              />
            )}
            <div className="relative z-10 flex h-[14px] w-[14px] items-center justify-center">
              {step.status === 'ACTIVE' && order.status === 'ACTIVE' && (
                <>
                  <span className="anim-pulse-ring absolute h-full w-full rounded-full bg-success" />
                  <span className="anim-pulse-ring absolute h-full w-full rounded-full bg-success" style={{ animationDelay: '0.8s' }} />
                </>
              )}
              <div
                className={classNames(
                  'h-[14px] w-[14px] rounded-full border-2',
                  i <= currentIndex ? 'border-success bg-success' : 'border-border bg-surface',
                )}
              />
            </div>
            <span className={classNames('text-sm font-medium', i <= currentIndex ? 'text-text-primary' : 'text-text-secondary')}>{step.label}</span>
            <span className="h-4 text-xs text-text-secondary">
              {i === 0 && formatTime(order.createdAt)}
              {i === STEPS.length - 1 && order.completedAt && formatTime(order.completedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderDetailPage() {
  const { id } = Route.useParams();
  const orderId = Number(id);
  const { data: order, isLoading } = useOrder(orderId);
  const { data: menu } = useMenu();
  const pushToast = useToastStore((s) => s.push);
  const openExistingOrder = useOrderStore((s) => s.openExistingOrder);
  const navigate = useNavigate();

  const handleReprint = async (kind: 'kitchen_ticket' | 'bill') => {
    try {
      await reprintOrderDocument(orderId, kind);
      pushToast('Reimpresión enviada');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo reimprimir', 'error');
    }
  };

  const handleCompleteOrder = () => {
    openExistingOrder(orderId);
    navigate({ to: '/menu' });
  };

  if (isLoading || !order) return <p className="p-6 text-sm text-text-secondary">Cargando...</p>;

  const net = order.grandTotal - order.discount;
  const items = groupOrderItems(menu, order.items);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">
          Orden #{order.id} · {orderSubtitle(order)}
        </h1>
      </div>

      <StatusTimeline order={order} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex w-full flex-col gap-3 lg:w-64 lg:shrink-0">
          <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-text-primary">Orden #{order.id}</span>
              <span className={classNames('rounded-full px-2 py-0.5 text-xs font-medium', statusStyles[order.status])}>{statusLabels[order.status]}</span>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-sm">
              <Field label="Tipo" value={orderTypeLabel(order)} />
              {order.customerName && <Field label="Cliente" value={order.customerName} />}
              {order.phone && <Field label="Teléfono" value={order.phone} />}
              {order.address && <Field label="Dirección" value={order.address} />}
              {order.employeeName && <Field label="Empleado" value={order.employeeName} />}
              <Field label="Creada" value={formatDateTime(order.createdAt)} />
              {order.completedAt && <Field label="Completada" value={formatDateTime(order.completedAt)} />}
              {order.notes && <Field label="Notas" value={order.notes} />}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleReprint('kitchen_ticket')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              <Printer size={15} /> Comanda
            </button>
            <button
              type="button"
              onClick={() => handleReprint('bill')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              <Receipt size={15} /> Factura
            </button>
          </div>

          {order.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={handleCompleteOrder}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-success py-2.5 text-sm font-semibold text-white transition-opacity duration-fast hover:opacity-90"
            >
              <CreditCard size={15} /> Completar orden
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-2 font-semibold text-text-primary">Artículos</div>
            {items.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary">
                    {item.quantity}x {item.description}
                  </p>
                  {item.notes && <p className="text-xs text-text-secondary">{item.notes}</p>}
                </div>
                <span className="shrink-0 font-medium text-text-secondary">{formatCOP(item.unitPrice * item.quantity)}</span>
              </div>
            ))}

            <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
              <TotalRow label="Subtotal" value={formatCOP(order.total)} />
              {order.discount > 0 && <TotalRow label="Descuento" value={`-${formatCOP(order.discount)}`} />}
              {order.tip > 0 && <TotalRow label="Propina" value={formatCOP(order.tip)} />}
              {order.deliveryFee > 0 && <TotalRow label="Domicilio" value={formatCOP(order.deliveryFee)} />}
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold text-text-primary">
                <span>Total</span>
                <span className={order.status === 'COMPLETED' ? 'text-success' : ''}>{formatCOP(net)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-2 font-semibold text-text-primary">Pagos</div>
            {order.payments.length === 0 ? (
              <p className="text-sm text-text-secondary">Sin pagos registrados todavía.</p>
            ) : (
              order.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-b-0">
                  <span className="text-text-primary">{paymentMethodLabels[payment.method]}</span>
                  <span className="font-medium text-text-secondary">{formatCOP(payment.grossAmount - payment.discount)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function orderTypeLabel(order: Order): string {
  if (order.orderType === 'dine_in') return `En mesa (Mesa ${order.tableNumber})`;
  if (order.orderType === 'delivery') return 'Domicilio';
  return 'Para llevar';
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-secondary">{label.toUpperCase()}</div>
      <div className="text-text-primary">{value}</div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
