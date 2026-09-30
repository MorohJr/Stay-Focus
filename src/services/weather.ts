import { getSettings, nowIso, updateSettings } from './entity';

/**
 * The ONLY network access in the app (CLAUDE.md iron rule 1, SPEC 5.10).
 * Sends latitude/longitude (or a city name for search) to Open-Meteo. Nothing else leaves the device.
 */

const CACHE_MINUTES = 30;

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=he&format=json&name=${encodeURIComponent(query.trim())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const json = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
  return (json.results ?? []).map((r) => ({ name: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}

/** Refreshes the cached temperature if it's older than 30 minutes. Fails silently offline. */
export async function refreshWeather(force = false): Promise<void> {
  const s = await getSettings();
  if (!s.weather) return;
  if (!force && s.weatherCache && Date.now() - new Date(s.weatherCache.fetchedAt).getTime() < CACHE_MINUTES * 60_000) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.weather.lat.toFixed(3)}&longitude=${s.weather.lon.toFixed(3)}&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as { current?: { temperature_2m: number; weather_code: number } };
    if (!json.current) return;
    await updateSettings({ weatherCache: { fetchedAt: nowIso(), tempC: Math.round(json.current.temperature_2m), code: json.current.weather_code } });
  } catch {
    // offline: keep the cached value
  }
}

/** WMO weather code → Hebrew word + icon name. */
export function describeWeather(code: number): { text: string; icon: 'sun' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog' } {
  if (code === 0) return { text: 'בהיר', icon: 'sun' };
  if (code <= 2) return { text: 'מעונן חלקית', icon: 'cloud' };
  if (code === 3) return { text: 'מעונן', icon: 'cloud' };
  if (code === 45 || code === 48) return { text: 'ערפל', icon: 'fog' };
  if (code >= 51 && code <= 67) return { text: 'גשום', icon: 'rain' };
  if (code >= 71 && code <= 77) return { text: 'שלג', icon: 'snow' };
  if (code >= 80 && code <= 82) return { text: 'ממטרים', icon: 'rain' };
  if (code >= 85 && code <= 86) return { text: 'שלג', icon: 'snow' };
  if (code >= 95) return { text: 'סופה', icon: 'storm' };
  return { text: 'מעונן', icon: 'cloud' };
}
