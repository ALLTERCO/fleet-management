type TenantCacheInvalidator = (tenantId: string) => Promise<void>;

let tenantCacheInvalidator: TenantCacheInvalidator | null = null;

export function registerAuthzTenantCacheInvalidator(
    invalidator: TenantCacheInvalidator
): void {
    tenantCacheInvalidator = invalidator;
}

export async function invalidateAuthzTenantCache(
    tenantId: string
): Promise<void> {
    await tenantCacheInvalidator?.(tenantId);
}
