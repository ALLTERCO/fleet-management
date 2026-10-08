// AUTO-GENERATED — do not edit by hand.
// Source: docs/generated/api-catalog.json (Describe + inventories)
// Regenerate: cd backend && npm run generate

export interface HostMethodMetadata {
    namespaceKind: 'device' | 'fleet-manager';
    readOnly: boolean;
    destructive: boolean;
    consequential: boolean;
    requiresOnlineDevice: boolean;
    /** Dispatcher/tunnel: the real effect depends on caller input. */
    effectDependsOnInput?: boolean;
    /** This method IS a raw escape hatch — prefer curated wrappers. */
    escapeHatch?: boolean;
    /** Recommended hand-written wrapper, e.g. host.devices.setKind. */
    wrapper?: string;
}

export interface HostEscapeHatch {
    name: string;
    path: string;
    note: string;
    /** Set when the hatch is itself an RPC method in the catalog. */
    rpcId?: string;
}

export declare const HOST_ESCAPE_HATCHES: readonly HostEscapeHatch[];

export declare const HOST_METHOD_METADATA: Readonly<
    Record<string, HostMethodMetadata>
>;
