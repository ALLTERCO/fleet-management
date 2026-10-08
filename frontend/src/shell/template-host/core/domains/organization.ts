import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

export type FleetOrganizationDomain = ReturnType<
    typeof createOrganizationDomain
>;

type OrganizationMethod = Extract<HostMethod, `organization.${string}`>;

type Profile = HostResult<'organization.setprofile'>;

export function createOrganizationDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<OrganizationMethod>(access);
    return {
        getProfile(): Promise<HostResult<'organization.getprofile'>> {
            return call('organization.getprofile', {});
        },
        /** Omitted field = unchanged, explicit null = cleared. */
        setProfile(
            params: HostParams<'organization.setprofile'>
        ): Promise<Profile> {
            return call('organization.setprofile', params);
        },
        getDefaults(): Promise<HostResult<'organization.getdefaults'>> {
            return call('organization.getdefaults', {});
        },
        getScopeModel(): Promise<HostResult<'organization.getscopemodel'>> {
            return call('organization.getscopemodel', {});
        },
        /**
         * Write one key of the organization's shared settings bag.
         *
         * The bag is shared: it also holds the MCP kill-switch and one key per
         * other template. Send only your own key — the server merges it, so a
         * write to a different key that lands at the same moment survives.
         * Reading the whole bag and writing it back, which every caller had to
         * do before migration 7369, is what loses the other keys.
         */
        saveSetting(key: string, value: unknown): Promise<Profile> {
            return call('organization.setprofile', {
                patch: {metadata: {[key]: value}}
            });
        },
        /** Drop one key from the bag. A null value erases rather than stores. */
        removeSetting(key: string): Promise<Profile> {
            return call('organization.setprofile', {
                patch: {metadata: {[key]: null}}
            });
        }
    };
}
