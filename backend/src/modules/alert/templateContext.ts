// Shared context builders for templateRenderer — used by delivery +
// preview so a UI-previewed template matches what gets delivered.

import type {AlertRuleKind} from '../../types/api/alert';
import {summaryLine} from '../delivery/groupSummary';
import {
    notificationDisplayContext,
    notificationTimeLabel
} from '../delivery/notificationDisplay';
import type {DeliveryPayload} from '../delivery/types';
import {ALERT_INSTANCE_STATE_SET} from './states';

export interface TemplateContextArgs {
    locale?: string;
    timeZone?: string;
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
        locale: payload.locale,
        timeZone: payload.timeZone,
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
    const display = context.display as Record<string, string>;
    const deviceName = payload.context?.deviceName;
    const sourceLabel =
        typeof deviceName === 'string' && deviceName.length > 0
            ? deviceName
            : (payload.source?.subjectId ?? '');
    const groupAlerts =
        payload.siblings && payload.siblings.length > 0
            ? [payload, ...payload.siblings]
            : [];
    const sourceNames = [
        ...new Set(
            groupAlerts.map((alert) => {
                const name = alert.context?.deviceName;
                return typeof name === 'string' && name.length > 0
                    ? name
                    : (alert.source?.subjectId ?? alert.title);
            })
        )
    ];
    const previewLimit = 5;
    const previewNames = sourceNames.slice(0, previewLimit);
    const remainingSources = Math.max(
        0,
        sourceNames.length - previewNames.length
    );
    const preview = [
        ...previewNames.map((name) => `• ${name}`),
        ...(remainingSources > 0 ? [`+${remainingSources} more`] : [])
    ].join('\n');
    const compactPreviewLimit = 3;
    const compactPreviewNames = sourceNames.slice(0, compactPreviewLimit);
    const remainingCompactSources = Math.max(
        0,
        sourceNames.length - compactPreviewNames.length
    );
    const compactPreview = [
        ...compactPreviewNames.map((name) => `• ${name}`),
        ...(remainingCompactSources > 0
            ? [`+${remainingCompactSources} more`]
            : [])
    ].join('\n');
    const firstAt = payload.aggregate?.firstAt || payload.firedAt;
    const lastAt = payload.aggregate?.lastAt || payload.firedAt;
    const firstLabel = notificationTimeLabel(
        firstAt,
        payload.timeZone,
        payload.locale
    );
    const lastLabel = notificationTimeLabel(
        lastAt,
        payload.timeZone,
        payload.locale
    );
    const groupTimeLabel =
        firstAt === lastAt ? firstLabel : `${firstLabel} – ${lastLabel}`;
    const groupCount = groupAlerts.length;
    const deviceCount = sourceNames.length;
    const groupTriggers = groupAlerts.map((alert) => {
        const name = alert.context?.deviceName;
        const label =
            typeof name === 'string' && name.length > 0
                ? name
                : (alert.source?.subjectId ?? '');
        return label && alert.title.startsWith(label)
            ? alert.title.slice(label.length).trim()
            : '';
    });
    const sharedTrigger =
        groupTriggers.length > 0 &&
        groupTriggers.every(
            (trigger) => trigger.length > 0 && trigger === groupTriggers[0]
        )
            ? groupTriggers[0]
            : '';
    return {
        ...context,
        group: {
            isGrouped: groupAlerts.length > 0,
            count: groupCount,
            title: `${groupCount} alerts · ${payload.ruleName}`,
            deviceTitle: sharedTrigger
                ? `${deviceCount} devices ${sharedTrigger}`
                : `${deviceCount} devices · ${payload.ruleName}`,
            heading: `${groupCount} ${display.stateLabel.toLowerCase()} alerts`,
            summary: summaryLine(payload.aggregate) || `${groupCount} alerts`,
            preview,
            compactPreview,
            timeLabel: groupTimeLabel,
            compactTimeLabel: compactTimeRange(firstLabel, lastLabel)
        },
        display: {
            ...display,
            sourceLabel,
            timeLabel: notificationTimeLabel(
                payload.firedAt,
                payload.timeZone,
                payload.locale
            )
        },
        labels: payload.labels ?? {},
        context: payload.context ?? {},
        is_has_device_image: Boolean(payload.deviceImageUrl),
        device: {
            imageUrl: payload.deviceImageUrl ?? ''
        },
        virtualDevice: payload.context?.virtualDevice ?? null
    };
}

function compactTimeRange(firstLabel: string, lastLabel: string): string {
    if (firstLabel === lastLabel) return firstLabel;
    const first = splitTimeLabel(firstLabel);
    const last = splitTimeLabel(lastLabel);
    if (first && last && first.date === last.date && first.zone === last.zone) {
        return `${first.date} · ${first.time}–${last.time} ${first.zone}`;
    }
    return `${firstLabel} – ${lastLabel}`;
}

function splitTimeLabel(
    value: string
): {date: string; time: string; zone: string} | null {
    const match = /^(.*?) · (\d{2}:\d{2}) (.+)$/.exec(value);
    if (!match) return null;
    return {date: match[1], time: match[2], zone: match[3]};
}

export function buildTemplateContext(
    args: TemplateContextArgs
): Record<string, unknown> {
    const {instance, rule, locale, timeZone} = args;
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
        device: {
            imageUrl:
                'https://control.shelly.cloud/images/device_images/SNSW-001X16EU.png'
        },
        is_has_device_image: true,
        display: {
            ...notificationDisplayContext(severity, state),
            sourceLabel: instance.sourceSubjectId,
            timeLabel: notificationTimeLabel(instance.firedAt, timeZone, locale)
        }
    };
}

function normalizeSeverity(value: string): DeliveryPayload['severity'] {
    if (value === 'critical' || value === 'warning' || value === 'info') {
        return value;
    }
    return 'info';
}

// Asks the shared vocabulary instead of listing the states again. The old copy
// had to be edited every time a state was added, and nothing said so.
function normalizeState(value: string): DeliveryPayload['state'] {
    return ALERT_INSTANCE_STATE_SET.has(value)
        ? (value as DeliveryPayload['state'])
        : 'active';
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
            sourceSubjectType: 'system',
            sourceSubjectId: '7',
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        system_health: {
            id: 42,
            title: 'Rejected meter blocks are waiting',
            message:
                '3 meter history blocks were refused by the database. Review the list and queue them again once the cause is fixed.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'system',
            sourceSubjectId: 'em-sync-rejected-open',
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        grafana_alert: {
            id: 42,
            title: 'Grafana: HighCPU',
            message: 'CPU usage above 90% for 5 minutes.',
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'external',
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
        credential_expiring: {
            id: 42,
            title: 'Device key ends soon',
            message: `The key for ${SAMPLE_DEVICE} ends in 29 days.`,
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
        cost_budget_threshold: {
            id: 42,
            title: 'Energy-cost budget threshold reached',
            message: `${SAMPLE_DEVICE} crossed 80% of its USD 500.00 billing-period energy-cost budget.`,
            severity: 'warning',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        record_incomplete: {
            id: 42,
            title: 'Daily temperature record incomplete',
            message: `${SAMPLE_DEVICE} has no temperature reading today.`,
            severity: 'info',
            state: 'active',
            sourceSubjectType: 'device',
            sourceSubjectId: SAMPLE_DEVICE,
            firedAt: SAMPLE_TS,
            activeSince: SAMPLE_TS
        },
        approaching_new_peak: {
            id: 42,
            title: 'Approaching a new demand peak',
            message: `${SAMPLE_DEVICE} is at 92% of the current billing peak.`,
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
    credential_expiring: {
        shellyID: SAMPLE_DEVICE,
        endsAt: '2026-10-11T10:00:00.000Z',
        daysLeft: 29
    },
    energy_consumption_threshold: {
        shellyID: SAMPLE_DEVICE,
        consumptionKWh: 6.25,
        thresholdKWh: 5,
        operator: 'gt',
        windowSec: 3600,
        sampleCount: 120
    },
    cost_budget_threshold: {
        shellyID: SAMPLE_DEVICE,
        actualCost: 410,
        budgetAmount: 500,
        currency: 'USD',
        thresholdPct: 80,
        thresholdAmount: 400,
        period: 'billing_period',
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: SAMPLE_TS,
        billingDay: 1,
        timeZone: 'America/New_York',
        costBasis: 'recorded_import_energy_charge',
        excludedCharges: ['standing', 'demand', 'tax']
    },
    record_incomplete: {
        shellyID: SAMPLE_DEVICE,
        roleKey: 'temperature',
        deadlineHour: 17,
        timeZone: 'Australia/Sydney',
        // A real timestamp, not null: the sample exists so every token in the
        // catalog can be shown rendering, and a null renders as nothing.
        latestReadingAt: SAMPLE_TS
    },
    approaching_new_peak: {
        shellyID: SAMPLE_DEVICE,
        intervalMinutes: 30,
        currentKw: 184,
        baselineKw: 200,
        ratio: 0.92,
        warningRatio: 0.9,
        timeZone: 'Australia/Sydney'
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
