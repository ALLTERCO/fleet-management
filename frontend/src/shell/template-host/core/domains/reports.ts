// Generating a report and getting it back.
//
// Generation is long-running, so the pair that matters is `generate` and
// `cancel` — a year-long report over a big fleet takes minutes, and a user who
// changed their mind should not have to wait for it.

import type {HostMethod, HostParams} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type ReportMethod = Extract<HostMethod, `report.${string}`>;

export type FleetReportsDomain = ReturnType<typeof createReportsDomain>;

export function createReportsDomain(access: FleetRpcAccess) {
    const report = namespaceCaller<ReportMethod>(access);

    return {
        generate: (params: HostParams<'report.generate'>) =>
            report('report.generate', params),
        /** Stops one in flight and removes the partial artifact. */
        cancel: (params: HostParams<'report.cancel'>) =>
            report('report.cancel', params),
        /** Permanently removes one finished report and all of its files. */
        delete: (params: HostParams<'report.delete'>) =>
            report('report.delete', params),
        get: (params: HostParams<'report.getreport'>) =>
            report('report.getreport', params),
        /** Which shifted window best compares with the one asked for. */
        suggestTimeShift: (params: HostParams<'report.suggesttimeshift'>) =>
            report('report.suggesttimeshift', params),
        /** Deletes EVERY stored report and its file. Not per report, and there
         *  is no undo — `cancel` is the one that stops a single run. */
        purgeReports: (params: HostParams<'report.purgereports'> = {}) =>
            report('report.purgereports', params)
    };
}
