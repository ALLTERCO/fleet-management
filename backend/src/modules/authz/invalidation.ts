type TenantInvalidator = (tenantId: string) => Promise<void>;

let tenantInvalidator: TenantInvalidator | null = null;

export function registerAuthzTenantInvalidator(
    invalidator: TenantInvalidator
): void {
    tenantInvalidator = invalidator;
}

export async function invalidateAuthzTenant(tenantId: string): Promise<void> {
    await tenantInvalidator?.(tenantId);
}
