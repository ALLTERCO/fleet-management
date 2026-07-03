import type {
    EffectiveAccessProvenance,
    EffectiveAccessRoleSummary,
    EffectiveScope,
    EffectiveStatement
} from '@api/authz';

export interface EffectiveAccessDetail {
    label: string;
    value: string;
}

export function emptyEffectiveAccessProvenance(): EffectiveAccessRoleSummary {
    return {
        baseRoles: [],
        directAssignments: [],
        groupAssignments: []
    };
}

export function formatBaseRoles(roles: readonly string[]): string {
    return roles.length > 0 ? roles.join(', ') : '(none)';
}

export function formatScopeSummary(scope: EffectiveScope): string {
    if (scope.all) return 'All resources';
    const parts = scopeSummaryParts(scope);
    return parts.length > 0 ? `Scoped: ${parts.join(' · ')}` : 'No scope';
}

export function formatAssignmentSource(
    entry: EffectiveAccessProvenance
): string {
    if (entry.source === 'group-assignment') return 'Group';
    if (entry.source === 'user-assignment') return 'Direct';
    return 'Built-in';
}

export function formatAssignmentSummary(
    entry: EffectiveAccessProvenance
): string {
    const persona = entry.persona || '(no persona)';
    const actions = entry.actions.join(', ') || '(no actions)';
    return `${persona}: ${actions} · ${formatScopeSummary(entry.scope)}`;
}

export function assignmentDetails(
    entry: EffectiveAccessProvenance
): EffectiveAccessDetail[] {
    return [
        detail('Subject', formatSubject(entry)),
        detail('Grantor', entry.grantorId),
        detail('Expires', formatExpiresAt(entry.expiresAt)),
        detail('Assignment', entry.assignmentId)
    ].filter(hasValue);
}

export function hasStatementCondition(statement: EffectiveStatement): boolean {
    return !!(
        statement.condition?.mfa ||
        statement.condition?.ip ||
        statement.condition?.time
    );
}

export function formatConditionSummary(statement: EffectiveStatement): string {
    return conditionSummaryParts(statement).join(' · ');
}

function scopeSummaryParts(scope: EffectiveScope): string[] {
    const parts: string[] = [];
    addCount(parts, {values: scope.device_ids, label: 'devices'});
    addCount(parts, {values: scope.location_ids, label: 'locations'});
    addCount(parts, {values: scope.device_group_ids, label: 'groups'});
    addCount(parts, {values: scope.device_tags, label: 'tags'});
    addCount(parts, {values: scope.dashboard_ids, label: 'dashboards'});
    addCount(parts, {values: scope.plugin_keys, label: 'plugins'});
    addCount(parts, {
        values: scope.waiting_room_ids,
        label: 'waiting-room devices'
    });
    addCount(parts, {
        values: scope.configuration_keys,
        label: 'configuration keys'
    });
    addCount(parts, {values: scope.report_ids, label: 'reports'});
    addCount(parts, {values: scope.organization_ids, label: 'organizations'});
    addCount(parts, {values: scope.alert_ids, label: 'alerts'});
    addCount(parts, {values: scope.notification_ids, label: 'notifications'});
    addCount(parts, {values: scope.integration_keys, label: 'integrations'});
    addCount(parts, {values: scope.automation_ids, label: 'automations'});
    return parts;
}

function addCount<T>(
    parts: string[],
    entry: {values: T[] | undefined; label: string}
) {
    if (entry.values?.length)
        parts.push(`${entry.values.length} ${entry.label}`);
}

function conditionSummaryParts(statement: EffectiveStatement): string[] {
    const parts: string[] = [];
    if (statement.condition?.mfa?.required) parts.push('MFA required');
    if (statement.condition?.ip?.cidrs?.length) {
        parts.push(`IP: ${statement.condition.ip.cidrs.join(', ')}`);
    }
    if (statement.condition?.time?.window) {
        const window = statement.condition.time.window;
        parts.push(`Time: ${window.start}–${window.end}`);
    }
    return parts;
}

function formatSubject(entry: EffectiveAccessProvenance): string | undefined {
    if (!entry.subjectId) return undefined;
    return entry.subjectType
        ? `${entry.subjectType}: ${entry.subjectId}`
        : entry.subjectId;
}

function formatExpiresAt(expiresAt: number | undefined): string | undefined {
    if (!expiresAt) return undefined;
    return new Date(expiresAt).toISOString();
}

function detail(
    label: string,
    value: string | undefined
): EffectiveAccessDetail {
    return {label, value: value ?? ''};
}

function hasValue(detail: EffectiveAccessDetail): boolean {
    return detail.value.length > 0;
}
