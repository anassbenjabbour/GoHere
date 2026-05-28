import { bearingDegrees, destinationPoint, formatCoords, haversineDistanceMeters, placeSignature, randomPointBetween, routeKey } from './geo';
import type { Coordinates, ExplorationMode, PlaceCandidate, RouteResult, RouteStep } from './types';

interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: Coordinates;
  tags?: Record<string, string>;
  type: string;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface NominatimSearchResult {
  lat: string;
  lon: string;
  display_name: string;
  place_id: number;
  type?: string;
  class?: string;
}

interface NominatimReverseResult {
  display_name: string;
  name?: string;
}

interface OsrmRouteResponse {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    geometry: {
      coordinates: Array<[number, number]>;
    };
    legs: Array<{
      steps: Array<{
        maneuver?: {
          instruction?: string;
          type?: string;
          modifier?: string;
        };
        name: string;
        distance: number;
        duration: number;
        geometry?: {
          coordinates: Array<[number, number]>;
        };
      }>;
    }>;
  }>;
}

const MODE_SETTINGS: Record<ExplorationMode, { minimumRadius: number; maximumRadius: number; queryRadius: number }> = {
  nearby: { minimumRadius: 700, maximumRadius: 4_000, queryRadius: 4_000 },
  medium: { minimumRadius: 3_000, maximumRadius: 15_000, queryRadius: 15_000 },
  far: { minimumRadius: 10_000, maximumRadius: 50_000, queryRadius: 50_000 },
  anywhere: { minimumRadius: 1_500, maximumRadius: 120_000, queryRadius: 120_000 },
};

const PLACE_QUERY = `
[out:json][timeout:20];
(
  nwr(around:__RADIUS__,__LAT__,__LON__)["amenity"~"cafe|restaurant|library|marketplace|bar|pub|biergarten"];
  nwr(around:__RADIUS__,__LAT__,__LON__)["leisure"~"park|garden|nature_reserve|playground|dog_park|pitch|beach_resort"];
  nwr(around:__RADIUS__,__LAT__,__LON__)["tourism"~"viewpoint|museum|gallery|attraction|camp_site|picnic_site|artwork|information|theme_park"];
  nwr(around:__RADIUS__,__LAT__,__LON__)["natural"~"peak|wood|tree|spring|hot_spring|waterfall|saddle|ridge|bare_rock|heath|shingle|beach|cape"];
  nwr(around:__RADIUS__,__LAT__,__LON__)["historic"];
);
out center tags;
`;

const CATEGORY_PRIORITY = ['viewpoint', 'park', 'garden', 'cafe', 'museum', 'gallery', 'attraction', 'forest', 'peak', 'beach', 'spring', 'historic'];
const PRIVATE_OR_WATER_TAGS = new Set(['water', 'reservoir', 'bay', 'wetland', 'river', 'stream', 'lake']);

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function normalizeName(value?: string): string {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[-,]+|[-,]+$/g, '');
}

function elementCoordinates(element: OverpassElement): Coordinates | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lon: element.lon };
  }

  if (element.center && Number.isFinite(element.center.lat) && Number.isFinite(element.center.lon)) {
    return element.center;
  }

  return null;
}

function buildDisplayName(tags: Record<string, string> | undefined): string {
  if (!tags) {
    return 'Unnamed place';
  }

  return normalizeName(
    tags.name ||
      tags['name:en'] ||
      tags.brand ||
      tags.operator ||
      tags.tourism ||
      tags.amenity ||
      tags.leisure ||
      tags.natural ||
      tags.historic ||
      'Unnamed place',
  );
}

function buildCategory(tags: Record<string, string> | undefined): string {
  if (!tags) {
    return 'location';
  }

  const detectedCategory = CATEGORY_PRIORITY.find((category) => Object.values(tags).some((value) => value === category));
  if (detectedCategory) {
    return detectedCategory;
  }

  return tags.tourism || tags.amenity || tags.leisure || tags.natural || tags.historic || 'location';
}

function isPlaceEligible(tags: Record<string, string> | undefined): boolean {
  if (!tags) {
    return false;
  }

  if (tags.access === 'private' || tags.access === 'no') {
    return false;
  }

  if (tags.landuse && PRIVATE_OR_WATER_TAGS.has(tags.landuse)) {
    return false;
  }

  if (tags.natural && PRIVATE_OR_WATER_TAGS.has(tags.natural)) {
    return false;
  }

  if (tags.waterway || tags.water) {
    return false;
  }

  return true;
}

function chooseCandidate(elements: OverpassElement[], recentSignatures: Set<string>): PlaceCandidate | null {
  const candidates = elements
    .map<PlaceCandidate | null>((element) => {
      const coordinates = elementCoordinates(element);
      const tags = element.tags ?? {};
      if (!coordinates || !isPlaceEligible(tags)) {
        return null;
      }

      const name = buildDisplayName(tags);
      const displayName = `${name} • ${buildCategory(tags)}`;
      const signature = placeSignature(name, coordinates);
      if (recentSignatures.has(signature)) {
        return null;
      }

      return {
        id: `${element.type}/${element.id}`,
        name,
        displayName,
        lat: coordinates.lat,
        lon: coordinates.lon,
        category: buildCategory(tags),
        source: 'overpass' as const,
        tags,
      };
    })
    .filter((candidate): candidate is PlaceCandidate => candidate !== null);

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function buildOverpassQuery(origin: Coordinates, radiusMeters: number): string {
  return PLACE_QUERY.replaceAll('__RADIUS__', String(radiusMeters)).replaceAll('__LAT__', String(origin.lat)).replaceAll('__LON__', String(origin.lon));
}

export async function findRandomDestination(origin: Coordinates, mode: ExplorationMode, recentNames: string[]): Promise<PlaceCandidate> {
  const settings = MODE_SETTINGS[mode];
  const recentSignatures = new Set(recentNames);
  const overpassUrl = 'https://overpass-api.de/api/interpreter';
  const overpassResponse = await fetchJson<OverpassResponse>(overpassUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: `data=${encodeURIComponent(buildOverpassQuery(origin, settings.queryRadius))}`,
  });

  const candidate = chooseCandidate(overpassResponse.elements, recentSignatures);
  if (candidate) {
    return candidate;
  }

  return buildFallbackDestination(origin, mode, recentSignatures);
}

async function buildFallbackDestination(origin: Coordinates, mode: ExplorationMode, recentSignatures: Set<string>): Promise<PlaceCandidate> {
  const settings = MODE_SETTINGS[mode];

  for (let attemptIndex = 0; attemptIndex < 8; attemptIndex += 1) {
    const projectedPoint = randomPointBetween(origin, settings.minimumRadius, settings.maximumRadius);
    const resolvedName = await reverseGeocode(projectedPoint);
    const signature = placeSignature(resolvedName, projectedPoint);
    if (recentSignatures.has(signature)) {
      continue;
    }

    return {
      id: `fallback-${signature}`,
      name: resolvedName,
      displayName: `${resolvedName} • fallback`,
      lat: projectedPoint.lat,
      lon: projectedPoint.lon,
      category: 'fallback',
      source: 'fallback',
      tags: {},
    };
  }

  const lastChance = destinationPoint(origin, Math.random() * 360, settings.maximumRadius);
  return {
    id: `fallback-${lastChance.lat.toFixed(4)}-${lastChance.lon.toFixed(4)}`,
    name: `Lat ${lastChance.lat.toFixed(3)}, Lon ${lastChance.lon.toFixed(3)}`,
    displayName: `Lat ${lastChance.lat.toFixed(3)}, Lon ${lastChance.lon.toFixed(3)} • fallback`,
    lat: lastChance.lat,
    lon: lastChance.lon,
    category: 'fallback',
    source: 'fallback',
    tags: {},
  };
}

export async function reverseGeocode(point: Coordinates): Promise<string> {
  try {
    const searchParams = new URLSearchParams({
      format: 'jsonv2',
      lat: String(point.lat),
      lon: String(point.lon),
      zoom: '18',
      addressdetails: '1',
    });
    const result = await fetchJson<NominatimReverseResult>(`https://nominatim.openstreetmap.org/reverse?${searchParams.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    });
    return normalizeName(result.name || result.display_name) || formatCoords(point);
  } catch {
    return formatCoords(point);
  }
}

export async function searchNearbyPlaces(origin: Coordinates, query: string): Promise<PlaceCandidate[]> {
  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '8',
    addressdetails: '1',
    bounded: '1',
    viewbox: [origin.lon - 0.35, origin.lat + 0.35, origin.lon + 0.35, origin.lat - 0.35].join(','),
  });

  const results = await fetchJson<NominatimSearchResult[]>(`https://nominatim.openstreetmap.org/search?${searchParams.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  return results
    .map((result) => ({
      id: `search-${result.place_id}`,
      name: normalizeName(result.display_name.split(',')[0]),
      displayName: result.display_name,
      lat: Number(result.lat),
      lon: Number(result.lon),
      category: result.type || result.class || 'search result',
      source: 'nominatim' as const,
      tags: {},
    }))
    .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon));
}

interface OsrmStep {
  maneuver?: {
    instruction?: string;
    type?: string;
    modifier?: string;
  };
  name: string;
  distance: number;
  duration: number;
}

function buildInstruction(step: OsrmStep): string {
  if (step.maneuver?.instruction) {
    return step.maneuver.instruction;
  }

  const maneuverType = step.maneuver?.type;
  const maneuverModifier = step.maneuver?.modifier;
  const roadName = step.name || 'the route';

  if (!maneuverType) {
    return `Continue on ${roadName}`;
  }

  if (maneuverModifier) {
    return `${maneuverType} ${maneuverModifier} onto ${roadName}`;
  }

  return `${maneuverType} onto ${roadName}`;
}

export async function fetchRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
  const response = await fetchJson<OsrmRouteResponse>(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.code !== 'Ok' || !response.routes.length) {
    throw new Error('No route returned');
  }

  const primaryRoute = response.routes[0];
  const polyline = primaryRoute.geometry.coordinates.map(([longitude, latitude]) => ({ lat: latitude, lon: longitude }));
  const steps = primaryRoute.legs.flatMap((leg) =>
    leg.steps.map((step) => ({
      instruction: buildInstruction(step),
      distanceMeters: step.distance,
      durationSeconds: step.duration,
    })),
  );

  return {
    distanceMeters: primaryRoute.distance,
    durationSeconds: primaryRoute.duration,
    polyline,
    steps,
    summary: `${formatCoords(origin)} → ${formatCoords(destination)}`,
    source: 'live',
  };
}

export function deriveRouteKey(origin: Coordinates, destination: Coordinates): string {
  return routeKey(origin, destination);
}

export function routeBearing(origin: Coordinates, destination: Coordinates): number {
  return bearingDegrees(origin, destination);
}

export function estimateStraightLineDistance(origin: Coordinates, destination: Coordinates): number {
  return haversineDistanceMeters(origin, destination);
}
