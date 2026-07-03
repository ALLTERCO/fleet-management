import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Mock modules before importing the store
vi.mock('@/tools/websocket', () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn()
}));

vi.mock('@/tools/http', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/helpers/zitadelAuth', () => ({
    initZitadelAuth: vi.fn().mockResolvedValue(undefined),
    getZitadelAuth: vi.fn().mockReturnValue(undefined),
    setAuthLifecycleHandlers: vi.fn()
}));

import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/http';
import * as ws from '@/tools/websocket';

function bootstrapResponse(permissions: Record<string, unknown>) {
    return {
        serverTime: '2026-05-02T00:00:00.000Z',
        user: {
            username: 'test',
            organizationId: null,
            isAdmin: !!permissions.isAdmin
        },
        permissions,
        uiCapabilities: permissions.uiCapabilities ?? {components: {}},
        devices: {visible: false, items: [], total: 0},
        waitingRoom: {visible: false, pendingCount: 0, pending: {}},
        alerts: {visible: false, openCount: 0, criticalCount: 0}
    };
}

describe('authStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        localStorage.clear();
        // The store has an immediate watch on `loggedIn` that runs
        // `handleLoginChanged(false)` at factory time when Zitadel is
        // mocked-undefined, transitioning status to 'unauthenticated'.
        // fetchUserPermissions then guards out and never sets state.
        // Reset to 'booting' so direct fetch tests can exercise the path.
        useAuthStore().status = 'booting';
    });

    describe('initial state', () => {
        it('starts with permissionsLoaded = false', () => {
            const auth = useAuthStore();
            expect(auth.permissionsLoaded).toBe(false);
        });

        it('starts with role = none', () => {
            const auth = useAuthStore();
            expect(auth.role).toBe('none');
        });

        it('starts as read-only', () => {
            const auth = useAuthStore();
            expect(auth.isReadOnly).toBe(true);
            expect(auth.canWrite).toBe(false);
        });

        it('starts with isAdmin = false', () => {
            const auth = useAuthStore();
            expect(auth.isAdmin).toBe(false);
        });
    });

    describe('fetchUserPermissions', () => {
        it('sets permissionsLoaded after successful fetch', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.permissionsLoaded).toBe(true);
            expect(auth.role).toBe('admin');
            expect(auth.isAdmin).toBe(true);
            expect(auth.canWrite).toBe(true);
        });

        it('coalesces concurrent bootstrap permission fetches', async () => {
            let resolveBootstrap:
                | ((value: ReturnType<typeof bootstrapResponse>) => void)
                | undefined;
            vi.mocked(sendRPC).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveBootstrap = resolve;
                    })
            );

            const auth = useAuthStore();
            const first = auth.fetchUserPermissions();
            const second = auth.fetchUserPermissions();

            expect(sendRPC).toHaveBeenCalledTimes(1);
            resolveBootstrap?.(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );
            await Promise.all([first, second]);

            expect(sendRPC).toHaveBeenCalledTimes(1);
            expect(auth.permissionsLoaded).toBe(true);
        });

        it('defaults to no permissions on RPC failure', async () => {
            // Both Mobile.GetBootstrap (primary) and User.GetMe (fallback) fail.
            vi.mocked(sendRPC).mockRejectedValueOnce(
                new Error('Connection refused')
            );
            vi.mocked(sendRPC).mockRejectedValueOnce(
                new Error('Connection refused')
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.permissionsLoaded).toBe(true);
            expect(auth.role).toBe('none');
            expect(auth.canWrite).toBe(false);
        });

        it('sets viewer permissions correctly', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['viewer'],
                    group: 'viewer',
                    canWrite: false,
                    isAdmin: false,
                    isViewer: true
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.isViewer).toBe(true);
            expect(auth.isAdmin).toBe(false);
            expect(auth.isReadOnly).toBe(true);
        });

        it('does not derive provider support from role strings', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['super_admin'],
                    group: 'super_admin',
                    canWrite: true,
                    isAdmin: false,
                    isViewer: false,
                    isPlatformAdmin: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.canAccessPlatformAdmin).toBe(false);
        });

        it('uses only the backend provider-support capability', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['viewer'],
                    group: 'viewer',
                    canWrite: false,
                    isAdmin: false,
                    isViewer: true,
                    isPlatformAdmin: true
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.canAccessPlatformAdmin).toBe(true);
        });
    });

    describe('handleLoginChanged', () => {
        it('connects websocket and fetches permissions on login', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.handleLoginChanged(true);

            expect(ws.connect).toHaveBeenCalled();
            expect(sendRPC).toHaveBeenCalledWith('Mobile.GetBootstrap', {});
            expect(auth.permissionsLoaded).toBe(true);
        });

        it('coalesces duplicate login lifecycle starts', async () => {
            let resolveBootstrap:
                | ((value: ReturnType<typeof bootstrapResponse>) => void)
                | undefined;
            vi.mocked(sendRPC).mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveBootstrap = resolve;
                    })
            );

            const auth = useAuthStore();
            const first = auth.handleLoginChanged(true);
            const second = auth.handleLoginChanged(true);

            expect(ws.connect).toHaveBeenCalledTimes(1);
            await vi.waitFor(() => {
                expect(sendRPC).toHaveBeenCalledTimes(1);
            });

            resolveBootstrap?.(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );
            await Promise.all([first, second]);

            expect(ws.connect).toHaveBeenCalledTimes(1);
            expect(sendRPC).toHaveBeenCalledTimes(1);
            expect(auth.permissionsLoaded).toBe(true);
        });

        it('closes websocket and clears permissions on logout', async () => {
            const auth = useAuthStore();

            // First login
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );
            await auth.handleLoginChanged(true);
            expect(auth.permissionsLoaded).toBe(true);

            // Then logout
            await auth.handleLoginChanged(false);
            expect(ws.close).toHaveBeenCalled();
            expect(auth.permissionsLoaded).toBe(false);
        });
    });

    describe('hasComponentPermission', () => {
        it('admin has all permissions', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.hasComponentPermission('devices', 'read')).toBe(true);
            expect(auth.hasComponentPermission('devices', 'execute')).toBe(
                true
            );
            expect(auth.hasComponentPermission('plugins', 'delete')).toBe(true);
        });

        it('returns false when no permission config', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['viewer'],
                    group: 'viewer',
                    canWrite: false,
                    isAdmin: false,
                    isViewer: true
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            // No permissionConfig set, non-admin -> false
            expect(auth.hasComponentPermission('devices', 'execute')).toBe(
                false
            );
        });

        it('checks CRUD permissions from V2 effectiveShape', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['viewer'],
                    group: 'viewer',
                    canWrite: false,
                    isAdmin: false,
                    isViewer: true,
                    effectiveShape: {
                        statements: [
                            {
                                effect: 'Allow',
                                actions: ['device:read'],
                                resourceTypes: ['device'],
                                scope: {all: true}
                            }
                        ]
                    }
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.hasComponentPermission('devices', 'read')).toBe(true);
            expect(auth.hasComponentPermission('devices', 'execute')).toBe(
                false
            );
            expect(auth.hasComponentPermission('devices', 'delete')).toBe(
                false
            );
        });

        it('uses backend bootstrap capabilities before falling back to shape checks', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['viewer'],
                    group: 'viewer',
                    canWrite: false,
                    isAdmin: false,
                    isViewer: true,
                    effectiveShape: {statements: []},
                    uiCapabilities: {
                        components: {
                            waiting_room: {read: true, delete: true}
                        }
                    }
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.hasComponentPermission('waiting_room', 'read')).toBe(
                true
            );
            expect(auth.hasComponentPermission('waiting_room', 'delete')).toBe(
                true
            );
            expect(auth.hasComponentPermission('devices', 'read')).toBe(false);
            expect(auth.hasNoPermissions).toBe(false);
        });
    });

    describe('canExecuteDevice', () => {
        it('admin can execute any device', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.canExecuteDevice('shellyplus1-abc')).toBe(true);
        });

        it('respects device_ids scope', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['operator'],
                    group: 'operator',
                    canWrite: true,
                    isAdmin: false,
                    isViewer: false,
                    effectiveShape: {
                        statements: [
                            {
                                effect: 'Allow',
                                actions: ['device:write'],
                                resourceTypes: ['device'],
                                scope: {
                                    device_ids: [
                                        'shellyplus1-abc',
                                        'shellyplus2-def'
                                    ]
                                }
                            }
                        ]
                    }
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.canExecuteDevice('shellyplus1-abc')).toBe(true);
            expect(auth.canExecuteDevice('shellyplus3-xyz')).toBe(false);
        });
    });

    describe('logout', () => {
        it('clears permissions and sets last_logout_time', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();
            expect(auth.permissionsLoaded).toBe(true);

            await auth.logout();
            expect(auth.permissionsLoaded).toBe(false);
            expect(localStorage.getItem('last_logout_time')).toBeTruthy();
        });
    });

    describe('launchBootstrap actions', () => {
        it('updateWaitingRoom mutates pendingCount and pending dict', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            auth.updateWaitingRoom(1, {abc: {shellyID: 'x'}});
            expect(auth.launchBootstrap?.waitingRoom.pendingCount).toBe(1);
            expect(auth.launchBootstrap?.waitingRoom.pending).toEqual({
                abc: {shellyID: 'x'}
            });
        });

        it('updateWaitingRoomCount changes only the pending badge count', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            auth.updateWaitingRoom(2, {abc: {shellyID: 'x'}});
            auth.updateWaitingRoomCount(7);

            expect(auth.launchBootstrap?.waitingRoom.pendingCount).toBe(7);
            expect(auth.launchBootstrap?.waitingRoom.pending).toEqual({
                abc: {shellyID: 'x'}
            });
        });

        it('updateAlertCounts mutates open + critical counts', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce(
                bootstrapResponse({
                    roles: ['admin'],
                    group: 'admin',
                    canWrite: true,
                    isAdmin: true,
                    isViewer: false
                })
            );

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            auth.updateAlertCounts(12, 3);
            expect(auth.launchBootstrap?.alerts.openCount).toBe(12);
            expect(auth.launchBootstrap?.alerts.criticalCount).toBe(3);
        });

        it('actions are no-ops before bootstrap loads', () => {
            const auth = useAuthStore();
            auth.updateWaitingRoom(5, {});
            auth.updateWaitingRoomCount(5);
            auth.updateAlertCounts(1, 1);
            expect(auth.launchBootstrap).toBeNull();
        });
    });
});
