import * as fs from 'node:fs';
import * as path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isCliEntry} from '../../../frontend/scripts/lib/cli-entry.mjs';

export type HostContractBuildMetadata = {
    fleetVersion: string;
    sourceCommit: string | null;
    contractMethodCount: number;
};

type WriteBuildMetadataOptions = HostContractBuildMetadata & {
    packageDir: string;
};

const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function validateBuildMetadata(
    metadata: HostContractBuildMetadata
): HostContractBuildMetadata {
    if (!VERSION_PATTERN.test(metadata.fleetVersion)) {
        throw new Error(
            `Invalid Fleet release version: ${metadata.fleetVersion}`
        );
    }
    if (
        metadata.sourceCommit !== null &&
        !SOURCE_COMMIT_PATTERN.test(metadata.sourceCommit)
    ) {
        throw new Error('Source commit must be a lowercase 40-character SHA');
    }
    if (
        !Number.isSafeInteger(metadata.contractMethodCount) ||
        metadata.contractMethodCount < 1
    ) {
        throw new Error(
            'Contract method count must be a positive safe integer'
        );
    }
    return metadata;
}

export function renderHostContractBuildMetadata(
    input: HostContractBuildMetadata
): {runtime: string; declarations: string} {
    const metadata = validateBuildMetadata(input);
    const value = JSON.stringify(metadata, null, 4);
    return {
        runtime: [
            '// AUTO-GENERATED — do not edit by hand.',
            '// Source: Fleet Host contract generator and release build identity',
            '// Regenerate: cd backend && npm run generate',
            '',
            `export const HOST_CONTRACT_BUILD_METADATA = Object.freeze(${value});`,
            ''
        ].join('\n'),
        declarations: [
            '// AUTO-GENERATED — do not edit by hand.',
            '// Source: Fleet Host contract generator and release build identity',
            '// Regenerate: cd backend && npm run generate',
            '',
            'export interface HostContractBuildMetadata {',
            '    readonly fleetVersion: string;',
            '    readonly sourceCommit: string | null;',
            '    readonly contractMethodCount: number;',
            '}',
            '',
            'export declare const HOST_CONTRACT_BUILD_METADATA: Readonly<HostContractBuildMetadata>;',
            ''
        ].join('\n')
    };
}

export function writeHostContractBuildMetadata(
    options: WriteBuildMetadataOptions
): void {
    const {packageDir, ...metadata} = options;
    const outputDir = path.join(packageDir, 'generated');
    const rendered = renderHostContractBuildMetadata(metadata);
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(
        path.join(outputDir, 'build-metadata.js'),
        rendered.runtime
    );
    fs.writeFileSync(
        path.join(outputDir, 'build-metadata.d.ts'),
        rendered.declarations
    );
}

async function readGeneratedMetadata(
    packageDir: string
): Promise<HostContractBuildMetadata> {
    const file = path.join(packageDir, 'generated/build-metadata.js');
    const imported = (await import(pathToFileURL(file).href)) as {
        HOST_CONTRACT_BUILD_METADATA?: unknown;
    };
    const metadata = imported.HOST_CONTRACT_BUILD_METADATA;
    if (!metadata || typeof metadata !== 'object') {
        throw new Error('Generated Host contract build metadata is missing');
    }
    return validateBuildMetadata(metadata as HostContractBuildMetadata);
}

function argument(name: string): string {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value) throw new Error(`${name} is required`);
    return value;
}

async function main(): Promise<void> {
    const packageDir = path.resolve(argument('--package-dir'));
    const sourceCommit = argument('--source-commit');
    const generated = await readGeneratedMetadata(packageDir);
    writeHostContractBuildMetadata({
        ...generated,
        packageDir,
        sourceCommit
    });
}

if (isCliEntry(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
