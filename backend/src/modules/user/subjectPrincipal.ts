import {zitadelService} from '../zitadel';

// Service users are tagged with the fleet organization metadata at creation;
// humans are owned via Zitadel resourceOwner instead (see tenantGate).
// Untagged global service users (provider-created, no org) read as human —
// the stricter expiry rule then simply does not apply to them.
export async function userIsServiceUser(userId: string): Promise<boolean> {
    const metadata = await zitadelService.getUserMetadata(userId);
    return Boolean(metadata.organizationId);
}
