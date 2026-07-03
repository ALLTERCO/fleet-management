import type {FleetRole} from '../../../types/api/authzCatalog';

// isPlatformAdmin === user holds the platform-admin Zitadel role
// (default IAM_OWNER) in the configured platform org.
export interface AuthContext {
    userId: string;
    authOrgId: string;
    effectiveOrgId: string;
    roles: FleetRole[];
    isPlatformAdmin: boolean;
    tenantPinned: boolean;
}
