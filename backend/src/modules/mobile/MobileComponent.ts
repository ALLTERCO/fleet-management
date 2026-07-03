// Composite read endpoints — aggregate device/waiting-room/alert state
// for one-round-trip mobile launch + resume.

import {tuning} from '../../config';
import type CommandSender from '../../model/CommandSender';
import Component from '../../model/component/Component';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    MOBILE_DESCRIBE,
    MOBILE_GET_BOOTSTRAP_PARAMS_SCHEMA,
    MOBILE_SYNC_DELTA_PARAMS_SCHEMA,
    type MobileBootstrapResponse,
    type MobileGetBootstrapParams,
    type MobileSyncDeltaParams,
    type MobileSyncDeltaResponse
} from '../../types/api/mobile';
import {
    hasTenantAdminAuthority,
    resolveUiCapabilities
} from '../authz/evaluator';
import {
    canSeeAlerts,
    canSeeDevices,
    canSeeWaitingRoom,
    readAlertCounts,
    readSlimDevices,
    readUserPermissions,
    readWaitingRoomState
} from './helpers';

interface Config {
    enable: boolean;
}

function hasAuthenticatedUser(sender: CommandSender): boolean {
    return Boolean(sender.getUser()?.username);
}

export default class MobileComponent extends Component<Config> {
    constructor() {
        super('mobile', {viewer_visible: true});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe() {
        return MOBILE_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('GetBootstrap')
    @Component.CheckPermissions(hasAuthenticatedUser)
    async getBootstrap(
        params: unknown,
        sender: CommandSender
    ): Promise<MobileBootstrapResponse> {
        const p = validateOrThrow<MobileGetBootstrapParams>(
            params ?? {},
            MOBILE_GET_BOOTSTRAP_PARAMS_SCHEMA
        );
        const username = sender.getUser()?.username;
        if (!username) throw RpcError.Unauthorized();

        const limit = p.deviceLimit ?? tuning.mobile.bootstrapDeviceLimit;
        const [permissions, deviceRes, wrState, alertCounts] =
            await Promise.all([
                readUserPermissions(sender),
                readSlimDevices(sender, limit),
                readWaitingRoomState(sender),
                readAlertCounts(sender)
            ]);

        return {
            serverTime: new Date().toISOString(),
            user: {
                username,
                organizationId: sender.getOrganizationId() ?? null,
                isAdmin: hasTenantAdminAuthority(sender)
            },
            permissions,
            uiCapabilities: resolveUiCapabilities(sender),
            devices: {
                visible: canSeeDevices(sender),
                items: deviceRes.items,
                total: deviceRes.total
            },
            waitingRoom: {
                visible: canSeeWaitingRoom(sender),
                pendingCount: wrState.count,
                pending: wrState.pending
            },
            alerts: {
                visible: canSeeAlerts(sender),
                openCount: alertCounts.open,
                criticalCount: alertCounts.critical
            }
        };
    }

    @Component.NoAudit
    @Component.Expose('SyncDelta')
    @Component.CheckPermissions(hasAuthenticatedUser)
    async syncDelta(
        params: unknown,
        sender: CommandSender
    ): Promise<MobileSyncDeltaResponse> {
        const p = validateOrThrow<MobileSyncDeltaParams>(
            params,
            MOBILE_SYNC_DELTA_PARAMS_SCHEMA
        );
        const username = sender.getUser()?.username;
        if (!username) throw RpcError.Unauthorized();

        const sinceMs = Date.parse(p.since);
        if (!Number.isFinite(sinceMs)) {
            throw RpcError.InvalidParams('since must be a valid ISO timestamp');
        }

        const [deviceRes, wrState, alertCounts] = await Promise.all([
            readSlimDevices(sender, tuning.mobile.syncDeltaLimit, {
                updatedSince: new Date(sinceMs).toISOString()
            }),
            readWaitingRoomState(sender),
            readAlertCounts(sender)
        ]);

        return {
            serverTime: new Date().toISOString(),
            devices: {
                visible: canSeeDevices(sender),
                changed: deviceRes.items
            },
            alerts: {
                visible: canSeeAlerts(sender),
                openCount: alertCounts.open,
                criticalCount: alertCounts.critical
            },
            waitingRoom: {
                visible: canSeeWaitingRoom(sender),
                pendingCount: wrState.count,
                pending: wrState.pending
            }
        };
    }

    protected override getDefaultConfig(): Config {
        return {enable: true};
    }
}
