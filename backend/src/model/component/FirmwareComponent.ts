import {createHash} from 'node:crypto';
import * as log4js from 'log4js';
import {tuning} from '../../config';
import * as AlertEngine from '../../modules/AlertEngine';
import {
    canCrossOrganizationBoundary,
    canPerformComponentOperation,
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../../modules/authz/evaluator';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import {
    type FirmwareAutoUpdateCandidate,
    type FirmwareAutoUpdateJobGroup,
    type FirmwareAutoUpdateJobRef,
    type FirmwareAutoUpdateResult,
    type FirmwareAutoUpdateRunSummary,
    groupAutoUpdateCandidates,
    summarizeAutoUpdateRun
} from '../../modules/firmware/autoUpdateJobs';
import {
    type FirmwareUnitResult,
    registerFirmwareUnitProcessor
} from '../../modules/firmware/jobWorker';
import {
    computeSha256,
    deleteFileIfExists,
    FIRMWARE_LIBRARY_REGISTRY,
    getFirmwareLibraryFilePath,
    getFirmwareLibraryItem,
    getFirmwareLibraryItems,
    invalidateFirmwareLibraryCache,
    parseTags,
    registerTemporaryFirmwareFile,
    sanitizeOptionalText,
    temporaryFirmwareFiles
} from '../../modules/firmwareLibrary';
import {
    createFirmwareJob,
    enqueueFirmwareTargets,
    type FirmwareQueuedUnit
} from '../../modules/jobs/repository';
import * as Observability from '../../modules/observability/counters';
import * as Registry from '../../modules/Registry';
import {
    issueUploadTicket,
    uploadTicketResponse,
    uploadTicketUserFromSender
} from '../../modules/uploadTickets';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    FIRMWARE_CREATE_LIBRARY_DOWNLOAD_URL_PARAMS_SCHEMA,
    FIRMWARE_DELETE_LIBRARY_ENTRY_PARAMS_SCHEMA,
    FIRMWARE_DESCRIBE,
    FIRMWARE_GET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA,
    FIRMWARE_GET_AUTO_UPDATE_DEVICES_PARAMS_SCHEMA,
    FIRMWARE_GET_AUTO_UPDATE_MODE_PARAMS_SCHEMA,
    FIRMWARE_GET_AUTO_UPDATE_MODES_PARAMS_SCHEMA,
    FIRMWARE_GET_AUTO_UPDATE_STATUS_PARAMS_SCHEMA,
    FIRMWARE_GET_LAST_AUTO_UPDATE_RUN_PARAMS_SCHEMA,
    FIRMWARE_LIBRARY_ID_REGEX,
    FIRMWARE_LIBRARY_ITEM_RESOURCE_TYPE,
    FIRMWARE_LIST_LIBRARY_PARAMS_SCHEMA,
    FIRMWARE_REGISTER_MANUAL_UPDATE_PARAMS_SCHEMA,
    FIRMWARE_SET_AUTO_UPDATE_BULK_PARAMS_SCHEMA,
    FIRMWARE_SET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA,
    FIRMWARE_SET_AUTO_UPDATE_MODE_BULK_PARAMS_SCHEMA,
    FIRMWARE_SET_AUTO_UPDATE_MODE_PARAMS_SCHEMA,
    FIRMWARE_SET_AUTO_UPDATE_PARAMS_SCHEMA,
    FIRMWARE_START_UPDATE_JOB_PARAMS_SCHEMA,
    FIRMWARE_TRIGGER_AUTO_UPDATE_PARAMS_SCHEMA,
    FIRMWARE_UNREGISTER_MANUAL_UPDATE_PARAMS_SCHEMA,
    FIRMWARE_UPDATE_LIBRARY_ENTRY_PARAMS_SCHEMA,
    type FirmwareCreateLibraryDownloadUrlParams,
    type FirmwareCreateLibraryDownloadUrlResponse,
    type FirmwareDeleteLibraryEntryParams,
    type FirmwareDeleteLibraryEntryResponse,
    type FirmwareGetAutoUpdateChannelParams,
    type FirmwareGetAutoUpdateDevicesParams,
    type FirmwareGetAutoUpdateModeParams,
    type FirmwareGetAutoUpdateModesParams,
    type FirmwareGetAutoUpdateStatusParams,
    type FirmwareGetLastAutoUpdateRunParams,
    type FirmwareLibraryItem,
    type FirmwareListLibraryParams,
    type FirmwareListLibraryResponse,
    type FirmwareRegisterManualUpdateParams,
    type FirmwareSetAutoUpdateBulkParams,
    type FirmwareSetAutoUpdateChannelParams,
    type FirmwareSetAutoUpdateModeBulkParams,
    type FirmwareSetAutoUpdateModeParams,
    type FirmwareSetAutoUpdateParams,
    type FirmwareStartUpdateJobParams,
    type FirmwareStartUpdateJobResponse,
    type FirmwareTriggerAutoUpdateParams,
    type FirmwareTriggerAutoUpdateResponse,
    type FirmwareUnregisterManualUpdateParams,
    type FirmwareUpdateLibraryEntryParams,
    type FirmwareUpdateLibraryEntryResponse
} from '../../types/api/firmware';
import type AbstractDevice from '../AbstractDevice';
import type CommandSender from '../CommandSender';
import {
    firmwareFileTokenFromUrl,
    parseFirmwareUrl
} from '../firmware/firmwareUrlGuard';
import Component from './Component';

const logger = log4js.getLogger('FirmwareComponent');

function isExpectedUpdateStartError(error: any): boolean {
    const code = RpcError.codeOf(error);
    const message = (RpcError.messageOf(error) ?? String(error)).toLowerCase();

    return (
        code === -109 ||
        code === -32900 ||
        message.includes('shutting down') ||
        message.includes('device not found') ||
        message.includes('timeout') ||
        message.includes('closed')
    );
}

function getBuildIdSuffix(fwId: unknown): string | undefined {
    if (typeof fwId !== 'string' || fwId.length === 0) return undefined;
    const trimmed = fwId.trim();
    const suffix = trimmed.split('/').pop()?.trim();
    return suffix || trimmed;
}

/** Numeric components of a Shelly version like "1.4.0" → [1,4,0]. */
export function parseFirmwareVersion(version: unknown): number[] | null {
    if (typeof version !== 'string') return null;
    const core = version.trim().split(/[-+]/)[0];
    const parts = core.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) {
        return null;
    }
    return parts;
}

/**
 * True when `target` is strictly newer than `current`, false when
 * older-or-equal, null when either side is unparseable (treat as "unknown").
 */
export function isFirmwareTargetNewer(
    current: unknown,
    target: unknown
): boolean | null {
    const a = parseFirmwareVersion(current);
    const b = parseFirmwareVersion(target);
    if (!a || !b) return null;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
        const ai = a[i] ?? 0;
        const bi = b[i] ?? 0;
        if (bi > ai) return true;
        if (bi < ai) return false;
    }
    return false;
}

/**
 * True when the device already runs the target build/version (basis for
 * idempotent retries). Unknown target means "not applied" so it still runs.
 */
export function isFirmwareAlreadyApplied(
    current: {ver?: string; fwId?: string},
    target: {targetVersion?: string; targetBuildId?: string}
): boolean {
    const targetBuild = getBuildIdSuffix(target.targetBuildId);
    const currentBuild = getBuildIdSuffix(current.fwId);
    if (targetBuild && currentBuild && targetBuild === currentBuild) {
        return true;
    }
    return Boolean(
        target.targetVersion &&
            current.ver &&
            target.targetVersion === current.ver
    );
}

// Re-exported from ../firmware/firmwareUrlGuard so existing importers keep
// their entry point.
export {firmwareFileTokenFromUrl, parseFirmwareUrl};

/** Counter raised when a url-based update's declared app/model does not match
 * the target device (warn-and-proceed; the permission is the control). */
export const FIRMWARE_MODEL_MISMATCH_COUNTER = 'firmware_model_mismatch';

/** True when a build id matches the known-vulnerable blocklist. */
export function isBuildBlocked(
    buildId: string | undefined,
    blocklist: readonly string[]
): boolean {
    if (!buildId || blocklist.length === 0) return false;
    const suffix = getBuildIdSuffix(buildId);
    return blocklist.some(
        (entry) =>
            entry === buildId ||
            (suffix !== undefined && getBuildIdSuffix(entry) === suffix)
    );
}

/** Reject a known-vulnerable target build before it reaches the device. */
export function assertBuildNotBlocked(
    buildId: string | undefined,
    blocklist: readonly string[]
): void {
    if (isBuildBlocked(buildId, blocklist)) {
        throw RpcError.InvalidParams(
            `Firmware build is blocked as known-vulnerable: ${buildId}`
        );
    }
}

/**
 * Slice each tenant+channel group to a max device count so one auto-update run
 * can't collapse a whole fleet into one all-or-nothing job. Order preserved.
 */
export function chunkAutoUpdateGroups(
    groups: readonly FirmwareAutoUpdateJobGroup[],
    maxDevicesPerJob: number
): FirmwareAutoUpdateJobGroup[] {
    const cap = Math.max(1, maxDevicesPerJob);
    const chunked: FirmwareAutoUpdateJobGroup[] = [];
    for (const group of groups) {
        for (let i = 0; i < group.shellyIDs.length; i += cap) {
            chunked.push({
                tenantId: group.tenantId,
                channel: group.channel,
                shellyIDs: group.shellyIDs.slice(i, i + cap)
            });
        }
    }
    return chunked;
}

interface FirmwareCompatibilityTarget {
    app?: string;
    model?: string;
}

/**
 * Returns a reason when the image's declared app/model conflicts with the
 * device, else null. Advisory only (the device accepts any url and the caller
 * holds devices:execute) — the caller warns and proceeds, never blocks.
 */
export function checkFirmwareCompatibility(
    deviceInfo: {app?: string; model?: string},
    target: FirmwareCompatibilityTarget,
    shellyID: string
): string | null {
    if (
        target.app &&
        deviceInfo.app &&
        target.app.toLowerCase() !== deviceInfo.app.toLowerCase()
    ) {
        return `Firmware app ${target.app} does not match device ${shellyID} (${deviceInfo.app})`;
    }
    if (
        target.model &&
        deviceInfo.model &&
        target.model.toLowerCase() !== deviceInfo.model.toLowerCase()
    ) {
        return `Firmware model ${target.model} does not match device ${shellyID} (${deviceInfo.model})`;
    }
    return null;
}

export interface FirmwareComponentConfig {
    enable: boolean;
    autoUpdateDevices?: string[]; // legacy compatibility
    autoUpdateChannel?: 'stable' | 'beta'; // legacy/default enable mode
    autoUpdateModes?: Record<string, AutoUpdateMode>;
    lastAutoUpdateRun?: number;
}

export type AutoUpdateMode = 'off' | 'stable' | 'beta';

type ManualUpdateLock = {
    expiresAt: number;
    ownerKey: string;
    ownerLabel: string;
};

type FirmwareUpdateRequest =
    | {type: 'channel'; value: 'stable' | 'beta'; allowDowngrade?: boolean}
    | {
          type: 'url';
          value: string;
          targetBuildIdHint?: string;
          allowDowngrade?: boolean;
      };

interface FirmwareVerificationInput {
    shellyID: string;
    previousVersion?: string;
    previousFwId?: string;
    targetBuildIdHint?: string;
}

interface FirmwareVerificationResult {
    finalVersion?: string;
    finalFwId?: string;
    resultMessage?: string;
}

const manualUpdateLockSocketIds = new WeakMap<object, string>();
let manualUpdateLockSocketCounter = 0;

function canReadFirmwareDevices(sender: CommandSender): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, 'devices', 'read')
    );
}

function canUpdateFirmwareDevices(sender: CommandSender): boolean {
    return isComponentPermissionAllowed(
        canPerformComponentOperation(sender, 'devices', 'update')
    );
}

export default class FirmwareComponent extends Component<FirmwareComponentConfig> {
    private autoUpdateRunning = false;
    private manualUpdateLocks = new Map<string, ManualUpdateLock>();

    constructor() {
        super('firmware', {set_config_methods: false, viewer_visible: true});
        registerFirmwareUnitProcessor((unit) =>
            this.processFirmwareJobUnit(unit)
        );
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'enable':
                return typeof value === 'boolean';
            case 'autoUpdateDevices':
                return Array.isArray(value);
            case 'autoUpdateChannel':
                return value === 'stable' || value === 'beta';
            case 'autoUpdateModes':
                return (
                    value != null &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    Object.values(value).every(
                        (mode) =>
                            mode === 'off' ||
                            mode === 'stable' ||
                            mode === 'beta'
                    )
                );
            case 'lastAutoUpdateRun':
                return typeof value === 'number' || value === undefined;
            default:
                return super.checkConfigKey(key, value);
        }
    }

    protected override getDefaultConfig(): FirmwareComponentConfig {
        return {
            enable: true,
            autoUpdateDevices: [],
            autoUpdateChannel: 'stable',
            autoUpdateModes: {},
            lastAutoUpdateRun: undefined
        };
    }

    private getDefaultAutoUpdateChannel(): 'stable' | 'beta' {
        return this.config.autoUpdateChannel || 'stable';
    }

    private getAutoUpdateModes(): Record<string, AutoUpdateMode> {
        const rawModes = this.config.autoUpdateModes;
        if (
            rawModes &&
            typeof rawModes === 'object' &&
            !Array.isArray(rawModes)
        ) {
            const sanitized: Record<string, AutoUpdateMode> = {};
            for (const [shellyID, mode] of Object.entries(rawModes)) {
                if (!shellyID) continue;
                if (mode === 'stable' || mode === 'beta') {
                    sanitized[shellyID] = mode;
                } else if (mode === 'off') {
                    sanitized[shellyID] = 'off';
                }
            }
            return sanitized;
        }

        const defaultChannel = this.getDefaultAutoUpdateChannel();
        return Object.fromEntries(
            (this.config.autoUpdateDevices || []).map((shellyID) => [
                shellyID,
                defaultChannel
            ])
        );
    }

    private persistAutoUpdateModes(
        nextModes: Record<string, AutoUpdateMode>
    ): void {
        const sanitized: Record<string, AutoUpdateMode> = {};
        for (const [shellyID, mode] of Object.entries(nextModes)) {
            if (!shellyID || mode === 'off') continue;
            if (mode === 'stable' || mode === 'beta') {
                sanitized[shellyID] = mode;
            }
        }

        this.config.autoUpdateModes = sanitized;
        this.config.autoUpdateDevices = Object.keys(sanitized);
        this._persistConfig();
    }

    private getAutoUpdateModeForDevice(shellyID: string): AutoUpdateMode {
        return this.getAutoUpdateModes()[shellyID] || 'off';
    }

    private getManualUpdateLockOwner(
        sender: CommandSender,
        ownerToken?: string
    ): {
        key: string;
        label: string;
    } {
        const normalizedOwnerToken =
            typeof ownerToken === 'string' &&
            /^[a-zA-Z0-9._:-]{1,120}$/.test(ownerToken.trim())
                ? ownerToken.trim()
                : undefined;
        const username = sender.getUser()?.username?.trim();
        if (username) {
            return {
                key: normalizedOwnerToken
                    ? `user:${username.toLowerCase()}:${normalizedOwnerToken}`
                    : `user:${username.toLowerCase()}`,
                label: username
            };
        }

        if (normalizedOwnerToken) {
            return {
                key: `token:${normalizedOwnerToken}`,
                label: normalizedOwnerToken
            };
        }

        const socket = sender.getSocket();
        if (socket) {
            let socketId = manualUpdateLockSocketIds.get(socket);
            if (!socketId) {
                manualUpdateLockSocketCounter += 1;
                socketId = `socket:${manualUpdateLockSocketCounter}`;
                manualUpdateLockSocketIds.set(socket, socketId);
            }
            return {
                key: socketId,
                label: socketId
            };
        }

        const group = sender.getGroup();
        return {
            key: `group:${group}`,
            label: group
        };
    }

    private pruneManualUpdateLocks(now = Date.now()): void {
        for (const [shellyID, lock] of this.manualUpdateLocks.entries()) {
            if (lock.expiresAt <= now) {
                this.manualUpdateLocks.delete(shellyID);
            }
        }
    }

    private isManualUpdateLocked(shellyID: string): boolean {
        this.pruneManualUpdateLocks();
        return this.manualUpdateLocks.has(shellyID);
    }

    private normalizeFirmwareJobRequest(
        params: FirmwareStartUpdateJobParams
    ): FirmwareUpdateRequest {
        const hasChannel =
            params.channel === 'stable' || params.channel === 'beta';
        const hasUrl = typeof params.url === 'string' && params.url.length > 0;
        if (hasChannel === hasUrl) {
            throw RpcError.InvalidParams(
                'Provide exactly one firmware target: channel or url'
            );
        }
        if (hasChannel) {
            return {
                type: 'channel',
                value: params.channel as 'stable' | 'beta',
                allowDowngrade: params.allowDowngrade === true
            };
        }
        return {
            type: 'url',
            value: params.url as string,
            targetBuildIdHint: params.targetBuildIdHint,
            allowDowngrade: params.allowDowngrade === true
        };
    }

    private firmwareJobRequestHash(
        deviceIds: readonly string[],
        request: FirmwareUpdateRequest
    ): string {
        return createHash('sha256')
            .update(JSON.stringify({deviceIds: [...deviceIds].sort(), request}))
            .digest('hex');
    }

    private firmwareJobOwnerKey(
        sender: CommandSender,
        requestHash: string
    ): string {
        const user = sender.getUser();
        const actor = user?.userId || user?.username || sender.getGroup();
        return `firmware-job:${actor}:${requestHash}`;
    }

    private acquireFirmwareJobLocks(
        shellyIDs: readonly string[],
        ownerKey: string,
        ownerLabel: string
    ): void {
        this.pruneManualUpdateLocks();
        const busyShellyIDs = shellyIDs.filter((shellyID) => {
            const existing = this.manualUpdateLocks.get(shellyID);
            return Boolean(existing && existing.ownerKey !== ownerKey);
        });
        if (busyShellyIDs.length > 0) {
            throw RpcError.Domain('ResourceConflict', {
                message: `Firmware update already in progress for device(s): ${busyShellyIDs.join(', ')}`,
                details: {
                    resourceType: 'firmware_update_lock',
                    shellyIDs: busyShellyIDs
                }
            });
        }
        const expiresAt = Date.now() + 30 * 60 * 1000;
        for (const shellyID of shellyIDs) {
            this.manualUpdateLocks.set(shellyID, {
                expiresAt,
                ownerKey,
                ownerLabel
            });
        }
    }

    private releaseFirmwareJobLocks(
        shellyIDs: readonly string[],
        ownerKey: string
    ): void {
        for (const shellyID of shellyIDs) {
            const existing = this.manualUpdateLocks.get(shellyID);
            if (existing?.ownerKey === ownerKey) {
                this.manualUpdateLocks.delete(shellyID);
            }
        }
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return FIRMWARE_DESCRIBE;
    }

    @Component.Expose('RegisterManualUpdate')
    @Component.CheckPermissions(async (sender, params) => {
        const shellyIDs = Array.isArray(params?.shellyIDs)
            ? params.shellyIDs
            : [];
        return (
            shellyIDs.length > 0 &&
            (
                await Promise.all(
                    shellyIDs.map((shellyID: string) =>
                        canPerformComponentOperationAsync(
                            sender,
                            'devices',
                            'execute',
                            shellyID
                        )
                    )
                )
            ).every(isComponentPermissionAllowed)
        );
    })
    registerManualUpdate(
        rawParams: unknown,
        sender: CommandSender
    ): {locked: string[]} {
        const params = validateOrThrow<FirmwareRegisterManualUpdateParams>(
            rawParams,
            FIRMWARE_REGISTER_MANUAL_UPDATE_PARAMS_SCHEMA
        );
        const shellyIDs = Array.from(new Set(params.shellyIDs.filter(Boolean)));
        if (shellyIDs.length === 0) {
            return {locked: []};
        }

        this.pruneManualUpdateLocks();
        const owner = this.getManualUpdateLockOwner(sender, params.ownerToken);
        const busyShellyIDs = shellyIDs.filter((shellyID) => {
            const existing = this.manualUpdateLocks.get(shellyID);
            // Allow same owner to re-lock (refresh TTL for retry)
            return Boolean(existing && existing.ownerKey !== owner.key);
        });
        if (busyShellyIDs.length > 0) {
            throw RpcError.Domain('ResourceConflict', {
                message: `Firmware update already in progress for device(s): ${busyShellyIDs.join(', ')}`,
                details: {
                    resourceType: 'firmware_update_lock',
                    shellyIDs: busyShellyIDs
                }
            });
        }

        const requestedTtl =
            typeof params.ttlMs === 'number' && Number.isFinite(params.ttlMs)
                ? params.ttlMs
                : 20 * 60 * 1000;
        const ttlMs = Math.max(60_000, Math.min(requestedTtl, 30 * 60 * 1000));
        const expiresAt = Date.now() + ttlMs;

        for (const shellyID of shellyIDs) {
            this.manualUpdateLocks.set(shellyID, {
                expiresAt,
                ownerKey: owner.key,
                ownerLabel: owner.label
            });
        }

        logger.info(
            'Registered manual firmware update locks for %d device(s) by %s',
            shellyIDs.length,
            owner.label
        );
        return {locked: shellyIDs};
    }

    @Component.Expose('UnregisterManualUpdate')
    @Component.CheckPermissions(async (sender, params) => {
        const shellyIDs = Array.isArray(params?.shellyIDs)
            ? params.shellyIDs
            : [];
        return (
            shellyIDs.length > 0 &&
            (
                await Promise.all(
                    shellyIDs.map((shellyID: string) =>
                        canPerformComponentOperationAsync(
                            sender,
                            'devices',
                            'execute',
                            shellyID
                        )
                    )
                )
            ).every(isComponentPermissionAllowed)
        );
    })
    unregisterManualUpdate(
        rawParams: unknown,
        sender: CommandSender
    ): {
        released: string[];
    } {
        const params = validateOrThrow<FirmwareUnregisterManualUpdateParams>(
            rawParams,
            FIRMWARE_UNREGISTER_MANUAL_UPDATE_PARAMS_SCHEMA
        );
        const shellyIDs = Array.from(new Set(params.shellyIDs.filter(Boolean)));
        const released: string[] = [];
        const owner = this.getManualUpdateLockOwner(sender, params.ownerToken);

        for (const shellyID of shellyIDs) {
            const existingLock = this.manualUpdateLocks.get(shellyID);
            if (existingLock?.ownerKey === owner.key) {
                this.manualUpdateLocks.delete(shellyID);
                released.push(shellyID);
            }
        }

        if (released.length > 0) {
            logger.info(
                'Released manual firmware update locks for %d device(s) by %s',
                released.length,
                owner.label
            );
        }

        return {released};
    }

    @Component.Expose('StartUpdateJob')
    @Component.CheckPermissions(async (sender, params) => {
        const shellyIDs = Array.isArray(params?.shellyIDs)
            ? params.shellyIDs
            : [];
        return (
            shellyIDs.length > 0 &&
            (
                await Promise.all(
                    shellyIDs.map((shellyID: string) =>
                        canPerformComponentOperationAsync(
                            sender,
                            'devices',
                            'execute',
                            shellyID
                        )
                    )
                )
            ).every(isComponentPermissionAllowed)
        );
    })
    async startUpdateJob(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<FirmwareStartUpdateJobResponse> {
        const params = validateOrThrow<FirmwareStartUpdateJobParams>(
            rawParams,
            FIRMWARE_START_UPDATE_JOB_PARAMS_SCHEMA
        );
        const shellyIDs = Array.from(new Set(params.shellyIDs.filter(Boolean)));
        if (shellyIDs.length === 0) {
            throw RpcError.InvalidParams('At least one device is required');
        }
        const request = this.normalizeFirmwareJobRequest(params);
        const requestHash = this.firmwareJobRequestHash(shellyIDs, request);
        const ownerKey = this.firmwareJobOwnerKey(sender, requestHash);
        const ownerLabel = sender.getUser()?.username ?? sender.getGroup();
        const tenantId = requireOrganizationId(sender);
        const target = {
            deviceIds: shellyIDs,
            request,
            lockOwnerKey: ownerKey
        };

        this.acquireFirmwareJobLocks(shellyIDs, ownerKey, ownerLabel);
        try {
            const created = await createFirmwareJob({
                tenantId,
                mode: request.type,
                target,
                createdBy: ownerLabel,
                idempotencyKey: params.idempotencyKey,
                requestHash
            });
            if (created.created) {
                await enqueueFirmwareTargets({
                    tenantId,
                    jobId: created.jobId,
                    deviceIds: shellyIDs,
                    request
                });
            }
            return {jobId: created.jobId};
        } catch (err) {
            this.releaseFirmwareJobLocks(shellyIDs, ownerKey);
            throw err;
        }
    }

    @Component.Expose('GetAutoUpdateDevices')
    @Component.CheckPermissions(canReadFirmwareDevices)
    async getAutoUpdateDevices(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<ReturnType<typeof buildListResponse<string>>> {
        validateOrThrow<FirmwareGetAutoUpdateDevicesParams>(
            rawParams ?? {},
            FIRMWARE_GET_AUTO_UPDATE_DEVICES_PARAMS_SCHEMA
        );
        const all = Object.entries(this.getAutoUpdateModes())
            .filter(([, mode]) => mode !== 'off')
            .map(([shellyID]) => shellyID);
        // Global provider support sees every device; tenant admin only their org.
        const accessible = await sender.filterAccessibleDevices(all);
        const visible = canCrossOrganizationBoundary(sender)
            ? all
            : all.filter((id) => accessible.has(id));
        return buildListResponse(visible, visible.length, 0, 0);
    }

    @Component.Expose('GetAutoUpdateModes')
    @Component.CheckPermissions(canReadFirmwareDevices)
    async getAutoUpdateModesList(rawParams: unknown, sender: CommandSender) {
        validateOrThrow<FirmwareGetAutoUpdateModesParams>(
            rawParams ?? {},
            FIRMWARE_GET_AUTO_UPDATE_MODES_PARAMS_SCHEMA
        );
        const all = Object.entries(this.getAutoUpdateModes()).map(
            ([shellyID, mode]) => ({shellyID, mode})
        );
        const accessible = await sender.filterAccessibleDevices(
            all.map((e) => e.shellyID)
        );
        const visible = canCrossOrganizationBoundary(sender)
            ? all
            : all.filter((e) => accessible.has(e.shellyID));
        return buildListResponse(visible, visible.length, 0, 0);
    }

    @Component.Expose('SetAutoUpdate')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    setAutoUpdate(rawParams: unknown): {success: boolean} {
        const {shellyID, enabled} =
            validateOrThrow<FirmwareSetAutoUpdateParams>(
                rawParams,
                FIRMWARE_SET_AUTO_UPDATE_PARAMS_SCHEMA
            );

        const nextModes = this.getAutoUpdateModes();
        nextModes[shellyID] = enabled
            ? this.getDefaultAutoUpdateChannel()
            : 'off';
        this.persistAutoUpdateModes(nextModes);
        logger.info(
            'Auto-update %s for device %s (mode: %s)',
            enabled ? 'enabled' : 'disabled',
            shellyID,
            nextModes[shellyID] || 'off'
        );
        return {success: true};
    }

    // Bulk writes still filter by per-device update authority.
    @Component.Expose('SetAutoUpdateBulk')
    @Component.CheckPermissions(canUpdateFirmwareDevices)
    async setAutoUpdateBulk(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<{updated: string[]}> {
        const {shellyIDs, enabled} =
            validateOrThrow<FirmwareSetAutoUpdateBulkParams>(
                rawParams,
                FIRMWARE_SET_AUTO_UPDATE_BULK_PARAMS_SCHEMA
            );

        const accessible = await sender.filterAccessibleDevices(shellyIDs);
        const allowedIds = canCrossOrganizationBoundary(sender)
            ? shellyIDs
            : shellyIDs.filter((id) => accessible.has(id));

        const updated: string[] = [];
        const nextModes = this.getAutoUpdateModes();
        const targetMode = enabled ? this.getDefaultAutoUpdateChannel() : 'off';

        for (const shellyID of allowedIds) {
            if (nextModes[shellyID] !== targetMode) {
                nextModes[shellyID] = targetMode;
                updated.push(shellyID);
            }
        }

        if (updated.length > 0) {
            this.persistAutoUpdateModes(nextModes);
            logger.info(
                'Auto-update %s for devices: %s',
                enabled ? 'enabled' : 'disabled',
                updated.join(', ')
            );
        }

        return {updated};
    }

    @Component.Expose('GetAutoUpdateStatus')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getAutoUpdateStatus(rawParams: unknown): {enabled: boolean} {
        const {shellyID} = validateOrThrow<FirmwareGetAutoUpdateStatusParams>(
            rawParams,
            FIRMWARE_GET_AUTO_UPDATE_STATUS_PARAMS_SCHEMA
        );
        return {enabled: this.getAutoUpdateModeForDevice(shellyID) !== 'off'};
    }

    @Component.Expose('GetAutoUpdateMode')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    getAutoUpdateMode(rawParams: unknown): {mode: AutoUpdateMode} {
        const {shellyID} = validateOrThrow<FirmwareGetAutoUpdateModeParams>(
            rawParams,
            FIRMWARE_GET_AUTO_UPDATE_MODE_PARAMS_SCHEMA
        );
        return {mode: this.getAutoUpdateModeForDevice(shellyID)};
    }

    private parseFirmwareUnitRequest(
        raw: Record<string, unknown>
    ): FirmwareUpdateRequest {
        const allowDowngrade = raw.allowDowngrade === true;
        if (raw.type === 'channel') {
            if (raw.value !== 'stable' && raw.value !== 'beta') {
                throw new Error('Invalid firmware channel request');
            }
            return {type: 'channel', value: raw.value, allowDowngrade};
        }
        if (raw.type === 'url' && typeof raw.value === 'string') {
            return {
                type: 'url',
                value: raw.value,
                targetBuildIdHint:
                    typeof raw.targetBuildIdHint === 'string'
                        ? raw.targetBuildIdHint
                        : undefined,
                allowDowngrade
            };
        }
        throw new Error('Invalid firmware job request');
    }

    private async processFirmwareJobUnit(
        unit: FirmwareQueuedUnit
    ): Promise<FirmwareUnitResult> {
        const request = this.parseFirmwareUnitRequest(unit.request);
        const lockOwnerKey =
            typeof unit.target_summary.lockOwnerKey === 'string'
                ? unit.target_summary.lockOwnerKey
                : undefined;
        try {
            return await this.updateFirmwareDevice(unit.device_id, request);
        } catch (error) {
            const errorMessage = RpcError.messageOf(error) ?? String(error);
            const organizationId = EventDistributor.getDeviceOrg(
                unit.device_id
            );
            if (organizationId) {
                void AlertEngine.ingestEvent({
                    kind: 'firmware_operation_failed',
                    organizationId,
                    shellyID: unit.device_id,
                    errorMessage
                });
            }
            throw error;
        } finally {
            if (lockOwnerKey) {
                this.releaseFirmwareJobLocks([unit.device_id], lockOwnerKey);
            }
        }
    }

    /** Resolve an FM firmware-file URL to its library item, or null when
     * the URL points at an external (allowlisted) host. */
    private async resolveLibraryItemForUrl(
        url: URL
    ): Promise<FirmwareLibraryItem | null> {
        const token = firmwareFileTokenFromUrl(url);
        if (token === null) return null;
        const temp = temporaryFirmwareFiles.get(token);
        if (!temp) {
            throw RpcError.InvalidParams(
                'Firmware download token is unknown or expired'
            );
        }
        const items = await getFirmwareLibraryItems();
        const item = items.find(
            (candidate) =>
                getFirmwareLibraryFilePath(candidate) === temp.filePath
        );
        if (!item) {
            throw RpcError.InvalidParams(
                'Firmware URL does not map to a library item'
            );
        }
        return item;
    }

    /** Confirm the stored blob still matches the recorded SHA-256 so the
     * device fetches exactly the audited image. */
    private async assertLibraryChecksum(
        item: FirmwareLibraryItem
    ): Promise<void> {
        if (!item.checksum) {
            throw RpcError.InvalidParams(
                `Firmware ${item.id} has no recorded checksum`
            );
        }
        const actual = await computeSha256(getFirmwareLibraryFilePath(item));
        if (actual.toLowerCase() !== item.checksum.toLowerCase()) {
            throw RpcError.InvalidParams(
                `Firmware ${item.id} checksum mismatch; refusing to flash`
            );
        }
    }

    /** Warn and count an app/model mismatch but don't block — a wrong-target
     * flash is the operator's call (caller holds devices:execute). */
    private warnOnModelMismatch(
        device: AbstractDevice,
        item: FirmwareLibraryItem,
        shellyID: string
    ): void {
        const reason = checkFirmwareCompatibility(
            {app: device.info?.app, model: device.info?.model},
            {app: item.app, model: item.model},
            shellyID
        );
        if (reason) {
            logger.warn('%s; proceeding (caller holds execute)', reason);
            Observability.incrementCounter(FIRMWARE_MODEL_MISMATCH_COUNTER);
        }
    }

    /** Validate compatibility, checksum, downgrade and blocklist for a url
     * update. Returns the resolved target version so downgrade can be checked. */
    private async validateUrlFirmwareTarget(input: {
        device: AbstractDevice;
        shellyID: string;
        request: Extract<FirmwareUpdateRequest, {type: 'url'}>;
        previousVersion?: string;
    }): Promise<{targetVersion?: string; targetBuildId?: string}> {
        const url = parseFirmwareUrl(input.request.value);
        assertBuildNotBlocked(
            input.request.targetBuildIdHint,
            tuning.firmware.vulnerableBuildIds
        );

        const item = await this.resolveLibraryItemForUrl(url);
        if (!item) {
            // External url: the device fetches and validates it; we can't
            // inspect the remote image, so proceed without a target version.
            return {
                targetVersion: undefined,
                targetBuildId: input.request.targetBuildIdHint
            };
        }

        this.warnOnModelMismatch(input.device, item, input.shellyID);
        assertBuildNotBlocked(item.fwId, tuning.firmware.vulnerableBuildIds);
        await this.assertLibraryChecksum(item);
        this.assertNotDowngrade(
            input.previousVersion,
            item.ver,
            input.request.allowDowngrade === true,
            input.shellyID
        );
        return {
            targetVersion: item.ver,
            targetBuildId: item.fwId ?? input.request.targetBuildIdHint
        };
    }

    private firmwareAlreadyApplied(
        device: AbstractDevice,
        target: {targetBuildId?: string; targetVersion?: string}
    ): boolean {
        return isFirmwareAlreadyApplied(
            {ver: device.info?.ver, fwId: device.info?.fw_id},
            target
        );
    }

    private assertNotDowngrade(
        previousVersion: string | undefined,
        targetVersion: string | undefined,
        allowDowngrade: boolean,
        shellyID: string
    ): void {
        if (allowDowngrade) return;
        const newer = isFirmwareTargetNewer(previousVersion, targetVersion);
        // null = unparseable on either side; let it through (channel/url with
        // unknown version) rather than block a legitimate update.
        if (newer === false) {
            throw RpcError.InvalidParams(
                `Firmware ${targetVersion} is not newer than device ${shellyID} (${previousVersion}); set allowDowngrade to override`
            );
        }
    }

    private async updateFirmwareDevice(
        shellyID: string,
        request: FirmwareUpdateRequest
    ): Promise<FirmwareUnitResult> {
        const device = DeviceCollector.getDevice(shellyID);
        if (!device) throw new Error(`Device ${shellyID} is offline`);
        const previousVersion = device.info?.ver;
        const previousFwId = device.info?.fw_id;
        if (!previousVersion && !previousFwId) {
            throw new Error('Cannot determine current firmware identity');
        }

        let targetBuildId: string | undefined;
        let targetVersion: string | undefined;
        if (request.type === 'url') {
            const validated = await this.validateUrlFirmwareTarget({
                device,
                shellyID,
                request,
                previousVersion
            });
            targetBuildId = validated.targetBuildId;
            targetVersion = validated.targetVersion;
        }

        // Idempotency: a retry (e.g. after an FM restart mid-flash) that finds
        // the device already at the target must not re-dispatch the update.
        const already = this.firmwareAlreadyApplied(device, {
            targetBuildId,
            targetVersion
        });
        if (already) {
            return {
                finalVersion: device.info?.ver,
                finalFwId: device.info?.fw_id,
                result: {message: 'Device already at target firmware'}
            };
        }

        await this.dispatchUpdate(device, shellyID, request);

        try {
            const verification = await this.verifyUpdate({
                shellyID,
                previousVersion,
                previousFwId,
                targetBuildIdHint:
                    request.type === 'url'
                        ? request.targetBuildIdHint
                        : undefined
            });
            return {
                finalVersion: verification.finalVersion,
                finalFwId: verification.finalFwId,
                result: {
                    message: verification.resultMessage,
                    finalVersion: verification.finalVersion,
                    finalFwId: verification.finalFwId
                }
            };
        } catch (error) {
            await this.attemptOtaRevert(device, shellyID);
            throw error;
        }
    }

    private async dispatchUpdate(
        device: AbstractDevice,
        shellyID: string,
        request: FirmwareUpdateRequest
    ): Promise<void> {
        try {
            await device.sendRPC(
                'Shelly.Update',
                request.type === 'channel'
                    ? {stage: request.value}
                    : {url: request.value}
            );
        } catch (error) {
            if (!isExpectedUpdateStartError(error)) throw error;
            logger.info(
                'Device %s entered update/reboot during Shelly.Update: %s',
                shellyID,
                RpcError.messageOf(error) ?? String(error)
            );
        }
    }

    /** Best-effort rollback after a failed flash. Not all firmware exposes
     * OTA.Revert, so failure here is expected and must not mask the error. */
    private async attemptOtaRevert(
        device: AbstractDevice,
        shellyID: string
    ): Promise<void> {
        try {
            await device.sendRPC('OTA.Revert', {});
            logger.warn(
                'Requested OTA.Revert for device %s after failed update',
                shellyID
            );
        } catch (error) {
            logger.warn(
                'OTA.Revert unavailable for device %s: %s',
                shellyID,
                RpcError.messageOf(error) ?? String(error)
            );
        }
    }

    @Component.Expose('SetAutoUpdateMode')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    setAutoUpdateMode(rawParams: unknown): {success: boolean} {
        const {shellyID, mode} =
            validateOrThrow<FirmwareSetAutoUpdateModeParams>(
                rawParams,
                FIRMWARE_SET_AUTO_UPDATE_MODE_PARAMS_SCHEMA
            );

        const nextModes = this.getAutoUpdateModes();
        nextModes[shellyID] = mode;
        this.persistAutoUpdateModes(nextModes);
        logger.info('Auto-update mode set for %s: %s', shellyID, mode);
        return {success: true};
    }

    // Bulk writes still filter by per-device update authority.
    @Component.Expose('SetAutoUpdateModeBulk')
    @Component.CheckPermissions(canUpdateFirmwareDevices)
    async setAutoUpdateModeBulk(
        rawParams: unknown,
        sender: CommandSender
    ): Promise<{updated: string[]}> {
        const {shellyIDs, mode} =
            validateOrThrow<FirmwareSetAutoUpdateModeBulkParams>(
                rawParams,
                FIRMWARE_SET_AUTO_UPDATE_MODE_BULK_PARAMS_SCHEMA
            );

        const accessible = await sender.filterAccessibleDevices(shellyIDs);
        const allowedIds = canCrossOrganizationBoundary(sender)
            ? shellyIDs
            : shellyIDs.filter((id) => accessible.has(id));

        const nextModes = this.getAutoUpdateModes();
        const updated: string[] = [];
        for (const shellyID of allowedIds) {
            if (!shellyID || nextModes[shellyID] === mode) continue;
            nextModes[shellyID] = mode;
            updated.push(shellyID);
        }

        if (updated.length > 0) {
            this.persistAutoUpdateModes(nextModes);
            logger.info(
                'Auto-update mode %s set for devices: %s',
                mode,
                updated.join(', ')
            );
        }

        return {updated};
    }

    // Instance-wide default channel + last-run timestamp + library CRUD
    // are instance state, not per-tenant. Global provider support only.
    @Component.Expose('GetAutoUpdateChannel')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    getAutoUpdateChannel(rawParams: unknown): {channel: 'stable' | 'beta'} {
        validateOrThrow<FirmwareGetAutoUpdateChannelParams>(
            rawParams ?? {},
            FIRMWARE_GET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA
        );
        return {channel: this.getDefaultAutoUpdateChannel()};
    }

    @Component.Expose('SetAutoUpdateChannel')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    setAutoUpdateChannel(rawParams: unknown): {
        success: boolean;
    } {
        const {channel} = validateOrThrow<FirmwareSetAutoUpdateChannelParams>(
            rawParams,
            FIRMWARE_SET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA
        );

        this.config.autoUpdateChannel = channel;
        this._persistConfig();
        logger.info(
            'Auto-update default channel set to %s for future legacy enables',
            channel
        );
        return {success: true};
    }

    @Component.Expose('GetLastAutoUpdateRun')
    @Component.CheckPermissions(canReadFirmwareDevices)
    getLastAutoUpdateRun(rawParams: unknown): {timestamp: number | null} {
        validateOrThrow<FirmwareGetLastAutoUpdateRunParams>(
            rawParams ?? {},
            FIRMWARE_GET_LAST_AUTO_UPDATE_RUN_PARAMS_SCHEMA
        );
        return {timestamp: this.config.lastAutoUpdateRun || null};
    }

    private firmwareAutoUpdateOwnerKey(
        group: FirmwareAutoUpdateJobGroup,
        requestHash: string
    ): string {
        return `firmware-auto-update:${group.tenantId}:${group.channel}:${requestHash}`;
    }

    private reportFirmwareAutoUpdateFailure(
        shellyID: string,
        errorMessage: string
    ): void {
        const organizationId = EventDistributor.getDeviceOrg(shellyID);
        if (!organizationId) return;
        void AlertEngine.ingestEvent({
            kind: 'firmware_operation_failed',
            organizationId,
            shellyID,
            errorMessage
        });
    }

    private async resolveAutoUpdateCandidate(input: {
        shellyID: string;
        channel: 'stable' | 'beta';
    }): Promise<{
        candidate?: FirmwareAutoUpdateCandidate;
        result?: FirmwareAutoUpdateResult;
    }> {
        if (this.isManualUpdateLocked(input.shellyID)) {
            logger.info(
                'Skipping auto-update for %s because a firmware update lock is active',
                input.shellyID
            );
            return {
                result: {
                    shellyID: input.shellyID,
                    status: 'skipped',
                    channel: input.channel,
                    error: 'Skipped due to active firmware update'
                }
            };
        }

        const tenantId = EventDistributor.getDeviceOrg(input.shellyID);
        if (!tenantId) {
            return {
                result: {
                    shellyID: input.shellyID,
                    status: 'failed',
                    channel: input.channel,
                    error: 'Device organization is unknown'
                }
            };
        }

        const device = DeviceCollector.getDevice(input.shellyID);
        if (!device) {
            return {
                result: {
                    shellyID: input.shellyID,
                    status: 'offline',
                    channel: input.channel
                }
            };
        }

        try {
            const checkResponse = await device.sendRPC(
                'Shelly.CheckForUpdate',
                {}
            );
            const availableUpdate =
                input.channel === 'stable'
                    ? checkResponse?.stable
                    : checkResponse?.beta;

            if (!availableUpdate) {
                return {
                    result: {
                        shellyID: input.shellyID,
                        status: 'no_update',
                        channel: input.channel
                    }
                };
            }

            const blocklist = tuning.firmware.vulnerableBuildIds;
            const targetBuildId =
                typeof availableUpdate.build_id === 'string'
                    ? availableUpdate.build_id
                    : undefined;
            if (isBuildBlocked(targetBuildId, blocklist)) {
                logger.warn(
                    'Skipping auto-update for %s: target build %s is blocked',
                    input.shellyID,
                    targetBuildId
                );
                return {
                    result: {
                        shellyID: input.shellyID,
                        status: 'skipped',
                        channel: input.channel,
                        error: 'Target firmware build is blocked'
                    }
                };
            }

            return {
                candidate: {
                    shellyID: input.shellyID,
                    tenantId,
                    channel: input.channel
                }
            };
        } catch (error) {
            const errorMessage = RpcError.messageOf(error) ?? String(error);
            logger.error(
                'Failed to check firmware update for device %s: %s',
                input.shellyID,
                errorMessage
            );
            this.reportFirmwareAutoUpdateFailure(input.shellyID, errorMessage);
            return {
                result: {
                    shellyID: input.shellyID,
                    status: 'failed',
                    channel: input.channel,
                    error: errorMessage
                }
            };
        }
    }

    private async collectAutoUpdateCandidates(
        entries: readonly [string, AutoUpdateMode][]
    ): Promise<{
        candidates: FirmwareAutoUpdateCandidate[];
        results: FirmwareAutoUpdateResult[];
    }> {
        const candidates: FirmwareAutoUpdateCandidate[] = [];
        const results: FirmwareAutoUpdateResult[] = [];
        const AUTO_UPDATE_BATCH_SIZE = 5;

        for (let i = 0; i < entries.length; i += AUTO_UPDATE_BATCH_SIZE) {
            const batch = entries.slice(i, i + AUTO_UPDATE_BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(([shellyID, channel]) =>
                    this.resolveAutoUpdateCandidate({
                        shellyID,
                        channel: channel as 'stable' | 'beta'
                    })
                )
            );

            for (const item of batchResults) {
                if (item.candidate) candidates.push(item.candidate);
                if (item.result) results.push(item.result);
            }
        }

        return {candidates, results};
    }

    private async enqueueAutoUpdateGroup(
        group: FirmwareAutoUpdateJobGroup
    ): Promise<{
        job?: FirmwareAutoUpdateJobRef;
        results: FirmwareAutoUpdateResult[];
    }> {
        const request: FirmwareUpdateRequest = {
            type: 'channel',
            value: group.channel
        };
        const requestHash = this.firmwareJobRequestHash(
            group.shellyIDs,
            request
        );
        const ownerKey = this.firmwareAutoUpdateOwnerKey(group, requestHash);
        const target = {
            deviceIds: group.shellyIDs,
            request,
            lockOwnerKey: ownerKey,
            autoUpdate: true
        };

        this.acquireFirmwareJobLocks(
            group.shellyIDs,
            ownerKey,
            'firmware-auto-update'
        );

        try {
            const created = await createFirmwareJob({
                tenantId: group.tenantId,
                mode: 'channel',
                target,
                createdBy: 'firmware-auto-update',
                requestHash
            });
            if (created.created) {
                await enqueueFirmwareTargets({
                    tenantId: group.tenantId,
                    jobId: created.jobId,
                    deviceIds: group.shellyIDs,
                    request
                });
            }
            const job = {
                jobId: created.jobId,
                tenantId: group.tenantId,
                channel: group.channel,
                shellyIDs: group.shellyIDs
            };
            return {
                job,
                results: group.shellyIDs.map((shellyID) => ({
                    shellyID,
                    status: 'queued' as const,
                    channel: group.channel,
                    jobId: created.jobId
                }))
            };
        } catch (error) {
            const errorMessage = RpcError.messageOf(error) ?? String(error);
            this.releaseFirmwareJobLocks(group.shellyIDs, ownerKey);
            logger.error(
                'Failed to enqueue firmware auto-update job for %d device(s): %s',
                group.shellyIDs.length,
                errorMessage
            );
            for (const shellyID of group.shellyIDs) {
                this.reportFirmwareAutoUpdateFailure(shellyID, errorMessage);
            }
            return {
                results: group.shellyIDs.map((shellyID) => ({
                    shellyID,
                    status: 'failed' as const,
                    channel: group.channel,
                    error: errorMessage
                }))
            };
        }
    }

    private async enqueueAutoUpdateGroups(
        groups: readonly FirmwareAutoUpdateJobGroup[]
    ): Promise<{
        jobs: FirmwareAutoUpdateJobRef[];
        results: FirmwareAutoUpdateResult[];
    }> {
        const jobs: FirmwareAutoUpdateJobRef[] = [];
        const results: FirmwareAutoUpdateResult[] = [];

        for (const group of groups) {
            const queued = await this.enqueueAutoUpdateGroup(group);
            if (queued.job) jobs.push(queued.job);
            results.push(...queued.results);
        }

        return {jobs, results};
    }

    /**
     * Run auto-update discovery and enqueue durable jobs for eligible devices.
     * This method is meant to be called by the scheduler.
     */
    async runAutoUpdate(): Promise<FirmwareAutoUpdateRunSummary> {
        if (this.autoUpdateRunning) {
            logger.warn('Auto-update already in progress, skipping');
            return summarizeAutoUpdateRun([], []);
        }
        this.autoUpdateRunning = true;

        try {
            const autoUpdateModes = this.getAutoUpdateModes();
            this.pruneManualUpdateLocks();
            const autoUpdateEntries = Object.entries(autoUpdateModes).filter(
                ([, mode]) => mode !== 'off'
            );
            logger.info(
                'Checking firmware auto-update eligibility for %d device(s)',
                autoUpdateEntries.length
            );

            const collected =
                await this.collectAutoUpdateCandidates(autoUpdateEntries);
            const groups = chunkAutoUpdateGroups(
                groupAutoUpdateCandidates(collected.candidates),
                tuning.firmware.autoUpdateMaxDevicesPerJob
            );
            const queued = await this.enqueueAutoUpdateGroups(groups);
            const summary = summarizeAutoUpdateRun(
                [...collected.results, ...queued.results],
                queued.jobs
            );

            this.config.lastAutoUpdateRun = Date.now();
            this._persistConfig();

            logger.info(
                'Auto-update queued: checked=%d, queued=%d, skipped=%d, failed=%d',
                summary.checked,
                summary.queued,
                summary.skipped,
                summary.failed
            );

            return summary;
        } finally {
            this.autoUpdateRunning = false;
        }
    }

    /**
     * Manually trigger auto-update (for testing or manual invocation).
     * Requires admin permissions.
     */
    // TriggerAutoUpdate enqueues jobs for every eligible auto-update device.
    // Instance-wide effect, so global provider support only.
    @Component.Expose('TriggerAutoUpdate')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async triggerAutoUpdate(
        rawParams: unknown
    ): Promise<FirmwareTriggerAutoUpdateResponse> {
        validateOrThrow<FirmwareTriggerAutoUpdateParams>(
            rawParams ?? {},
            FIRMWARE_TRIGGER_AUTO_UPDATE_PARAMS_SCHEMA
        );
        return await this.runAutoUpdate();
    }

    /** Polls until version/fw_id changes; throws UpdateVerificationTimeout. */
    private async verifyUpdate(
        input: FirmwareVerificationInput
    ): Promise<FirmwareVerificationResult> {
        const VERIFY_TIMEOUT = tuning.firmware.verifyTimeoutMs;
        const POLL_INTERVAL = tuning.firmware.verifyPollMs;
        const startTime = Date.now();
        const previousBuildId = getBuildIdSuffix(
            input.previousFwId
        )?.toLowerCase();
        const targetBuildId = getBuildIdSuffix(
            input.targetBuildIdHint
        )?.toLowerCase();
        let sawDisconnectDuringVerification = false;

        while (Date.now() - startTime < VERIFY_TIMEOUT) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));

            const device = DeviceCollector.getDevice(input.shellyID);
            if (!device) continue;

            try {
                const info = await device.sendRPC('Shelly.GetDeviceInfo', {});
                const currentBuildId = getBuildIdSuffix(
                    info?.fw_id
                )?.toLowerCase();
                const versionChanged =
                    Boolean(info?.ver) &&
                    Boolean(input.previousVersion) &&
                    info.ver !== input.previousVersion;
                const buildChanged =
                    Boolean(currentBuildId) &&
                    Boolean(previousBuildId) &&
                    currentBuildId !== previousBuildId;
                const reachedTargetBuild =
                    Boolean(targetBuildId) &&
                    Boolean(currentBuildId) &&
                    currentBuildId === targetBuildId &&
                    (buildChanged ||
                        (!previousBuildId && sawDisconnectDuringVerification));

                if (versionChanged || buildChanged || reachedTargetBuild) {
                    logger.info(
                        'Device %s verified: ver %s → %s, fw_id %s → %s',
                        input.shellyID,
                        input.previousVersion,
                        info?.ver,
                        input.previousFwId,
                        info?.fw_id
                    );
                    return {
                        finalVersion:
                            typeof info?.ver === 'string'
                                ? info.ver
                                : undefined,
                        finalFwId:
                            typeof info?.fw_id === 'string'
                                ? info.fw_id
                                : undefined,
                        resultMessage:
                            reachedTargetBuild &&
                            !versionChanged &&
                            !buildChanged
                                ? `Applied firmware build ${currentBuildId}`
                                : undefined
                    };
                }
            } catch {
                sawDisconnectDuringVerification = true;
            }
        }

        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        logger.warn(
            'Device %s: version unchanged after update (%s) after %ds',
            input.shellyID,
            input.previousVersion,
            elapsedSec
        );
        throw new Error(
            `UpdateVerificationTimeout: device ${input.shellyID} still reports ${input.previousVersion} after ${elapsedSec}s`
        );
    }

    // ──────────────────────────────────────────────────────────────
    // Firmware library CRUD — replaces the legacy /api/firmware-library
    // HTTP routes. Data access goes through the shared modules/firmwareLibrary
    // module so the HTTP upload + download routes (which must stay HTTP)
    // and these RPC methods see one consistent view.
    // ──────────────────────────────────────────────────────────────

    private assertLibraryId(id: unknown): string {
        if (typeof id !== 'string' || !FIRMWARE_LIBRARY_ID_REGEX.test(id)) {
            throw RpcError.InvalidParams('Invalid firmware library ID');
        }
        return id;
    }

    private async requireLibraryItem(id: string): Promise<FirmwareLibraryItem> {
        const item = await getFirmwareLibraryItem(id);
        if (!item) {
            throw RpcError.NotFound(FIRMWARE_LIBRARY_ITEM_RESOURCE_TYPE, id);
        }
        return item;
    }

    // Firmware library blobs are shared. Device update authority may list/use
    // them; upload, metadata update, and deletion stay provider support below.
    @Component.Expose('ListLibrary')
    @Component.CheckPermissions(canUpdateFirmwareDevices)
    async listLibrary(
        rawParams: unknown
    ): Promise<FirmwareListLibraryResponse> {
        validateOrThrow<FirmwareListLibraryParams>(
            rawParams ?? {},
            FIRMWARE_LIST_LIBRARY_PARAMS_SCHEMA
        );
        try {
            const items = await getFirmwareLibraryItems();
            return buildListResponse(items, items.length, 0, 0);
        } catch (err: unknown) {
            throw RpcError.OperationFailed('fetch firmware library', err);
        }
    }

    @Component.NoAudit
    @Component.Expose('CreateUploadTicket')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async createUploadTicket(rawParams: unknown, sender: CommandSender) {
        validateOrThrow<FirmwareListLibraryParams>(
            rawParams ?? {},
            FIRMWARE_LIST_LIBRARY_PARAMS_SCHEMA
        );
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'firmware',
                user: uploadTicketUserFromSender(sender)
            })
        );
    }

    @Component.Expose('CreateLibraryDownloadUrl')
    @Component.CheckPermissions(canUpdateFirmwareDevices)
    async createLibraryDownloadUrl(
        rawParams: unknown
    ): Promise<FirmwareCreateLibraryDownloadUrlResponse> {
        const params = validateOrThrow<FirmwareCreateLibraryDownloadUrlParams>(
            rawParams,
            FIRMWARE_CREATE_LIBRARY_DOWNLOAD_URL_PARAMS_SCHEMA
        );
        const id = this.assertLibraryId(params.id);
        const item = await this.requireLibraryItem(id);

        try {
            const token = registerTemporaryFirmwareFile(
                getFirmwareLibraryFilePath(item),
                item.originalFileName,
                {deleteOnExpire: false}
            );
            return {url: `/media/firmware-file/${token}`};
        } catch (err: unknown) {
            throw RpcError.OperationFailed('prepare firmware library URL', err);
        }
    }

    @Component.Expose('UpdateLibraryEntry')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async updateLibraryEntry(
        rawParams: unknown
    ): Promise<FirmwareUpdateLibraryEntryResponse> {
        const params = validateOrThrow<FirmwareUpdateLibraryEntryParams>(
            rawParams,
            FIRMWARE_UPDATE_LIBRARY_ENTRY_PARAMS_SCHEMA
        );
        const id = this.assertLibraryId(params.id);
        const item = await this.requireLibraryItem(id);

        const updated: FirmwareLibraryItem = {
            ...item,
            name: sanitizeOptionalText(params.name) || item.name,
            app:
                params.app !== undefined
                    ? sanitizeOptionalText(params.app)
                    : item.app,
            model:
                params.model !== undefined
                    ? sanitizeOptionalText(params.model)
                    : item.model,
            ver:
                params.ver !== undefined
                    ? sanitizeOptionalText(params.ver)
                    : item.ver,
            fwId:
                params.fwId !== undefined
                    ? sanitizeOptionalText(params.fwId)
                    : item.fwId,
            channel:
                params.channel === 'stable' ||
                params.channel === 'beta' ||
                params.channel === 'custom'
                    ? params.channel
                    : params.channel === ''
                      ? undefined
                      : item.channel,
            tags: params.tags !== undefined ? parseTags(params.tags) : item.tags
        };

        try {
            await Registry.addToRegistry(
                FIRMWARE_LIBRARY_REGISTRY,
                id,
                updated
            );
            invalidateFirmwareLibraryCache();
            return {success: true, item: updated};
        } catch (err: unknown) {
            throw RpcError.OperationFailed('update firmware library item', err);
        }
    }

    @Component.Expose('DeleteLibraryEntry')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async deleteLibraryEntry(
        rawParams: unknown
    ): Promise<FirmwareDeleteLibraryEntryResponse> {
        const params = validateOrThrow<FirmwareDeleteLibraryEntryParams>(
            rawParams,
            FIRMWARE_DELETE_LIBRARY_ENTRY_PARAMS_SCHEMA
        );
        const id = this.assertLibraryId(params.id);
        const item = await this.requireLibraryItem(id);

        try {
            await deleteFileIfExists(getFirmwareLibraryFilePath(item));
            await Registry.removeFromRegistry(FIRMWARE_LIBRARY_REGISTRY, id, {
                id
            });
            invalidateFirmwareLibraryCache();
            return {success: true};
        } catch (err: unknown) {
            throw RpcError.OperationFailed('delete firmware library item', err);
        }
    }
}
