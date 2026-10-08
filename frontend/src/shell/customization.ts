import type {App, InjectionKey, Ref} from 'vue';
import {inject, ref} from 'vue';
import {
    DEFAULT_CUSTOMIZATION,
    mergeProjectOverrides,
    type ProjectOverrides,
    type ThemeTokens,
    validateProjectOverrides
} from './customizationSchema';
import {validateTemplateCustomization} from './template-customization-gate';
import {resolvePresentationCustomization} from './template-host/core/customization-presentation';

// Templates following @template-contract read `customization.value.X`,
// so this key must hold a Ref, not a plain object. Without the Ref wrap
// every template crashes at first render with
//   "Cannot read properties of undefined (reading 'title')".
export const CUSTOMIZATION_KEY: InjectionKey<Readonly<Ref<ProjectOverrides>>> =
    Symbol('fm-customization');

export class CustomizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CustomizationError';
    }
}

// A network failure or 5xx means the file could not be reached, not that it is
// wrong; callers fall back to defaults instead of failing the boot.
export class CustomizationUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CustomizationUnavailableError';
    }
}

export function applyThemeTokens(
    theme: ThemeTokens = {},
    themeTokens: Readonly<Record<string, string>> = {}
): void {
    const root = document.documentElement;
    const presentation = resolvePresentationCustomization({theme, themeTokens});
    for (const [key, value] of Object.entries(presentation.themeStyle)) {
        root.style.setProperty(key, value);
    }
}

async function fetchCustomization(): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch('/customization.json', {
            cache: 'no-store',
            headers: {Accept: 'application/json'}
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CustomizationUnavailableError(
            `customization.json could not be reached: ${message}`
        );
    }
    if (response.status >= 500) {
        throw new CustomizationUnavailableError(
            `customization.json failed with HTTP ${response.status}`
        );
    }
    if (!response.ok) {
        throw new CustomizationError(
            `customization.json failed with HTTP ${response.status}`
        );
    }
    return response.json();
}

export async function loadCustomization(): Promise<Readonly<ProjectOverrides>> {
    try {
        const raw = await fetchCustomization();
        const parsed = validateProjectOverrides(raw);
        if (!parsed.ok) {
            throw new CustomizationError(parsed.errors.join('; '));
        }
        const safetyIssues = validateTemplateCustomization(
            parsed.value,
            DEFAULT_CUSTOMIZATION.theme
        );
        if (safetyIssues.length > 0) {
            throw new CustomizationError(safetyIssues.join('; '));
        }
        const customization = Object.freeze(
            mergeProjectOverrides(parsed.value)
        );
        applyThemeTokens(customization.theme, customization.themeTokens);
        return customization;
    } catch (err) {
        if (import.meta.env.DEV) {
            console.error('[customization] using dev defaults:', err);
            applyThemeTokens(DEFAULT_CUSTOMIZATION.theme);
            return DEFAULT_CUSTOMIZATION;
        }
        if (err instanceof CustomizationUnavailableError) {
            console.warn(
                '[customization] temporarily unavailable, using defaults:',
                err
            );
            applyThemeTokens(DEFAULT_CUSTOMIZATION.theme);
            return DEFAULT_CUSTOMIZATION;
        }
        throw err;
    }
}

export function installCustomization(
    app: App,
    customization: Readonly<ProjectOverrides>
): void {
    // Wrap the plain object in a ref so templates following @template-
    // contract can read `customization.value.X`. Without this wrap every
    // template's first render explodes.
    app.provide(CUSTOMIZATION_KEY, ref(customization));
}

const DEFAULT_CUSTOMIZATION_REF = ref(DEFAULT_CUSTOMIZATION);

export function useCustomization(): Readonly<Ref<ProjectOverrides>> {
    return inject(CUSTOMIZATION_KEY, DEFAULT_CUSTOMIZATION_REF);
}
