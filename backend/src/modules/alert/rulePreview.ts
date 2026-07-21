// Side-effect-free preview of a (possibly unsaved) alert rule.
// Walks devices in the caller's org, synthesizes a device_status_changed
// event per device, runs the live evaluator + scope matcher, returns
// subjects that WOULD fire right now. No DB writes, no delivery, no
// inbox entries. Caps via FM_ALERT_PREVIEW_MAX_{DEVICES,MATCHES}.

import {envInt} from '../../config/envReader';
import type AbstractDevice from '../../model/AbstractDevice';
import {ALERT_RULE_KIND_DESCRIPTOR_BY_KEY} from '../../types/api/alert';
import * as DeviceCollector from '../DeviceCollector';
import * as EventDistributor from '../EventDistributor';
import * as PostgresProvider from '../PostgresProvider';
import {getEvaluator} from './evaluators';
import {buildDeviceOfflineMatch} from './evaluators/deviceOffline';
import {matchesScope} from './scope';
import {collectEntityIds} from './signals';
import {storedDevicePresence, timestampMs} from './storedPresence';
import {resolveSubjectForEvent} from './subjectForEvent';
import type {LoadedAlertRule} from './types';

export interface PreviewMatch {
    subject: {
        type: 'device' | 'entity' | 'group' | 'location' | 'tag';
        id: string;
    };
    title: string;
    message: string;
    severity: string;
    fingerprint: string;
    context: Record<string, unknown>;
}

export interface PreviewResult {
    matches: PreviewMatch[];
    matchCount: number;
    scanned: number;
    supportedKind: boolean;
    truncated: boolean;
    note: string | null;
}

/** Evaluator trigger kinds that are replayable from current device state. */
const STATUS_BASED_TRIGGER = 'device_status_changed';

function isStatusBased(rule: LoadedAlertRule): boolean {
    const evaluator = getEvaluator(rule.kind);
    return evaluator?.triggerKinds.includes(STATUS_BASED_TRIGGER) ?? false;
}

function offlineForSec(rule: LoadedAlertRule): number | null {
    const v = rule.config.offlineForSec;
    return typeof v === 'number' && v > 0 ? v : null;
}

interface PreviewInputs {
    organizationId: string;
    rule: LoadedAlertRule;
    /** Optional allowlist from CommandSender.filterAccessibleDevices. */
    accessibleDeviceIds?: Set<string>;
}

export async function previewRuleAgainstOrg(
    inputs: PreviewInputs
): Promise<PreviewResult> {
    const {organizationId, rule, accessibleDeviceIds} = inputs;

    if (rule.kind === 'device_offline') {
        return previewOfflineRule({organizationId, rule, accessibleDeviceIds});
    }

    if (!isStatusBased(rule)) {
        const descriptor = ALERT_RULE_KIND_DESCRIPTOR_BY_KEY[rule.kind];
        return {
            matches: [],
            matchCount: 0,
            scanned: 0,
            supportedKind: false,
            truncated: false,
            note:
                descriptor?.evaluationMode === 'event'
                    ? `Preview is not available for event-driven rule kind '${rule.kind}'. Fires only on future runtime events.`
                    : `Preview is not available for rule kind '${rule.kind}'.`
        };
    }

    const evaluator = getEvaluator(rule.kind);
    if (!evaluator) {
        return {
            matches: [],
            matchCount: 0,
            scanned: 0,
            supportedKind: false,
            truncated: false,
            note: `No evaluator registered for rule kind '${rule.kind}'.`
        };
    }

    const maxDevices = envInt('FM_ALERT_PREVIEW_MAX_DEVICES', 5000);
    const maxMatches = envInt('FM_ALERT_PREVIEW_MAX_MATCHES', 200);

    const matches: PreviewMatch[] = [];
    const seenFingerprints = new Set<string>();
    let matchCount = 0;
    let scanned = 0;
    let truncated = false;

    const ruleUsesMemberships =
        (rule.scope.groupIds?.length ?? 0) > 0 ||
        (rule.scope.locationIds?.length ?? 0) > 0 ||
        (rule.scope.tagIds?.length ?? 0) > 0;

    for (const device of DeviceCollector.getAll()) {
        if (scanned >= maxDevices) {
            truncated = true;
            break;
        }
        if (EventDistributor.getDeviceOrg(device.shellyID) !== organizationId) {
            continue;
        }
        if (
            accessibleDeviceIds !== undefined &&
            !accessibleDeviceIds.has(device.shellyID)
        ) {
            continue;
        }
        scanned++;

        // Resolve the full membership axes (group + location + tag) the same
        // way the live and device_offline paths do, so location/tag-scoped
        // rules preview correctly. Skip the lookup when the rule needs no
        // membership axis (device/component/wildcard scope) — resolver is
        // cached, so repeat previews stay cheap.
        const subject = ruleUsesMemberships
            ? await resolveSubjectForEvent(
                  {
                      kind: 'device_status_changed',
                      organizationId,
                      shellyID: device.shellyID,
                      device,
                      status: (device as AbstractDevice).status ?? {}
                  },
                  PostgresProvider.callMethod
              )
            : {
                  shellyID: device.shellyID,
                  entityIds: collectEntityIds(device)
              };

        if (!matchesScope(rule.scope, subject)) {
            continue;
        }

        const event = {
            kind: 'device_status_changed' as const,
            organizationId,
            shellyID: device.shellyID,
            device,
            status: (device as AbstractDevice).status ?? {}
        };
        const results = evaluator.matchAll
            ? evaluator.matchAll(event, rule)
            : [evaluator.match(event, rule, {preview: true})].filter(
                  (m): m is NonNullable<typeof m> => m !== null
              );

        for (const result of results) {
            if (seenFingerprints.has(result.fingerprintV2)) continue;
            seenFingerprints.add(result.fingerprintV2);
            matchCount++;

            if (matches.length < maxMatches) {
                matches.push({
                    subject: result.subject,
                    title: result.title,
                    message: result.message,
                    severity: result.severity ?? rule.severity,
                    fingerprint: result.fingerprintV2,
                    context: result.context ?? {}
                });
            } else {
                truncated = true;
            }
        }
    }

    return {
        matches,
        matchCount,
        scanned,
        supportedKind: true,
        truncated,
        note: null
    };
}

async function previewOfflineRule(
    inputs: PreviewInputs
): Promise<PreviewResult> {
    const {organizationId, rule, accessibleDeviceIds} = inputs;
    const maxDevices = envInt('FM_ALERT_PREVIEW_MAX_DEVICES', 5000);
    const maxMatches = envInt('FM_ALERT_PREVIEW_MAX_MATCHES', 200);
    const matches: PreviewMatch[] = [];
    let matchCount = 0;
    let scanned = 0;
    let truncated = false;
    let noData = 0;
    const now = Date.now();
    const requiredOfflineSec = offlineForSec(rule);

    for (const row of await storedDevicePresence(organizationId)) {
        if (scanned >= maxDevices) {
            truncated = true;
            break;
        }
        const shellyID = row.external_id;
        if (accessibleDeviceIds && !accessibleDeviceIds.has(shellyID)) continue;
        scanned++;

        const live = DeviceCollector.getDevice(shellyID);
        const subject = await resolveSubjectForEvent(
            {kind: 'device_offline', organizationId, shellyID, device: live},
            PostgresProvider.callMethod
        );
        if (!matchesScope(rule.scope, subject)) continue;
        if (live?.presence === 'online' || live?.online === true) continue;

        const lastSeenMs =
            timestampMs(row.last_seen) ?? timestampMs(live?.lastReportTs);
        if (lastSeenMs === null) {
            noData++;
            continue;
        }

        const offlineForMs =
            requiredOfflineSec === null ? null : requiredOfflineSec * 1000;
        const elapsedMs = now - lastSeenMs;
        const pending =
            offlineForMs !== null && elapsedMs >= 0 && elapsedMs < offlineForMs;
        const match = buildDeviceOfflineMatch(
            rule.id,
            rule.name,
            shellyID,
            row.name ?? (live?.info?.name as string | undefined),
            {
                offlineSince: new Date(lastSeenMs).toISOString(),
                offlineForSec: requiredOfflineSec ?? undefined,
                pending,
                remainingSec: pending
                    ? Math.ceil((offlineForMs! - elapsedMs) / 1000)
                    : 0
            }
        );
        matchCount++;
        if (matches.length < maxMatches) {
            matches.push({
                subject: match.subject,
                title: match.title,
                message: match.message,
                severity: match.severity ?? rule.severity,
                fingerprint: match.fingerprintV2,
                context: match.context ?? {}
            });
        } else {
            truncated = true;
        }
    }

    return {
        matches,
        matchCount,
        scanned,
        supportedKind: true,
        truncated,
        note:
            noData > 0
                ? `${noData} device(s) had no stored last-seen timestamp and were treated as no data.`
                : null
    };
}
