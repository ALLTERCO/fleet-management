// Validates a device's `kind` against the resolver — vendor catalog plus this
// org's custom kinds. A device may carry any kind whose `appliesTo` is not
// 'group'. NULL is always allowed (unclassified). loaders is injectable for
// tests; it defaults to the real custom-kind repository inside the resolver.

import RpcError from '../rpc/RpcError';
import {type KindResolverLoaders, resolveKind} from './kindResolver';

export async function assertDeviceKindAllowed(
    kindId: string | null | undefined,
    organizationId: string,
    loaders?: KindResolverLoaders
): Promise<void> {
    if (kindId === null || kindId === undefined) return;
    const kind = loaders
        ? await resolveKind(kindId, organizationId, loaders)
        : await resolveKind(kindId, organizationId);
    if (!kind) {
        throw RpcError.InvalidParams(`Unknown device kind: '${kindId}'`);
    }
    if (kind.appliesTo === 'group') {
        throw RpcError.InvalidParams(
            `Kind '${kindId}' applies to groups, not devices`
        );
    }
}
