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
}

export function pushReportAnomalies(dispatch: ReportAnomalyDispatch): void {
    if (!dispatch.organizationId) return;
    for (const anomaly of buildReportAnomalies(dispatch.signal)) {
        emitReportAnomaly(dispatch.organizationId, {
            ...anomaly,
            dashboardId: dispatch.dashboardId
        });
    }
}
