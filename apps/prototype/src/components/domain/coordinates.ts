/** A site position as the latitude and longitude fields hold it: decimal degrees, north and east positive. */

/** Five decimals: about a metre, finer than any observing site needs. */
export function roundCoordinate(value: number): number {
  return Number(value.toFixed(5))
}

/** The position when both values are numbers in range, else null (a field mid-typing or empty). */
export function validLatLon(latitude: number | null, longitude: number | null): [number, number] | null {
  if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? [latitude, longitude] : null
}
