import { useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { mutate } from 'swr';
import { Pencil, Plus, RotateCcw, UserX } from 'lucide-react';
import { useActiveEmployees, useInactiveEmployees } from '@/lib/queries';
import { activateEmployee, deactivateEmployee } from '@/lib/api';
import { avatarSrc } from '@/lib/avatar';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import { EmployeeModal } from '@/components/employee/EmployeeModal';
import { EmployeeRoleModal } from '@/components/employee/EmployeeRoleModal';
import type { Employee } from '@/types/api';

export const Route = createFileRoute('/dashboard/employees/')({
  beforeLoad: () => {
    // Managing employees is admin-only (see routes/employees.ts) - bounce
    // anyone else back before the page even loads. The session store is
    // hydrated from the cookie session in __root.tsx, so this reflects the
    // real backend-enforced role, not a client-only guess.
    if (useSessionStore.getState().employee?.role !== 'admin') {
      throw redirect({ to: '/dashboard/order-history' });
    }
  },
  component: EmployeesAdminPage,
});

function EmployeesAdminPage() {
  const { data: activeEmployees = [], isLoading: loadingActive } = useActiveEmployees();
  const { data: inactiveEmployees = [], isLoading: loadingInactive } = useInactiveEmployees();
  const pushToast = useToastStore((s) => s.push);

  const [creating, setCreating] = useState(false);
  const [roleTarget, setRoleTarget] = useState<Employee | null>(null);

  const refreshLists = () => Promise.all([mutate('/employees/active'), mutate('/employees/inactive')]);

  const handleDeactivate = async (employee: Employee) => {
    try {
      await deactivateEmployee(employee.id);
      await refreshLists();
      pushToast(`${employee.name} fue desactivado`, 'warning');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo desactivar', 'error');
    }
  };

  const handleReactivate = async (employee: Employee) => {
    try {
      await activateEmployee(employee.id);
      await refreshLists();
      pushToast(`${employee.name} fue reactivado`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo reactivar', 'error');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Empleados</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={16} /> Crear empleado
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">Activos</h2>
        {loadingActive ? (
          <p className="text-sm text-text-secondary">Cargando...</p>
        ) : activeEmployees.length === 0 ? (
          <p className="text-sm text-text-secondary">Todavía no hay empleados registrados.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {activeEmployees.map((employee) => (
              <div key={employee.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                <img src={avatarSrc(employee)} alt={employee.name} className="h-10 w-10 rounded-full border border-border" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">{employee.name}</p>
                  <p className="text-xs text-text-secondary">{employee.role === 'admin' ? 'Administrador' : 'Empleado'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRoleTarget(employee)}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
                >
                  <Pencil size={12} /> Cambiar rol
                </button>
                <button
                  type="button"
                  onClick={() => handleDeactivate(employee)}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-danger hover:text-danger"
                >
                  <UserX size={12} /> Desactivar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">Inactivos</h2>
        {loadingInactive ? (
          <p className="text-sm text-text-secondary">Cargando...</p>
        ) : inactiveEmployees.length === 0 ? (
          <p className="text-sm text-text-secondary">No hay empleados inactivos.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {inactiveEmployees.map((employee) => (
              <div key={employee.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 opacity-70">
                <img src={avatarSrc(employee)} alt={employee.name} className="h-10 w-10 rounded-full border border-border grayscale" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">{employee.name}</p>
                  <p className="text-xs text-text-secondary">{employee.role === 'admin' ? 'Administrador' : 'Empleado'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleReactivate(employee)}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
                >
                  <RotateCcw size={12} /> Reactivar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <EmployeeModal open={creating} onClose={() => setCreating(false)} />
      <EmployeeRoleModal employee={roleTarget} onClose={() => setRoleTarget(null)} />
    </div>
  );
}
