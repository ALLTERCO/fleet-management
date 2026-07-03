// Back-compat shim. Callers should migrate to `import {eventReplayCache}
// from '../redis/services'`.

import type {TripPath} from '../eventReplay';
import type {EventReplayCacheParams, EventReplayResult} from '../redis/ports';
import {eventReplayCacheKey, isHistoricalWindow} from '../redis/ports.shared';
import {eventReplayCache} from '../redis/services';

export type {
    EventReplayCacheParams,
    EventReplayResult
} from '../redis/ports';

/** Stable key shape — exposed for cross-cache invalidation tooling. */
export const cacheKey = eventReplayCacheKey;

export const getCachedEventReplay = (
    orgId: string,
    params: EventReplayCacheParams,
    fetcher: () => Promise<EventReplayResult<TripPath>>
) => eventReplayCache.get(orgId, params, fetcher);

export const __testing = {isHistorical: isHistoricalWindow};
