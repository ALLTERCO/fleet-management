// Shared context builders for templateRenderer — used by delivery +
// preview so a UI-previewed template matches what gets delivered.

import type {AlertRuleKind} from '../../types/api/alert';
import {notificationDisplayContext} from '../delivery/notificationDisplay';
import type {DeliveryPayload} from '../delivery/types';

export interface TemplateContextArgs {
    instance: {
        id: number;
        title: string;
        message: string;
        severity: string;
        state: string;
        sourceSubjectType: string;
        sourceSubjectId: string;
        firedAt: string;
        activeSince: string;
    };
    rule: {
        id: number;
        name: string;
        kind: AlertRuleKind;
        runbookUrl?: string | null;
    };
}

/** Build the renderer context from a live DeliveryPayload. Single
 *  source of truth for every adapter's template rendering. */
export function buildDeliveryContext(
    payload: DeliveryPayload
): Record<string, unknown> {
    const context = buildTemplateContext({
        instance: {
            id: payload.alertId ?? 0,
            title: payload.title,
            message: payload.message,
            severity: payload.severity,
            state: payload.state,
            sourceSubjectType: payload.source?.subjectType ?? 'device',
            sourceSubjectId: payload.source?.subjectId ?? '',
            firedAt: payload.firedAt,
            activeSince: payload.activeSince
        },
        rule: {
            id: payload.ruleId ?? 0,
            name: payload.ruleName,
            kind: payload.ruleKind as AlertRuleKind,
            runbookUrl: payload.ruleRunbookUrl ?? null
        }
    });
    return {
        ...context,
        labels: payload.labels ?? {},
        context: payload.context ?? {},
        virtualDevice: payload.context?.virtualDevice ?? null
    };
}

export function buildTemplateContext(
    args: TemplateContextArgs
): Record<string, unknown> {
    const {instance, rule} = args;
    const severity = normalizeSeverity(instance.severity);
    const state = normalizeState(instance.state);
    return {
        alert: {
            id: instance.id,
            title: instance.title,
            message: instance.message,
            severity: instance.severity,
            state: instance.state,
            source: {
                type: instance.sourceSubjectType,
                id: instance.sourceSubjectId
            },
            firedAt: instance.firedAt,
            activeSince: instance.activeSince
        },
        rule: {
            id: rule.id,
            name: rule.name,
            kind: rule.kind,
            runbookUrl: rule.runbookUrl ?? null
        },
        display: notificationDisplayContext(severity, state)
    };
}

function normalizeSeverity(value: string): DeliveryPayload['severity'] {
    if (value === 'critical' || value === 'warning' || value === 'info') {
        return value;
    }
    return 'info';
}

function normalizeState(value: string): DeliveryPayload['state'] {
    if (
        value === 'pending' ||
        value === 'active' ||
        value === 'acknowledged' ||
        value === 'recovering' ||
        value === 'cleared_unack' ||
        value === 'cleared_ack' ||
        value === 'no_data' ||
        value === 'evaluation_error' ||
        value === 'resolved'
    ) {
        return value;
    }
    return 'active';
}

// Per-kind sample inputs. Values here are the single source of truth
// for both the token-catalog examples and the RenderTemplate preview
// when no real alert is available.
const SAMPLE_TS = '2026-04-22T10:30:00.000Z';
const SAMPLE_DEVICE = 'shellyplus1-441793d67bcc';

const SAMPLE_INSTANCES: Record<AlertRuleKind, TemplateContextArgs['instance']> =
    {
        device_offline: {
            id: 42,
            title: 'Device offline',
            message: `Device ${SAMPLE_DEVICE} has been offline for 5 minutes.`,
            severity: 'critical',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        device_back_online: {
            id: 42,
            title: 'Device back online',
            message: `Device ${SAMPLE_DEVICE} reconnected.`,
            severity: 'info',
            state: 'resolved',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        battery_below: {
            id: 42,
            title: 'Sensor A battery low',
            message: 'Battery on Sensor A is 12% — below 20%.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        smoke_alarm: {
            id: 42,
            title: 'Smoke alarm',
            message: 'Smoke detected by Kitchen smoke sensor.',
            severity: 'critical',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        flood_alarm: {
            id: 42,
            title: 'Flood alarm',
            message: 'Flood detected by Basement water sensor.',
            severity: 'critical',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        motion_detected: {
            id: 42,
            title: 'Motion detected',
            message: 'Motion detected by Hallway PIR.',
            severity: 'info',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        component_threshold: {
            id: 42,
            title: 'Sensor threshold crossed',
            message: 'Reading on Sensor A crossed configured threshold.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'component',
            sourceSubjectId: `${SAMPLE_DEVICE}_temperature:0`,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        component_state: {
            id: 42,
            title: 'Relay is on',
            message: 'switch:0.output is on.',
            severity: 'info',
            state: 'active',
            sourceSubjectType: 'component',
            sourceSubjectId: `${SAMPLE_DEVICE}_switch:0`,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        firmware_operation_failed: {
            id: 42,
            title: 'Firmware update failed',
            message: 'Firmware update failed on Device A.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        backup_operation_failed: {
            id: 42,
            title: 'Backup failed',
            message: 'Scheduled backup job failed.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        automation_run_failed: {
            id: 42,
            title: 'Automation run failed',
            message: 'Automation execution failed.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        grafana_alert: {
            id: 42,
            title: 'Grafana: HighCPU',
            message: 'CPU usage above 90% for 5 minutes.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'entity',
            sourceSubjectId: 'grafana-fp-abc123',
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        heartbeat: {
            id: 42,
            title: 'Device heartbeat missed',
            message: `${SAMPLE_DEVICE} stopped reporting telemetry.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        energy_consumption_threshold: {
            id: 42,
            title: 'High energy consumption',
            message: `${SAMPLE_DEVICE} consumed 6.250 kWh in the last hour.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        rate_of_change: {
            id: 42,
            title: 'Rate of change exceeded',
            message: `${SAMPLE_DEVICE} temperature changing too fast.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        stuck_sensor: {
            id: 42,
            title: 'Stuck sensor',
            message: `${SAMPLE_DEVICE} reading hasn't moved.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        composite: {
            id: 42,
            title: 'Composite condition matched',
            message: 'Motion AND door-open (within 60s) AND NOT armed.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        anomaly_band: {
            id: 42,
            title: 'Anomaly band breach',
            message: `${SAMPLE_DEVICE} temperature:0.tC outside learned band.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        change_event: {
            id: 42,
            title: 'Categorical change',
            message: `${SAMPLE_DEVICE} cover:0.state closed → open.`,
            severity: 'info',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        device_event: {
            id: 42,
            title: `${SAMPLE_DEVICE} em:0 alarm_overvoltage`,
            message: `Device ${SAMPLE_DEVICE} pushed event em:0.alarm_overvoltage.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        }
    };

function sampleRule(kind: AlertRuleKind, ruleName?: string) {
    return {
        id: 42,
        name: ruleName ?? 'Sample rule',
        kind,
        runbookUrl: 'https://runbooks.example.com/sample'
    };
}

// Per-kind sample context payload — matches MatchResult.context that the
// real evaluator produces. Used by token-catalog examples.
const SAMPLE_CONTEXT_PAYLOADS: Partial<
    Record<AlertRuleKind, Record<string, unknown>>
> = {
    battery_below: {
        shellyID: SAMPLE_DEVICE,
        channel: '0',
        percent: 12,
        threshold: 20,
        // Union of context.* keys so every catalog token resolves.
        current: 12,
        operator: 'lt',
        component: 'devicepower:0',
        field: 'percent'
    },
    component_threshold: {
        shellyID: SAMPLE_DEVICE,
        component: 'temperature:0',
        field: 'tC',
        current: 35,
        threshold: 30,
        operator: 'gt'
    },
    component_state: {
        shellyID: SAMPLE_DEVICE,
        component: 'switch:0',
        field: 'output',
        current: true
    },
    smoke_alarm: {shellyID: SAMPLE_DEVICE, channel: '0'},
    flood_alarm: {shellyID: SAMPLE_DEVICE, channel: '0'},
    motion_detected: {shellyID: SAMPLE_DEVICE, channel: '0'},
    device_offline: {shellyID: SAMPLE_DEVICE, offlineForSec: 300},
    device_back_online: {shellyID: SAMPLE_DEVICE},
    firmware_operation_failed: {
        shellyID: SAMPLE_DEVICE,
        error: 'Download failed: 404'
    },
    backup_operation_failed: {
        shellyID: SAMPLE_DEVICE,
        error: 'Backup endpoint unreachable'
    },
    automation_run_failed: {
        automationId: 7,
        automationName: 'Nightly backup',
        error: 'Step 3 failed'
    },
    heartbeat: {shellyID: SAMPLE_DEVICE, expectedIntervalSec: 600},
    energy_consumption_threshold: {
        shellyID: SAMPLE_DEVICE,
        consumptionKWh: 6.25,
        thresholdKWh: 5,
        operator: 'gt',
        windowSec: 3600,
        sampleCount: 120
    },
    rate_of_change: {
        shellyID: SAMPLE_DEVICE,
        component: 'temperature:0',
        field: 'tC',
        rate: 0.5,
        deltaValue: 0.1,
        windowSec: 300
    },
    stuck_sensor: {
        shellyID: SAMPLE_DEVICE,
        component: 'temperature:0',
        field: 'tC',
        notChangedForSec: 1800
    },
    composite: {
        ruleId: 42,
        matchedLeafIds: ['motion-rule', 'door-rule'],
        explanation: '(motion AND door) within 60s'
    },
    anomaly_band: {
        shellyID: SAMPLE_DEVICE,
        component: 'temperature:0',
        field: 'tC',
        current: 38,
        mean: 22,
        stdDev: 1.5,
        upperBound: 26.5,
        lowerBound: 17.5,
        direction: 'above'
    },
    change_event: {
        shellyID: SAMPLE_DEVICE,
        component: 'cover:0',
        field: 'state',
        previous: 'closed',
        current: 'open'
    },
    device_event: {
        shellyID: SAMPLE_DEVICE,
        componentType: 'em',
        componentKey: 'em:0',
        event: 'alarm_overvoltage',
        ts: 1745318400,
        attrs: {phase: 'a', voltage: 252.4}
    }
};

/** Pre-built sample contexts (one per kind) — renderer uses these for token examples. */
export const SAMPLE_CONTEXTS = Object.freeze(
    Object.fromEntries(
        (Object.keys(SAMPLE_INSTANCES) as AlertRuleKind[]).map((kind) => [
            toCamel(kind),
            {
                ...buildTemplateContext({
                    instance: SAMPLE_INSTANCES[kind],
                    rule: sampleRule(kind)
                }),
                context: SAMPLE_CONTEXT_PAYLOADS[kind] ?? {},
                labels: {}
            }
        ])
    )
) as Record<string, Record<string, unknown>>;

function toCamel(kind: AlertRuleKind): string {
    return kind.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Synthesize a preview context when no real alert is available. */
export function sampleTemplateContext(
    kind?: AlertRuleKind,
    ruleName?: string
): Record<string, unknown> {
    const effectiveKind = kind ?? 'device_offline';
    const base = buildTemplateContext({
        instance: SAMPLE_INSTANCES[effectiveKind],
        rule: sampleRule(effectiveKind, ruleName)
    });
    return {
        ...base,
        context: SAMPLE_CONTEXT_PAYLOADS[effectiveKind] ?? {},
        labels: {}
    };
}
