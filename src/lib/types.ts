export type ExplorationMode = 'nearby' | 'medium' | 'far' | 'anywhere';
export type ExplorationScope = 'city' | 'country';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface PlaceCandidate extends Coordinates {
  id: string;
  name: string;
  displayName: string;
  category: string;
  source: 'overpass' | 'nominatim' | 'fallback';
  tags: Record<string, string>;
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: Coordinates[];
  steps: RouteStep[];
  summary: string;
  source: 'live' | 'cache';
}

export interface HistoryEntry {
  id: string;
  name: string;
  label: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  durationSeconds: number;
  generatedAt: string;
  mode: ExplorationMode;
  favorite: boolean;
  status: 'planned' | 'visited';
  routeSummary: string;
  steps: RouteStep[];
}

export interface RouteCacheEntry {
  key: string;
  route: RouteResult;
  updatedAt: string;
}

export interface AppSettings {
  mode: ExplorationMode;
  searchQuery: string;
  followCompass: boolean;
}
