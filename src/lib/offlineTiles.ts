import type { Coordinates } from './types';

const CITY_TILE_CACHE = 'osm-city-pack-v1';
const MIN_ZOOM = 12;
const MAX_ZOOM = 15;
const CITY_RADIUS_KM = 10;
const MAX_TILE_DOWNLOAD = 220;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapTileX(x: number, zoom: number): number {
  const tileCount = 2 ** zoom;
  return ((x % tileCount) + tileCount) % tileCount;
}

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const latitudeRadians = (lat * Math.PI) / 180;
  const tileCount = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * tileCount);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * tileCount,
  );

  return {
    x: wrapTileX(x, zoom),
    y: clamp(y, 0, tileCount - 1),
  };
}

function cityTileUrls(center: Coordinates): string[] {
  const latDelta = CITY_RADIUS_KM / 111.32;
  const lonDelta = CITY_RADIUS_KM / Math.max(0.12, 111.32 * Math.cos((center.lat * Math.PI) / 180));
  const minLat = clamp(center.lat - latDelta, -85, 85);
  const maxLat = clamp(center.lat + latDelta, -85, 85);
  const minLon = center.lon - lonDelta;
  const maxLon = center.lon + lonDelta;
  const urls = new Set<string>();

  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
    const topLeft = latLonToTile(maxLat, minLon, zoom);
    const bottomRight = latLonToTile(minLat, maxLon, zoom);
    const yMin = Math.min(topLeft.y, bottomRight.y);
    const yMax = Math.max(topLeft.y, bottomRight.y);

    for (let y = yMin; y <= yMax; y += 1) {
      for (let x = topLeft.x; x <= bottomRight.x; x += 1) {
        urls.add(`https://tile.openstreetmap.org/${zoom}/${wrapTileX(x, zoom)}/${y}.png`);
        if (urls.size >= MAX_TILE_DOWNLOAD) {
          return Array.from(urls);
        }
      }
    }
  }

  return Array.from(urls);
}

export async function prefetchCityTiles(center: Coordinates): Promise<number> {
  if (!('caches' in window)) {
    return 0;
  }

  const tileUrls = cityTileUrls(center);
  if (!tileUrls.length) {
    return 0;
  }

  const tileCache = await caches.open(CITY_TILE_CACHE);
  const previousEntries = await tileCache.keys();
  await Promise.all(previousEntries.map((request) => tileCache.delete(request)));

  let savedCount = 0;
  for (let index = 0; index < tileUrls.length; index += 12) {
    const chunk = tileUrls.slice(index, index + 12);
    const results = await Promise.allSettled(
      chunk.map(async (tileUrl) => {
        const response = await fetch(tileUrl, { mode: 'no-cors' });
        await tileCache.put(tileUrl, response.clone());
      }),
    );

    savedCount += results.filter((result) => result.status === 'fulfilled').length;
  }

  return savedCount;
}
