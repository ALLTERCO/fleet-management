// Turn a saved template into the unified report request that report.Generate
// runs. params is the stored kind-specific request (no kind field); the kind
// and — for energy — the section allowlist are layered on here.

import type {ReportTemplate} from '../../types/api/reporttemplate';

export function templateReportRequest(
    template: Pick<ReportTemplate, 'kind' | 'params' | 'sectionsEnabled'>
): Record<string, unknown> {
    // The template's kind and section allowlist (its own column) are the single
    // authority; strip any same-named keys from the stored params so a stray
    // params.kind / params.sections_enabled can never override them.
    const {
        kind: _kind,
        sections_enabled: _sections,
        ...params
    } = template.params;
    const request: Record<string, unknown> = {kind: template.kind, ...params};
    if (template.kind === 'energy' && template.sectionsEnabled) {
        request.sections_enabled = template.sectionsEnabled;
    }
    return request;
}
