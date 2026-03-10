import {describe, it, expect, vi, beforeEach} from 'vitest';
import {setActivePinia, createPinia} from 'pinia';

// Mock modules before importing the store
vi.mock('@/tools/websocket', () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn()
}));

vi.mock('@/tools/http', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/helpers/zitadelAuth', () => ({
    default: null
}));

import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/http';
import * as ws from '@/tools/websocket';

describe('authStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        localStorage.clear();
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
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'admin',
                group: 'admin',
                canWrite: true,
                isAdmin: true,
                isViewer: false
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.permissionsLoaded).toBe(true);
            expect(auth.role).toBe('admin');
            expect(auth.isAdmin).toBe(true);
            expect(auth.canWrite).toBe(true);
        });

        it('defaults to no permissions on RPC failure', async () => {
            vi.mocked(sendRPC).mockRejectedValueOnce(new Error('Connection refused'));

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.permissionsLoaded).toBe(true);
            expect(auth.role).toBe('none');
            expect(auth.canWrite).toBe(false);
        });

        it('sets viewer permissions correctly', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'viewer',
                group: 'viewer',
                canWrite: false,
                isAdmin: false,
                isViewer: true
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.isViewer).toBe(true);
            expect(auth.isAdmin).toBe(false);
            expect(auth.isReadOnly).toBe(true);
        });
    });

    describe('handleLoginChanged', () => {
        it('connects websocket and fetches permissions on login', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'admin',
                group: 'admin',
                canWrite: true,
                isAdmin: true,
                isViewer: false
            });

            const auth = useAuthStore();
            await auth.handleLoginChanged(true);

            expect(ws.connect).toHaveBeenCalled();
            expect(sendRPC).toHaveBeenCalledWith('User.GetMe', {});
            expect(auth.permissionsLoaded).toBe(true);
        });

        it('closes websocket and clears permissions on logout', async () => {
            const auth = useAuthStore();

            // First login
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'admin',
                group: 'admin',
                canWrite: true,
                isAdmin: true,
                isViewer: false
            });
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
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'admin',
                group: 'admin',
                canWrite: true,
                isAdmin: true,
                isViewer: false
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.hasComponentPermission('devices', 'read')).toBe(true);
            expect(auth.hasComponentPermission('devices', 'execute')).toBe(true);
            expect(auth.hasComponentPermission('plugins', 'delete')).toBe(true);
        });

        it('returns false when no permission config', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'viewer',
                group: 'viewer',
                canWrite: false,
                isAdmin: false,
                isViewer: true
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            // No permissionConfig set, non-admin -> false
            expect(auth.hasComponentPermission('devices', 'execute')).toBe(false);
        });

        it('checks CRUD permissions from config', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'viewer',
                group: 'viewer',
                canWrite: false,
                isAdmin: false,
                isViewer: true,
                permissionConfig: {
                    components: {
                        devices: {
                            create: false,
                            read: true,
                            update: false,
                            delete: false,
                            execute: false,
                            scope: 'ALL'
                        }
                    }
                }
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.hasComponentPermission('devices', 'read')).toBe(true);
            expect(auth.hasComponentPermission('devices', 'execute')).toBe(false);
            expect(auth.hasComponentPermission('devices', 'delete')).toBe(false);
        });
    });

    describe('canExecuteDevice', () => {
        it('admin can execute any device', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'admin',
                group: 'admin',
                canWrite: true,
                isAdmin: true,
                isViewer: false
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.canExecuteDevice('shellyplus1-abc')).toBe(true);
        });

        it('respects SELECTED scope', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'viewer',
                group: 'user',
                canWrite: true,
                isAdmin: false,
                isViewer: false,
                permissionConfig: {
                    components: {
                        devices: {
                            create: false,
                            read: true,
                            update: false,
                            delete: false,
                            execute: true,
                            scope: 'SELECTED',
                            selected: ['shellyplus1-abc', 'shellyplus2-def']
                        }
                    }
                }
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();

            expect(auth.canExecuteDevice('shellyplus1-abc')).toBe(true);
            expect(auth.canExecuteDevice('shellyplus3-xyz')).toBe(false);
        });
    });

    describe('dev mode', () => {
        it('checkDevMode detects dev mode from API', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                json: () => Promise.resolve({'dev-mode': true})
            });

            const auth = useAuthStore();
            const result = await auth.checkDevMode();

            expect(result).toBe(true);
            expect(auth.devMode).toBe(true);
            expect(auth.devModeChecked).toBe(true);
        });

        it('checkDevMode handles network error gracefully', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            const auth = useAuthStore();
            const result = await auth.checkDevMode();

            expect(result).toBe(false);
            expect(auth.devMode).toBe(false);
            expect(auth.devModeChecked).toBe(true);
        });
    });

    describe('logout', () => {
        it('clears permissions and sets last_logout_time', async () => {
            vi.mocked(sendRPC).mockResolvedValueOnce({
                role: 'admin',
                group: 'admin',
                canWrite: true,
                isAdmin: true,
                isViewer: false
            });

            const auth = useAuthStore();
            await auth.fetchUserPermissions();
            expect(auth.permissionsLoaded).toBe(true);

            await auth.logout();
            expect(auth.permissionsLoaded).toBe(false);
            expect(localStorage.getItem('last_logout_time')).toBeTruthy();
        });
    });
});
