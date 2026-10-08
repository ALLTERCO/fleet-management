import {IS_CLIENT_BUILD} from '@build-mode';
import {findUnsafeCustomizationIssues} from './customization-safety.ts';

export {findUnsafeCustomizationIssues} from './customization-safety.ts';

type RegistryIssue = {componentId: string; field: string; reason: string};
type RegistryValidator = {
    validateCustomization?: (
        patch: unknown,
        baseTheme?: unknown
    ) => RegistryIssue[];
};
type BlockValidator = {
    resolveDashboardBlock?: (
        block: unknown
    ) => {ok: true} | {ok: false; issues: readonly RegistryIssue[]};
};

// Client builds stage the selected repository's shared tree at /src/shared.
// The registry remains owned by that repository; Fleet discovers its gate
// rather than carrying a second component list that could drift.
const registryValidators = import.meta.glob(
    '/src/shared/component-library/registry/validate.ts',
    {eager: true}
) as Record<string, RegistryValidator>;
const blockValidators = import.meta.glob(
    '/src/shared/component-library/registry/dashboard-block.ts',
    {eager: true}
) as Record<string, BlockValidator>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runs for the JSON Fleet actually loads in the browser. Common legacy fields
 * remain supported, while registry-controlled surfaces are delegated to the
 * selected template's own gate and executable fields fail closed.
 */
export function validateTemplateCustomization(
    value: unknown,
    baseTheme?: unknown
): string[] {
    const issues = findUnsafeCustomizationIssues(value);
    if (!isRecord(value)) return issues;

    const registry = Object.values(registryValidators)[0];
    const blocks = Object.values(blockValidators)[0];
    const needsRegistry =
        value.components !== undefined ||
        value.componentInstances !== undefined ||
        value.dashboardBlocks !== undefined ||
        value.theme !== undefined ||
        value.themeTokens !== undefined;

    // A regular Fleet build has no selected client-template registry. Its
    // generic customization still receives the structural safety checks above.
    if (!registry?.validateCustomization || !blocks?.resolveDashboardBlock) {
        if (needsRegistry && IS_CLIENT_BUILD) {
            issues.push(
                'selected template did not ship its safe component registry'
            );
        }
        return issues;
    }

    const patch: Record<string, unknown> = {};
    if (value.components !== undefined) patch.components = value.components;
    if (value.componentInstances !== undefined) {
        patch.componentInstances = value.componentInstances;
    }
    if (value.themeTokens !== undefined) patch.theme = value.themeTokens;
    else if (value.theme !== undefined) patch.theme = value.theme;
    for (const issue of registry.validateCustomization(patch, baseTheme)) {
        issues.push(
            `customization${issue.componentId ? ` component "${issue.componentId}"` : ''}.${issue.field}: ${issue.reason}`
        );
    }

    if (value.dashboardBlocks !== undefined) {
        if (!Array.isArray(value.dashboardBlocks)) {
            issues.push('customization.dashboardBlocks must be a list');
        } else {
            value.dashboardBlocks.forEach((block, index) => {
                const result = blocks.resolveDashboardBlock?.(block);
                if (result && !result.ok) {
                    result.issues.forEach((issue) => {
                        issues.push(
                            `customization.dashboardBlocks[${index}].${issue.field}: ${issue.reason}`
                        );
                    });
                }
            });
        }
    }
    return issues;
}
