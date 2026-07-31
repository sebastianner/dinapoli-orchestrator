import { useCallback, useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { mutate } from 'swr';
import classNames from 'classnames';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useCities, useNeighborhoods } from '@/lib/queries';
import { deleteCity, deleteNeighborhood } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import { formatCOP } from '@/lib/format';
import { CityModal } from '@/components/location/CityModal';
import { NeighborhoodModal } from '@/components/location/NeighborhoodModal';
import type { City, Neighborhood } from '@/types/api';

/** Green/yellow/red at a glance, same tiers as the design mockup - free, standard (up to $5.000), or a higher zone fee. */
function feeTierClass(fee: number): string {
  if (fee === 0) return 'bg-success-bg text-success';
  if (fee <= 5000) return 'bg-warning-bg text-warning';
  return 'bg-danger-bg text-danger';
}

export const Route = createFileRoute('/ajustes/ubicaciones/')({
  // Admin-only - enforced by the parent /ajustes layout's beforeLoad.
  component: UbicacionesAdminPage,
});

type NeighborhoodModalState = { mode: 'create'; cityId: number } | { mode: 'edit'; neighborhood: Neighborhood };

/**
 * Unified search layout (design #5 of 5): one search box filters cities and
 * neighborhoods together, results grouped by city in a single scrolling
 * list - no separate city sidebar/tabs to navigate first, same layout at
 * every breakpoint.
 */
function UbicacionesAdminPage() {
  const { data: cities = [], isLoading: loadingCities } = useCities();
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<Record<number, boolean>>({});
  const [cityModal, setCityModal] = useState<{ mode: 'create' } | { mode: 'edit'; city: City } | null>(null);
  const [neighborhoodModal, setNeighborhoodModal] = useState<NeighborhoodModalState | null>(null);
  const pushToast = useToastStore((s) => s.push);

  // Each CityResultGroup fetches its own neighborhoods and reports back whether
  // it matched the query, so the parent can show one "nothing matches" message
  // instead of every group just silently disappearing with no explanation.
  const handleVisibilityChange = useCallback((cityId: number, visible: boolean) => {
    setVisibility((prev) => (prev[cityId] === visible ? prev : { ...prev, [cityId]: visible }));
  }, []);

  const handleDeleteCity = async (city: City) => {
    try {
      await deleteCity(city.id);
      await mutate('/locations/cities');
      pushToast(`${city.name} fue eliminada`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo eliminar la ciudad', 'error');
    }
  };

  const handleDeleteNeighborhood = async (neighborhood: Neighborhood) => {
    try {
      await deleteNeighborhood(neighborhood.id);
      await mutate(`/locations/cities/${neighborhood.cityId}/neighborhoods`);
      pushToast(`${neighborhood.name} fue eliminado`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo eliminar el barrio', 'error');
    }
  };

  const q = query.trim().toLowerCase();
  const noResults = q !== '' && cities.length > 0 && cities.every((c) => visibility[c.id] === false);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">Ciudades y barrios</h1>
        <button
          type="button"
          onClick={() => setCityModal({ mode: 'create' })}
          className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={16} /> Crear ciudad
        </button>
      </div>

      <label className="mb-6 flex max-w-md items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-text-secondary">
        <Search size={15} className="shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar ciudad o barrio…"
          className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
        />
      </label>

      {loadingCities ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : cities.length === 0 ? (
        <p className="text-sm text-text-secondary">Todavía no hay ciudades registradas.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {cities.map((city) => (
            <CityResultGroup
              key={city.id}
              city={city}
              query={q}
              onEditCity={() => setCityModal({ mode: 'edit', city })}
              onDeleteCity={() => handleDeleteCity(city)}
              onCreateNeighborhood={() => setNeighborhoodModal({ mode: 'create', cityId: city.id })}
              onEditNeighborhood={(neighborhood) => setNeighborhoodModal({ mode: 'edit', neighborhood })}
              onDeleteNeighborhood={handleDeleteNeighborhood}
              onVisibilityChange={handleVisibilityChange}
            />
          ))}
          {noResults && <p className="text-sm text-text-secondary">Nada coincide con "{query.trim()}".</p>}
        </div>
      )}

      <CityModal open={cityModal != null} onClose={() => setCityModal(null)} city={cityModal?.mode === 'edit' ? cityModal.city : undefined} />
      {neighborhoodModal && (
        <NeighborhoodModal
          open
          onClose={() => setNeighborhoodModal(null)}
          cityId={neighborhoodModal.mode === 'edit' ? neighborhoodModal.neighborhood.cityId : neighborhoodModal.cityId}
          neighborhood={neighborhoodModal.mode === 'edit' ? neighborhoodModal.neighborhood : undefined}
        />
      )}
    </div>
  );
}

interface CityResultGroupProps {
  city: City;
  /** Already trimmed + lowercased. */
  query: string;
  onEditCity: () => void;
  onDeleteCity: () => void;
  onCreateNeighborhood: () => void;
  onEditNeighborhood: (neighborhood: Neighborhood) => void;
  onDeleteNeighborhood: (neighborhood: Neighborhood) => void;
  onVisibilityChange: (cityId: number, visible: boolean) => void;
}

/** One search result group. Reuses the same per-city neighborhoods cache key every other location screen uses (so create/edit/delete elsewhere still invalidates it), then filters client-side against `query` alongside the city's own name - if the city name matches, every one of its neighborhoods shows; otherwise only the neighborhoods that themselves match. */
function CityResultGroup({
  city,
  query,
  onEditCity,
  onDeleteCity,
  onCreateNeighborhood,
  onEditNeighborhood,
  onDeleteNeighborhood,
  onVisibilityChange,
}: CityResultGroupProps) {
  const { data: neighborhoods = [], isLoading } = useNeighborhoods(city.id);

  const cityMatches = query === '' || city.name.toLowerCase().includes(query);
  const visibleNeighborhoods = cityMatches ? neighborhoods : neighborhoods.filter((n) => n.name.toLowerCase().includes(query));
  const visible = isLoading || cityMatches || visibleNeighborhoods.length > 0;

  useEffect(() => {
    onVisibilityChange(city.id, visible);
  }, [city.id, visible, onVisibilityChange]);

  if (!visible) return null;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-sm font-semibold text-text-primary">{city.name}</h2>
          {city.department && <span className="text-xs text-text-secondary">{city.department}</span>}
          <span className="text-xs text-text-secondary">
            · {visibleNeighborhoods.length} barrio{visibleNeighborhoods.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCreateNeighborhood}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
          >
            <Plus size={13} /> Barrio
          </button>
          <button
            type="button"
            onClick={onEditCity}
            aria-label={`Editar ${city.name}`}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-text-secondary hover:bg-brand-500/10 hover:text-brand-600"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onDeleteCity}
            aria-label={`Eliminar ${city.name}`}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-text-secondary hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : visibleNeighborhoods.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-text-secondary">
          Todavía no hay barrios registrados para esta ciudad.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleNeighborhoods.map((neighborhood) => (
            <div key={neighborhood.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">{neighborhood.name}</p>
              </div>
              <span className={classNames('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', feeTierClass(neighborhood.deliveryFee))}>
                {neighborhood.deliveryFee === 0 ? 'Gratis' : formatCOP(neighborhood.deliveryFee)}
              </span>
              <button
                type="button"
                onClick={() => onEditNeighborhood(neighborhood)}
                className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
              >
                <Pencil size={12} /> Editar
              </button>
              <button
                type="button"
                onClick={() => onDeleteNeighborhood(neighborhood)}
                className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-danger hover:text-danger"
              >
                <Trash2 size={12} /> Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
