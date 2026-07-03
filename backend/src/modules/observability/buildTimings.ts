// Monitoring for device builds (the probe + compose that runs after a device
// is admitted). Counts every build, and catches the slow ones — the device
// that shows up late in the tab after an accept — with the per-stage breakdown
// that names which probe step was slow.

import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import {IntervalSampler} from '../util/intervalSampler';
import {formatStageTimings, type StageTiming} from '../util/stageTimer';
import {incrementCounter} from './counters';
import {getLevel} from './samplers';
import {pushRing} from './util/ringBuffer';
import {type WindowQuery, windowedTopN} from './util/windowedTopN';

const logger = getLogger('device-build');
const slowLog = new IntervalSampler(() => tuning.device.buildSlowLogIntervalMs);

export interface SlowBuildEntry {
    shellyID: string;
    totalMs: number;
    componentPages: number;
    stages: StageTiming[];
    ts: number;
}

export interface BuildTiming {
    shellyID: string;
    totalMs: number;
    componentPages: number;
    stages: readonly StageTiming[];
}

export interface SlowBuildStats {
    slowBuilds: number;
    slowestBuildMs: number;
}

const slowBuilds: SlowBuildEntry[] = [];

function isSlow(totalMs: number): boolean {
    return totalMs > tuning.device.buildSlowLogMs;
}

// Counting is a gated Map increment — safe even when 2k devices build at once.
// Slow ones land in a bounded ring and a rate-limited log.
export function recordBuildTiming(build: BuildTiming): void {
    incrementCounter('device_builds_total');
    if (!isSlow(build.totalMs)) return;
    incrementCounter('device_builds_slow');
    logSlowBuild(build);
    if (getLevel() < 2) return;
    pushRing(
        slowBuilds,
        {
            shellyID: build.shellyID,
            totalMs: build.totalMs,
            componentPages: build.componentPages,
            stages: [...build.stages],
            ts: Date.now()
        },
        tuning.observability.initDurationRingSize
    );
}

// At most one line per interval; the count carries how many it stands for.
function logSlowBuild(build: BuildTiming): void {
    const count = slowLog.sample();
    if (count === null) return;
    logger.info(
        'slow device build id=%s total=%dms %s pages=%d (x%d this window)',
        build.shellyID,
        build.totalMs,
        formatStageTimings(build.stages),
        build.componentPages,
        count
    );
}

export function getSlowBuilds(): SlowBuildEntry[] {
    return [...slowBuilds];
}

// Slowest-first within the window, for the in-app Slow Operations view.
export function querySlowBuilds(query: WindowQuery): SlowBuildEntry[] {
    return windowedTopN(slowBuilds, query, (b) => b.totalMs);
}

// Compact summary for the in-app monitor: how many slow builds are held and
// the worst one's duration.
export function getSlowBuildStats(): SlowBuildStats {
    let slowestBuildMs = 0;
    for (const b of slowBuilds) {
        if (b.totalMs > slowestBuildMs) slowestBuildMs = b.totalMs;
    }
    return {slowBuilds: slowBuilds.length, slowestBuildMs};
}

export function resetSlowBuilds(): void {
    slowBuilds.length = 0;
}
