import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import type { CustomerInfo } from '@/types/api';

interface CustomerInfoModalProps {
  open: boolean;
  orderType: 'takeaway' | 'delivery';
  onClose: () => void;
  onSubmit: (customer: CustomerInfo) => void;
}

export function CustomerInfoModal({ open, orderType, onClose, onSubmit }: CustomerInfoModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setPhone('');
    setAddress('');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('El nombre del cliente es obligatorio');
      return;
    }
    if (orderType === 'delivery' && (!phone.trim() || !address.trim())) {
      setError('Teléfono y dirección son obligatorios para domicilio');
      return;
    }

    onSubmit({
      name: name.trim(),
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
    });
    reset();
  };

  return (
    <Modal open={open} onClose={handleClose} title={orderType === 'delivery' ? 'Nuevo domicilio' : 'Nuevo para llevar'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del cliente"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        />

        {orderType === 'delivery' && (
          <>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Teléfono"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Dirección"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
          </>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          className="mt-1 w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          Continuar al menú
        </button>
      </form>
    </Modal>
  );
}
