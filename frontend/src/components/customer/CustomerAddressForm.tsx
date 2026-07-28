import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { useCities, useNeighborhoods, useBuildingSuggestions } from '@/lib/queries';
import type { CustomerAddressInput } from '@/lib/api';
import type { CustomerAddress, PropertyType } from '@/types/api';

interface CustomerAddressFormProps {
  /** Present when editing an existing address; absent when adding a new one. */
  initial?: CustomerAddress;
  /**
   * `deliveryFee` is the just-selected neighborhood's fee, read straight out of the
   * already-fetched `useNeighborhoods` list (no extra request) so the caller can default
   * the order's delivery fee without a second lookup - null if no neighborhood is chosen yet.
   */
  onSubmit: (input: CustomerAddressInput, deliveryFee: number | null) => void;
  onCancel: () => void;
  submitting?: boolean;
}

// The DB supports 3 more property types (OFFICE/BUILDING/OTHER, see
// schema.sql) reserved for later - this form only exposes the two the todo's
// "Delivery Address Form" section actually asked for.
const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'HOUSE', label: 'Casa' },
  { value: 'APARTMENT', label: 'Apartamento' },
];

export function CustomerAddressForm({ initial, onSubmit, onCancel, submitting }: CustomerAddressFormProps) {
  const [streetAddress, setStreetAddress] = useState(initial?.streetAddress ?? '');
  const [addressLine2, setAddressLine2] = useState(initial?.addressLine2 ?? '');
  const [propertyType, setPropertyType] = useState<PropertyType>(initial?.propertyType ?? 'HOUSE');
  const [cityId, setCityId] = useState<number | null>(initial?.cityId ?? null);
  const [neighborhoodId, setNeighborhoodId] = useState<number | null>(initial?.neighborhoodId ?? null);
  const [apartmentNumber, setApartmentNumber] = useState(initial?.apartmentNumber ?? '');
  const [tower, setTower] = useState(initial?.tower ?? '');
  const [buildingName, setBuildingName] = useState(initial?.buildingName ?? '');
  const [buildingQuery, setBuildingQuery] = useState('');
  const [showBuildingSuggestions, setShowBuildingSuggestions] = useState(false);
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: cities = [] } = useCities();
  const { data: neighborhoods = [] } = useNeighborhoods(cityId);
  const { data: buildingSuggestions = [] } = useBuildingSuggestions(neighborhoodId, buildingQuery);

  // Cities default to the only one seeded (Cali) so staff don't have to
  // pick it every time - still overridable once more cities exist.
  useEffect(() => {
    if (cityId == null && cities.length > 0) setCityId(cities[0].id);
  }, [cities, cityId]);

  const handleCityChange = (id: number) => {
    setCityId(id);
    setNeighborhoodId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!streetAddress.trim()) {
      setError('La dirección es obligatoria');
      return;
    }
    if (!neighborhoodId) {
      setError('Elige un barrio');
      return;
    }
    const deliveryFee = neighborhoods.find((n) => n.id === neighborhoodId)?.deliveryFee ?? null;
    onSubmit(
      {
        streetAddress: streetAddress.trim(),
        addressLine2: addressLine2.trim() || undefined,
        propertyType,
        neighborhoodId,
        apartmentNumber: propertyType === 'APARTMENT' ? apartmentNumber.trim() || undefined : undefined,
        tower: propertyType === 'APARTMENT' ? tower.trim() || undefined : undefined,
        buildingName: propertyType === 'APARTMENT' ? buildingName.trim() || undefined : undefined,
        reference: reference.trim() || undefined,
      },
      deliveryFee,
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex w-full gap-1 rounded-full border border-border bg-surface p-1">
        {PROPERTY_TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPropertyType(option.value)}
            className={classNames(
              'flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
              propertyType === option.value ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-brand-600',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={streetAddress}
        onChange={(e) => setStreetAddress(e.target.value)}
        placeholder="Dirección (ej. Calle 123 #45-67)"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
      />

      <input
        type="text"
        value={addressLine2}
        onChange={(e) => setAddressLine2(e.target.value)}
        placeholder="Línea 2 (opcional, ej. casa 5, interior 2)"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
      />

      <div className="flex gap-2">
        <select
          value={cityId ?? ''}
          onChange={(e) => handleCityChange(Number(e.target.value))}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
        >
          <option value="" disabled>
            Ciudad
          </option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>

        <select
          value={neighborhoodId ?? ''}
          onChange={(e) => setNeighborhoodId(Number(e.target.value))}
          disabled={cityId == null}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400 disabled:opacity-50"
        >
          <option value="" disabled>
            Barrio
          </option>
          {neighborhoods.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>

      {propertyType === 'APARTMENT' && (
        <>
          <div className="relative">
            <input
              type="text"
              value={buildingName}
              onChange={(e) => {
                setBuildingName(e.target.value);
                setBuildingQuery(e.target.value);
                setShowBuildingSuggestions(true);
              }}
              onFocus={() => setShowBuildingSuggestions(true)}
              onBlur={() => setTimeout(() => setShowBuildingSuggestions(false), 150)}
              placeholder="Edificio / Conjunto"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            {showBuildingSuggestions && buildingSuggestions.length > 0 && (
              <div className="absolute z-10 mt-1 flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg">
                {buildingSuggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={() => {
                      setBuildingName(name);
                      setShowBuildingSuggestions(false);
                    }}
                    className="px-3 py-2 text-left text-sm text-text-primary hover:bg-brand-500/10"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={tower}
              onChange={(e) => setTower(e.target.value)}
              placeholder="Torre"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <input
              type="text"
              value={apartmentNumber}
              onChange={(e) => setApartmentNumber(e.target.value)}
              placeholder="Apto"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
          </div>
        </>
      )}

      <input
        type="text"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Punto de referencia (opcional)"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
        >
          {submitting ? 'Guardando...' : 'Guardar dirección'}
        </button>
      </div>
    </form>
  );
}
