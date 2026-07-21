// Shared lookups over the generated rpc/auth inventories — the one home
// for every generator that joins Describe data with them.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {GENERATED_DIR} from './_shared.js';
import type {RpcInventory, RpcMethod} from './backend-rpc-inventory.js';

export interface AuthRow {
    transport: string;
    surface: string;
    authBucket: string;
    detail: string;
    sourceFile: string;
    sourceLine: number;
}

export interface AuthInventory {
    rows: AuthRow[];
}

export function readGeneratedJson<T>(name: string): T {
    return JSON.parse(
        fs.readFileSync(path.join(GENERATED_DIR, name), 'utf8')
    ) as T;
}

/** RPC-transport auth rows keyed by lowercased full method. */
export function authIndex(auth: AuthInventory): Map<string, AuthRow> {
    const out = new Map<string, AuthRow>();
    for (const row of auth.rows ?? []) {
        if (row.transport !== 'rpc') continue;
        out.set(row.surface.toLowerCase(), row);
    }
    return out;
}

/** Production inventory methods keyed by lowercased full method. */
export function rpcIndex(rpc: RpcInventory): Map<string, RpcMethod> {
    const out = new Map<string, RpcMethod>();
    for (const method of rpc.methods) {
        if (method.env !== 'production') continue;
        out.set(`${method.namespace}.${method.method}`.toLowerCase(), method);
    }
    return out;
}
