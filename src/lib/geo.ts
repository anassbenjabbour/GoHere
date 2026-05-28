import type { Coordinates } from './types';

const EARTH_RADIUS_METERS = 6_371_000;

export function toRadians(valueDegrees: number): number {
  return (valueDegrees * Math.PI) / 180;
}

export function toDegrees(valueRadians: number): number {
  return (valueRadians * 180) / Math.PI;
}

export function haversineDistanceMeters(start: Coordinates, end: Coordinates): number {
  const deltaLatitude = toRadians(end.lat - start.lat);
  const deltaLongitude = toRadians(end.lon - start.lon);
  const latitude1 = toRadians(start.lat);
  const latitude2 = toRadians(end.lat);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) * Math.sin(deltaLongitude / 2);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function destinationPoint(origin: Coordinates, bearingDegrees: number, distanceMeters: number): Coordinates {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearingRadians = toRadians(bearingDegrees);
  const originLatitude = toRadians(origin.lat);
  const originLongitude = toRadians(origin.lon);

  const destinationLatitude = Math.asin(
    Math.sin(originLatitude) * Math.cos(angularDistance) +
      Math.cos(originLatitude) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );

  const destinationLongitude =
    originLongitude +
    Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(originLatitude),
      Math.cos(angularDistance) - Math.sin(originLatitude) * Math.sin(destinationLatitude),
    );

  return {
    lat: toDegrees(destinationLatitude),
    lon: ((toDegrees(destinationLongitude) + 540) % 360) - 180,
  };
}

export function randomPointBetween(origin: Coordinates, minimumDistanceMeters: number, maximumDistanceMeters: number): Coordinates {
  const randomAngleDegrees = Math.random() * 360;
  const randomDistanceMeters = minimumDistanceMeters + Math.random() * Math.max(1, maximumDistanceMeters - minimumDistanceMeters);
  return destinationPoint(origin, randomAngleDegrees, randomDistanceMeters);
}

export function bearingDegrees(start: Coordinates, end: Coordinates): number {
  const startLatitude = toRadians(start.lat);
  const endLatitude = toRadians(end.lat);
  const deltaLongitude = toRadians(end.lon - start.lon);
  const y = Math.sin(deltaLongitude) * Math.cos(endLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(endLatitude) -
    Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(deltaLongitude);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) {
    return '--';
  }

  if (meters < 1_000) {
    return `${Math.max(1, Math.round(meters))} m`;
  }

  return `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '--';
  }

  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function formatCoords(point: Coordinates): string {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

export function routeKey(origin: Coordinates, destination: Coordinates): string {
  return [origin.lat, origin.lon, destination.lat, destination.lon].map((value) => value.toFixed(4)).join(':');
}

export function placeSignature(name: string, point: Coordinates): string {
  return `${name.trim().toLowerCase()}@${point.lat.toFixed(3)},${point.lon.toFixed(3)}`;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
