// Shared bucket across all instances + callers. One key per cluster.

import {tuning} from '../../config/tuning';
import * as Observability from '../Observability';
import {rateLimiter} from '../redis/services';

const NOMINATIM_BUCKET_KEY = 'geocode:nominatim:global';

export async function tryAcquireNominatimSlot(): Promise<boolean> {
    const ok = await rateLimiter.consume(
        NOMINATIM_BUCKET_KEY,
        tuning.geocoding.nominatimRpsCap,
        tuning.geocoding.nominatimRpsCap
    );
    if (!ok) {
        Observability.incrementLabeledCounter('geo_nominatim_calls_total', {
            outcome: 'rate_limited'
        });
    }
    return ok;
}
