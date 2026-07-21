// Emits the SDK-side per-method metadata (generated/method-metadata.ts):
// a pure projection of the api catalog so custom-UI builders learn
// namespaceKind, risk, and the recommended wrapper without leaving @host.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {readGeneratedJson} from './_inventories.js';
import {FRONTEND_SRC, formatWithBiome, relPath} from './_shared.js';
import type {ApiCatalog} from './api-catalog.js';

const OUT_FILE = path.join(
    FRONTEND_SRC,
    'shell/template-host/generated/method-metadata.ts'
);

export interface HostMethodMetadata {
    namespaceKind: 'device' | 'fleet-manager';
    readOnly: boolean;
    destructive: boolean;
    consequential: boolean;
    requiresOnlineDevice: boolean;
    effectDependsOnInput?: boolean;
    /** This method IS a raw escape hatch — prefer curated wrappers. */
    escapeHatch?: boolean;
    wrapper?: string;
}

export function buildMethodMetadata(
    catalog: ApiCatalog
): Record<string, HostMethodMetadata> {
    const out: Record<string, HostMethodMetadata> = {};
    for (const m of catalog.methods) {
        out[m.id] = {
            namespaceKind: m.namespaceKind,
            readOnly: m.safety.readOnlyHint,
            destructive: m.safety.destructiveHint,
            consequential: m.safety.isConsequential,
            requiresOnlineDevice: m.requiresOnlineDevice,
            ...(m.safety.effectDependsOnInput
                ? {effectDependsOnInput: true}
                : {}),
            ...(m.escapeHatch ? {escapeHatch: true} : {}),
            ...(m.recommendedHostWrapper
                ? {wrapper: m.recommendedHostWrapper}
                : {})
        };
    }
    return out;
}

function render(catalog: ApiCatalog): string {
    return [
        '// AUTO-GENERATED — do not edit by hand.',
        '// Source: docs/generated/api-catalog.json (Describe + inventories)',
        '// Regenerate: cd backend && npm run generate',
        '',
        'export interface HostMethodMetadata {',
        "    namespaceKind: 'device' | 'fleet-manager';",
        '    readOnly: boolean;',
        '    destructive: boolean;',
        '    consequential: boolean;',
        '    requiresOnlineDevice: boolean;',
        '    /** Dispatcher/tunnel: the real effect depends on caller input. */',
        '    effectDependsOnInput?: boolean;',
        '    /** This method IS a raw escape hatch — prefer curated wrappers. */',
        '    escapeHatch?: boolean;',
        '    /** Recommended hand-written wrapper, e.g. host.devices.setKind. */',
        '    wrapper?: string;',
        '}',
        '',
        'export interface HostEscapeHatch {',
        '    name: string;',
        '    path: string;',
        '    note: string;',
        '    /** Set when the hatch is itself an RPC method in the catalog. */',
        '    rpcId?: string;',
        '}',
        '',
        `export const HOST_ESCAPE_HATCHES: readonly HostEscapeHatch[] = ${JSON.stringify(catalog.escapeHatches, null, 4)} as const;`,
        '',
        `export const HOST_METHOD_METADATA: Record<string, HostMethodMetadata> = ${JSON.stringify(buildMethodMetadata(catalog), null, 4)} as const;`,
        ''
    ].join('\n');
}

export async function generate(inputs?: {
    catalog?: ApiCatalog;
}): Promise<{methods: number}> {
    const catalog =
        inputs?.catalog ?? readGeneratedJson<ApiCatalog>('api-catalog.json');
    fs.mkdirSync(path.dirname(OUT_FILE), {recursive: true});
    fs.writeFileSync(OUT_FILE, render(catalog));
    formatWithBiome(OUT_FILE);
    console.log(
        `[host-method-metadata] ${catalog.methods.length} methods -> ${relPath(OUT_FILE)}`
    );
    return {methods: catalog.methods.length};
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void generate().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
