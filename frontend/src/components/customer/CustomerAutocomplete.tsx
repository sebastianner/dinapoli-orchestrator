import { useState } from 'react';
import { Plus, User } from 'lucide-react';
import { useCustomerSearch } from '@/lib/queries';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { Customer } from '@/types/api';

interface CustomerAutocompleteProps {
  onSelect: (customer: Customer) => void;
  /** Called with whatever's currently typed when nothing matches (or the user wants someone new anyway). */
  onCreateNew: (name: string) => void;
}

/** Search-as-you-type customer picker. Debounces locally so typing fast doesn't fire a request per keystroke - lib/queries.useCustomerSearch itself is a plain SWR wrapper with no timing logic of its own. */
export function CustomerAutocomplete({ onSelect, onCreateNew }: CustomerAutocompleteProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);

  const { data: results = [], isLoading } = useCustomerSearch(debouncedQuery);

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nombre o teléfono"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
      />

      {query.trim() !== '' && (
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {isLoading && <p className="px-1 py-2 text-sm text-text-secondary">Buscando...</p>}
          {!isLoading &&
            results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => onSelect(customer)}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors duration-fast hover:border-brand-400 hover:bg-brand-500/5"
              >
                <User size={15} className="shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{customer.name}</p>
                  {customer.phone && <p className="truncate text-xs text-text-secondary">{customer.phone}</p>}
                </div>
              </button>
            ))}

          <button
            type="button"
            onClick={() => onCreateNew(query.trim())}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
          >
            <Plus size={15} /> Crear nuevo cliente "{query.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}
