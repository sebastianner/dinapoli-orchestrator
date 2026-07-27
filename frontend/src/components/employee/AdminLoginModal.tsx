import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { avatarSrc } from '@/lib/avatar';
import { login, ApiError } from '@/lib/api';
import type { Employee } from '@/types/api';

interface AdminLoginModalProps {
  employee: Employee | null;
  onClose: () => void;
  onSuccess: (employee: Employee) => void;
}

/** Admin accounts need a password (see authService.login); staff log in by picking their name alone. */
export function AdminLoginModal({ employee, onClose, onSuccess }: AdminLoginModalProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setPassword('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setError(null);
    setSubmitting(true);
    try {
      const { employee: loggedIn } = await login(employee.id, password);
      onSuccess(loggedIn);
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Contraseña incorrecta' : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={employee != null} onClose={handleClose} title="Iniciar sesión de administrador">
      {employee && (
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-border bg-surface">
            <img src={avatarSrc(employee)} alt={employee.name} className="h-full w-full" />
          </div>
          <p className="text-sm font-medium text-text-primary">{employee.name}</p>

          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
          >
            {submitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      )}
    </Modal>
  );
}
