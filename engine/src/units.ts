/** Unit conversions. The engine works in SI internally; convert only at the edges. */
export const kmhToMs = (kmh: number): number => kmh / 3.6;
export const msToKmh = (ms: number): number => ms * 3.6;
/** veh/s → veh/h */
export const perSecToPerHour = (q: number): number => q * 3600;
/** veh/h → veh/s */
export const perHourToPerSec = (q: number): number => q / 3600;
/** veh/m → veh/km */
export const perMToPerKm = (rho: number): number => rho * 1000;
