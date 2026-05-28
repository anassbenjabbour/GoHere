import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import {
  clearHistoryEntries,
  deleteHistoryEntry,
  loadHistoryEntries,
  loadRouteCache,
  loadSettings,
  saveHistoryEntry,
  saveRouteCache,
  saveSettings,
} from './lib/storage';
import {
  deriveRouteKey,
  estimateStraightLineDistance,
  fetchRoute,
  findRandomDestination,
  routeBearing,
  reverseGeocode,
  searchNearbyPlaces as searchNearbyPlacesApi,
} from './lib/api';
import { bearingDegrees, formatCoords as formatCoordinates, formatDistance, formatDuration, haversineDistanceMeters, placeSignature } from './lib/geo';
import type { Coordinates, ExplorationMode, ExplorationScope, HistoryEntry, PlaceCandidate, RouteResult } from './lib/types';

const DEFAULT_CENTER: Coordinates = {
  lat: 40.7128,
  lon: -74.006,
};

const MODE_LABELS: Record<ExplorationMode, string> = {
  nearby: 'Nearby adventure',
  medium: 'Medium ride',
  far: 'Far exploration',
  anywhere: 'Random anywhere',
};

const ACTIONS: Array<{
  mode: ExplorationMode;
  title: string;
  subtitle: string;
}> = [
  { mode: 'nearby', title: 'Find Random Place', subtitle: 'Close range' },
  { mode: 'medium', title: 'Generate Destination', subtitle: 'Mid-range run' },
  { mode: 'far', title: 'Explore Nearby', subtitle: 'Longer route' },
  { mode: 'anywhere', title: 'Take Me Somewhere', subtitle: 'Surprise mode' },
];

const historyMarkerIcon = L.divIcon({
  className: 'gh-map-marker gh-map-marker-history',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const destinationMarkerIcon = L.divIcon({
  className: 'gh-map-marker gh-map-marker-destination',
  html: '<span></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const originMarkerIcon = L.divIcon({
  className: 'gh-map-marker gh-map-marker-origin',
  html: '<span></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function summarizePlace(place: PlaceCandidate): string {
  return `${place.name} • ${place.category}`;
}

function MapFocus({
  origin,
  destination,
  route,
  focusNonce,
  followUser,
}: {
  origin: Coordinates | null;
  destination: PlaceCandidate | null;
  route: RouteResult | null;
  focusNonce: number;
  followUser: boolean;
}) {
  const map = useMap();
  const lastFocusKey = useRef('');

  useEffect(() => {
    const focusKey = [origin?.lat, origin?.lon, destination?.lat, destination?.lon, route?.summary, focusNonce]
      .map((value) => String(value ?? ''))
      .join('|');
    if (!focusKey || focusKey === lastFocusKey.current) {
      return;
    }

    lastFocusKey.current = focusKey;

    if (followUser && origin) {
      map.panTo([origin.lat, origin.lon], { animate: true, duration: 0.8 });
      return;
    }

    if (route?.polyline.length) {
      const bounds = L.latLngBounds(route.polyline.map((point) => [point.lat, point.lon] as [number, number]));
      map.fitBounds(bounds.pad(0.25), { animate: true, duration: 0.9 });
      return;
    }

    if (origin) {
      map.flyTo([origin.lat, origin.lon], 14, { animate: true, duration: 0.8 });
      return;
    }

    if (destination) {
      map.flyTo([destination.lat, destination.lon], 13, { animate: true, duration: 0.8 });
    }
  }, [destination, focusNonce, map, origin, route]);

  return null;
}

function App() {
  const [origin, setOrigin] = useState<Coordinates | null>(DEFAULT_CENTER);
  const [destination, setDestination] = useState<PlaceCandidate | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceCandidate[]>([]);
  const [mode, setMode] = useState<ExplorationMode>('nearby');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState('Ready. Using fallback coordinates until GPS locks.');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'searching' | 'locked' | 'error'>('idle');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [followCompass, setFollowCompass] = useState(false);
  const [followUserLocation, setFollowUserLocation] = useState(true);
  const [explorationScope, setExplorationScope] = useState<ExplorationScope>('city');
  const [focusNonce, setFocusNonce] = useState(0);
  const lastRouteOriginRef = useRef<Coordinates | null>(null);
  const lastRouteKeyRef = useRef('');
  const gpsWatchIdRef = useRef<number | null>(null);
  const [showVisitedMarkers, setShowVisitedMarkers] = useState(true);

  const routeSummary = useMemo(() => {
    if (!route) {
      return null;
    }

    return {
      distance: formatDistance(route.distanceMeters),
      duration: formatDuration(route.durationSeconds),
      steps: route.steps.length,
    };
  }, [route]);

  const routeProgress = useMemo(() => {
    if (!origin || !destination) {
      return null;
    }

    const straightDistanceMeters = estimateStraightLineDistance(origin, destination);
    const bearingToDestination = bearingDegrees(origin, destination);
    const deltaBearing = heading === null ? null : Math.abs((((bearingToDestination - heading) % 360) + 540) % 360 - 180);
    return {
      straightDistanceMeters,
      bearingToDestination,
      deltaBearing,
    };
  }, [destination, heading, origin]);

  const nearbyRecentSignatures = useMemo(() => history.slice(0, 8).map((entry) => placeSignature(entry.name, { lat: entry.lat, lon: entry.lon })), [history]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedHistory = await loadHistoryEntries();
      if (!cancelled) {
        setHistory(storedHistory);
      }
    })();

    const settings = loadSettings();
    setMode(settings.mode);
    setSearchQuery(settings.searchQuery);
    setFollowCompass(settings.followCompass);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveSettings({ mode, searchQuery, followCompass });
  }, [followCompass, mode, searchQuery]);

  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const orientationHandler = (event: DeviceOrientationEvent) => {
      const compassHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const headingValue = typeof compassHeading === 'number' ? compassHeading : event.alpha;
      if (typeof headingValue === 'number' && Number.isFinite(headingValue)) {
        setHeading((360 - headingValue) % 360);
      }
    };

    window.addEventListener('deviceorientationabsolute', orientationHandler as EventListener);
    window.addEventListener('deviceorientation', orientationHandler as EventListener);
    return () => {
      window.removeEventListener('deviceorientationabsolute', orientationHandler as EventListener);
      window.removeEventListener('deviceorientation', orientationHandler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      lastRouteKeyRef.current = '';
      return;
    }

    const routeCacheKey = deriveRouteKey(origin, destination);
    if (route && lastRouteKeyRef.current === routeCacheKey && lastRouteOriginRef.current && haversineDistanceMeters(lastRouteOriginRef.current, origin) < 120) {
      return;
    }

    let cancelled = false;
    const refreshRoute = async () => {
      setLoadingAction('routing');
      try {
        const routeFromCache = await loadRouteCache(routeCacheKey);
        if (!navigator.onLine && routeFromCache) {
          if (!cancelled) {
            setRoute({ ...routeFromCache.route, source: 'cache' });
            lastRouteKeyRef.current = routeCacheKey;
            setNotice('Offline route restored from cache.');
          }
          return;
        }

        const liveRoute = await fetchRoute(origin, destination);
        if (cancelled) {
          return;
        }

        setRoute(liveRoute);
        lastRouteOriginRef.current = origin;
        lastRouteKeyRef.current = routeCacheKey;
        await saveRouteCache({ key: routeCacheKey, route: liveRoute, updatedAt: new Date().toISOString() });
        setNotice(`Route locked: ${formatDistance(liveRoute.distanceMeters)} / ${formatDuration(liveRoute.durationSeconds)}.`);
      } catch {
        if (cancelled) {
          return;
        }

        const routeFromCache = await loadRouteCache(routeCacheKey);
        if (routeFromCache) {
          setRoute({ ...routeFromCache.route, source: 'cache' });
          lastRouteOriginRef.current = origin;
          lastRouteKeyRef.current = routeCacheKey;
          setNotice('Live routing failed. Using cached route.');
        } else {
          setRoute(null);
          setNotice('Route unavailable. Try again when connectivity returns.');
        }
      } finally {
        if (!cancelled) {
          setLoadingAction(null);
        }
      }
    };

    void refreshRoute();

    return () => {
      cancelled = true;
    };
  }, [destination, origin, route]);

  useEffect(() => {
    const routeRecalculationNeeded = Boolean(origin && destination && route && estimateStraightLineDistance(origin, destination) > 0);
    if (!routeRecalculationNeeded || !followCompass || !origin || !destination) {
      return;
    }

    const firstRoutePoint = route?.polyline[0];
    const recalculationDistance = firstRoutePoint ? haversineDistanceMeters(origin, firstRoutePoint) : 0;
    if (recalculationDistance > 250) {
      setNotice('Re-routing: position drift detected.');
    }
  }, [destination, followCompass, origin, route]);

  async function selectDestination(selectionMode: ExplorationMode): Promise<void> {
    const effectiveOrigin = origin ?? DEFAULT_CENTER;
    setMode(selectionMode);
    setLoadingAction(selectionMode);
    const scopeLabel = explorationScope === 'city' ? 'Kenitra area' : 'Morocco-wide';
    setNotice(`${origin ? 'Scanning' : 'Scanning with fallback coordinates'} ${scopeLabel.toLowerCase()} ${MODE_LABELS[selectionMode].toLowerCase()}...`);

    try {
      const destinationCandidate = await findRandomDestination(effectiveOrigin, selectionMode, nearbyRecentSignatures, explorationScope);
      const resolvedName = destinationCandidate.name || (await reverseGeocode(destinationCandidate));
      const place = {
        ...destinationCandidate,
        name: resolvedName,
        displayName: summarizePlace({ ...destinationCandidate, name: resolvedName }),
      };

      setDestination(place);
      setSearchResults([]);
      setNotice(`${MODE_LABELS[selectionMode]} selected: ${place.name}.`);

      const logEntry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: place.name,
        label: place.displayName,
        lat: place.lat,
        lon: place.lon,
        distanceMeters: haversineDistanceMeters(effectiveOrigin, place),
        durationSeconds: route?.durationSeconds ?? 0,
        generatedAt: new Date().toISOString(),
        mode: selectionMode,
        favorite: false,
        status: 'visited',
        routeSummary: route ? `${formatDistance(route.distanceMeters)} • ${formatDuration(route.durationSeconds)}` : 'route pending',
        steps: route?.steps ?? [],
      };

      setHistory((currentHistory) => {
        const nextHistory = [logEntry, ...currentHistory.filter((entry) => placeSignature(entry.name, { lat: entry.lat, lon: entry.lon }) !== placeSignature(place.name, place))].slice(0, 40);
        void saveHistoryEntry(logEntry);
        return nextHistory;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Destination generation failed.');
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!origin || !searchQuery.trim()) {
      return;
    }

    setLoadingAction('search');
    setNotice(`Searching nearby for ${searchQuery.trim()}...`);

    try {
      const results = await searchNearbyPlacesApi(origin, searchQuery.trim());
      setSearchResults(results);
      setNotice(`Found ${results.length} nearby results.`);
    } catch {
      setNotice('Search failed. Retry when online.');
    } finally {
      setLoadingAction(null);
    }
  }

  async function chooseSearchResult(candidate: PlaceCandidate): Promise<void> {
    setDestination(candidate);
    setSearchResults([]);
    setNotice(`Destination selected: ${candidate.name}.`);
  }

  async function centerOnOrigin(): Promise<void> {
    if (!origin) {
      return;
    }

    setFocusNonce((currentValue) => currentValue + 1);
    setNotice('Centering map on current coordinates.');
  }

  async function requestGpsAccess(): Promise<void> {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setNotice('GPS unavailable in this browser.');
      return;
    }

    if (!window.isSecureContext) {
      setGpsStatus('error');
      setNotice('GPS permission needs HTTPS or localhost. This phone session is running over insecure HTTP.');
      return;
    }

    setGpsStatus('searching');
    setNotice('Requesting GPS access...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextOrigin = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };

        setOrigin(nextOrigin);
        setGpsAccuracy(position.coords.accuracy || null);
        setGpsStatus('locked');
        setNotice(`Coordinates locked at ${formatCoordinates(nextOrigin)}.`);
        if (followUserLocation) {
          setFocusNonce((currentValue) => currentValue + 1);
        }

        if (gpsWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        }

        gpsWatchIdRef.current = navigator.geolocation.watchPosition(
          (watchPosition) => {
            const watchedOrigin = {
              lat: watchPosition.coords.latitude,
              lon: watchPosition.coords.longitude,
            };
            setOrigin(watchedOrigin);
            setGpsAccuracy(watchPosition.coords.accuracy || null);
            setGpsStatus('locked');
            if (followUserLocation) {
              setFocusNonce((currentValue) => currentValue + 1);
            }
          },
          () => {
            setGpsStatus('error');
          },
          {
            enableHighAccuracy: true,
            maximumAge: 10_000,
            timeout: 12_000,
          },
        );
      },
      (error) => {
        setGpsStatus('error');
        if (error.code === error.PERMISSION_DENIED) {
          setNotice('GPS permission was denied. Open site permissions and allow location access.');
          return;
        }

        if (error.code === error.POSITION_UNAVAILABLE) {
          setNotice('GPS signal unavailable. Try again outdoors or near a window.');
          return;
        }

        setNotice('GPS request timed out. Retry the permission prompt.');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 12_000,
      },
    );
  }

  useEffect(() => {
    if (!window.isSecureContext) {
      setGpsStatus('error');
      setNotice('GPS needs HTTPS or localhost. Open the app over HTTPS on your phone to get the permission prompt.');
      return;
    }

    void requestGpsAccess();
  }, [followUserLocation]);

  async function toggleFavorite(entry: HistoryEntry): Promise<void> {
    const nextFavorite = !entry.favorite;
    const nextHistory = history.map((currentEntry) => (currentEntry.id === entry.id ? { ...currentEntry, favorite: nextFavorite } : currentEntry));
    setHistory(nextHistory);
    await saveHistoryEntry({ ...entry, favorite: nextFavorite });
  }

  async function revisit(entry: HistoryEntry): Promise<void> {
    const candidate: PlaceCandidate = {
      id: entry.id,
      name: entry.name,
      displayName: entry.label,
      lat: entry.lat,
      lon: entry.lon,
      category: entry.mode,
      source: 'fallback',
      tags: {},
    };
    setDestination(candidate);
    setMode(entry.mode);
    setNotice(`Replaying destination: ${entry.name}.`);
  }

  async function removeHistory(entryId: string): Promise<void> {
    setHistory((currentHistory) => currentHistory.filter((entry) => entry.id !== entryId));
    await deleteHistoryEntry(entryId);
  }

  async function clearHistory(): Promise<void> {
    setHistory([]);
    await clearHistoryEntries();
    setNotice('History log cleared.');
  }

  const compassAngle = heading !== null && destination && origin ? (routeBearing(origin, destination) - heading + 360) % 360 : 0;
  const currentLocationLabel = origin ? formatCoordinates(origin) : 'LOCKING...';
  const favoriteCount = history.filter((entry) => entry.favorite).length;
  const recentEntries = history.slice(0, 5);
  const scopeLabel = explorationScope === 'city' ? 'Kenitra' : 'Morocco';

  async function triggerRandomRoute(): Promise<void> {
    await selectDestination(mode);
  }

  function endRoute(): void {
    setDestination(null);
    setRoute(null);
    setSearchResults([]);
    lastRouteOriginRef.current = null;
    lastRouteKeyRef.current = '';
    setLoadingAction(null);
    setNotice('Route ended. Tap Random for a new destination.');
  }

  return (
    <div className="app-shell scanlines">
      <div className="map-stage">
        <MapContainer center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lon]} zoom={12} zoomControl={true} scrollWheelZoom>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <MapFocus origin={origin} destination={destination} route={route} focusNonce={focusNonce} followUser={followUserLocation} />
          {origin && <Marker position={[origin.lat, origin.lon]} icon={originMarkerIcon} />}
          {destination && <Marker position={[destination.lat, destination.lon]} icon={destinationMarkerIcon} />}
          {route?.polyline.length ? <Polyline positions={route.polyline.map((point) => [point.lat, point.lon] as [number, number])} pathOptions={{ color: '#e3c84b', weight: 4, opacity: 0.9 }} /> : null}
          {destination ? <CircleMarker center={[destination.lat, destination.lon]} radius={36} pathOptions={{ color: '#9d9d9d', weight: 1, fillOpacity: 0.08 }} /> : null}
          {showVisitedMarkers
            ? history.slice(0, 6).map((entry) => (
                <Marker key={entry.id} position={[entry.lat, entry.lon]} icon={historyMarkerIcon}>
                  <Popup>{entry.label}</Popup>
                </Marker>
              ))
            : null}
        </MapContainer>
      </div>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className="nav-item" onClick={() => void requestGpsAccess()}>
          <span>1</span>
          <strong>Location</strong>
        </button>
        <button className="nav-item" onClick={() => setShowVisitedMarkers((currentValue) => !currentValue)}>
          <span>2</span>
          <strong>Visited</strong>
        </button>
        <button className="nav-item nav-center" onClick={() => void triggerRandomRoute()}>
          <span>3</span>
          <strong>Random</strong>
        </button>
        <button className="nav-item" onClick={() => endRoute()}>
          <span>4</span>
          <strong>End Route</strong>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setExplorationScope((currentValue) => (currentValue === 'city' ? 'country' : 'city'));
            void centerOnOrigin();
          }}
        >
          <span>5</span>
          <strong>Scope</strong>
          <span className="nav-subtitle">{scopeLabel}</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
