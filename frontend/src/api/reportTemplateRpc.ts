// Typed wrappers for the reporttemplate.* RPC surface — saved, named report
// configurations an org can re-run.

import {pollUntilReady, type ReportFileRef} from '@/helpers/reportGeneration';
import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';
const rpcClient = {sendRPC};

export type ReportTemplateKind = 'energy' | 'interval';

// Role-gated sections a template may allowlist. Mirrors REPORT_SECTION_IDS on
// the backend (types/api/reporttemplate.ts) — the RPC boundary has no shared
// import. Empty/all-selected means no restriction.
export const REPORT_SECTIONS: {id: string; label: string}[] = [
    {id: 'demand', label: 'Demand'},
    {id: 'solar', label: 'Solar'},
    {id: 'battery', label: 'Battery'},
    {id: 'ev', label: 'EV'},
    {id: 'tenant', label: 'Tenant'}
];

export interface ReportTemplate {
    id: string;
    name: string;
    description: string | null;
    kind: ReportTemplateKind;
    params: Record<string, unknown>;
    sectionsEnabled: string[] | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string | null;
}

export interface ReportTemplateCreateInput {
    name: string;
    description?: string | null;
    kind: ReportTemplateKind;
    params: Record<string, unknown>;
    sectionsEnabled?: string[] | null;
}

export interface ReportTemplateUpdateInput {
    id: string;
    name?: string;
    description?: string | null;
    params?: Record<string, unknown>;
    sectionsEnabled?: string[] | null;
}

export function listReportTemplates(): Promise<{templates: ReportTemplate[]}> {
    return sendRPC(FM, 'reporttemplate.list', {});
}

export function createReportTemplate(
    input: ReportTemplateCreateInput
): Promise<ReportTemplate> {
    return sendRPC(FM, 'reporttemplate.create', input);
}

export function updateReportTemplate(
    input: ReportTemplateUpdateInput
): Promise<ReportTemplate> {
    return sendRPC(FM, 'reporttemplate.update', input);
}

export function deleteReportTemplate(id: string): Promise<{deleted: boolean}> {
    return sendRPC(FM, 'reporttemplate.delete', {id});
}

// Run a template through the one report entrypoint: start the job, then poll
// report.GetReport until the file is ready (same flow as the report builders).
export async function runReportTemplate(
    id: string,
    name: string
): Promise<ReportFileRef> {
    const {jobId} = await sendRPC<{jobId: string}>(FM, 'reporttemplate.run', {
        id
    });
    return pollUntilReady(rpcClient, jobId, name);
}

// Download a finished report file with the user's auth token
// (/api/reports/download/<file>).
export async function downloadReportFile(ref: ReportFileRef): Promise<void> {
    if (!ref.file) throw new Error('Report produced no file');
    const token =
        localStorage.getItem('dev_mode_token') ??
        sessionStorage.getItem('access_token') ??
        '';
    const res = await fetch(`/api/reports/download/${ref.file}`, {
        credentials: 'include',
        headers: token ? {Authorization: `Bearer ${token}`} : {}
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${ref.name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
