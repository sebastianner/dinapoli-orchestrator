import { createFileRoute } from '@tanstack/react-router';
import { UtensilsCrossed } from 'lucide-react';

export const Route = createFileRoute('/menu/')({
  component: MenuPage,
});

function MenuPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-text-secondary">
      <UtensilsCrossed size={40} strokeWidth={1.5} />
      <p className="text-sm">Elige una categoría del menú para empezar.</p>
    </div>
  );
}
