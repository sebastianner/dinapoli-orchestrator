import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import classNames from 'classnames';
import { useActiveEmployees, useInactiveEmployees } from '@/lib/queries';
import { login } from '@/lib/api';
import { avatarSrc } from '@/lib/avatar';
import { EmployeeCard } from '@/components/employee/EmployeeCard';
import { EmployeeModal } from '@/components/employee/EmployeeModal';
import { AdminLoginModal } from '@/components/employee/AdminLoginModal';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import type { Employee } from '@/types/api';

export const Route = createFileRoute('/select-employee')({
  component: SelectEmployeePage,
});

function SelectEmployeePage() {
  const [tab, setTab] = useState<'active' | 'inactive'>('active');
  const [adminLoginTarget, setAdminLoginTarget] = useState<Employee | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const { data: activeEmployees = [], isLoading: loadingActive } = useActiveEmployees();
  const { data: inactiveEmployees = [], isLoading: loadingInactive } = useInactiveEmployees();

  const setSessionEmployee = useSessionStore((s) => s.setEmployee);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const handleLoggedIn = (employee: Employee) => {
    setSessionEmployee(employee);
    setAdminLoginTarget(null);
    pushToast(`Bienvenido, ${employee.name}`);
    navigate({ to: '/tables' });
  };

  const handleSelect = async (employee: Employee) => {
    // Admins authenticate with a password; staff log in by picking their
    // name alone (see authService.login).
    if (employee.role === 'admin') {
      setAdminLoginTarget(employee);
      return;
    }
    try {
      const { employee: loggedIn } = await login(employee.id);
      handleLoggedIn(loggedIn);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo iniciar sesión', 'error');
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
        <ActiveTab employees={activeEmployees} loading={loadingActive} onSelect={handleSelect} onEdit={setEditingEmployee} />
      ) : (
        <InactiveTab employees={inactiveEmployees} loading={loadingInactive} />
      )}

      <AdminLoginModal employee={adminLoginTarget} onClose={() => setAdminLoginTarget(null)} onSuccess={handleLoggedIn} />
      <EmployeeModal open={editingEmployee != null} employee={editingEmployee ?? undefined} onClose={() => setEditingEmployee(null)} />
    </div>
  );
}

interface ActiveTabProps {
  employees: Employee[];
  loading: boolean;
  onSelect: (employee: Employee) => void;
  onEdit: (employee: Employee) => void;
}

function ActiveTab({ employees, loading, onSelect, onEdit }: ActiveTabProps) {
  if (loading) return <p className="text-sm text-text-secondary">Cargando empleados...</p>;

  if (employees.length === 0) {
    // Creating employees is admin-only now (see /dashboard/employees) - this
    // page is purely a login picker.
    return <p className="py-16 text-center text-sm text-text-secondary">Todavía no hay empleados registrados.</p>;
  }

  return (
    <div className="flex flex-wrap gap-6">
      {employees.map((employee) => (
        <EmployeeCard key={employee.id} employee={employee} onSelect={() => onSelect(employee)} onEdit={() => onEdit(employee)} />
      ))}
    </div>
  );
}

interface InactiveTabProps {
  employees: Employee[];
  loading: boolean;
}

function InactiveTab({ employees, loading }: InactiveTabProps) {
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
        </div>
      ))}
    </div>
  );
}
