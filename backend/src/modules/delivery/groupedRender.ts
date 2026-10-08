// Shared grouped-payload rendering for delivery adapters.
// Decides single / list / summary mode based on sibling count vs
// FM_ALERT_STORM_SUMMARY_THRESHOLD. Single SSOT via tuning.

import {tuning} from '../../config/tuning';
import {summaryLine} from './groupSummary';
import type {DeliveryAggregate, DeliveryPayload} from './types';

export {summaryLine};

export type RenderMode = 'single' | 'list' | 'summary';

export interface GroupedInfo {
    mode: RenderMode;
    leader: DeliveryPayload;
    /** All alerts in the group, leader first. Empty when mode='single'. */
    alerts: DeliveryPayload[];
    aggregate: DeliveryAggregate | null;
}

export function analyzePayload(payload: DeliveryPayload): GroupedInfo {
    const siblings = payload.siblings ?? [];
    if (siblings.length === 0) {
        return {mode: 'single', leader: payload, alerts: [], aggregate: null};
    }
    const alerts = [payload, ...siblings];
    const mode: RenderMode =
        alerts.length > tuning.alert.stormSummaryThreshold ? 'summary' : 'list';
    return {
        mode,
        leader: payload,
        alerts,
        aggregate: payload.aggregate ?? null
    };
}
