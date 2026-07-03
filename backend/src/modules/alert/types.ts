/**
 * Shared types for the AlertEngine. A NormalizedEvent is the one shape
 * evaluators receive — `kind` discriminates the union so each evaluator
 * narrows to the fields it needs and no evaluator ever reaches into the
 * raw device object.
 */

import type AbstractDevice from '../../model/AbstractDevice';
import type {
    AlertRuleKind,
    AlertSeverity,
    ScopeSelector
} from '../../types/api/alert';

/** One active rule loaded from fn_alert_rule_list_enabled. */
export interface LoadedAlertRule {
    id: number;
    organizationId: string;
    name: string;
    kind: AlertRuleKind;
    /** Condition family — threshold | inactivity | delta | event | composite | anomaly. */
    conditionFamily: import('../../types/api/alert').AlertConditionFamily;
    /** Preset within the family. e.g. battery_below.subkind='battery'. */
    conditionSubkind: string;
    severity: AlertSeverity;
    scope: ScopeSelector;
    dedupeWindowSec: number;
    cooldownSec: number;
    ownerUserId: string | null;
    summaryTemplate: string | null;
    messageTemplate: string | null;
    autoResolve: boolean;
    config: Record<string, unknown>;
    destinationGroupIds: number[];
    /** Channels the rule notifies directly. */
    destinationChannelIds: number[];
    /** Per-rule override of FM_ALERT_GROUP_BY. Null = use env default. */
    groupBy: readonly string[] | null;
    /** digest = inbox routed through digest queue, overriding per-user pref. */
    deliveryMode: 'instant' | 'digest';
    /** Digest window in minutes. Null = use platform default. */
    digestWindowMinutes: number | null;
    /** Optional URL to the org's runbook for this rule; surfaces in renderers. */
    runbookUrl: string | null;
    /** Reusable multi-channel message template id, or null for inline wording. */
    templateId: number | null;
    /** Templated labels; resolved per fire to alert_instances.labels. */
    labelsTemplate: Record<string, unknown>;
}

interface EventBase {
    organizationId: string;
    shellyID: string;
    /** Attached for evaluators that need richer context (scope match, status). */
    device?: AbstractDevice;
}

export type NormalizedEvent =
    | ({kind: 'device_offline'} & EventBase)
    | ({kind: 'device_online'} & EventBase)
    | ({
          kind: 'device_status_changed';
          status: Record<string, unknown>;
      } & EventBase)
    | ({
          kind: 'device_event_received';
          /** Bare prefix, e.g. "em". */
          componentType: string;
          /** Full key, e.g. "em:0". */
          componentKey: string;
          event: string;
          /** Unix seconds per device clock. */
          ts: number | null;
          /** Payload with envelope keys stripped. */
          attrs: Record<string, unknown>;
      } & EventBase)
    | {
          kind: 'firmware_operation_failed';
          organizationId: string;
          shellyID: string;
          errorMessage: string;
      }
    | {
          kind: 'backup_operation_failed';
          organizationId: string;
          shellyID: string;
          errorMessage: string;
      }
    | {
          kind: 'automation_run_failed';
          organizationId: string;
          automationId: number;
          automationName: string;
          errorMessage: string;
      }
    | {
          kind: 'grafana_alert';
          organizationId: string;
          /** 'firing' triggers; 'resolved' auto-clears. */
          status: 'firing' | 'resolved';
          /** Grafana series fingerprint — stable per alert, used to clear. */
          fingerprint: string;
          alertName: string;
          summary: string;
          labels: Record<string, string>;
          annotations: Record<string, string>;
      };

/** An evaluator match — shape handed back to the engine for upsert. */
export interface MatchResult {
    /** Canonical fingerprint. Matches notifications.fn_compute_fingerprint_v2. */
    fingerprintV2: string;
    title: string;
    message: string;
    /** Optional severity override (default: rule.severity). */
    severity?: AlertSeverity;
    /** Arbitrary per-match context — surfaces in the instance `context` column. */
    context?: Record<string, unknown>;
    /** Subject attribution for the source ref on the instance. */
    subject: {
        type: 'device' | 'entity' | 'group' | 'location' | 'tag';
        id: string;
    };
}

/**
 * Evaluator shape. Each rule-kind module exports a matchers for its
 * triggering event-kind(s) and, optionally, a clear-signal handler for
 * auto-resolve.
 */
export interface MatchOptions {
    /** Read-only evaluation (Rule.Preview): stateful evaluators must NOT mutate
     *  their per-rule caches, so a preview can't corrupt live detection. */
    preview?: boolean;
}

export interface Evaluator {
    /** Event kinds this evaluator cares about (trigger path). */
    triggerKinds: readonly NormalizedEvent['kind'][];
    /** Event kinds that clear an active alert for this rule (auto-resolve). */
    clearKinds?: readonly NormalizedEvent['kind'][];
    /** Trigger match — returns the alert shape, or null if the event does not match. */
    match(
        event: NormalizedEvent,
        rule: LoadedAlertRule,
        opts?: MatchOptions
    ): MatchResult | null;
    /** Multi-subject trigger — one match per matching subject (e.g. every relay
     *  on a device). Engine prefers this over match when present. */
    matchAll?(event: NormalizedEvent, rule: LoadedAlertRule): MatchResult[];
    /** Auto-resolve match — returns the fingerprint to clear, or null. Must be
     *  the same fingerprintV2 the fire path produced for this subject. */
    matchClear?(
        event: NormalizedEvent,
        rule: LoadedAlertRule
    ): {fingerprintV2: string} | null;
    /** Fingerprints of all recovered subjects. Engine prefers this over
     *  matchClear so a recovered sibling can't stand in for the fired one. */
    matchClearAll?(
        event: NormalizedEvent,
        rule: LoadedAlertRule
    ): readonly string[];
}
