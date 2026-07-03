// Hourly grid carbon intensity contract. Implementations: ElectricityMaps
// adapter (real-time, paid/free tier) + static fallback (flat curve from
// the org's LBM factor when no API key is configured).

export interface HourlyCarbonPoint {
    readonly hour: string;
    readonly gPerKWh: number;
}

export interface HourlyCarbonQuery {
    readonly zoneCode: string;
    readonly start: string;
    readonly end: string;
}

export interface HourlyCarbonProvider {
    readonly source: 'electricitymaps' | 'static-lbm';
    fetchHourly(query: HourlyCarbonQuery): Promise<HourlyCarbonPoint[]>;
}
