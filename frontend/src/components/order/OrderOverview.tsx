import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { mutate } from 'swr';
import classNames from 'classnames';
import { CreditCard, Send, Trash2 } from 'lucide-react';
import { useOrderStore } from '@/store/useOrderStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import { useOrder } from '@/lib/queries';
import { formatCOP } from '@/lib/format';
import { addOrderItems, setOrderDeliveryFee, setOrderTip } from '@/lib/api';
import { orderSocketClient } from '@/lib/orderSocket';
import { PaymentModal } from '@/components/order/PaymentModal';

type TipMode = 'none' | 'ten' | 'twenty' | 'custom';

const TIP_PERCENTAGES: Record<'ten' | 'twenty', number> = { ten: 0.1, twenty: 0.2 };

export function OrderOverview() {
  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const cart = useOrderStore((s) => s.cart);
  const removeCartItem = useOrderStore((s) => s.removeCartItem);
  const clearCart = useOrderStore((s) => s.clearCart);
  const openExistingOrder = useOrderStore((s) => s.openExistingOrder);
  const upsertActiveOrder = useOrderStore((s) => s.upsertActiveOrder);
  const clearCurrentOrder = useOrderStore((s) => s.clearCurrentOrder);

  const employee = useSessionStore((s) => s.employee);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const { data: existingOrder } = useOrder(currentOrderId);

  const [tipMode, setTipMode] = useState<TipMode>('none');
  const [localTip, setLocalTip] = useState('0');
  const [localDeliveryFee, setLocalDeliveryFee] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (existingOrder) {
      const tenPct = Math.round(existingOrder.total * TIP_PERCENTAGES.ten);
      const twentyPct = Math.round(existingOrder.total * TIP_PERCENTAGES.twenty);
      if (existingOrder.tip === 0) setTipMode('none');
      else if (existingOrder.tip === tenPct) setTipMode('ten');
      else if (existingOrder.tip === twentyPct) setTipMode('twenty');
      else setTipMode('custom');
      setLocalTip(String(existingOrder.tip));
      setLocalDeliveryFee(String(existingOrder.deliveryFee));
    }
  }, [existingOrder]);

  const cartSubtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const existingSubtotal = existingOrder?.total ?? 0;
  const subtotal = existingSubtotal + cartSubtotal;

  const shouldShow = currentOrderId != null || cart.length > 0;
  if (!shouldShow) return null;

  const orderType = existingOrder?.orderType ?? newOrderInfo?.orderType;
  const isDelivery = orderType === 'delivery';

  const applyTip = async (amount: number) => {
    if (!existingOrder || amount === existingOrder.tip) return;
    try {
      const updated = await setOrderTip(existingOrder.id, amount);
      upsertActiveOrder(updated);
      await mutate(`/orders/${existingOrder.id}`, updated, { revalidate: false });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar la propina', 'error');
    }
  };

  const handlePercentClick = (mode: 'ten' | 'twenty') => {
    const nextMode = tipMode === mode ? 'none' : mode;
    const amount = nextMode === 'none' ? 0 : Math.round(subtotal * TIP_PERCENTAGES[mode]);
    setTipMode(nextMode);
    setLocalTip(String(amount));
    applyTip(amount);
  };

  const handleCustomClick = () => {
    const nextMode = tipMode === 'custom' ? 'none' : 'custom';
    setTipMode(nextMode);
    if (nextMode === 'none') {
      setLocalTip('0');
      applyTip(0);
    }
  };

  const handleCustomTipBlur = () => {
    applyTip(Number(localTip) || 0);
  };

  const handleDeliveryFeeBlur = async () => {
    if (!existingOrder) return;
    const fee = Number(localDeliveryFee) || 0;
    if (fee === existingOrder.deliveryFee) return;
    try {
      const updated = await setOrderDeliveryFee(existingOrder.id, fee);
      upsertActiveOrder(updated);
      await mutate(`/orders/${existingOrder.id}`, updated, { revalidate: false });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar el domicilio', 'error');
    }
  };

  const handleSubmitNewOrder = async () => {
    if (!newOrderInfo || cart.length === 0) return;
    setSubmitting(true);
    try {
      const order = await orderSocketClient.submitOrder({
        orderType: newOrderInfo.orderType,
        tableNumber: newOrderInfo.tableNumber,
        customer: newOrderInfo.customer,
        employeeId: employee?.id,
        tip: Number(localTip) || 0,
        deliveryFee: isDelivery ? Number(localDeliveryFee) || 0 : undefined,
        items: cart.map((item) => item.request),
      });
      upsertActiveOrder(order);
      openExistingOrder(order.id);
      pushToast('Orden enviada a cocina');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo enviar la orden', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToExistingOrder = async () => {
    if (!existingOrder || cart.length === 0) return;
    setSubmitting(true);
    try {
      const updated = await addOrderItems(
        existingOrder.id,
        cart.map((item) => item.request),
      );
      upsertActiveOrder(updated);
      await mutate(`/orders/${existingOrder.id}`, updated, { revalidate: false });
      clearCart();
      pushToast('Productos agregados a la orden');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudieron agregar los productos', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSuccess = () => {
    setPaymentOpen(false);
    clearCurrentOrder();
    pushToast('Orden cobrada y cerrada');
    navigate({ to: '/tables' });
  };

  return (
    <aside className="anim-slide-up flex w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold text-text-primary">
          {existingOrder ? orderTitle(existingOrder.orderType, existingOrder.tableNumber) : orderTitle(newOrderInfo?.orderType, newOrderInfo?.tableNumber)}
        </h2>
        {(existingOrder?.customerName ?? newOrderInfo?.customer?.name) && (
          <p className="text-xs text-text-secondary">{existingOrder?.customerName ?? newOrderInfo?.customer?.name}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {existingOrder?.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-text-primary">
                {item.quantity}x {describeCommittedItem(item)}
              </p>
              {item.notes && <p className="truncate text-xs text-text-secondary">{item.notes}</p>}
            </div>
            <span className="shrink-0 font-medium text-text-secondary">{formatCOP(item.unitPrice * item.quantity)}</span>
          </div>
        ))}

        {cart.map((item) => (
          <div key={item.clientId} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-text-primary">{item.label}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-medium text-text-primary">{formatCOP(item.unitPrice * item.quantity)}</span>
              <button
                type="button"
                onClick={() => removeCartItem(item.clientId)}
                aria-label="Quitar producto"
                className="text-text-secondary hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}

        {!existingOrder && cart.length === 0 && <p className="py-6 text-center text-sm text-text-secondary">Agrega productos del menú</p>}
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <div className="flex justify-between text-sm text-text-secondary">
          <span>Subtotal</span>
          <span className="font-medium text-text-primary">{formatCOP(subtotal)}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm text-text-secondary">
            <span>Propina</span>
            <span className="font-medium text-text-primary">{formatCOP(Number(localTip) || 0)}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => handlePercentClick('ten')}
              className={classNames(
                'flex-1 rounded-lg border py-1.5 text-sm font-semibold transition-colors duration-fast',
                tipMode === 'ten' ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-text-secondary hover:border-brand-400',
              )}
            >
              10%
            </button>
            <button
              type="button"
              onClick={() => handlePercentClick('twenty')}
              className={classNames(
                'flex-1 rounded-lg border py-1.5 text-sm font-semibold transition-colors duration-fast',
                tipMode === 'twenty' ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-text-secondary hover:border-brand-400',
              )}
            >
              20%
            </button>
            <button
              type="button"
              onClick={handleCustomClick}
              className={classNames(
                'flex-1 rounded-lg border py-1.5 text-sm font-semibold transition-colors duration-fast',
                tipMode === 'custom' ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-text-secondary hover:border-brand-400',
              )}
            >
              Otra
            </button>
          </div>
          {tipMode === 'custom' && (
            <input
              autoFocus
              type="number"
              min={0}
              value={localTip}
              onChange={(e) => setLocalTip(e.target.value)}
              onBlur={handleCustomTipBlur}
              placeholder="Monto de la propina"
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-text-primary outline-none focus:border-brand-400"
            />
          )}
        </div>

        {isDelivery && (
          <label className="flex items-center justify-between text-sm text-text-secondary">
            <span>Domicilio</span>
            <input
              type="number"
              min={0}
              value={localDeliveryFee}
              onChange={(e) => setLocalDeliveryFee(e.target.value)}
              onBlur={handleDeliveryFeeBlur}
              className="w-28 rounded-lg border border-border bg-surface px-2 py-1 text-right text-text-primary outline-none focus:border-brand-400"
            />
          </label>
        )}

        {existingOrder ? (
          <button
            type="button"
            onClick={handleAddToExistingOrder}
            disabled={cart.length === 0 || submitting}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-brand-400 py-2 text-sm font-semibold text-brand-600 transition-colors duration-fast hover:bg-brand-500/10 disabled:opacity-50"
          >
            <Send size={15} /> Agregar productos
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmitNewOrder}
            disabled={cart.length === 0 || submitting}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-50"
          >
            <Send size={15} /> Enviar orden
          </button>
        )}

        {existingOrder && (
          <button
            type="button"
            onClick={() => setPaymentOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-success py-2 text-sm font-semibold text-white transition-colors duration-fast hover:opacity-90"
          >
            <CreditCard size={15} /> Cobrar orden
          </button>
        )}
      </div>

      {paymentOpen && existingOrder && (
        <PaymentModal open={paymentOpen} order={existingOrder} onClose={() => setPaymentOpen(false)} onSuccess={handlePaymentSuccess} />
      )}
    </aside>
  );
}

function orderTitle(orderType: string | undefined, tableNumber: number | null | undefined): string {
  if (orderType === 'dine_in') return tableNumber ? `Mesa ${tableNumber}` : 'Mesa';
  if (orderType === 'delivery') return 'Domicilio';
  if (orderType === 'takeaway') return 'Para llevar';
  return 'Orden';
}

function describeCommittedItem(item: { menuItemRef: unknown; pizzaRef: { size: string; flavors: string[] } | null }): string {
  if (item.pizzaRef) return `Pizza ${item.pizzaRef.size} - ${item.pizzaRef.flavors.join(', ')}`;
  const ref = item.menuItemRef as { product: string } | null;
  return ref?.product ?? 'Producto';
}
