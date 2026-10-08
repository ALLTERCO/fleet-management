// Side-effect helper: fan out org-scoped Report.Anomaly events. The decision
// of WHAT to emit lives in buildReportAnomalies — this file only DOES.

import {emitReportAnomaly} from '../../modules/EventDistributor';
import {
    buildReportAnomalies,
    type ReportAnomalySignal
} from './buildReportAnomalies';

export interface ReportAnomalyDispatch {
    readonly organizationId: string | null;
    readonly dashboardId?: number;
    readonly signal: ReportAnomalySignal;
    /** The org's region (BCP-47), so the pushed detail text reads the way
     *  the org's own reports and bill do — see modules/i18n/formatterContext. */
    readonly locale: string;
}

/** Injectable so the fan-out is testable without a live socket fleet, the
 *  same way modules/i18n/formatterContext injects its loaders. */
export type ReportAnomalyEmitter = typeof emitReportAnomaly;

export function pushReportAnomalies(
    dispatch: ReportAnomalyDispatch,
    emit: ReportAnomalyEmitter = emitReportAnomaly
): void {
    if (!dispatch.organizationId) return;
    for (const anomaly of buildReportAnomalies(
        dispatch.signal,
        dispatch.locale
    )) {
        emit(dispatch.organizationId, {
            ...anomaly,
            dashboardId: dispatch.dashboardId
        });
    }
}
