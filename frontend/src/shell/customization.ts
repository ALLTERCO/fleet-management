import type {App, InjectionKey, Ref} from 'vue';
import {inject, ref} from 'vue';
import {
    DEFAULT_CUSTOMIZATION,
    mergeProjectOverrides,
    type ProjectOverrides,
    type ThemeTokens,
    validateProjectOverrides
} from './customizationSchema';

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

function cssVarName(key: string): string {
    return `--fm-template-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

export function applyThemeTokens(theme: ThemeTokens = {}): void {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme)) {
        if (value) root.style.setProperty(cssVarName(key), value);
    }
}

async function fetchCustomization(): Promise<unknown> {
    const response = await fetch('/customization.json', {
        cache: 'no-store',
        headers: {Accept: 'application/json'}
    });
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
        const customization = Object.freeze(
            mergeProjectOverrides(parsed.value)
        );
        applyThemeTokens(customization.theme);
        return customization;
    } catch (err) {
        if (import.meta.env.DEV) {
            console.error('[customization] using dev defaults:', err);
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
