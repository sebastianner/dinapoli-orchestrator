import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useOrderStore } from '@/store/useOrderStore';
import type { PromoType } from '@/types/api';

export const Route = createFileRoute('/menu/promos')({
  component: PromosPage,
});

const PROMOS: { type: PromoType; title: string; price: string; description: string }[] = [
  {
    type: 'duo',
    title: 'Dúo',
    price: '$37.000',
    description: 'Elige 2: pizza personal (un solo sabor), lasaña, pasta o gratinado, en cualquier combinación.',
  },
  {
    type: 'pizza_xl',
    title: 'Pizza XL',
    price: '$80.000',
    description: 'Pizza XL (hasta 4 sabores) + gaseosa personal y panes al gratín de regalo.',
  },
];

function PromosPage() {
  const startPromo = useOrderStore((s) => s.startPromo);
  const navigate = useNavigate();

  const handleSelect = (type: PromoType) => {
    startPromo(type);
    navigate({ to: '/menu/pizzas' });
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Promociones</h1>
      <div className="flex flex-wrap gap-4">
        {PROMOS.map((promo) => (
          <button
            key={promo.type}
            type="button"
            onClick={() => handleSelect(promo.type)}
            className="anim-scale-in flex w-64 flex-col items-start gap-2 rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
              <Sparkles size={20} />
            </span>
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-semibold text-text-primary">{promo.title}</h2>
              <span className="font-semibold text-brand-700">{promo.price}</span>
            </div>
            <p className="text-sm text-text-secondary">{promo.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
