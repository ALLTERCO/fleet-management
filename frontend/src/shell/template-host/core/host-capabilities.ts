// What the running Fleet actually has, answered without making a call that
// might throw. A template written for a newer Fleet asks first and hides the
// panel, instead of finding out from a rejection at render time.

import {HOST_METHOD_METADATA} from '../generated/method-metadata';
import {checkHostVersionFloor, hostVersionNumber} from './host-version';
import type {FleetHost, FleetSdk} from './types';

const RPC_PREFIX = 'rpc:';
const SDK_PREFIX = 'fleet.';

export type HostCapabilitiesOptions = {
    /** The running Fleet build, from Fleet's own package version. */
    version: string;
    /** The assembled SDK, so a domain is probed rather than listed by hand. */
    sdk: FleetSdk;
};

// The catalog is one generated table for the whole build; one Set serves every
// context created in the tab.
let rpcMethodNames: Set<string> | null = null;

function knowsRpcMethod(id: string): boolean {
    rpcMethodNames ??= new Set(Object.keys(HOST_METHOD_METADATA));
    return rpcMethodNames.has(id.trim().toLowerCase());
}

/**
 * Walks own properties only, so an inherited name (`toString`, `constructor`)
 * is not reported as a Fleet capability, and stops at anything that is not a
 * plain object, so a method has no sub-members to claim.
 */
function hasOwnPath(root: object, path: readonly string[]): boolean {
    let current: unknown = root;
    for (const segment of path) {
        if (typeof current !== 'object' || current === null) return false;
        if (!Object.hasOwn(current, segment)) return false;
        current = (current as Record<string, unknown>)[segment];
    }
    return current !== undefined;
}

export function createHostCapabilities(
    options: HostCapabilitiesOptions
): FleetHost {
    const {version, sdk} = options;
    return {
        version,
        // Unreadable reads as older than everything, the same answer atLeast
        // gives, so the two can never disagree.
        versionNumber: hostVersionNumber(version) ?? 0,
        atLeast(floor: string): boolean {
            return checkHostVersionFloor(version, floor) === 'satisfied';
        },
        has(name: string): boolean {
            if (typeof name !== 'string' || name.length === 0) return false;
            if (name.startsWith(RPC_PREFIX)) {
                return knowsRpcMethod(name.slice(RPC_PREFIX.length));
            }
            if (!name.startsWith(SDK_PREFIX)) return false;
            const path = name.slice(SDK_PREFIX.length).split('.');
            if (path.some((segment) => segment.length === 0)) return false;
            return hasOwnPath(sdk, path);
        }
    };
}
