import { Bike, LayoutGrid, ShoppingBag } from 'lucide-react';
import type { OrderType } from '@/types/api';

interface OrderContextBarProps {
  orderType: OrderType;
  tableNumber?: number;
  customerName?: string;
  customerAddress?: string | null;
}

/** Shows what the current order/draft is for - table number (dine_in) or customer name + delivery address (takeaway/delivery) - so it's visible while browsing the menu, not just in the Order Overview panel. */
export function OrderContextBar({ orderType, tableNumber, customerName, customerAddress }: OrderContextBarProps) {
  const isDineIn = orderType === 'dine_in';
  const TypeIcon = isDineIn ? LayoutGrid : orderType === 'delivery' ? Bike : ShoppingBag;
  const mainLabel = isDineIn ? `Mesa ${tableNumber}` : customerName;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-6 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-600">
        <TypeIcon size={17} />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-text-primary">{mainLabel}</p>
        {customerAddress && <p className="text-xs text-text-secondary">{customerAddress}</p>}
      </div>
    </div>
  );
}
