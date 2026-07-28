import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { mutate } from 'swr';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import classNames from 'classnames';
import { useCities, useNeighborhoods } from '@/lib/queries';
import { deleteCity, deleteNeighborhood } from '@/lib/api';
import { useToastStore } from '@/store/useToastStore';
import { formatCOP } from '@/lib/format';
import { CityModal } from '@/components/location/CityModal';
import { NeighborhoodModal } from '@/components/location/NeighborhoodModal';
import type { City, Neighborhood } from '@/types/api';

export const Route = createFileRoute('/ajustes/locations/')({
  // Admin-only - enforced by the parent /ajustes layout's beforeLoad.
  component: LocationsAdminPage,
});

function LocationsAdminPage() {
  const { data: cities = [], isLoading: loadingCities } = useCities();
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);
  const [cityModal, setCityModal] = useState<{ mode: 'create' } | { mode: 'edit'; city: City } | null>(null);
  const [neighborhoodModal, setNeighborhoodModal] = useState<{ mode: 'create' } | { mode: 'edit'; neighborhood: Neighborhood } | null>(null);
  const pushToast = useToastStore((s) => s.push);

  const selectedCity = cities.find((c) => c.id === selectedCityId) ?? cities[0] ?? null;
  const { data: neighborhoods = [], isLoading: loadingNeighborhoods } = useNeighborhoods(selectedCity?.id ?? null);

  const handleDeleteCity = async (city: City) => {
    try {
      await deleteCity(city.id);
      await mutate('/locations/cities');
      if (selectedCityId === city.id) setSelectedCityId(null);
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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Ciudades y barrios</h1>
        <button
          type="button"
          onClick={() => setCityModal({ mode: 'create' })}
          className="flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
        >
          <Plus size={16} /> Crear ciudad
        </button>
      </div>

      <div className="flex items-start gap-6">
        <section className="w-64 shrink-0">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">Ciudades</h2>
          {loadingCities ? (
            <p className="text-sm text-text-secondary">Cargando...</p>
          ) : cities.length === 0 ? (
            <p className="text-sm text-text-secondary">Todavía no hay ciudades registradas.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {cities.map((city) => (
                <div
                  key={city.id}
                  className={classNames(
                    'flex items-center gap-2 rounded-xl border p-3 transition-colors duration-fast',
                    selectedCity?.id === city.id ? 'border-brand-400 bg-brand-500/5' : 'border-border bg-surface',
                  )}
                >
                  <button type="button" onClick={() => setSelectedCityId(city.id)} className="flex-1 text-left">
                    <p className="text-sm font-medium text-text-primary">{city.name}</p>
                    {city.department && <p className="text-xs text-text-secondary">{city.department}</p>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCityModal({ mode: 'edit', city })}
                    aria-label={`Editar ${city.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-brand-500/10 hover:text-brand-600"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCity(city)}
                    aria-label={`Eliminar ${city.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Barrios{selectedCity ? ` de ${selectedCity.name}` : ''}
            </h2>
            {selectedCity && (
              <button
                type="button"
                onClick={() => setNeighborhoodModal({ mode: 'create' })}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
              >
                <Plus size={13} /> Crear barrio
              </button>
            )}
          </div>

          {!selectedCity ? (
            <p className="text-sm text-text-secondary">Elige una ciudad para ver sus barrios.</p>
          ) : loadingNeighborhoods ? (
            <p className="text-sm text-text-secondary">Cargando...</p>
          ) : neighborhoods.length === 0 ? (
            <p className="text-sm text-text-secondary">Todavía no hay barrios registrados para esta ciudad.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {neighborhoods.map((neighborhood) => (
                <div key={neighborhood.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">{neighborhood.name}</p>
                    <p className="text-xs text-text-secondary">Domicilio: {formatCOP(neighborhood.deliveryFee)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNeighborhoodModal({ mode: 'edit', neighborhood })}
                    className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
                  >
                    <Pencil size={12} /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteNeighborhood(neighborhood)}
                    className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-danger hover:text-danger"
                  >
                    <Trash2 size={12} /> Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <CityModal open={cityModal != null} onClose={() => setCityModal(null)} city={cityModal?.mode === 'edit' ? cityModal.city : undefined} />
      {selectedCity && (
        <NeighborhoodModal
          open={neighborhoodModal != null}
          onClose={() => setNeighborhoodModal(null)}
          cityId={selectedCity.id}
          neighborhood={neighborhoodModal?.mode === 'edit' ? neighborhoodModal.neighborhood : undefined}
        />
      )}
    </div>
  );
}
