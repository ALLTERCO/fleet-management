// Gate 3 of the coarse auth chain: tenant-pinning policy. When the FM
// instance is pinned to a single tenant, non-platform users from other
// orgs are rejected; verified platform admins are allowed across. The
// "effective org" is the tenant when a platform admin acts on a pinned
// instance, otherwise the token's own org.

export function isAllowedForPinnedOrganization(input: {
    isPlatformAdmin?: boolean;
    organizationId?: string;
    pinnedOrgId?: string;
}): boolean {
    if (!input.pinnedOrgId) return true;
    return (
        input.organizationId === input.pinnedOrgId ||
        input.isPlatformAdmin === true
    );
}

export function effectiveOrganizationIdForAuthenticatedUser(input: {
    isPlatformAdmin?: boolean;
    organizationId: string;
    pinnedOrgId?: string;
}): string {
    if (input.isPlatformAdmin === true && input.pinnedOrgId) {
        return input.pinnedOrgId;
    }
    return input.organizationId;
}
