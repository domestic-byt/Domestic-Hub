import { City } from './types';

export const ETHIOPIAN_CITIES: Record<string, City> = {
  'Addis Ababa': { name: 'Addis Ababa', lat: 9.03, lon: 38.74 },
  Adama: { name: 'Adama', lat: 8.54, lon: 39.27 },
  'Dire Dawa': { name: 'Dire Dawa', lat: 9.59, lon: 41.85 },
  Mekelle: { name: 'Mekelle', lat: 13.5, lon: 39.47 },
  'Bahir Dar': { name: 'Bahir Dar', lat: 11.59, lon: 37.39 },
  Gondar: { name: 'Gondar', lat: 12.6, lon: 37.47 },
  Hawassa: { name: 'Hawassa', lat: 7.06, lon: 38.47 },
  Jimma: { name: 'Jimma', lat: 7.67, lon: 36.83 },
  Dessie: { name: 'Dessie', lat: 11.13, lon: 39.63 },
  Nekemte: { name: 'Nekemte', lat: 9.09, lon: 36.55 },
  'Arba Minch': { name: 'Arba Minch', lat: 6.04, lon: 37.56 },
  Jijiga: { name: 'Jijiga', lat: 9.35, lon: 42.8 },
  Semera: { name: 'Semera', lat: 11.79, lon: 41.0 },
  Assosa: { name: 'Assosa', lat: 10.07, lon: 34.53 },
  Gambela: { name: 'Gambela', lat: 8.25, lon: 34.59 },
  Harar: { name: 'Harar', lat: 9.31, lon: 42.12 },
  'Debre Markos': { name: 'Debre Markos', lat: 10.35, lon: 37.72 },
};

const CITY_ALIASES: Record<string, string> = {
  addis: 'Addis Ababa',
  finfinne: 'Addis Ababa',
  awassa: 'Hawassa',
  'dire dawa town': 'Dire Dawa',
};

export function findCitiesInText(text: string): City[] {
  const lower = text.toLowerCase();
  const found: Array<{ city: City; index: number }> = [];
  for (const city of Object.values(ETHIOPIAN_CITIES)) {
    const index = lower.indexOf(city.name.toLowerCase());
    if (index >= 0) {
      found.push({ city, index });
    }
  }
  if (found.length === 0) {
    for (const [alias, cityName] of Object.entries(CITY_ALIASES)) {
      const index = lower.indexOf(alias);
      const city = ETHIOPIAN_CITIES[cityName];
      if (index >= 0 && city) {
        found.push({ city, index });
      }
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter(({ city }) => {
      if (seen.has(city.name)) return false;
      seen.add(city.name);
      return true;
    })
    .map(({ city }) => city);
}
