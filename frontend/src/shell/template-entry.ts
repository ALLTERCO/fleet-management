// Resolves the selected template's entry to something mountable, deciding the
// renderer once from the shared contract.

import type {Component} from 'vue';
import {
    DEFAULT_TEMPLATE_KIND,
    rendererForEntryFile,
    SUPPORTED_ENTRY_FILES,
    SUPPORTED_TEMPLATE_KINDS,
    TEMPLATE_KINDS,
    type TemplateKind,
    type TemplateRenderer
} from './template-contract';
import {
    checkHostVersionFloor,
    hostVersionFloorMessage
} from './template-host/core/host-version';
import type {MountTemplate} from './template-host/core/types';

// Vite needs a literal glob, so the filenames appear here too; the assertion
// below pins them to the contract.
const GLOB_ENTRY_FILES = ['index.vue', 'index.tsx'];
const ACTIVE_TEMPLATE_DIR = '/src/template-active';

const activeEntries = import.meta.glob('/src/template-active/index.{vue,tsx}', {
    eager: true
});
const activeManifests = import.meta.glob('/src/template-active/manifest.ts', {
    eager: true
});
const devEntries = import.meta.glob('/src/shell/dev-template/index.vue', {
    eager: true
});

export type ResolvedTemplateEntry =
    | {renderer: 'vue'; component: Component}
    | {renderer: 'react'; mount: MountTemplate};

function assertGlobMatchesContract(): void {
    const contract = [...SUPPORTED_ENTRY_FILES].sort().join(',');
    const globbed = [...GLOB_ENTRY_FILES].sort().join(',');
    if (contract === globbed) return;
    throw new Error(
        `Template entry glob (${globbed}) no longer covers the contract (${contract}).`
    );
}

function entryFileOf(modulePath: string): string {
    return modulePath.slice(modulePath.lastIndexOf('/') + 1);
}

/**
 * The kind the staged manifest declares. Declaring nothing is the legacy
 * default; declaring a kind nobody implements is a bad manifest, not a Vue one.
 */
export function declaredTemplateKind(
    manifests: Record<string, unknown>
): TemplateKind {
    const manifest = Object.values(manifests)[0] as
        | Record<string, {kind?: string}>
        | undefined;
    if (!manifest) return DEFAULT_TEMPLATE_KIND;
    const declared = Object.values(manifest).find(
        (value) => value && typeof value === 'object' && 'kind' in value
    );
    const kind = declared?.kind;
    if (!kind) return DEFAULT_TEMPLATE_KIND;
    if (!(kind in TEMPLATE_KINDS)) {
        throw new Error(
            `Manifest declares template kind "${kind}"; supported kinds are ${SUPPORTED_TEMPLATE_KINDS.join(', ')}`
        );
    }
    return kind as TemplateKind;
}

/**
 * The oldest Fleet the staged manifest says it supports. Read the same way the
 * kind is: a manifest module exports one manifest object under a name only the
 * template knows.
 */
export function declaredMinHostVersion(
    manifests: Record<string, unknown>
): string | undefined {
    const manifest = Object.values(manifests)[0] as
        | Record<string, {minHostVersion?: string}>
        | undefined;
    if (!manifest) return undefined;
    const declared = Object.values(manifest).find(
        (value) =>
            value && typeof value === 'object' && 'minHostVersion' in value
    );
    const floor = declared?.minHostVersion;
    return typeof floor === 'string' ? floor : undefined;
}

/** Resolve a version-floor refusal from an explicit manifest module set. */
export function templateFloorRefusal(
    hostVersion: string,
    manifests: Record<string, unknown>
): string | null {
    const floor = declaredMinHostVersion(manifests);
    const verdict = checkHostVersionFloor(hostVersion, floor);
    if (verdict !== 'below_floor' && verdict !== 'invalid_floor') return null;
    return hostVersionFloorMessage(hostVersion, floor);
}

/** Refuse a staged template before any of its entry module is mounted. */
export function assertTemplateVersion(
    hostVersion: string,
    manifests: Record<string, unknown>
): void {
    const refusal = templateFloorRefusal(hostVersion, manifests);
    if (refusal) {
        throw new Error(`This fleet view cannot run here: ${refusal}`);
    }
}

/**
 * The refusal this Fleet owes the template staged into it, or null to render.
 *
 * Refuses only what it can prove: a floor this Fleet is below, or a floor that
 * is not a version. A template that declared no floor, or a Fleet that cannot
 * state its own version, still renders. Blanking a customer's screen over
 * missing metadata is worse than the failed call it would have prevented. The
 * build gates fail closed on both, which is where those are fixable.
 */
export function activeTemplateFloorRefusal(hostVersion: string): string | null {
    return templateFloorRefusal(hostVersion, activeManifests);
}

function readVueComponent(module: unknown): Component {
    const component = (module as {default?: Component}).default;
    if (!component) {
        throw new Error('Vue template entry has no default export');
    }
    return component;
}

function readReactMount(module: unknown): MountTemplate {
    const mount = (module as {mount?: MountTemplate}).mount;
    if (typeof mount !== 'function') {
        throw new Error(
            'React template entry must export mount(element, context)'
        );
    }
    return mount;
}

function buildEntry(
    renderer: TemplateRenderer,
    module: unknown
): ResolvedTemplateEntry {
    return renderer === 'react'
        ? {renderer, mount: readReactMount(module)}
        : {renderer, component: readVueComponent(module)};
}

/** More than one match means the template shipped both, so the renderer is
 * ambiguous and the build is wrong. */
export function resolveTemplateEntry(
    hostVersion: string
): ResolvedTemplateEntry {
    assertGlobMatchesContract();
    // Before any template code runs. A template that starts rendering and then
    // hits a method this Fleet does not have shows a stack trace instead of a
    // sentence, and shows it halfway through a screen.
    assertTemplateVersion(hostVersion, activeManifests);
    const matches = Object.entries(activeEntries);
    if (matches.length === 0) {
        const devEntry = Object.values(devEntries)[0];
        if (!devEntry) {
            throw new Error(
                `No template entry found in ${ACTIVE_TEMPLATE_DIR} and no dev template available`
            );
        }
        return buildEntry('vue', devEntry);
    }
    if (matches.length > 1) {
        throw new Error(
            `Template declares more than one entry file: ${matches
                .map(([modulePath]) => entryFileOf(modulePath))
                .join(', ')}`
        );
    }

    const [modulePath, module] = matches[0];
    const renderer = rendererForEntryFile(entryFileOf(modulePath));
    if (!renderer) {
        throw new Error(`Unsupported template entry file: ${modulePath}`);
    }
    // The manifest was validated at build time; disagreeing with the staged
    // file now means the wrong artifact shipped, so fail loudly.
    const manifestRenderer =
        TEMPLATE_KINDS[declaredTemplateKind(activeManifests)].renderer;
    if (manifestRenderer !== renderer) {
        throw new Error(
            `Manifest declares renderer "${manifestRenderer}" but the staged entry is "${renderer}"`
        );
    }
    return buildEntry(renderer, module);
}
