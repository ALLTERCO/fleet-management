export type ThemeTokens = {
    primary?: string;
    accent?: string;
    background?: string;
    surface?: string;
    text?: string;
    sidebar?: string;
    card?: string;
    themeColor?: string;
    sidebarColor?: string;
    sidebarTextColor?: string;
    accentColor?: string;
    cardColor?: string;
};

export type CustomNavItem = {
    id: string;
    label: string;
    icon: string;
    section?: 'main' | 'custom' | 'advanced';
    builtin?: string;
    badge?: number;
    badgeColor?: 'red' | 'yellow' | 'blue';
};

export type Vocabulary = {
    group?: {
        singular?: string;
        plural?: string;
    };
};

export type DashboardBlock = {
    id: string;
    position: 'top' | 'after-kpis' | 'after-charts' | 'bottom';
    html: string;
    css?: string;
    refreshInterval?: number;
    dataSources: Record<
        string,
        {method: string; params?: Record<string, unknown>}
    >;
};

export type KpiSource =
    | {
          kind: 'count';
          collection: 'groups' | 'alerts' | 'devices';
          where?: {field: string; equals: string | number | boolean};
      }
    | {
          kind: 'sum';
          collection: 'groups' | 'devices';
          field: string;
          divisor?: number;
          decimals?: number;
      }
    | {
          kind: 'avg';
          collection: 'groups' | 'devices';
          field: string;
          decimals?: number;
      }
    | {kind: 'overview'; field: string}
    | {kind: 'static'; value: string | number}
    | {
          kind: 'rpc';
          method: string;
          params?: Record<string, unknown>;
          path?: string;
      };

export type KpiWidget = {
    id: string;
    label: string;
    icon?: string;
    unit?: string;
    accentColor?: string;
    source: KpiSource;
};

export type SectionOverride<T> = {
    hidden?: string[];
    custom?: T[];
    order?: string[];
};

export type ProjectOverrides = Record<string, unknown> & {
    schemaVersion?: number;
    clientName?: string;
    logoUrl?: string;
    theme?: ThemeTokens;
    title?: string;
    subtitle?: string;
    themeColor?: string;
    sidebarColor?: string;
    sidebarTextColor?: string;
    accentColor?: string;
    cardColor?: string;
    navLabels?: Record<string, string>;
    navOrder?: string[];
    customNavItems?: CustomNavItem[];
    groups?: unknown[];
    alerts?: unknown[];
    vocabulary?: Vocabulary;
    hiddenSections?: unknown[];
    dashboardBlocks?: DashboardBlock[];
    kpis?: SectionOverride<KpiWidget>;
};

export type ValidationResult<T> =
    | {ok: true; value: T}
    | {ok: false; errors: string[]};

export const DEFAULT_CUSTOMIZATION: Readonly<ProjectOverrides> = Object.freeze({
    schemaVersion: 1,
    clientName: 'Fleet Manager',
    theme: {
        primary: '#1f73d6',
        accent: '#18a999',
        background: '#f6f8fb',
        surface: '#ffffff',
        text: '#172033',
        sidebar: '#111827',
        card: '#ffffff'
    },
    title: 'Fleet Manager',
    subtitle: 'Device fleet overview',
    navLabels: {},
    navOrder: [],
    customNavItems: [],
    groups: [],
    alerts: [],
    vocabulary: undefined,
    hiddenSections: [],
    dashboardBlocks: []
});

const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);
const COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
    );
}

function validateUrl(
    value: unknown,
    context: {path: string; errors: string[]}
): void {
    if (value == null || value === '') return;
    if (typeof value !== 'string') {
        context.errors.push(`${context.path} must be a string URL`);
        return;
    }
    if (value.startsWith('/') && !value.startsWith('//')) {
        return;
    }
    try {
        const url = new URL(value);
        if (!SAFE_URL_SCHEMES.has(url.protocol)) {
            context.errors.push(`${context.path} must use http or https`);
        }
    } catch {
        context.errors.push(
            `${context.path} must be an absolute http(s) URL or root-relative path`
        );
    }
}

function validateColor(
    value: unknown,
    context: {path: string; errors: string[]}
): void {
    if (value == null || value === '') return;
    if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
        context.errors.push(`${context.path} must be a hex color`);
    }
}

function validateStringRecord(
    value: unknown,
    context: {path: string; errors: string[]}
): void {
    if (value == null) return;
    if (!isRecord(value)) {
        context.errors.push(`${context.path} must be an object`);
        return;
    }
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string') {
            context.errors.push(`${context.path}.${key} must be a string`);
        }
    }
}

function validateTheme(
    value: unknown,
    context: {path: string; errors: string[]}
): void {
    if (value == null) return;
    if (typeof value === 'string') {
        validateColor(value, context);
        return;
    }
    if (!isRecord(value)) {
        context.errors.push(`${context.path} must be an object`);
        return;
    }
    for (const key of Object.keys(value)) {
        validateColor(value[key], {
            path: `${context.path}.${key}`,
            errors: context.errors
        });
    }
}

export function validateProjectOverrides(
    value: unknown
): ValidationResult<ProjectOverrides> {
    const errors: string[] = [];
    if (!isRecord(value)) {
        return {ok: false, errors: ['customization must be an object']};
    }
    if (value.schemaVersion != null && value.schemaVersion !== 1) {
        errors.push('schemaVersion must be 1');
    }
    if (value.clientName != null && typeof value.clientName !== 'string') {
        errors.push('clientName must be a string');
    }
    if (value.title != null && typeof value.title !== 'string') {
        errors.push('title must be a string');
    }
    if (value.subtitle != null && typeof value.subtitle !== 'string') {
        errors.push('subtitle must be a string');
    }
    validateUrl(value.logoUrl, {path: 'logoUrl', errors});
    validateStringRecord(value.navLabels, {path: 'navLabels', errors});
    if (value.navOrder != null && !isStringArray(value.navOrder)) {
        errors.push('navOrder must be a string array');
    }
    if (value.hiddenSections != null && !isStringArray(value.hiddenSections)) {
        errors.push('hiddenSections must be a string array');
    }
    validateTheme(value.theme, {path: 'theme', errors});
    validateTheme(value.themeColor, {path: 'themeColor', errors});
    validateTheme(value.sidebarColor, {path: 'sidebarColor', errors});
    validateTheme(value.sidebarTextColor, {path: 'sidebarTextColor', errors});
    validateTheme(value.accentColor, {path: 'accentColor', errors});
    validateTheme(value.cardColor, {path: 'cardColor', errors});
    if (errors.length > 0) return {ok: false, errors};
    return {ok: true, value: value as ProjectOverrides};
}

export function mergeProjectOverrides(
    value: ProjectOverrides
): ProjectOverrides {
    return {
        ...DEFAULT_CUSTOMIZATION,
        ...value,
        theme: {...DEFAULT_CUSTOMIZATION.theme, ...value.theme},
        title: value.title ?? DEFAULT_CUSTOMIZATION.title,
        subtitle: value.subtitle ?? DEFAULT_CUSTOMIZATION.subtitle,
        navLabels: {...DEFAULT_CUSTOMIZATION.navLabels, ...value.navLabels},
        navOrder: value.navOrder ?? DEFAULT_CUSTOMIZATION.navOrder,
        customNavItems:
            value.customNavItems ?? DEFAULT_CUSTOMIZATION.customNavItems,
        groups: value.groups ?? DEFAULT_CUSTOMIZATION.groups,
        alerts: value.alerts ?? DEFAULT_CUSTOMIZATION.alerts,
        vocabulary: value.vocabulary ?? DEFAULT_CUSTOMIZATION.vocabulary,
        hiddenSections:
            value.hiddenSections ?? DEFAULT_CUSTOMIZATION.hiddenSections,
        dashboardBlocks: (
            value.dashboardBlocks ?? DEFAULT_CUSTOMIZATION.dashboardBlocks
        )?.map((block) => ({
            ...block,
            dataSources: block.dataSources ?? {}
        })),
        kpis: value.kpis
    };
}
