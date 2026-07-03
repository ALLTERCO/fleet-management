// Monitoring for individual device commands (FM → device RPCs: the probe's
// GetStatus/GetComponents/Webhook.ListAllSupported and every post-onboard call).
// Counts every command and catches the slow ones — the round-trip that drags an
// onboard — with method and ms, so a future regression is traceable by command
// rather than guessed at. Mirrors buildTimings: gated recording, bounded ring,
// rate-limited log.

import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import {IntervalSampler} from '../util/intervalSampler';
import {incrementCounter, incrementLabeledCounter} from './counters';
import {getLevel} from './samplers';
import {pushRing} from './util/ringBuffer';
import {type WindowQuery, windowedTopN} from './util/windowedTopN';

const logger = getLogger('device-command');
const slowLog = new IntervalSampler(
    () => tuning.device.commandSlowLogIntervalMs
);

// 'unsupported' (device lacks the method) is an expected probe, not a failure.
export type DeviceCommandOutcome = 'ok' | 'error' | 'timeout' | 'unsupported';

export interface DeviceCommandTiming {
    // shellyID once the device is built; empty during the onboarding probe.
    label: string;
    method: string;
    ms: number;
    outcome: DeviceCommandOutcome;
}

export interface SlowDeviceCommand extends DeviceCommandTiming {
    ts: number;
}

const slowCommands: SlowDeviceCommand[] = [];

function isSlow(ms: number): boolean {
    return ms > tuning.device.commandSlowLogMs;
}

// Called from the transport when a command settles (response, error, or
// timeout). Counting is a gated Map increment — safe at thousands/sec; the slow
// ones land in a bounded ring (level >= 2) and a rate-limited log.
export function recordDeviceCommand(cmd: DeviceCommandTiming): void {
    incrementCounter('device_commands_total');
    recordOutcomeCounter(cmd);
    if (!isSlow(cmd.ms)) return;
    incrementCounter('device_commands_slow');
    logSlowCommand(cmd);
    if (getLevel() < 2) return;
    pushRing(
        slowCommands,
        {...cmd, ts: Date.now()},
        tuning.device.commandRingSize
    );
}

// Method-labeled so a regression names the command; unsupported kept apart.
function recordOutcomeCounter(cmd: DeviceCommandTiming): void {
    if (cmd.outcome === 'ok') return;
    if (cmd.outcome === 'unsupported') {
        incrementLabeledCounter('device_commands_unsupported_total', {
            method: cmd.method
        });
        return;
    }
    incrementLabeledCounter('device_commands_failed_total', {
        outcome: cmd.outcome,
        method: cmd.method
    });
}

// At most one line per interval; the count carries how many it stands for.
function logSlowCommand(cmd: DeviceCommandTiming): void {
    const count = slowLog.sample();
    if (count === null) return;
    logger.info(
        'slow device command method=%s ms=%d outcome=%s label=%s (x%d this window)',
        cmd.method,
        cmd.ms,
        cmd.outcome,
        cmd.label || '-',
        count
    );
}

// Slowest-first within the window, for the in-app Slow Operations view.
export function querySlowDeviceCommands(
    query: WindowQuery
): SlowDeviceCommand[] {
    return windowedTopN(slowCommands, query, (c) => c.ms);
}

export function getSlowDeviceCommands(): SlowDeviceCommand[] {
    return [...slowCommands];
}

export function resetSlowDeviceCommands(): void {
    slowCommands.length = 0;
}
