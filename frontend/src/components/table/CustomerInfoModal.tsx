import { useState } from 'react';
import { Plus, MapPin, Pencil } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { CustomerAutocomplete } from '@/components/customer/CustomerAutocomplete';
import { CustomerAddressForm } from '@/components/customer/CustomerAddressForm';
import { createCustomer, createCustomerAddress, updateCustomerAddress, type CustomerAddressInput } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import type { CustomerDisplayInfo } from '@/store/useOrderStore';
import type { Customer, CustomerAddress } from '@/types/api';

interface CustomerInfoModalProps {
  open: boolean;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  onClose: () => void;
  /**
   * `deliveryFee` is the address's neighborhood's fee (already known client-side, see
   * CustomerAddressForm/CustomerAddress.deliveryFee) - null for takeaway, so the caller can
   * default the order's delivery fee without re-querying the DB for it.
   */
  onSubmit: (customerId: number, customerAddressId: number | undefined, display: CustomerDisplayInfo, deliveryFee: number | null) => void;
}

type Step = { kind: 'search' } | { kind: 'create'; prefillName: string } | { kind: 'address'; customer: Customer };

// Colombian mobile numbers: 10 digits, starting with 3. Re-validated
// server-side too (customerService.ts) - this is UX only.
const PHONE_REGEX = /^3[0-9]{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatAddressDisplay(address: CustomerAddress): string {
  const parts = [address.streetAddress];
  if (address.addressLine2) parts.push(address.addressLine2);
  if (address.propertyType === 'APARTMENT') {
    const unitBits = [
      address.buildingName,
      address.tower ? `Torre ${address.tower}` : null,
      address.apartmentNumber ? `Apto ${address.apartmentNumber}` : null,
    ].filter((bit): bit is string => Boolean(bit));
    if (unitBits.length > 0) parts.push(unitBits.join(', '));
  }
  parts.push(address.neighborhoodName, address.cityName);
  return parts.join(', ');
}

type AddressFormState = { mode: 'create' } | { mode: 'edit'; address: CustomerAddress } | null;

/**
 * Takeaway needs a customer; delivery additionally needs one of that
 * customer's saved addresses (or a brand new/edited one). dine_in never
 * requires a customer, but this same modal is reused to let staff attach one
 * optionally (from the Order Overview panel) - identification only, no
 * address step, same as takeaway. See Customer Selection / Customer Address
 * Form in Todo.MD.
 */
export function CustomerInfoModal({ open, orderType, onClose, onSubmit }: CustomerInfoModalProps) {
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [addressForm, setAddressForm] = useState<AddressFormState>(null);
  const [submitting, setSubmitting] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const reset = () => {
    setStep({ kind: 'search' });
    setAddressForm(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const finish = (customerId: number, customerAddressId: number | undefined, display: CustomerDisplayInfo, deliveryFee: number | null) => {
    onSubmit(customerId, customerAddressId, display, deliveryFee);
    reset();
  };

  const handleSelectCustomer = (customer: Customer) => {
    if (orderType !== 'delivery') {
      finish(customer.id, undefined, { name: customer.name, phone: customer.phone, address: null }, null);
      return;
    }
    setStep({ kind: 'address', customer });
    setAddressForm(customer.addresses.length === 0 ? { mode: 'create' } : null);
  };

  const [createName, setCreateName] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateNew = (name: string) => {
    setCreateName(name);
    setCreatePhone('');
    setCreateEmail('');
    setCreateError(null);
    setStep({ kind: 'create', prefillName: name });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError('El nombre es obligatorio');
      return;
    }
    if (createPhone.trim() !== '' && !PHONE_REGEX.test(createPhone.trim())) {
      setCreateError('El teléfono debe tener 10 dígitos y empezar por 3');
      return;
    }
    if (createEmail.trim() !== '' && !EMAIL_REGEX.test(createEmail.trim())) {
      setCreateError('El correo no es válido');
      return;
    }
    setSubmitting(true);
    try {
      const customer = await createCustomer(createName.trim(), createPhone.trim() || undefined, createEmail.trim() || undefined);
      if (orderType !== 'delivery') {
        finish(customer.id, undefined, { name: customer.name, phone: customer.phone, address: null }, null);
      } else {
        setStep({ kind: 'address', customer });
        setAddressForm({ mode: 'create' });
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo crear el cliente');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectAddress = (customer: Customer, address: CustomerAddress) => {
    finish(customer.id, address.id, { name: customer.name, phone: customer.phone, address: formatAddressDisplay(address) }, address.deliveryFee);
  };

  const handleAddressFormSubmit = async (input: CustomerAddressInput, deliveryFee: number | null) => {
    if (step.kind !== 'address' || !addressForm) return;
    setSubmitting(true);
    try {
      if (addressForm.mode === 'edit') {
        const updated = await updateCustomerAddress(step.customer.id, addressForm.address.id, input);
        // Editing just fixes the saved address in place - it doesn't pick it
        // for this order, so go back to the list instead of finishing.
        setStep({
          kind: 'address',
          customer: { ...step.customer, addresses: step.customer.addresses.map((a) => (a.id === updated.id ? updated : a)) },
        });
        setAddressForm(null);
        pushToast('Dirección actualizada');
      } else {
        const created = await createCustomerAddress(step.customer.id, input);
        finish(step.customer.id, created.id, { name: step.customer.name, phone: step.customer.phone, address: formatAddressDisplay(created) }, deliveryFee);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo guardar la dirección', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelAddressForm = () => {
    if (step.kind === 'address' && addressForm?.mode === 'create' && step.customer.addresses.length === 0) {
      setStep({ kind: 'search' });
    }
    setAddressForm(null);
  };

  const title =
    step.kind === 'create'
      ? 'Nuevo cliente'
      : step.kind === 'address'
        ? 'Dirección de entrega'
        : orderType === 'delivery'
          ? 'Nuevo domicilio'
          : orderType === 'takeaway'
            ? 'Nuevo para llevar'
            : 'Agregar cliente';

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      {step.kind === 'search' && <CustomerAutocomplete onSelect={handleSelectCustomer} onCreateNew={handleCreateNew} />}

      {step.kind === 'create' && (
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Nombre del cliente"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          />
          <input
            type="tel"
            inputMode="numeric"
            value={createPhone}
            onChange={(e) => setCreatePhone(e.target.value.replace(/\D/g, ''))}
            placeholder="Teléfono (opcional, ej. 3001234567)"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          />
          <input
            type="email"
            value={createEmail}
            onChange={(e) => setCreateEmail(e.target.value)}
            placeholder="Correo (opcional)"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
          />
          {createError && <p className="text-sm text-danger">{createError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep({ kind: 'search' })}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              Atrás
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? 'Creando...' : 'Continuar'}
            </button>
          </div>
        </form>
      )}

      {step.kind === 'address' &&
        (addressForm ? (
          <CustomerAddressForm
            initial={addressForm.mode === 'edit' ? addressForm.address : undefined}
            onSubmit={handleAddressFormSubmit}
            onCancel={handleCancelAddressForm}
            submitting={submitting}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">{step.customer.name}</p>
            <div className="flex flex-col gap-2">
              {step.customer.addresses.map((address) => (
                <div
                  key={address.id}
                  className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors duration-fast hover:border-brand-400 hover:bg-brand-500/5"
                >
                  <button type="button" onClick={() => handleSelectAddress(step.customer, address)} className="flex flex-1 items-start gap-2 text-left">
                    <MapPin size={15} className="mt-0.5 shrink-0 text-brand-600" />
                    <span className="text-text-primary">{formatAddressDisplay(address)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddressForm({ mode: 'edit', address })}
                    aria-label="Editar dirección"
                    className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAddressForm({ mode: 'create' })}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              <Plus size={15} /> Agregar nueva dirección
            </button>
          </div>
        ))}
    </Modal>
  );
}
