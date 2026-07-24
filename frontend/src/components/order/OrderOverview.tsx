import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { mutate } from 'swr';
import classNames from 'classnames';
import { CreditCard, Send, Trash2 } from 'lucide-react';
import { useOrderStore, type CartItem } from '@/store/useOrderStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import { useMenu, useOrder } from '@/lib/queries';
import { formatCOP } from '@/lib/format';
import { addOrderItems } from '@/lib/api';
import { orderSocketClient } from '@/lib/orderSocket';
import { PaymentModal } from '@/components/order/PaymentModal';
import { allPizzaFlavors, formatPortionFraction, getPizzaCategory, getProduct } from '@/lib/pricing';
import { useOrderNotificationStore } from '@/store/useOrderNotificationStore';
import type { Menu, Order, OrderItem, PizzaCategory } from '@/types/api';

type TipMode = 'none' | 'ten' | 'twenty' | 'custom';

const TIP_PERCENTAGES: Record<'ten' | 'twenty', number> = { ten: 0.1, twenty: 0.2 };

export function OrderOverview() {
  const { data: menu } = useMenu();
  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const cart = useOrderStore((s) => s.cart);
  const removeCartItem = useOrderStore((s) => s.removeCartItem);
  const removeCartItems = useOrderStore((s) => s.removeCartItems);
  const clearCart = useOrderStore((s) => s.clearCart);
  const promoteDraftToOrder = useOrderStore((s) => s.promoteDraftToOrder);
  const upsertActiveOrder = useOrderStore((s) => s.upsertActiveOrder);
  const clearCurrentOrder = useOrderStore((s) => s.clearCurrentOrder);
  const pendingTip = useOrderStore((s) => s.pendingTip);
  const pendingDeliveryFee = useOrderStore((s) => s.pendingDeliveryFee);
  const pendingDiscount = useOrderStore((s) => s.pendingDiscount);
  const setPendingTip = useOrderStore((s) => s.setPendingTip);
  const setPendingDeliveryFee = useOrderStore((s) => s.setPendingDeliveryFee);
  const setPendingDiscount = useOrderStore((s) => s.setPendingDiscount);

  const employee = useSessionStore((s) => s.employee);
  const pushToast = useToastStore((s) => s.push);
  const showOrderNotification = useOrderNotificationStore((s) => s.show);
  const navigate = useNavigate();

  const { data: existingOrder } = useOrder(currentOrderId);

  // Tip/delivery fee/discount are purely client-side drafts until checkout
  // (see useOrderStore) - there's nowhere on the server to persist them
  // before a payment method is chosen. customTipOpen only exists to keep the
  // custom-amount input visible while it's still 0 (e.g. right after
  // clicking "Otra", before typing anything) - tipMode itself is derived
  // from pendingTip so it survives navigating away and back.
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const cartSubtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const existingSubtotal = existingOrder?.total ?? 0;
  const subtotal = existingSubtotal + cartSubtotal;

  const shouldShow = currentOrderId != null || cart.length > 0;
  if (!shouldShow) return null;

  const orderType = existingOrder?.orderType ?? newOrderInfo?.orderType;
  const isDelivery = orderType === 'delivery';

  const tenPct = Math.round(subtotal * TIP_PERCENTAGES.ten);
  const twentyPct = Math.round(subtotal * TIP_PERCENTAGES.twenty);
  const tipMode: TipMode =
    tenPct > 0 && pendingTip === tenPct
      ? 'ten'
      : twentyPct > 0 && pendingTip === twentyPct
        ? 'twenty'
        : pendingTip > 0 || customTipOpen
          ? 'custom'
          : 'none';

  const grossTotal = subtotal + pendingTip + (isDelivery ? pendingDeliveryFee : 0);
  const netTotal = grossTotal - pendingDiscount;

  const handlePercentClick = (mode: 'ten' | 'twenty') => {
    const turningOn = tipMode !== mode;
    setPendingTip(turningOn ? (mode === 'ten' ? tenPct : twentyPct) : 0);
    setCustomTipOpen(false);
  };

  const handleCustomClick = () => {
    const turningOn = tipMode !== 'custom';
    setCustomTipOpen(turningOn);
    if (!turningOn) setPendingTip(0);
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
        items: cart.map((item) => item.request),
      });
      upsertActiveOrder(order);
      promoteDraftToOrder(order.id);
      pushToast('Orden enviada a cocina');
      showOrderNotification('created');
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

  const handlePaymentSuccess = (completedOrder: Order) => {
    setPaymentOpen(false);
    upsertActiveOrder(completedOrder); // status is COMPLETED, so this drops it out of activeOrders / Órdenes activas
    clearCurrentOrder();
    pushToast('Orden cobrada y cerrada');
    showOrderNotification('closed');
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
        {groupCommittedItems(menu, existingOrder?.items ?? []).map((group) => (
          <div key={group.key} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate text-text-primary">
                {group.quantity}x {group.description}
              </p>
              {group.notes && <p className="truncate text-xs text-text-secondary">{group.notes}</p>}
            </div>
            <span className="shrink-0 font-medium text-text-secondary">{formatCOP(group.unitPrice * group.quantity)}</span>
          </div>
        ))}

        {groupCartItems(cart).map((group) => (
          <CartRow
            key={group.key}
            group={group}
            onRemoveOne={() => removeCartItem(group.clientIds[group.clientIds.length - 1])}
            onRemoveAll={() => removeCartItems(group.clientIds)}
          />
        ))}

        {!existingOrder && cart.length === 0 && <p className="py-6 text-center text-sm text-text-secondary">Agrega productos del menú</p>}
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <div className="flex justify-between text-sm text-text-secondary">
          <span>Subtotal</span>
          <span className="font-medium text-text-primary">{formatCOP(subtotal)}</span>
        </div>

        <label className="flex items-center justify-between text-sm text-text-secondary">
          <span>Descuento</span>
          <input
            type="number"
            min={0}
            value={pendingDiscount}
            onChange={(e) => setPendingDiscount(Number(e.target.value) || 0)}
            className="w-28 rounded-lg border border-border bg-surface px-2 py-1 text-right text-text-primary outline-none focus:border-brand-400"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm text-text-secondary">
            <span>Propina</span>
            <span className="font-medium text-text-primary">{formatCOP(pendingTip)}</span>
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
              value={pendingTip}
              onChange={(e) => setPendingTip(Number(e.target.value) || 0)}
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
              value={pendingDeliveryFee}
              onChange={(e) => setPendingDeliveryFee(Number(e.target.value) || 0)}
              className="w-28 rounded-lg border border-border bg-surface px-2 py-1 text-right text-text-primary outline-none focus:border-brand-400"
            />
          </label>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
          <span className="font-semibold text-text-primary">Total</span>
          {pendingDiscount > 0 ? (
            <span className="flex items-baseline gap-1.5">
              <span className="text-text-secondary line-through">{formatCOP(grossTotal)}</span>
              <span className="font-semibold text-success">{formatCOP(netTotal)}</span>
            </span>
          ) : (
            <span className="font-semibold text-text-primary">{formatCOP(netTotal)}</span>
          )}
        </div>

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

function pizzaSizeName(pizzas: PizzaCategory, sizeId: string): string {
  for (const group of pizzas.groups) {
    const size = group.sizes.find((s) => s.id === sizeId);
    if (size) return size.name;
  }
  return sizeId;
}

/** Order items only carry menu ids (e.g. 'margherita', 'large') - resolve them to their Spanish menu names for display. */
function describeCommittedItem(menu: Menu | undefined, item: OrderItem): string {
  const pizzas = menu ? getPizzaCategory(menu) : undefined;
  const flavorName = (flavorId: string) => (pizzas ? (allPizzaFlavors(pizzas).find((f) => f.id === flavorId)?.name ?? flavorId) : flavorId);

  if (item.pizzaRef) {
    const sizeName = pizzas ? pizzaSizeName(pizzas, item.pizzaRef.size) : item.pizzaRef.size;
    const flavorNames = item.pizzaRef.flavors.map(({ flavor, portion }) => {
      const name = flavorName(flavor);
      const fraction = formatPortionFraction(portion);
      return fraction ? `${name} (${fraction})` : name;
    });
    return `Pizza ${sizeName} - ${flavorNames.join(', ')}`;
  }

  const ref = item.menuItemRef;
  if (!ref) return 'Producto';
  const product = menu ? getProduct(menu, ref.category, ref.product) : undefined;
  const bits = [product?.name ?? ref.product];
  if (ref.size) bits.push(product?.sizes?.find((s) => s.id === ref.size)?.name ?? ref.size);
  if (ref.option) bits.push(product?.options?.find((o) => o.id === ref.option)?.name ?? ref.option);
  if (ref.pizzaFlavor) bits.push(flavorName(ref.pizzaFlavor));
  return bits.join(' - ');
}

interface GroupedCommittedItem {
  key: string;
  description: string;
  notes: string | null;
  unitPrice: number;
  quantity: number;
}

/** Collapses repeated additions of the same item (same ref + notes + price) into one row with a summed quantity. */
function groupCommittedItems(menu: Menu | undefined, items: OrderItem[]): GroupedCommittedItem[] {
  const groups = new Map<string, GroupedCommittedItem>();
  for (const item of items) {
    const key = JSON.stringify([item.pizzaRef, item.menuItemRef, item.notes, item.unitPrice]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      groups.set(key, {
        key,
        description: describeCommittedItem(menu, item),
        notes: item.notes,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      });
    }
  }
  return [...groups.values()];
}

interface GroupedCartItem {
  key: string;
  label: string;
  unitPrice: number;
  quantity: number;
  /** Cart entries folded into this row, most-recently-added last - removing the row pops from the end. */
  clientIds: string[];
}

/** Same idea as groupCommittedItems, but for the not-yet-submitted cart (grouped by label + request payload). */
function groupCartItems(cart: CartItem[]): GroupedCartItem[] {
  const groups = new Map<string, GroupedCartItem>();
  for (const item of cart) {
    const key = JSON.stringify([item.label, item.unitPrice, item.request]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.clientIds.push(item.clientId);
    } else {
      groups.set(key, { key, label: item.label, unitPrice: item.unitPrice, quantity: item.quantity, clientIds: [item.clientId] });
    }
  }
  return [...groups.values()];
}

const LONG_PRESS_MS = 600;

/** A grouped, not-yet-submitted cart line. Tap the trash icon to drop one; hold it to drop the whole group. */
function CartRow({ group, onRemoveOne, onRemoveAll }: { group: GroupedCartItem; onRemoveOne: () => void; onRemoveAll: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const startPress = () => {
    longPressFiredRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onRemoveAll();
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };
  const handleClick = () => {
    // A completed long-press already removed everything - swallow the click
    // that follows mouseup/touchend so it doesn't also remove one more.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onRemoveOne();
  };

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate text-text-primary">
          {group.quantity > 1 ? `${group.quantity}x ` : ''}
          {group.label}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-medium text-text-primary">{formatCOP(group.unitPrice * group.quantity)}</span>
        <button
          type="button"
          onMouseDown={startPress}
          onMouseUp={cancelPress}
          onMouseLeave={cancelPress}
          onTouchStart={startPress}
          onTouchEnd={cancelPress}
          onClick={handleClick}
          aria-label={group.quantity > 1 ? 'Quitar uno (mantén presionado para quitar todos)' : 'Quitar producto'}
          title={group.quantity > 1 ? 'Mantener para borrar todo' : undefined}
          className="text-text-secondary hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
