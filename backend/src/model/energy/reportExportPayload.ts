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

export interface EngineReportExportPayload {
    kind: 'energy' | 'interval' | 'energy_dump';
    jobId: string;
    userId: string;
    orgId: string | null;
    rawParams: unknown;
    sender: ReportJobSenderSnapshot;
}

export type ReportExportPayload = EngineReportExportPayload;
