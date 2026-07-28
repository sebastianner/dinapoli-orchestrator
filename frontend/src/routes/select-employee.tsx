import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import classNames from 'classnames';
import { Plus } from 'lucide-react';
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

// Matches --duration-slow in variables.scss, which .anim-push-out-left/
// -in-right (animations.scss) are keyed to - the setTimeout below just needs
// to not commit the new session/navigate until that CSS animation has
// actually finished playing.
const PUSH_TRANSITION_MS = 320;

type EmployeeModalState = { mode: 'create' } | { mode: 'edit'; employee: Employee } | null;

function SelectEmployeePage() {
  const [tab, setTab] = useState<'active' | 'inactive'>('active');
  const [adminLoginTarget, setAdminLoginTarget] = useState<Employee | null>(null);
  const [employeeModal, setEmployeeModal] = useState<EmployeeModalState>(null);
  const [leaving, setLeaving] = useState(false);

  // The gate screen shown before anyone is logged in (see __root.tsx) vs.
  // switching employees mid-session (reached via the Sidebar avatar while
  // already logged in) - the gate stays minimal (active employees only, no
  // management) while switching gets the full picker, tabs included.
  const sessionEmployee = useSessionStore((s) => s.employee);
  const alreadyLoggedIn = sessionEmployee != null;
  const isAdmin = sessionEmployee?.role === 'admin';

  const { data: activeEmployees = [], isLoading: loadingActive } = useActiveEmployees();
  const { data: inactiveEmployees = [], isLoading: loadingInactive } = useInactiveEmployees(alreadyLoggedIn);

  const setSessionEmployee = useSessionStore((s) => s.setEmployee);
  const markJustSelected = useSessionStore((s) => s.markJustSelected);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const handleLoggedIn = (employee: Employee) => {
    // Close the admin password modal (if open) and let the picker itself
    // play its exit animation before actually committing the session -
    // __root.tsx swaps to the full app shell the instant setSessionEmployee
    // fires, which would otherwise unmount this page mid-animation.
    setAdminLoginTarget(null);
    setLeaving(true);
    window.setTimeout(() => {
      markJustSelected();
      setSessionEmployee(employee);
      pushToast(`Bienvenido, ${employee.name}`);
      navigate({ to: '/tables' });
    }, PUSH_TRANSITION_MS);
  };

  const handleSelect = async (employee: Employee) => {
    if (leaving) return; // already mid-transition to another selection
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
    <div className={classNames('p-8', leaving && 'anim-push-out-left')}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">Seleccionar empleado</h1>

        <div className="flex items-center gap-3">
          {alreadyLoggedIn && (
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
          )}
        </div>
      </div>

      {tab === 'active' || !alreadyLoggedIn ? (
        <ActiveTab
          employees={activeEmployees}
          loading={loadingActive}
          onSelect={handleSelect}
          onEdit={(employee) => setEmployeeModal({ mode: 'edit', employee })}
          onCreate={alreadyLoggedIn && isAdmin ? () => setEmployeeModal({ mode: 'create' }) : undefined}
        />
      ) : (
        <InactiveTab employees={inactiveEmployees} loading={loadingInactive} />
      )}

      <AdminLoginModal employee={adminLoginTarget} onClose={() => setAdminLoginTarget(null)} onSuccess={handleLoggedIn} />
      <EmployeeModal
        open={employeeModal != null}
        employee={employeeModal?.mode === 'edit' ? employeeModal.employee : undefined}
        onClose={() => setEmployeeModal(null)}
      />
    </div>
  );
}

interface ActiveTabProps {
  employees: Employee[];
  loading: boolean;
  onSelect: (employee: Employee) => void;
  onEdit: (employee: Employee) => void;
  /** Admin-only, switching-context-only (see SelectEmployeePage) - absent hides the tile entirely. */
  onCreate?: () => void;
}

function ActiveTab({ employees, loading, onSelect, onEdit, onCreate }: ActiveTabProps) {
  if (loading) return <p className="text-sm text-text-secondary">Cargando empleados...</p>;

  if (employees.length === 0 && !onCreate) {
    // Creating employees is admin-only now (see /ajustes/employees) - this
    // page is purely a login picker.
    return <p className="py-16 text-center text-sm text-text-secondary">Todavía no hay empleados registrados.</p>;
  }

  return (
    <div className="flex flex-wrap gap-6">
      {employees.map((employee) => (
        <EmployeeCard key={employee.id} employee={employee} onSelect={() => onSelect(employee)} onEdit={() => onEdit(employee)} />
      ))}

      {onCreate && (
        <button type="button" onClick={onCreate} aria-label="Crear empleado" className="flex w-32 flex-col items-center gap-2">
          <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600">
            <Plus size={28} />
          </span>
          <span className="text-sm font-medium text-text-secondary">Crear empleado</span>
        </button>
      )}
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
