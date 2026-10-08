export type PresentationSize = 'compact' | 'standard' | 'comfortable';

export interface PresentationComponentOverride {
    fill?: string;
    textColor?: string;
    highlight?: string;
    size?: PresentationSize;
}

export type PresentationComponentOverrides = Partial<
    Record<string, PresentationComponentOverride>
>;

export type PresentationComponentInstanceOverrides = Partial<
    Record<string, Record<string, PresentationComponentOverride>>
>;

export interface PresentationCustomization {
    theme?: Readonly<Record<string, string | undefined>>;
    themeTokens?: Readonly<Record<string, string>>;
    components?: PresentationComponentOverrides;
    componentInstances?: PresentationComponentInstanceOverrides;
}

export interface ResolvedPresentationCustomization {
    themeStyle: Readonly<Record<string, string>>;
    components: Readonly<PresentationComponentOverrides>;
    componentInstances: Readonly<PresentationComponentInstanceOverrides>;
}

function cssVarName(key: string): string {
    return `--fm-template-${key.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}`;
}

function isFleetOwnedToken(key: string): boolean {
    return key.startsWith('--color-');
}

/* A tenant --highlight fans onto the canonical hover surfaces; set tokens win. */
const GLOBAL_HIGHLIGHT_TARGETS = [
    '--ui-action-primary-hover',
    '--ui-action-danger-hover',
    '--ui-action-success-hover',
    '--ui-action-warning-hover',
    '--ui-action-info-hover',
    '--ui-surface-control-hover',
    '--tpl-sidebar-hover-surface',
    '--tpl-sidebar-active-surface'
];

export function resolvePresentationCustomization(
    customization: PresentationCustomization
): ResolvedPresentationCustomization {
    const themeStyle: Record<string, string> = {};
    for (const [key, value] of Object.entries(customization.theme ?? {})) {
        if (value) themeStyle[cssVarName(key)] = value;
    }
    for (const [key, value] of Object.entries(
        customization.themeTokens ?? {}
    )) {
        if (isFleetOwnedToken(key)) continue;
        themeStyle[key] = value;
    }
    const highlight = customization.themeTokens?.['--highlight'];
    if (highlight) {
        for (const target of GLOBAL_HIGHLIGHT_TARGETS) {
            if (!themeStyle[target]) themeStyle[target] = highlight;
        }
    }
    return {
        themeStyle,
        components: customization.components ?? {},
        componentInstances: customization.componentInstances ?? {}
    };
}

export function resolveComponentPresentation(
    customization: PresentationCustomization,
    componentId: string,
    instanceId?: string
): PresentationComponentOverride | undefined {
    const family = customization.components?.[componentId];
    const instance = instanceId
        ? customization.componentInstances?.[componentId]?.[instanceId]
        : undefined;
    if (!family && !instance) return undefined;
    return {...family, ...instance};
}
