import type {Scope} from '../../modules/authz/types';

export interface ReportJobSenderSnapshot {
    permissions: string[];
    roles: string[];
    username?: string;
    organizationId?: string;
    tenantPinned?: boolean;
    isPlatformAdmin?: boolean;
    userId?: string;
    trusted?: boolean;
    mfaPresent?: boolean;
    sourceIp?: string;
    credentialBoundary?: Scope;
}

interface ReportExportPayloadBase {
    kind: 'energy' | 'interval' | 'energy_dump' | 'environment';
    jobId: string;
    userId: string;
    orgId: string | null;
    sender: ReportJobSenderSnapshot;
}

export type EngineReportExportPayload = ReportExportPayloadBase &
    (
        | {logicalParams: unknown; rawParams?: never}
        /** Jobs queued before logical device selectors were introduced. */
        | {logicalParams?: never; rawParams: unknown}
    );

export type ReportExportPayload = EngineReportExportPayload;
