import {
    ALERTS_PATH,
    AUTOMATIONS_PATH,
    DASHBOARDS_PATH,
    DEVICES_PATH,
    GRAPHS_PATH,
    ORGANIZE_PATH,
    SETTINGS_PATH,
    WAITING_ROOM_PATH
} from '@/constants';
import type {ComponentName, CrudOperation} from '@/helpers/sharedInfo';

type PageGate = (access: PageAccessContext) => boolean;

type PagePattern = {
    path: string;
    type: 'exact' | 'section';
};

type PageRule = {
    matches(path: string): boolean;
    gate: PageGate;
    fallback: PageFallback;
};

type PageFallback = string | ((access: PageAccessContext) => string);

type PageRuleConfig = {
    pattern: PagePattern;
    gate: PageGate;
    fallback: PageFallback;
};

type ComponentGateConfig = {
    component: ComponentName;
    operation: CrudOperation;
};

type PageConfig = {
    path: string;
    gate: PageGate;
    fallback: PageFallback;
};

export type PageAccessContext = {
    isAdmin: boolean;
    canAccessPlatformAdmin: boolean;
    canReadPolicies: boolean;
    canViewAuditLog: boolean;
    hasGrafanaAccess: boolean;
    canPerformComponent(
        component: ComponentName,
        operation: CrudOperation
    ): boolean;
};

const PAGE_RULES: readonly PageRule[] = [
    exactPage({
        path: '/settings/users',
        gate: policiesRead(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/user-groups',
        gate: policiesRead(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/personas',
        gate: policiesRead(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/authz-simulator',
        gate: platformAdminOnly(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/branding',
        gate: adminOnly(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/plugins',
        gate: adminOnly(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/identity-policies',
        gate: platformAdminOnly(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/identity-smtp',
        gate: platformAdminOnly(),
        fallback: SETTINGS_PATH
    }),
    exactPage({
        path: '/settings/instance',
        gate: platformAdminOnly(),
        fallback: SETTINGS_PATH
    }),
    sectionPage({
        path: '/alerts/channels',
        gate: adminOnly(),
        fallback: SETTINGS_PATH
    }),
    sectionPage({
        path: '/operations',
        gate: adminOnly(),
        fallback: firstAccessibleSection
    }),
    exactPage({
        path: '/monitoring/audit-log',
        gate: auditRead(),
        fallback: firstAccessibleSection
    }),
    exactPage({
        path: '/monitoring/troubleshoot',
        gate: auditRead(),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: '/monitoring',
        gate: adminOnly(),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: DASHBOARDS_PATH,
        gate: componentAccess({component: 'dashboards', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: DEVICES_PATH,
        gate: componentAccess({component: 'devices', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: AUTOMATIONS_PATH,
        gate: componentAccess({component: 'actions', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: WAITING_ROOM_PATH,
        gate: componentAccess({component: 'waiting_room', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: '/organize/groups',
        gate: componentAccess({component: 'groups', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: '/organize/locations',
        gate: componentAccess({component: 'locations', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: '/organize/tags',
        gate: componentAccess({component: 'tags', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: ORGANIZE_PATH,
        gate: organizeAccess(),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: ALERTS_PATH,
        gate: componentAccess({component: 'alerts', operation: 'read'}),
        fallback: firstAccessibleSection
    }),
    sectionPage({
        path: GRAPHS_PATH,
        gate: grafanaAccess(),
        fallback: firstAccessibleSection
    })
];

export function redirectForPageAccess(
    path: string,
    access: PageAccessContext
): string | null {
    const rule = PAGE_RULES.find((candidate) => candidate.matches(path));
    if (!rule) return null;
    return rule.gate(access) ? null : resolveFallback(rule.fallback, access);
}

export function canAccessPage(
    path: string,
    access: PageAccessContext
): boolean {
    return redirectForPageAccess(path, access) === null;
}

export function resolveDefaultPage(access: PageAccessContext): string {
    return firstAccessibleSection(access);
}

function exactPage(config: PageConfig): PageRule {
    return pageRule({
        pattern: {path: config.path, type: 'exact'},
        gate: config.gate,
        fallback: config.fallback
    });
}

function sectionPage(config: PageConfig): PageRule {
    return pageRule({
        pattern: {path: config.path, type: 'section'},
        gate: config.gate,
        fallback: config.fallback
    });
}

function pageRule(config: PageRuleConfig): PageRule {
    return {
        gate: config.gate,
        fallback: config.fallback,
        matches: pageMatcher(config.pattern)
    };
}

function pageMatcher(pattern: PagePattern): (candidate: string) => boolean {
    return pattern.type === 'exact'
        ? (candidate) => candidate === pattern.path
        : (candidate) =>
              candidate === pattern.path ||
              candidate.startsWith(`${pattern.path}/`);
}

function adminOnly(): PageGate {
    return (access) => access.isAdmin;
}

function auditRead(): PageGate {
    return (access) => access.canViewAuditLog;
}

function componentAccess(config: ComponentGateConfig): PageGate {
    return (access) =>
        access.canPerformComponent(config.component, config.operation);
}

function policiesRead(): PageGate {
    return (access) => access.canReadPolicies;
}

function platformAdminOnly(): PageGate {
    return (access) => access.canAccessPlatformAdmin;
}

function organizeAccess(): PageGate {
    return (access) =>
        canRead(access, 'groups') ||
        canRead(access, 'locations') ||
        canRead(access, 'tags');
}

function grafanaAccess(): PageGate {
    return (access) => access.hasGrafanaAccess;
}

function canRead(access: PageAccessContext, component: ComponentName): boolean {
    return access.canPerformComponent(component, 'read');
}

function resolveFallback(
    fallback: PageFallback,
    access: PageAccessContext
): string {
    return typeof fallback === 'function' ? fallback(access) : fallback;
}

function firstAccessibleSection(access: PageAccessContext): string {
    const entries: Array<[string, PageGate]> = [
        [
            DASHBOARDS_PATH,
            componentAccess({component: 'dashboards', operation: 'read'})
        ],
        [
            DEVICES_PATH,
            componentAccess({component: 'devices', operation: 'read'})
        ],
        [
            WAITING_ROOM_PATH,
            componentAccess({component: 'waiting_room', operation: 'read'})
        ],
        [ORGANIZE_PATH, organizeAccess()],
        [
            ALERTS_PATH,
            componentAccess({component: 'alerts', operation: 'read'})
        ],
        [
            AUTOMATIONS_PATH,
            componentAccess({component: 'actions', operation: 'read'})
        ]
    ];
    return entries.find(([, gate]) => gate(access))?.[0] ?? '/no-permissions';
}
