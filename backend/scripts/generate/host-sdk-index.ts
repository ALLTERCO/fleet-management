// Generated index for the UI-facing Host SDK.

import * as path from 'node:path';
import {
    factoryNamespaces,
    moduleRpcLiterals,
    sdkSourceFiles
} from './_hostSdkSource.js';
import {readGeneratedJson} from './_inventories.js';
import {mdEscape, readFile, relPath} from './_shared.js';
import type {ApiCatalog} from './api-catalog.js';

interface HostSdkModule {
    name: string;
    path: string;
    exports: string[];
    usesGeneratedContract: boolean;
    usesRawRpc: boolean;
    namespaces: string[];
    namespaceKinds: ('device' | 'fleet-manager')[];
}

export interface HostSdkIndex {
    generator: 'host-sdk-index';
    version: 1;
    summary: {
        entrypoint: string;
        rule: string;
        moduleCount: number;
        contractMethodCount: number;
    };
    modules: HostSdkModule[];
}

function moduleName(file: string): string {
    return path.basename(file, '.ts');
}

function exportNames(source: string): string[] {
    const names = new Set<string>();
    for (const match of source.matchAll(
        /export\s+(?:async\s+)?(?:function|const|type|interface)\s+([A-Za-z_$][\w$]*)/g
    )) {
        names.add(match[1]);
    }
    for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
        for (const part of match[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[1] ?? part.trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
    }
    return [...names].sort();
}

// Namespaces each module touches: factory proxies + known RPC literals,
// joined against the catalog (the kind's single home).
function moduleNamespaceIndex(catalog: ApiCatalog): {
    byModule: Map<string, Set<string>>;
    kindOf: Map<string, 'device' | 'fleet-manager'>;
} {
    const namespaceOfId = new Map(
        catalog.methods.map((m) => [m.id, m.namespace])
    );
    const kindOf = new Map(
        catalog.methods.map((m) => [m.namespace, m.namespaceKind])
    );
    const byModule = new Map<string, Set<string>>();
    const add = (module: string, namespace: string) => {
        const set = byModule.get(module) ?? new Set<string>();
        set.add(namespace);
        byModule.set(module, set);
    };
    for (const [namespace, files] of factoryNamespaces()) {
        for (const file of files) add(moduleName(file), namespace);
    }
    for (const [module, literals] of moduleRpcLiterals()) {
        for (const literal of literals) {
            const namespace = namespaceOfId.get(literal);
            if (namespace) add(module, namespace);
        }
    }
    return {byModule, kindOf};
}

function moduleFor(
    file: string,
    namespaceIndex: ReturnType<typeof moduleNamespaceIndex>
): HostSdkModule {
    const source = readFile(file);
    const name = moduleName(file);
    const namespaces = [...(namespaceIndex.byModule.get(name) ?? [])].sort();
    const namespaceKinds = [
        ...new Set(
            namespaces.flatMap((ns) => {
                const kind = namespaceIndex.kindOf.get(ns);
                return kind ? [kind] : [];
            })
        )
    ].sort();
    return {
        name,
        path: relPath(file),
        exports: exportNames(source),
        usesGeneratedContract: /generated\/contract|\.\/typed/.test(source),
        usesRawRpc: /sendRPC|hostRpc|hostListAll|callMethod/.test(source),
        namespaces,
        namespaceKinds
    };
}

export function generate(): HostSdkIndex {
    const catalog = readGeneratedJson<ApiCatalog>('api-catalog.json');
    const namespaceIndex = moduleNamespaceIndex(catalog);
    const modules = sdkSourceFiles().map((file) =>
        moduleFor(file, namespaceIndex)
    );
    return {
        generator: 'host-sdk-index',
        version: 1,
        summary: {
            entrypoint: 'frontend/src/shell/template-host/index.ts',
            rule: 'Templates and alternate UIs use @host domains before raw RPC.',
            moduleCount: modules.length,
            // The contract types every catalog method; count from the catalog
            // SSOT, not by re-parsing the formatted contract file.
            contractMethodCount: catalog.methods.length
        },
        modules
    };
}

export function renderMarkdown(index: HostSdkIndex): string {
    return [
        '# Host SDK Index',
        '',
        index.summary.rule,
        '',
        `Entrypoint: \`${mdEscape(index.summary.entrypoint)}\``,
        '',
        `Modules: ${index.summary.moduleCount}`,
        '',
        `Generated contract methods: ${index.summary.contractMethodCount}`,
        '',
        '| Module | Path | Exports | Namespaces (kinds) | Contract | RPC bridge |',
        '|---|---|---|---|---|---|',
        ...index.modules.map(
            (module) =>
                `| ${[
                    `\`${mdEscape(module.name)}\``,
                    `\`${mdEscape(module.path)}\``,
                    mdEscape(module.exports.join(', ') || 'none'),
                    mdEscape(
                        module.namespaces.length
                            ? `${module.namespaces.join(', ')} (${module.namespaceKinds.join(', ')})`
                            : 'none'
                    ),
                    module.usesGeneratedContract ? 'yes' : 'no',
                    module.usesRawRpc ? 'yes' : 'no'
                ].join(' | ')} |`
        )
    ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(generate(), null, 2));
}
