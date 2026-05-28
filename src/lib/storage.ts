import { openDB } from 'idb';
import type { AppSettings, HistoryEntry, RouteCacheEntry } from './types';

const DATABASE_NAME = 'go-here';
const DATABASE_VERSION = 1;
const HISTORY_STORE = 'history';
const ROUTE_STORE = 'routes';
const SETTINGS_KEY = 'settings';

const databasePromise = openDB(DATABASE_NAME, DATABASE_VERSION, {
  upgrade(database) {
    if (!database.objectStoreNames.contains(HISTORY_STORE)) {
      database.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
    }

    if (!database.objectStoreNames.contains(ROUTE_STORE)) {
      database.createObjectStore(ROUTE_STORE, { keyPath: 'key' });
    }
  },
});

export async function loadHistoryEntries(): Promise<HistoryEntry[]> {
  const database = await databasePromise;
  const items = await database.getAll(HISTORY_STORE);
  return items.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

export async function saveHistoryEntry(entry: HistoryEntry): Promise<void> {
  const database = await databasePromise;
  await database.put(HISTORY_STORE, entry);
}

export async function deleteHistoryEntry(identifier: string): Promise<void> {
  const database = await databasePromise;
  await database.delete(HISTORY_STORE, identifier);
}

export async function clearHistoryEntries(): Promise<void> {
  const database = await databasePromise;
  await database.clear(HISTORY_STORE);
}

export async function loadRouteCache(cacheKey: string): Promise<RouteCacheEntry | undefined> {
  const database = await databasePromise;
  return (await database.get(ROUTE_STORE, cacheKey)) as RouteCacheEntry | undefined;
}

export async function saveRouteCache(entry: RouteCacheEntry): Promise<void> {
  const database = await databasePromise;
  await database.put(ROUTE_STORE, entry);
}

export function loadSettings(): AppSettings {
  const rawSettings = window.localStorage.getItem(SETTINGS_KEY);
  if (!rawSettings) {
    return {
      mode: 'nearby',
      searchQuery: '',
      followCompass: false,
    };
  }

  try {
    const parsedSettings = JSON.parse(rawSettings) as Partial<AppSettings>;
    return {
      mode: parsedSettings.mode ?? 'nearby',
      searchQuery: parsedSettings.searchQuery ?? '',
      followCompass: parsedSettings.followCompass ?? false,
    };
  } catch {
    return {
      mode: 'nearby',
      searchQuery: '',
      followCompass: false,
    };
  }
}

export function saveSettings(settings: AppSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
