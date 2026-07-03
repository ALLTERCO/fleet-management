import type {MapPin, MapStatusFilter} from '@/types/map';

// 'all' = identity; 'alerts' = any open alert; otherwise status equality.
export function pinMatchesStatusFilter(
    pin: MapPin,
    filter: MapStatusFilter
): boolean {
    if (filter === 'all') return true;
    if (filter === 'alerts') return (pin.alertCount ?? 0) > 0;
    return pin.status === filter;
}

export function filterPinsByStatus(
    pins: MapPin[],
    filter: MapStatusFilter
): MapPin[] {
    if (filter === 'all') return pins;
    return pins.filter((pin) => pinMatchesStatusFilter(pin, filter));
}

export function pinMatchesQuery(pin: MapPin, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return true;
    return pin.label?.toLowerCase().includes(normalized) ?? false;
}

export function filterPinsByQuery(pins: MapPin[], query: string): MapPin[] {
    const normalized = query.trim();
    if (normalized.length === 0) return pins;
    return pins.filter((pin) => pinMatchesQuery(pin, normalized));
}
