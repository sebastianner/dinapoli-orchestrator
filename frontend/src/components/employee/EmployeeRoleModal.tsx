import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import classNames from 'classnames';
import { Modal } from '@/components/common/Modal';
import { avatarSrc } from '@/lib/avatar';
import { setEmployeeRole } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { Employee, EmployeeRole } from '@/types/api';

interface EmployeeRoleModalProps {
  employee: Employee | null;
  onClose: () => void;
}

/** Promotes/demotes an existing employee. Promoting to admin (or rotating an admin's password) needs a password; demoting to staff drops it. */
export function EmployeeRoleModal({ employee, onClose }: EmployeeRoleModalProps) {
  const [role, setRole] = useState<EmployeeRole>(employee?.role ?? 'staff');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const isPromoting = employee != null && employee.role !== 'admin' && role === 'admin';

  // This modal stays mounted across clicks (open/close via the `employee`
  // prop) - without this, picking a different employee would show the
  // previous one's leftover role/password state instead of theirs.
  useEffect(() => {
    setRole(employee?.role ?? 'staff');
    setPassword('');
    setError(null);
  }, [employee?.id, employee?.role]);

  const handleClose = () => {
    setRole(employee?.role ?? 'staff');
    setPassword('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setError(null);

    if (isPromoting && password.length < 6) {
      setError('Se necesita una contraseña de al menos 6 caracteres para hacerlo administrador');
      return;
    }

    setSubmitting(true);
    try {
      await setEmployeeRole(employee.id, role, password || undefined);
      await mutate('/employees/active');
      pushToast(`Rol de ${employee.name} actualizado`);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el rol');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={employee != null} onClose={handleClose} title="Cambiar rol">
      {employee && (
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-border bg-surface">
            <img src={avatarSrc(employee)} alt={employee.name} className="h-full w-full" />
          </div>
          <p className="text-sm font-medium text-text-primary">{employee.name}</p>

          <div className="flex w-full gap-1 rounded-full border border-border bg-surface p-1">
            {(['staff', 'admin'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRole(option)}
                className={classNames(
                  'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
                  role === option ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-brand-600',
                )}
              >
                {option === 'admin' ? 'Administrador' : 'Empleado'}
              </button>
            ))}
          </div>

          {role === 'admin' && (
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isPromoting ? 'Contraseña (mín. 6 caracteres)' : 'Nueva contraseña (opcional)'}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? 'Guardando...' : 'Guardar'}
          </button>
        </form>
      )}
    </Modal>
  );
}
