// Group creation for drain loops. It retries, so a Redis fault while a
// drainer starts cannot end the loop before its first read.

import log4js from 'log4js';
import * as Observability from '../Observability';
import {sleep} from '../util/sleep';
import {isRedisOomError} from './RedisStream';
import {markRedisWaiting, redisFeaturesWaiting} from './redisWaiting';

const logger = log4js.getLogger('redis-stream');
const FEATURE_PREFIX = 'stream-group:';

export interface GroupReadiness {
    source: string;
    retryMs: number;
    isStopped: () => boolean;
    ensure: () => Promise<void>;
}

/** Consumers still waiting for their group. */
export function streamGroupsWaiting(): string[] {
    return redisFeaturesWaiting()
        .filter((feature) => feature.startsWith(FEATURE_PREFIX))
        .map((feature) => feature.slice(FEATURE_PREFIX.length));
}

function markWaiting(source: string, isWaiting: boolean): void {
    markRedisWaiting(`${FEATURE_PREFIX}${source}`, isWaiting);
    Observability.setLabeledGauge(
        'redis_stream_group_waiting',
        {source},
        isWaiting ? 1 : 0
    );
}

async function tryEnsure(readiness: GroupReadiness): Promise<boolean> {
    try {
        await readiness.ensure();
        return true;
    } catch (err) {
        const oom = isRedisOomError(err);
        Observability.incrementLabeledCounter(
            'redis_stream_group_setup_errors_total',
            {source: readiness.source, reason: oom ? 'oom' : 'error'}
        );
        if (oom) {
            logger.error(
                'group create failed source=%s: Redis is at maxmemory and refuses writes; this consumer does not read until the group exists, retrying in %dms: %s',
                readiness.source,
                readiness.retryMs,
                err
            );
        } else {
            logger.error(
                'group create failed source=%s, retrying in %dms: %s',
                readiness.source,
                readiness.retryMs,
                err
            );
        }
        return false;
    }
}

export async function ensureGroupReady(
    readiness: GroupReadiness
): Promise<void> {
    try {
        while (!readiness.isStopped()) {
            if (await tryEnsure(readiness)) return;
            markWaiting(readiness.source, true);
            await sleep(readiness.retryMs);
        }
    } finally {
        if (streamGroupsWaiting().includes(readiness.source)) {
            markWaiting(readiness.source, false);
        }
    }
}
