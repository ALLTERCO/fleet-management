import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    buildKindsDescribeResponse,
    type LocationKindsDescribeResponse
} from '../../src/modules/location/kindDescriptors.js';
import {formatWithBiome, REPO_ROOT, relPath} from './_shared.js';

const PACKAGE_GENERATED_DIR = path.join(
    REPO_ROOT,
    'packages/fleet-manager-host-contract/generated'
);
const PACKAGE_JS_OUT_FILE = path.join(
    PACKAGE_GENERATED_DIR,
    'location-kind-catalog.js'
);
const PACKAGE_TYPES_OUT_FILE = path.join(
    PACKAGE_GENERATED_DIR,
    'location-kind-catalog.d.ts'
);

export function buildLocationKindCatalog(): LocationKindsDescribeResponse {
    return buildKindsDescribeResponse();
}

function renderRuntime(catalog: LocationKindsDescribeResponse): string {
    return [
        '// AUTO-GENERATED — do not edit by hand.',
        '// Source: Fleet location kind descriptors and option sets',
        '// Regenerate: cd backend && npm run generate',
        '',
        `export const LOCATION_KIND_CATALOG = Object.freeze(${JSON.stringify(catalog, null, 4)});`,
        ''
    ].join('\n');
}

function renderDeclarations(): string {
    return [
        '// AUTO-GENERATED — do not edit by hand.',
        '// Source: Fleet location kind descriptors and option sets',
        '// Regenerate: cd backend && npm run generate',
        '',
        "import type {HostResult} from './contract.js';",
        '',
        "export declare const LOCATION_KIND_CATALOG: Readonly<HostResult<'location.listkinds'>>;",
        ''
    ].join('\n');
}

export async function generate(): Promise<{kinds: number}> {
    const catalog = buildLocationKindCatalog();
    const outputs = new Map([
        [PACKAGE_JS_OUT_FILE, renderRuntime(catalog)],
        [PACKAGE_TYPES_OUT_FILE, renderDeclarations()]
    ]);
    for (const [file, contents] of outputs) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, contents);
        formatWithBiome(file);
    }
    console.log(
        `[location-kind-catalog] ${catalog.kinds.length} kinds -> ${[
            PACKAGE_JS_OUT_FILE,
            PACKAGE_TYPES_OUT_FILE
        ]
            .map(relPath)
            .join(' + ')}`
    );
    return {kinds: catalog.kinds.length};
}

if (import.meta.url === `file://${process.argv[1]}`) {
    void generate().catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
}
