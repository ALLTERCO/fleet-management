import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {defaultLiveTariffRepository} from '../repositories/LiveTariffRepository';
import {fetchEntsoeDayAhead} from './entsoeFetcher';
import type {LivePricePoint} from './entsoeParser';

const logger = log4js.getLogger('LiveTariffPullScheduler');

let timer: NodeJS.Timeout | null = null;
let running = false;

// Test seam — replaced by unit tests to avoid live HTTP. Production default
// is the real ENTSO-E fetcher; tests inject a stub returning preset points.
type EntsoeFetcher = (config: {
    token: string;
    area: string;
    date: string;
    expectedCurrency?: string;
}) => Promise<LivePricePoint[]>;
let activeFetcher: EntsoeFetcher = fetchEntsoeDayAhead;

/** Test-only: replace the ENTSO-E fetcher. Pass undefined to restore. */
export function __setFetcherForTests(fn: EntsoeFetcher | undefined): void {
    activeFetcher = fn ?? fetchEntsoeDayAhead;
}

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

async function pullSource(source: {
    tariffId: number;
    provider: string | null;
    providerConfig: any;
}): Promise<void> {
    if (source.provider !== 'entsoe') {
        logger.warn(
            'tariff %d: unknown provider %s — skipping',
            source.tariffId,
            source.provider
        );
        return;
    }
    const cfg = source.providerConfig ?? {};
    const token: string = cfg.token ?? '';
    const area: string = cfg.area ?? '';
    if (!token || !area) {
        logger.warn(
            'tariff %d: entsoe provider_config missing token or area — skipping',
            source.tariffId
        );
        return;
    }
    const date = todayUtc();
    // Operator declares the zone's currency in provider_config; ENTSO-E is EUR
    // by default. Mismatch with the document is rejected, not silently relabelled.
    const expectedCurrency: string = cfg.currency ?? 'EUR';
    const points = await activeFetcher({token, area, date, expectedCurrency});
    const repo = await defaultLiveTariffRepository();
    for (const pt of points) {
        await repo.appendPrice(source.tariffId, pt.tsSeconds, pt.price);
    }
    Observability.incrementCounter('tariff_pull_points_stored', points.length);
    logger.info(
        'tariff %d: stored %d price point(s) for %s',
        source.tariffId,
        points.length,
        date
    );
}

async function runPull(): Promise<void> {
    const repo = await defaultLiveTariffRepository();
    const sources = await repo.listPullSources();
    if (sources.length === 0) {
        logger.debug('no pull-mode live tariff sources configured');
        return;
    }
    // Each source is independent — one failure must not block the rest.
    for (const source of sources) {
        try {
            await pullSource(source);
        } catch (err) {
            Observability.incrementCounter('tariff_pull_errors');
            logger.error('tariff %d pull failed: %s', source.tariffId, err);
        }
    }
}

export function startScheduler(): void {
    if (!tuning.tariffPull.enabled) {
        logger.info('tariff pull disabled (FM_TARIFF_PULL_ENABLED=false)');
        return;
    }
    if (running) {
        logger.warn('live tariff pull scheduler already running');
        return;
    }
    running = true;
    timer = setInterval(() => {
        void runPull();
    }, tuning.tariffPull.intervalMs);
    timer.unref?.();
    // Run once immediately so the first pull does not wait a full interval.
    void runPull();
    logger.info(
        'live tariff pull scheduler started (interval=%dms)',
        tuning.tariffPull.intervalMs
    );
}

export function stopScheduler(): void {
    running = false;
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    logger.info('live tariff pull scheduler stopped');
}

export function isRunning(): boolean {
    return running;
}

// Test seam — exercise one pull cycle without a live timer.
export async function __runPullForTests(): Promise<void> {
    await runPull();
}

Observability.registerModule('liveTariffPullScheduler', {
    stats: () => ({running: running ? 1 : 0}),
    topology: {
        role: 'service',
        cluster: 'services',
        zone: 'operations',
        upstreams: ['dbPool'],
        label: 'Live Tariff Pull Scheduler',
        description: 'Periodic ENTSO-E day-ahead price fetch',
        route: '/monitoring/services'
    }
});
