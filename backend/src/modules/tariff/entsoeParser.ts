// No XML library ships in the backend bundle; regex extraction is intentional
// and safe here because ENTSO-E PublicationDocument is machine-generated,
// schema-stable XML — no user-controlled content, no SSRF risk.

export interface LivePricePoint {
    tsSeconds: number;
    price: number;
}

// Map PT15M / PT30M / PT60M resolution strings to milliseconds.
function resolutionMs(iso: string): number {
    const m = /^PT(\d+)M$/i.exec(iso.trim());
    if (!m) throw new Error(`Unsupported ENTSO-E resolution: ${iso}`);
    return parseInt(m[1], 10) * 60_000;
}

function extractAll(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
    const out: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
        out.push(match[1].trim());
    }
    return out;
}

function extractOne(xml: string, tag: string): string | null {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
    const m = re.exec(xml);
    return m ? m[1].trim() : null;
}

/**
 * Parse an ENTSO-E Publication_MarketDocument (A44 day-ahead prices).
 *
 * Each Period inside each TimeSeries is iterated; positions are 1-based and
 * map to offset = (position - 1) * resolutionMs from the Period start.
 *
 * By default prices are converted from EUR/MWh to EUR/kWh (÷ 1000).
 * Pass currencyPerMwhToPerKwh=false to keep the raw MWh-denominated value.
 */
export function parseEntsoeDayAhead(
    xml: string,
    opts: {currencyPerMwhToPerKwh?: boolean; expectedCurrency?: string} = {}
): LivePricePoint[] {
    // The amounts carry no currency — they are billed in the tariff's currency.
    // If the bidding zone reports a different currency than the tariff expects
    // (e.g. GB→GBP, PL→PLN while the tariff is EUR), the numbers would be
    // mis-billed, so reject loudly rather than silently relabel.
    if (opts.expectedCurrency) {
        const docCurrency = extractOne(xml, 'currency_Unit.name');
        if (
            docCurrency &&
            docCurrency.toUpperCase() !== opts.expectedCurrency.toUpperCase()
        ) {
            throw new Error(
                `ENTSO-E currency mismatch: document is ${docCurrency}, ` +
                    `tariff expects ${opts.expectedCurrency}`
            );
        }
    }
    const toKwh = opts.currencyPerMwhToPerKwh !== false;
    const points: LivePricePoint[] = [];

    const timeSeries = extractAll(xml, 'TimeSeries');
    for (const ts of timeSeries) {
        const periods = extractAll(ts, 'Period');
        for (const period of periods) {
            const startRaw = extractOne(period, 'start');
            if (!startRaw) continue;
            const startMs = Date.parse(startRaw);
            if (!Number.isFinite(startMs)) continue;

            const resRaw = extractOne(period, 'resolution');
            if (!resRaw) continue;
            let stepMs: number;
            try {
                stepMs = resolutionMs(resRaw);
            } catch {
                continue;
            }

            const pointTags = extractAll(period, 'Point');
            for (const pt of pointTags) {
                const posRaw = extractOne(pt, 'position');
                const amtRaw = extractOne(pt, 'price.amount');
                if (!posRaw || !amtRaw) continue;
                const position = parseInt(posRaw, 10);
                const amount = parseFloat(amtRaw);
                if (!Number.isFinite(position) || !Number.isFinite(amount))
                    continue;

                const tsMs = startMs + (position - 1) * stepMs;
                const price = toKwh ? amount / 1000 : amount;
                points.push({tsSeconds: Math.round(tsMs / 1000), price});
            }
        }
    }

    return points;
}
