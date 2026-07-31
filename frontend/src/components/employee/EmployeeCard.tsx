import classNames from 'classnames';
import { Pencil } from 'lucide-react';
import type { Employee } from '@/types/api';
import { avatarSrc } from '@/lib/avatar';
import { useAvatarOverrideStore } from '@/store/useAvatarOverrideStore';

interface EmployeeCardProps {
  employee: Employee;
  onSelect: () => void;
  onEdit: () => void;
}

export function EmployeeCard({ employee, onSelect, onEdit }: EmployeeCardProps) {
  const overrideSeed = useAvatarOverrideStore((s) => s.overrides[employee.id]);

  return (
    <div className="group anim-scale-in flex w-32 shrink-0 flex-col items-center gap-2">
      <div className="relative">
        {employee.role === 'admin' && (
          <span className="absolute -right-1 -top-1 z-10 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
            Admin
          </span>
        )}

        <div className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-border bg-surface-raised">
          <img src={avatarSrc(employee, overrideSeed)} alt={employee.name} className="h-full w-full" />

          {/* Mobile (below sm): tap the avatar to sign in directly - no hover
              to reveal a menu on touch, so editing isn't reachable here at
              all (desktop-only, see the overlay below). */}
          <button
            type="button"
            onClick={onSelect}
            aria-label={`Elegir a ${employee.name}`}
            className="absolute inset-0 sm:hidden"
          />

          {/* Desktop (sm and up): hover reveals both actions. */}
          <div className="absolute inset-0 hidden flex-col items-center justify-center gap-1.5 bg-black/55 opacity-0 backdrop-blur-[1px] transition-opacity duration-fast group-hover:opacity-100 sm:flex">
            <button
              type="button"
              onClick={onSelect}
              className="w-20 rounded-full bg-white py-1 text-xs font-semibold text-brand-700 transition-transform duration-fast hover:scale-105 active:scale-95"
            >
              Elegir
            </button>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Editar avatar de ${employee.name}`}
              className={classNames(
                'flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium text-white',
                'transition-colors duration-fast hover:bg-white/30',
              )}
            >
              <Pencil size={11} /> Editar
            </button>
          </div>
        </div>
      </div>

      <span className="max-w-full truncate text-sm font-medium text-text-primary">{employee.name}</span>
    </div>
  );
}
