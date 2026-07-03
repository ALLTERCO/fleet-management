// Gate 1 of the coarse auth chain: which org does this token represent?
// Reads the Zitadel resource-owner claim, falls back to a trusted-tenant
// lookup when the FM instance is tenant-pinned, and rejects default-root
// tokens that escaped the OIDC client binding.

export interface TrustedOrganizationFallback {
    organizationId?: string;
    reason: 'tenant' | 'platform';
}

export async function resolveAuthenticatedOrganizationId(input: {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
    userId: string;
    pinnedOrgId?: string;
    fallbackOrganizations?: readonly TrustedOrganizationFallback[];
    userBelongsToTenant: (userId: string, tenantId: string) => Promise<boolean>;
}): Promise<string | undefined> {
    const tokenOrgId = getTokenOrganizationId(input);
    if (!input.pinnedOrgId) return tokenOrgId;
    if (await canUsePinnedTenant(input, tokenOrgId)) return input.pinnedOrgId;
    if (tokenOrgId) return tokenOrgId;
    return findTrustedFallbackOrganization(input);
}

export function isDefaultRootOrganizationOnly(input: {
    organizationId?: string;
    rootOrgId?: string;
    clientOrgId?: string;
    platformOrgId?: string;
}): boolean {
    return (
        input.rootOrgId !== undefined &&
        input.organizationId === input.rootOrgId &&
        input.organizationId !== input.clientOrgId &&
        input.organizationId !== input.platformOrgId
    );
}

function getTokenOrganizationId(input: {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
}): string | undefined {
    const resourceOwnerClaim = 'urn:zitadel:iam:user:resourceowner:id';
    return (
        claimString(input.userinfo, resourceOwnerClaim) ??
        claimString(input.claims, resourceOwnerClaim)
    );
}

async function canUsePinnedTenant(
    input: {
        userId: string;
        pinnedOrgId?: string;
        fallbackOrganizations?: readonly TrustedOrganizationFallback[];
        userBelongsToTenant: (
            userId: string,
            tenantId: string
        ) => Promise<boolean>;
    },
    tokenOrgId: string | undefined
): Promise<boolean> {
    if (!tokenOrgId || !input.pinnedOrgId) return false;
    const tenantFallback = input.fallbackOrganizations?.find(
        (fallback) => fallback.reason === 'tenant'
    );
    return (
        tokenOrgId !== input.pinnedOrgId &&
        tenantFallback?.organizationId === input.pinnedOrgId &&
        (await input.userBelongsToTenant(input.userId, input.pinnedOrgId))
    );
}

async function findTrustedFallbackOrganization(input: {
    userId: string;
    fallbackOrganizations?: readonly TrustedOrganizationFallback[];
    userBelongsToTenant: (userId: string, tenantId: string) => Promise<boolean>;
}): Promise<string | undefined> {
    for (const fallback of input.fallbackOrganizations ?? []) {
        if (
            fallback.organizationId &&
            (await input.userBelongsToTenant(
                input.userId,
                fallback.organizationId
            ))
        ) {
            return fallback.organizationId;
        }
    }
    return undefined;
}

function claimString(
    claims: Record<string, unknown> | null | undefined,
    key: string
): string | undefined {
    const value = claims?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
