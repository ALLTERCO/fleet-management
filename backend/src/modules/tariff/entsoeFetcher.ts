import {tuning} from '../../config/tuning';
import {type LivePricePoint, parseEntsoeDayAhead} from './entsoeParser';

// ENTSO-E Transparency Platform REST API base URL.
const API_BASE = 'https://web-api.tp.entsoe.eu/api';

/**
 * Build the ENTSO-E A44 day-ahead request URL for a single calendar date.
 * periodStart and periodEnd are YYYYMMDDHHmm UTC strings as required by the API.
 */
function buildUrl(token: string, area: string, date: string): string {
    // date is YYYY-MM-DD; A44 windows are typically 23:00 the day before to
    // 23:00 on the requested date (UTC, for CET+1 markets).
    const d = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) {
        throw new Error(`Invalid date: ${date}`);
    }
    // Widen ±1h beyond the CET+1 day so DST-transition days aren't clipped.
    // The parser maps points by timestamp, so over-fetching is harmless.
    const start = new Date(d.getTime() - 2 * 60 * 60_000);
    const end = new Date(d.getTime() + 24 * 60 * 60_000);
    const fmt = (dt: Date) =>
        dt.toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const params = new URLSearchParams({
        securityToken: token,
        documentType: 'A44',
        in_Domain: area,
        out_Domain: area,
        periodStart: fmt(start),
        periodEnd: fmt(end)
    });
    return `${API_BASE}?${params.toString()}`;
}

/**
 * Fetch ENTSO-E day-ahead prices for a single date.
 * Throws on non-200 HTTP status or network error.
 */
export async function fetchEntsoeDayAhead(config: {
    token: string;
    area: string;
    date: string;
    expectedCurrency?: string;
}): Promise<LivePricePoint[]> {
    const url = buildUrl(config.token, config.area, config.date);
    let res: Response;
    try {
        res = await fetch(url, {
            signal: AbortSignal.timeout(tuning.tariffPull.fetchTimeoutMs)
        });
    } catch (err) {
        throw new Error(
            `ENTSO-E fetch failed for ${config.area}/${config.date}: ${err}`
        );
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `ENTSO-E returned ${res.status} for ${config.area}/${config.date}: ${body.slice(0, 256)}`
        );
    }
    const xml = await res.text();
    return parseEntsoeDayAhead(xml, {
        expectedCurrency: config.expectedCurrency
    });
}
