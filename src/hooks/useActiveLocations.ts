import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

export type ActiveLocation = { location_code: string; location_name: string };

type LocationResponse = {
  rows?: { location_code?: string; location_name?: string; code?: string; name?: string; status?: string }[];
};

export function useActiveLocations() {
  const [locations, setLocations] = useState<ActiveLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiGet<LocationResponse>('/api/locations')
      .then((result) => {
        if (!active) return;
        const normalized = (result.rows || [])
          .filter((row) => !row.status || row.status.toLowerCase() === 'active')
          .map((row) => ({
            location_code: String(row.location_code || row.code || '').trim(),
            location_name: String(row.location_name || row.name || '').trim(),
          }))
          .filter((row) => row.location_code && row.location_name);
        const unique = Array.from(new Map(normalized.map((row) => [row.location_code, row])).values());
        unique.sort((a, b) => a.location_name.localeCompare(b.location_name));
        setLocations(unique);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load active locations.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { locations, loading, error };
}
