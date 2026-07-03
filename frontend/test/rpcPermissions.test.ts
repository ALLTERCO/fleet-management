import {describe, expect, it} from 'vitest';

import {canCallRpc, type RpcAccessContext} from '@/helpers/rpcPermissions';

function rpcAccess(
    overrides: Partial<RpcAccessContext> = {}
): RpcAccessContext {
    return {
        isAdmin: false,
        canAccessPlatformAdmin: false,
        canReadPolicies: false,
        canViewAuditLog: false,
        ...overrides
    };
}

describe('rpcPermissions', () => {
    it('allows provider-support RPCs only for provider-support admins', () => {
        const request = {method: 'permission.ListAdministrators'};

        expect(canCallRpc(rpcAccess(), request)).toBe(false);
        expect(
            canCallRpc(rpcAccess({canAccessPlatformAdmin: true}), request)
        ).toBe(true);
    });

    it('allows admin RPCs only for admins', () => {
        const request = {method: 'User.CreateZitadelUser'};

        expect(canCallRpc(rpcAccess(), request)).toBe(false);
        expect(canCallRpc(rpcAccess({isAdmin: true}), request)).toBe(true);
    });

    it('allows policy-read RPCs for policy readers', () => {
        const request = {method: 'assignment.list'};

        expect(canCallRpc(rpcAccess(), request)).toBe(false);
        expect(canCallRpc(rpcAccess({canReadPolicies: true}), request)).toBe(
            true
        );
    });

    it('uses canonical user-group membership RPC names', () => {
        expect(canCallRpc(rpcAccess(), {method: 'user_group.addmembers'})).toBe(
            false
        );
        expect(
            canCallRpc(rpcAccess({isAdmin: true}), {
                method: 'user_group.addmembers'
            })
        ).toBe(true);
        expect(
            canCallRpc(rpcAccess(), {method: 'user_group.removemembers'})
        ).toBe(false);
        expect(
            canCallRpc(rpcAccess(), {method: 'user_group.add_members'})
        ).toBe(true);
    });

    it('allows audit RPCs for audit readers', () => {
        const request = {method: 'audit.list'};

        expect(canCallRpc(rpcAccess(), request)).toBe(false);
        expect(canCallRpc(rpcAccess({canViewAuditLog: true}), request)).toBe(
            true
        );
    });

    it('allows admin-or-self RPCs for admins or the same user', () => {
        const request = {
            method: 'User.GetEffectivePermissionsV2',
            selfUserId: 'user-1'
        };

        expect(canCallRpc(rpcAccess({userId: 'user-2'}), request)).toBe(false);
        expect(canCallRpc(rpcAccess({userId: 'user-1'}), request)).toBe(true);
        expect(canCallRpc(rpcAccess({isAdmin: true}), request)).toBe(true);
    });

    it('does not treat missing self ids as self access', () => {
        expect(
            canCallRpc(rpcAccess(), {method: 'User.GetEffectivePermissionsV2'})
        ).toBe(false);
    });

    it('does not block unmapped content RPCs in the frontend helper', () => {
        expect(canCallRpc(rpcAccess(), {method: 'Device.List'})).toBe(true);
    });

    it('does not use optimistic UI state for access-changing RPCs', () => {
        const tamperedAccess = {
            ...rpcAccess(),
            optimisticOverlay: {isAdmin: true},
            predictedDeviceState: {canManageUsers: true}
        } as RpcAccessContext;

        expect(
            canCallRpc(tamperedAccess, {method: 'User.CreateServiceUser'})
        ).toBe(false);
        expect(canCallRpc(tamperedAccess, {method: 'assignment.create'})).toBe(
            false
        );
    });
});
