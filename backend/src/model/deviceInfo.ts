// Typed surface of Shelly.GetDeviceInfo. Pure types + one helper — no
// runtime imports so lean callers (composers, tests) don't pull the
// AbstractDevice → ShellyEvents → config barrel chain.

export interface ShellyServiceClaim {
    type: string;
    ver?: string;
    build_id?: string;
}

export interface ShellyJwtClaims {
    aud?: string;
    iat?: number;
    jti?: string;
    v?: number;
    p?: string;
    n?: string;
    m?: string;
    url?: string;
    f?: number;
    /** XT1 platform: map of service-index key ("svc0", "svc1", …) to claim. */
    xt1?: Record<string, ShellyServiceClaim | undefined>;
}

export interface DeviceInfo {
    id: string;
    mac: string;
    model: string;
    gen: number;
    fw_id: string;
    ver: string;
    app: string;
    name?: string | null;
    /** Multi-profile device (e.g. 3EM monophase/triphase, 2PM switch/cover). */
    profile?: string;
    slot?: number;
    auth_en?: boolean;
    auth_domain?: string | null;
    jti?: string;
    jwt?: ShellyJwtClaims;
}

/** Typed dynamic lookup for top-level "svcN" claims XT1 attaches to GetDeviceInfo. */
export function getServiceClaim(
    info: DeviceInfo,
    index: number | string
): ShellyServiceClaim | undefined {
    const key = `svc${index}`;
    const value = (info as unknown as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && 'type' in value) {
        return value as ShellyServiceClaim;
    }
    return undefined;
}
