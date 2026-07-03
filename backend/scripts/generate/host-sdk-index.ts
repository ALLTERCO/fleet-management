// Generated index for the UI-facing Host SDK.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    FRONTEND_SRC,
    mdEscape,
    readFile,
    relPath,
    walkFiles
} from './_shared.js';

interface HostSdkModule {
    name: string;
    path: string;
    exports: string[];
    usesGeneratedContract: boolean;
    usesRawRpc: boolean;
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

const HOST_DIR = path.join(FRONTEND_SRC, 'shell/template-host');
const CONTRACT_FILE = path.join(HOST_DIR, 'generated/contract.ts');

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

function contractMethodCount(source: string): number {
    return [...source.matchAll(/'[^']+':\s*\{/g)].length;
}

function hostFiles(): string[] {
    return walkFiles(HOST_DIR, ['.ts']).filter(
        (file) => !file.includes(`${path.sep}generated${path.sep}`)
    );
}

function moduleFor(file: string): HostSdkModule {
    const source = readFile(file);
    return {
        name: moduleName(file),
        path: relPath(file),
        exports: exportNames(source),
        usesGeneratedContract: /generated\/contract|\.\/typed/.test(source),
        usesRawRpc: /sendRPC|hostRpc|hostListAll|callMethod/.test(source)
    };
}

export function generate(): HostSdkIndex {
    const contract = fs.existsSync(CONTRACT_FILE)
        ? readFile(CONTRACT_FILE)
        : '';
    const modules = hostFiles().map(moduleFor);
    return {
        generator: 'host-sdk-index',
        version: 1,
        summary: {
            entrypoint: 'frontend/src/shell/template-host/index.ts',
            rule: 'Templates and alternate UIs use @host domains before raw RPC.',
            moduleCount: modules.length,
            contractMethodCount: contractMethodCount(contract)
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
        '| Module | Path | Exports | Contract | RPC bridge |',
        '|---|---|---|---|---|',
        ...index.modules.map(
            (module) =>
                `| ${[
                    `\`${mdEscape(module.name)}\``,
                    `\`${mdEscape(module.path)}\``,
                    mdEscape(module.exports.join(', ') || 'none'),
                    module.usesGeneratedContract ? 'yes' : 'no',
                    module.usesRawRpc ? 'yes' : 'no'
                ].join(' | ')} |`
        )
    ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(generate(), null, 2));
}
