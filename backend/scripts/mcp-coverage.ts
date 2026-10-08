import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import * as path from 'node:path';
import {
    buildOperationCoverage,
    type CatalogMethodRow,
    type EventInventoryRow,
    type HttpInventoryRow,
    type RpcInventoryRow
} from '../src/modules/ai/operationCoverage';

const root = path.resolve(__dirname, '../..');

function readJson<T>(relativePath: string): T {
    return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

const report = buildOperationCoverage({
    rpcInventory: readJson<{methods: RpcInventoryRow[]}>(
        'docs/generated/backend-rpc-inventory.json'
    ),
    httpInventory: readJson<{routes: HttpInventoryRow[]}>(
        'docs/generated/backend-http-inventory.json'
    ),
    eventInventory: readJson<{events: EventInventoryRow[]}>(
        'docs/generated/backend-event-inventory.json'
    ),
    catalogMethods: readJson<{methods: CatalogMethodRow[]}>(
        'docs/generated/api-catalog.json'
    ).methods,
    webMountSource: readFileSync(
        path.join(root, 'backend/src/modules/web/index.ts'),
        'utf8'
    )
});

const output = path.resolve(
    process.argv[2] ??
        path.join(root, 'report/mcp-review-2026-09-15/operation-coverage.json')
);
const artifact = {
    reportKind: 'mcp-operation-coverage',
    generatedAt: new Date().toISOString(),
    evidence: {
        rpc: 'docs/generated/backend-rpc-inventory.json',
        http: 'docs/generated/backend-http-inventory.json',
        events: 'docs/generated/backend-event-inventory.json',
        catalog: 'docs/generated/api-catalog.json',
        mounts: 'backend/src/modules/web/index.ts'
    },
    ...report
};

mkdirSync(path.dirname(output), {recursive: true});
writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(
    `${JSON.stringify({status: report.status, totals: report.totals, unclassified: report.unclassified}, null, 2)}\n`
);
if (report.status !== 'complete') process.exitCode = 1;
