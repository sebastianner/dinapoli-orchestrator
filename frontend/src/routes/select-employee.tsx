import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { mutate } from 'swr';
import classNames from 'classnames';
import { Plus, RotateCcw } from 'lucide-react';
import { useActiveEmployees, useInactiveEmployees } from '@/lib/queries';
import { activateEmployee, deactivateEmployee } from '@/lib/api';
import { avatarSrc } from '@/lib/avatar';
import { EmployeeCard } from '@/components/employee/EmployeeCard';
import { EmployeeModal } from '@/components/employee/EmployeeModal';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import type { Employee } from '@/types/api';

export const Route = createFileRoute('/select-employee')({
  component: SelectEmployeePage,
});

type ModalState = { mode: 'create' } | { mode: 'edit'; employee: Employee } | null;

function SelectEmployeePage() {
  const [tab, setTab] = useState<'active' | 'inactive'>('active');
  const [modal, setModal] = useState<ModalState>(null);

  const { data: activeEmployees = [], isLoading: loadingActive } = useActiveEmployees();
  const { data: inactiveEmployees = [], isLoading: loadingInactive } = useInactiveEmployees();

  const setSessionEmployee = useSessionStore((s) => s.setEmployee);
  const sessionEmployee = useSessionStore((s) => s.employee);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const handleSelect = (employee: Employee) => {
    setSessionEmployee(employee);
    pushToast(`Bienvenido, ${employee.name}`);
    navigate({ to: '/tables' });
  };

  const handleDeactivate = async (employee: Employee) => {
    try {
      await deactivateEmployee(employee.id);
      await Promise.all([mutate('/employees/active'), mutate('/employees/inactive')]);
      if (sessionEmployee?.id === employee.id) setSessionEmployee(null);
      pushToast(`${employee.name} fue desactivado`, 'warning');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo desactivar', 'error');
    }
  };

  const handleReactivate = async (employee: Employee) => {
    try {
      await activateEmployee(employee.id);
      await Promise.all([mutate('/employees/active'), mutate('/employees/inactive')]);
      pushToast(`${employee.name} fue reactivado`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo reactivar', 'error');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">Seleccionar empleado</h1>

        <div className="flex gap-1 rounded-full border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setTab('active')}
            className={classNames(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-fast',
              tab === 'active' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-brand-600',
            )}
          >
            Activos
          </button>
          <button
            type="button"
            onClick={() => setTab('inactive')}
            className={classNames(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-fast',
              tab === 'inactive' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-brand-600',
            )}
          >
            Inactivos
          </button>
        </div>
      </div>

      {tab === 'active' ? (
        <ActiveTab
          employees={activeEmployees}
          loading={loadingActive}
          onSelect={handleSelect}
          onEdit={(employee) => setModal({ mode: 'edit', employee })}
          onDeactivate={handleDeactivate}
          onCreate={() => setModal({ mode: 'create' })}
        />
      ) : (
        <InactiveTab employees={inactiveEmployees} loading={loadingInactive} onReactivate={handleReactivate} />
      )}

      <EmployeeModal
        open={modal != null}
        employee={modal?.mode === 'edit' ? modal.employee : undefined}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

interface ActiveTabProps {
  employees: Employee[];
  loading: boolean;
  onSelect: (employee: Employee) => void;
  onEdit: (employee: Employee) => void;
  onDeactivate: (employee: Employee) => void;
  onCreate: () => void;
}

function ActiveTab({ employees, loading, onSelect, onEdit, onDeactivate, onCreate }: ActiveTabProps) {
  if (loading) return <p className="text-sm text-text-secondary">Cargando empleados...</p>;

  if (employees.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-text-secondary">Todavía no hay empleados registrados.</p>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          Crear empleado
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-6">
      {employees.map((employee) => (
        <EmployeeCard
          key={employee.id}
          employee={employee}
          onSelect={() => onSelect(employee)}
          onEdit={() => onEdit(employee)}
          onDeactivate={() => onDeactivate(employee)}
        />
      ))}

      <button
        type="button"
        onClick={onCreate}
        aria-label="Crear empleado"
        className="flex w-32 flex-col items-center gap-2 pt-0"
      >
        <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600">
          <Plus size={28} />
        </span>
        <span className="text-sm font-medium text-text-secondary">Crear empleado</span>
      </button>
    </div>
  );
}

interface InactiveTabProps {
  employees: Employee[];
  loading: boolean;
  onReactivate: (employee: Employee) => void;
}

function InactiveTab({ employees, loading, onReactivate }: InactiveTabProps) {
  if (loading) return <p className="text-sm text-text-secondary">Cargando empleados...</p>;

  if (employees.length === 0) {
    return <p className="py-16 text-center text-sm text-text-secondary">No hay empleados inactivos.</p>;
  }

  return (
    <div className="flex flex-wrap gap-6">
      {employees.map((employee) => (
        <div key={employee.id} className="anim-scale-in flex w-32 flex-col items-center gap-2">
          <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-border opacity-50 grayscale">
            <img src={avatarSrc(employee)} alt={employee.name} className="h-full w-full" />
          </div>
          <span className="max-w-full truncate text-sm font-medium text-text-secondary">{employee.name}</span>
          <button
            type="button"
            onClick={() => onReactivate(employee)}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
          >
            <RotateCcw size={12} /> Reactivar
          </button>
        </div>
      ))}
    </div>
  );
}
