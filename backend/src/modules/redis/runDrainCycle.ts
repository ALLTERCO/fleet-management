// Shared drainer-cycle guard. Wraps the per-cycle work so a single thrown
// error doesn't kill the loop IIFE: bumps a labeled cycle counter, logs,
// and sleeps the configured retry backoff before the caller continues.

import type {Logger} from 'log4js';
import * as Observability from '../Observability';
import {sleep} from '../util/sleep';

export interface DrainCycleOptions {
    name: string;
    logger: Logger;
    retryMs: number;
    cycleErrorsCounter: string;
}

export async function runDrainCycle(
    work: () => Promise<void>,
    opts: DrainCycleOptions
): Promise<void> {
    try {
        await work();
    } catch (err) {
        Observability.incrementCounter(opts.cycleErrorsCounter);
        opts.logger.error('%s drain cycle failed: %s', opts.name, err);
        await sleep(opts.retryMs);
    }
}
