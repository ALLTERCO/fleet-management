// Auto-discovers every *_DESCRIBE export in types/api. Single source for the
// OpenAPI emitter, the Host SDK contract, and the golden coverage test.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {DescribeOutput} from '../../src/rpc/describe';
import {REPO_ROOT} from './_shared.js';

export const TYPES_DIR = path.join(REPO_ROOT, 'backend/src/types/api');

function describeFiles(): string[] {
    return fs
        .readdirSync(TYPES_DIR)
        .filter(
            (f) => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts'
        )
        .map((f) => path.join(TYPES_DIR, f));
}

// Sorted by namespace for stable output.
export async function loadAllDescribes(): Promise<DescribeOutput[]> {
    const byNamespace = new Map<string, DescribeOutput>();
    for (const file of describeFiles()) {
        const mod = (await import(file)) as Record<string, unknown>;
        for (const [key, value] of Object.entries(mod)) {
            if (!key.endsWith('_DESCRIBE')) continue;
            const candidate = value as DescribeOutput | undefined;
            if (
                !candidate ||
                typeof candidate.namespace !== 'string' ||
                !candidate.methods
            ) {
                continue;
            }
            if (!byNamespace.has(candidate.namespace)) {
                byNamespace.set(candidate.namespace, candidate);
            }
        }
    }
    return [...byNamespace.values()].sort((a, b) =>
        a.namespace.localeCompare(b.namespace)
    );
}
