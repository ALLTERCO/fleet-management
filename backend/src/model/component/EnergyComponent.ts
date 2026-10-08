/**
 * Energy namespace — reads fleet energy from FM storage, defines logical
 * meters (the user/report meaning layer), and fixes the rare unknown
 * point. `Query`/`Current` are dashboards/live charts; reports run through
 * the `report` namespace.
 *
 * Permissions: `mapLegacyComponentName('energy')` returns null, so every
 * method carries an explicit decorator. `Query`/`Current` use
 * `@NoPermissions` because the scope-dependent check happens inside the
 * handler. Logical-meter CRUD and the point override are `devices:*`.
 *
 * Each method is a thin adapter over a pure handler in `model/energy/*`,
 * so the handlers stay unit-testable without the Component base graph.
 */

import * as AuditLogger from '../../modules/AuditLogger';
import {requireTenantWideComponentPermission} from '../../modules/authz/evaluator';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {enqueueEmSyncBlock} from '../../modules/device/emSyncStream';
import {energyOverrideCache} from '../../modules/energyOverrideCache';
import {refreshDeviceOverrides} from '../../modules/energyOverrideLoader';
import {loadKind} from '../../modules/kindRepository';
import {getOrganizationProfile} from '../../modules/organizationModel';
import * as baselineExclusionRepo from '../../modules/repositories/BaselineExclusionRepository';
import {
    type CommodityRepairRepository,
    defaultCommodityRepairRepository
} from '../../modules/repositories/CommodityRepairRepository';
import * as emSyncRejectedRepo from '../../modules/repositories/EmSyncRejectedRepository';
import * as classificationRepo from '../../modules/repositories/EnergyClassificationRepository';
import {
    defaultEnergyRepository,
    type EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import {
    defaultLogicalMeterMeaningRepository,
    type LogicalMeterMeaningRepository
} from '../../modules/repositories/LogicalMeterMeaningRepository';
import * as logicalMeterRepo from '../../modules/repositories/LogicalMeterRepository';
import * as meterConnectionRepo from '../../modules/repositories/MeterConnectionRepository';
import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ENERGY_APPLY_COMMODITY_REPAIR_PARAMS_SCHEMA,
    ENERGY_APPLY_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA,
    ENERGY_BASELINE_PARAMS_SCHEMA,
    ENERGY_CURRENT_PARAMS_SCHEMA,
    ENERGY_DELETE_BASELINE_EXCLUSION_PARAMS_SCHEMA,
    ENERGY_DELETE_LOGICAL_METER_PARAMS_SCHEMA,
    ENERGY_DELETE_METER_CONNECTION_PARAMS_SCHEMA,
    ENERGY_DESCRIBE,
    ENERGY_GET_RESET_AUDIT_PARAMS_SCHEMA,
    ENERGY_LIST_BASELINE_EXCLUSIONS_PARAMS_SCHEMA,
    ENERGY_LIST_LOGICAL_METER_MEANING_HISTORY_PARAMS_SCHEMA,
    ENERGY_LIST_LOGICAL_METER_MEANING_REVIEW_QUEUE_PARAMS_SCHEMA,
    ENERGY_LIST_LOGICAL_METERS_PARAMS_SCHEMA,
    ENERGY_LIST_MEASUREMENT_POINTS_PARAMS_SCHEMA,
    ENERGY_LIST_METER_CONNECTIONS_PARAMS_SCHEMA,
    ENERGY_OVERNIGHT_BASELINE_PARAMS_SCHEMA,
    ENERGY_PREVIEW_COMMODITY_REPAIR_PARAMS_SCHEMA,
    ENERGY_PREVIEW_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA,
    ENERGY_PROJECTION_PARAMS_SCHEMA,
    ENERGY_QUERY_PARAMS_SCHEMA,
    ENERGY_REJECTED_SYNC_BLOCKS_PARAMS_SCHEMA,
    ENERGY_REQUEUE_REJECTED_SYNC_BLOCK_PARAMS_SCHEMA,
    ENERGY_SAVE_BASELINE_EXCLUSION_PARAMS_SCHEMA,
    ENERGY_SAVE_LOGICAL_METER_PARAMS_SCHEMA,
    ENERGY_SAVE_METER_CONNECTION_PARAMS_SCHEMA,
    ENERGY_SET_POINT_OVERRIDE_PARAMS_SCHEMA,
    ENERGY_SYNC_STATUS_PARAMS_SCHEMA,
    type EnergyApplyCommodityRepairParams,
    type EnergyApplyCommodityRepairResponse,
    type EnergyApplyLogicalMeterMeaningChangeParams,
    type EnergyApplyLogicalMeterMeaningChangeResponse,
    type EnergyBaselineParams,
    type EnergyBaselineResponse,
    type EnergyCurrentParams,
    type EnergyCurrentResponse,
    type EnergyDeleteBaselineExclusionParams,
    type EnergyDeleteBaselineExclusionResponse,
    type EnergyDeleteLogicalMeterParams,
    type EnergyDeleteLogicalMeterResponse,
    type EnergyDeleteMeterConnectionParams,
    type EnergyDeleteMeterConnectionResponse,
    type EnergyGetResetAuditParams,
    type EnergyGetResetAuditResponse,
    type EnergyListBaselineExclusionsParams,
    type EnergyListBaselineExclusionsResponse,
    type EnergyListLogicalMeterMeaningHistoryParams,
    type EnergyListLogicalMeterMeaningHistoryResponse,
    type EnergyListLogicalMeterMeaningReviewQueueParams,
    type EnergyListLogicalMeterMeaningReviewQueueResponse,
    type EnergyListLogicalMetersParams,
    type EnergyListLogicalMetersResponse,
    type EnergyListMeasurementPointsParams,
    type EnergyListMeasurementPointsResponse,
    type EnergyListMeterConnectionsParams,
    type EnergyListMeterConnectionsResponse,
    type EnergyOvernightBaselineParams,
    type EnergyOvernightBaselineResponse,
    type EnergyPreviewCommodityRepairParams,
    type EnergyPreviewCommodityRepairResponse,
    type EnergyPreviewLogicalMeterMeaningChangeParams,
    type EnergyPreviewLogicalMeterMeaningChangeResponse,
    type EnergyProjectionParams,
    type EnergyProjectionResponse,
    type EnergyQueryParams,
    type EnergyQueryResponse,
    type EnergyRejectedSyncBlocksParams,
    type EnergyRejectedSyncBlocksResponse,
    type EnergyRequeueRejectedSyncBlockParams,
    type EnergyRequeueRejectedSyncBlockResponse,
    type EnergySaveBaselineExclusionParams,
    type EnergySaveBaselineExclusionResponse,
    type EnergySaveLogicalMeterParams,
    type EnergySaveLogicalMeterResponse,
    type EnergySaveMeterConnectionParams,
    type EnergySaveMeterConnectionResponse,
    type EnergySetPointOverrideParams,
    type EnergySetPointOverrideResponse,
    type EnergySyncStatusParams,
    type EnergySyncStatusResponse
} from '../../types/api/energy';
import type CommandSender from '../CommandSender';
import {
    type BaselineExclusionHandlerDeps,
    handleDeleteBaselineExclusion,
    handleListBaselineExclusions,
    handleSaveBaselineExclusion
} from '../energy/baselineExclusionHandlers';
import {
    handleEnergyBaseline,
    productionBaselineChangeFetcher,
    productionBaselineFetcher,
    productionBaselineLookup,
    productionBaselineTempFetcher
} from '../energy/baselineHandler';
import {
    handleApplyCommodityRepair,
    handlePreviewCommodityRepair
} from '../energy/commodityRepairHandler';
import {handleEnergyCurrent} from '../energy/currentHandler';
import {handleListMeasurementPoints} from '../energy/listMeasurementPointsHandler';
import {
    handleDeleteLogicalMeter,
    handleListLogicalMeters,
    handleSaveLogicalMeter,
    type LogicalMeterRepoSeam
} from '../energy/logicalMeterHandlers';
import {
    handleApplyLogicalMeterMeaningChange,
    handleListLogicalMeterMeaningHistory,
    handleListLogicalMeterMeaningReviewQueue,
    handlePreviewLogicalMeterMeaningChange
} from '../energy/logicalMeterMeaningHandlers';
import {
    handleDeleteMeterConnection,
    handleListMeterConnections,
    handleSaveMeterConnection,
    type MeterConnectionRepoSeam
} from '../energy/meterConnectionHandlers';
import {handleEnergyMeterQuery} from '../energy/meterQueryHandler';
import {handleEnergyOvernightBaseline} from '../energy/overnightBaselineHandler';
import {
    handleSetPointOverride,
    type PointOverrideRepoSeam
} from '../energy/pointOverrideHandler';
import {handleEnergyProjection} from '../energy/projectionHandler';
import {handleEnergyQuery} from '../energy/queryHandler';
import {
    handleRejectedSyncBlocks,
    handleRequeueRejectedSyncBlock
} from '../energy/rejectedSyncBlocksHandler';
import {
    productionFetcher as defaultResetAuditFetcher,
    handleGetResetAudit,
    type ResetAuditFetcher
} from '../energy/resetAuditHandler';
import {handleEnergySyncStatus} from '../energy/syncStatusHandler';
import Component from './Component';

// Dead letter store for rejected meter blocks; PG calls only, bound statically.
const rejectedSyncBlockStore = {
    list: emSyncRejectedRepo.listRejectedBlocks,
    countOpen: emSyncRejectedRepo.countOpenRejectedBlocks,
    get: emSyncRejectedRepo.getOpenRejectedBlock,
    take: emSyncRejectedRepo.takeRejectedBlock
};

// Production wiring of the logical-meter repo seam. Stateless (PG calls
// only), so it is bound statically.
const productionLogicalMeterRepo: LogicalMeterRepoSeam = {
    save: logicalMeterRepo.saveLogicalMeter,
    remove: logicalMeterRepo.deleteLogicalMeter,
    list: logicalMeterRepo.listLogicalMeters
};

// Production wiring of the meter-connection repo seam. Stateless (PG calls
// only), so it is bound statically.
const productionMeterConnectionRepo: MeterConnectionRepoSeam = {
    save: meterConnectionRepo.saveMeterConnection,
    remove: meterConnectionRepo.deleteMeterConnection,
    list: meterConnectionRepo.listMeterConnections
};

// Production wiring of the point-override seam — upserts the tier-1
// classification override and re-seeds the device's cache rows.
const productionPointOverrideRepo: PointOverrideRepoSeam = {
    upsertClassification: classificationRepo.upsertClassification,
    refreshDeviceOverrides
};

// A kindId is valid for a meter when loadKind resolves it within the org —
// built-in (org-null) or this org's custom kind; foreign/unknown ids return
// null and are rejected by the meter-save validation.
const productionKindExists = async (
    org: string,
    kindId: string
): Promise<boolean> => (await loadKind(kindId, org)) !== null;
const productionEnergySourceExists = logicalMeterRepo.energySourceBelongsToOrg;

// A meter's group/location tag must reference the caller's own scope tree.
const productionGroupExists = logicalMeterRepo.groupBelongsToOrg;
const productionLocationExists = logicalMeterRepo.locationBelongsToOrg;

function productionBaselineExclusionDeps(
    sender: CommandSender
): BaselineExclusionHandlerDeps {
    return {
        sender,
        repo: {
            list: baselineExclusionRepo.listBaselineExclusions,
            save: baselineExclusionRepo.saveBaselineExclusion,
            remove: baselineExclusionRepo.deleteBaselineExclusion
        },
        audit: (entry) => {
            void AuditLogger.log(entry);
        }
    };
}

interface EnergyComponentOverrides {
    resetAuditFetcher?: ResetAuditFetcher;
    logicalMeterRepo?: LogicalMeterRepoSeam;
    meterConnectionRepo?: MeterConnectionRepoSeam;
    pointOverrideRepo?: PointOverrideRepoSeam;
    commodityRepairRepo?: CommodityRepairRepository;
    logicalMeterMeaningRepo?: LogicalMeterMeaningRepository;
}

// Energy settings (meters, connections, exclusions, sync blocks) are not
// devices: no scope selector names them.
const NOT_A_DEVICE_ID = (): undefined => undefined;

// A save with an id changes that existing setting.
function namesExistingSetting(params: unknown): boolean {
    return typeof params === 'object' && params !== null && 'id' in params;
}

export default class EnergyComponent extends Component {
    /**
     * Overridable for tests — when not provided, a lazily-constructed
     * production repository (wired to PostgresProvider + DeviceCollector)
     * is used on first call.
     */
    readonly #repoOverride?: EnergyRepository;
    readonly #resetAuditFetcher: ResetAuditFetcher;
    readonly #logicalMeterRepo: LogicalMeterRepoSeam;
    readonly #meterConnectionRepo: MeterConnectionRepoSeam;
    readonly #pointOverrideRepo: PointOverrideRepoSeam;
    readonly #commodityRepairRepo: CommodityRepairRepository;
    readonly #logicalMeterMeaningRepo: LogicalMeterMeaningRepository;

    constructor(
        repoOverride?: EnergyRepository,
        overrides?: EnergyComponentOverrides
    ) {
        super('energy', {set_config_methods: false, auto_apply_config: false});
        this.#repoOverride = repoOverride;
        this.#resetAuditFetcher =
            overrides?.resetAuditFetcher ?? defaultResetAuditFetcher;
        this.#logicalMeterRepo =
            overrides?.logicalMeterRepo ?? productionLogicalMeterRepo;
        this.#meterConnectionRepo =
            overrides?.meterConnectionRepo ?? productionMeterConnectionRepo;
        this.#pointOverrideRepo =
            overrides?.pointOverrideRepo ?? productionPointOverrideRepo;
        this.#commodityRepairRepo =
            overrides?.commodityRepairRepo ?? defaultCommodityRepairRepository;
        this.#logicalMeterMeaningRepo =
            overrides?.logicalMeterMeaningRepo ??
            defaultLogicalMeterMeaningRepository;
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return ENERGY_DESCRIBE;
    }

    @Component.Expose('Query')
    @Component.NoPermissions
    async query(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyQueryResponse> {
        const v = validateOrThrow<EnergyQueryParams>(
            params,
            ENERGY_QUERY_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        // meterIds or groupBy both run the meter path — group-by folds per-meter
        // energy by role/kind/utility, sharing the report breakdown's grouper.
        if (v.meterIds !== undefined || v.groupBy !== undefined) {
            return handleEnergyMeterQuery(v, sender, {
                repo,
                listMeters: (org) => this.#logicalMeterRepo.list(org)
            });
        }
        return handleEnergyQuery(v, sender, repo);
    }

    @Component.Expose('Current')
    @Component.NoPermissions
    async current(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyCurrentResponse> {
        const v = validateOrThrow<EnergyCurrentParams>(
            params,
            ENERGY_CURRENT_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleEnergyCurrent(
            v,
            sender,
            repo,
            (shellyID) => DeviceCollector.getDevice(shellyID),
            (org) => this.#logicalMeterRepo.list(org)
        );
    }

    @Component.Expose('Projection')
    @Component.NoPermissions
    async projection(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyProjectionResponse> {
        const v = validateOrThrow<EnergyProjectionParams>(
            params,
            ENERGY_PROJECTION_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleEnergyProjection(v, sender, repo);
    }

    @Component.Expose('SyncStatus')
    @Component.NoPermissions
    async syncStatus(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySyncStatusResponse> {
        const v = validateOrThrow<EnergySyncStatusParams>(
            params,
            ENERGY_SYNC_STATUS_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleEnergySyncStatus(v, sender, repo, (shellyID) =>
            DeviceCollector.getDevice(shellyID)
        );
    }

    @Component.Expose('RejectedSyncBlocks')
    @Component.NoPermissions
    async rejectedSyncBlocks(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyRejectedSyncBlocksResponse> {
        const v = validateOrThrow<EnergyRejectedSyncBlocksParams>(
            params,
            ENERGY_REJECTED_SYNC_BLOCKS_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleRejectedSyncBlocks(
            v,
            sender,
            repo,
            rejectedSyncBlockStore
        );
    }

    @Component.Expose('RequeueRejectedSyncBlock')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async requeueRejectedSyncBlock(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyRequeueRejectedSyncBlockResponse> {
        await requireTenantWideComponentPermission(sender, 'devices', 'update');
        const v = validateOrThrow<EnergyRequeueRejectedSyncBlockParams>(
            params,
            ENERGY_REQUEUE_REJECTED_SYNC_BLOCK_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleRequeueRejectedSyncBlock(
            v,
            sender,
            repo,
            rejectedSyncBlockStore,
            enqueueEmSyncBlock
        );
    }

    @Component.Expose('ListMeasurementPoints')
    @Component.NoPermissions
    async listMeasurementPoints(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyListMeasurementPointsResponse> {
        const v = validateOrThrow<EnergyListMeasurementPointsParams>(
            params,
            ENERGY_LIST_MEASUREMENT_POINTS_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleListMeasurementPoints(v, sender, repo, {
            lookup: (shellyID) => DeviceCollector.getDevice(shellyID),
            listMeters: (org) => this.#logicalMeterRepo.list(org)
        });
    }

    @Component.Expose('SetPointOverride')
    @Component.CrudPermission('devices', 'update')
    async setPointOverride(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySetPointOverrideResponse> {
        const v = validateOrThrow<EnergySetPointOverrideParams>(
            params,
            ENERGY_SET_POINT_OVERRIDE_PARAMS_SCHEMA
        );
        return handleSetPointOverride(v, {
            sender,
            repo: this.#pointOverrideRepo,
            overrideCache: energyOverrideCache
        });
    }

    @Component.Expose('PreviewCommodityRepair')
    @Component.CrudPermission('devices', 'update')
    @Component.RateLimit('expensive')
    async previewCommodityRepair(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyPreviewCommodityRepairResponse> {
        const v = validateOrThrow<EnergyPreviewCommodityRepairParams>(
            params,
            ENERGY_PREVIEW_COMMODITY_REPAIR_PARAMS_SCHEMA
        );
        return handlePreviewCommodityRepair(
            v,
            sender,
            this.#commodityRepairRepo
        );
    }

    @Component.Expose('ApplyCommodityRepair')
    @Component.CrudPermission('devices', 'update')
    @Component.RateLimit('expensive')
    async applyCommodityRepair(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyApplyCommodityRepairResponse> {
        const v = validateOrThrow<EnergyApplyCommodityRepairParams>(
            params,
            ENERGY_APPLY_COMMODITY_REPAIR_PARAMS_SCHEMA
        );
        return handleApplyCommodityRepair(v, sender, this.#commodityRepairRepo);
    }

    @Component.Expose('GetResetAudit')
    @Component.CrudPermission('devices', 'read')
    async getResetAudit(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyGetResetAuditResponse> {
        const v = validateOrThrow<EnergyGetResetAuditParams>(
            params,
            ENERGY_GET_RESET_AUDIT_PARAMS_SCHEMA
        );
        return handleGetResetAudit(v, this.#resetAuditFetcher, sender);
    }

    @Component.Expose('Baseline')
    @Component.CrudPermission('devices', 'read')
    async baseline(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyBaselineResponse> {
        const validated = validateOrThrow<EnergyBaselineParams>(
            params,
            ENERGY_BASELINE_PARAMS_SCHEMA
        );
        return handleEnergyBaseline(validated, sender, {
            fetch: productionBaselineFetcher,
            fetchTemp: productionBaselineTempFetcher,
            fetchChange: productionBaselineChangeFetcher,
            lookup: productionBaselineLookup
        });
    }

    @Component.Expose('OvernightBaseline')
    @Component.CrudPermission('devices', 'read')
    async overnightBaseline(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyOvernightBaselineResponse> {
        const validated = validateOrThrow<EnergyOvernightBaselineParams>(
            params,
            ENERGY_OVERNIGHT_BASELINE_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        return handleEnergyOvernightBaseline(validated, sender, repo, {
            fetchBaseline: productionBaselineFetcher,
            organizationTimeZone: async (organizationId) =>
                (await getOrganizationProfile(organizationId)).timezoneDefault
        });
    }

    @Component.Expose('ListBaselineExclusions')
    @Component.CrudPermission('devices', 'read')
    async listBaselineExclusions(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyListBaselineExclusionsResponse> {
        const validated = validateOrThrow<EnergyListBaselineExclusionsParams>(
            params,
            ENERGY_LIST_BASELINE_EXCLUSIONS_PARAMS_SCHEMA
        );
        return handleListBaselineExclusions(
            validated,
            productionBaselineExclusionDeps(sender)
        );
    }

    @Component.Expose('SaveBaselineExclusion')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async saveBaselineExclusion(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySaveBaselineExclusionResponse> {
        if (namesExistingSetting(params)) {
            await requireTenantWideComponentPermission(
                sender,
                'devices',
                'update'
            );
        }
        const validated = validateOrThrow<EnergySaveBaselineExclusionParams>(
            params,
            ENERGY_SAVE_BASELINE_EXCLUSION_PARAMS_SCHEMA
        );
        return handleSaveBaselineExclusion(
            validated,
            productionBaselineExclusionDeps(sender)
        );
    }

    @Component.Expose('DeleteBaselineExclusion')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async deleteBaselineExclusion(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyDeleteBaselineExclusionResponse> {
        await requireTenantWideComponentPermission(sender, 'devices', 'update');
        const validated = validateOrThrow<EnergyDeleteBaselineExclusionParams>(
            params,
            ENERGY_DELETE_BASELINE_EXCLUSION_PARAMS_SCHEMA
        );
        return handleDeleteBaselineExclusion(
            validated,
            productionBaselineExclusionDeps(sender)
        );
    }

    @Component.Expose('ListLogicalMeters')
    @Component.CrudPermission('devices', 'read')
    async listLogicalMeters(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyListLogicalMetersResponse> {
        const v = validateOrThrow<EnergyListLogicalMetersParams>(
            params,
            ENERGY_LIST_LOGICAL_METERS_PARAMS_SCHEMA
        );
        return handleListLogicalMeters(v, {
            sender,
            repo: this.#logicalMeterRepo,
            kindExists: productionKindExists,
            energySourceExists: productionEnergySourceExists,
            groupExists: productionGroupExists,
            locationExists: productionLocationExists
        });
    }

    @Component.Expose('SaveLogicalMeter')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async saveLogicalMeter(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySaveLogicalMeterResponse> {
        if (namesExistingSetting(params)) {
            await requireTenantWideComponentPermission(
                sender,
                'devices',
                'update'
            );
        }
        const v = validateOrThrow<EnergySaveLogicalMeterParams>(
            params,
            ENERGY_SAVE_LOGICAL_METER_PARAMS_SCHEMA
        );
        return handleSaveLogicalMeter(v, {
            sender,
            repo: this.#logicalMeterRepo,
            kindExists: productionKindExists,
            energySourceExists: productionEnergySourceExists,
            groupExists: productionGroupExists,
            locationExists: productionLocationExists
        });
    }

    @Component.Expose('DeleteLogicalMeter')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async deleteLogicalMeter(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyDeleteLogicalMeterResponse> {
        await requireTenantWideComponentPermission(sender, 'devices', 'update');
        const v = validateOrThrow<EnergyDeleteLogicalMeterParams>(
            params,
            ENERGY_DELETE_LOGICAL_METER_PARAMS_SCHEMA
        );
        return handleDeleteLogicalMeter(v, {
            sender,
            repo: this.#logicalMeterRepo,
            kindExists: productionKindExists,
            energySourceExists: productionEnergySourceExists,
            groupExists: productionGroupExists,
            locationExists: productionLocationExists
        });
    }

    @Component.Expose('ListLogicalMeterMeaningReviewQueue')
    @Component.CrudPermission('devices', 'read')
    async listLogicalMeterMeaningReviewQueue(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyListLogicalMeterMeaningReviewQueueResponse> {
        const v =
            validateOrThrow<EnergyListLogicalMeterMeaningReviewQueueParams>(
                params,
                ENERGY_LIST_LOGICAL_METER_MEANING_REVIEW_QUEUE_PARAMS_SCHEMA
            );
        return handleListLogicalMeterMeaningReviewQueue(
            v,
            this.#logicalMeterMeaningDeps(sender)
        );
    }

    @Component.Expose('ListLogicalMeterMeaningHistory')
    @Component.CrudPermission('devices', 'read')
    async listLogicalMeterMeaningHistory(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyListLogicalMeterMeaningHistoryResponse> {
        const v = validateOrThrow<EnergyListLogicalMeterMeaningHistoryParams>(
            params,
            ENERGY_LIST_LOGICAL_METER_MEANING_HISTORY_PARAMS_SCHEMA
        );
        return handleListLogicalMeterMeaningHistory(
            v,
            this.#logicalMeterMeaningDeps(sender)
        );
    }

    @Component.Expose('PreviewLogicalMeterMeaningChange')
    @Component.CrudPermission('devices', 'update')
    @Component.RateLimit('expensive')
    async previewLogicalMeterMeaningChange(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyPreviewLogicalMeterMeaningChangeResponse> {
        const v = validateOrThrow<EnergyPreviewLogicalMeterMeaningChangeParams>(
            params,
            ENERGY_PREVIEW_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA
        );
        return handlePreviewLogicalMeterMeaningChange(
            v,
            this.#logicalMeterMeaningDeps(sender)
        );
    }

    @Component.Expose('ApplyLogicalMeterMeaningChange')
    @Component.CrudPermission('devices', 'update')
    @Component.RateLimit('expensive')
    async applyLogicalMeterMeaningChange(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyApplyLogicalMeterMeaningChangeResponse> {
        const v = validateOrThrow<EnergyApplyLogicalMeterMeaningChangeParams>(
            params,
            ENERGY_APPLY_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA
        );
        return handleApplyLogicalMeterMeaningChange(
            v,
            this.#logicalMeterMeaningDeps(sender)
        );
    }

    @Component.Expose('ListMeterConnections')
    @Component.CrudPermission('devices', 'read')
    async listMeterConnections(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyListMeterConnectionsResponse> {
        const v = validateOrThrow<EnergyListMeterConnectionsParams>(
            params,
            ENERGY_LIST_METER_CONNECTIONS_PARAMS_SCHEMA
        );
        return handleListMeterConnections(v, this.#meterConnectionDeps(sender));
    }

    @Component.Expose('SaveMeterConnection')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async saveMeterConnection(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySaveMeterConnectionResponse> {
        if (namesExistingSetting(params)) {
            await requireTenantWideComponentPermission(
                sender,
                'devices',
                'update'
            );
        }
        const v = validateOrThrow<EnergySaveMeterConnectionParams>(
            params,
            ENERGY_SAVE_METER_CONNECTION_PARAMS_SCHEMA
        );
        return handleSaveMeterConnection(v, this.#meterConnectionDeps(sender));
    }

    @Component.Expose('DeleteMeterConnection')
    @Component.CrudPermission('devices', 'update', NOT_A_DEVICE_ID)
    async deleteMeterConnection(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyDeleteMeterConnectionResponse> {
        await requireTenantWideComponentPermission(sender, 'devices', 'update');
        const v = validateOrThrow<EnergyDeleteMeterConnectionParams>(
            params,
            ENERGY_DELETE_METER_CONNECTION_PARAMS_SCHEMA
        );
        return handleDeleteMeterConnection(
            v,
            this.#meterConnectionDeps(sender)
        );
    }

    // The meterId an edge references must be a logical meter in the org;
    // the org meter list (same repo as the meter CRUD) backs that check.
    #meterConnectionDeps(sender: CommandSender) {
        return {
            sender,
            repo: this.#meterConnectionRepo,
            listOrgMeterIds: async (org: string) =>
                (await this.#logicalMeterRepo.list(org)).map((m) => m.id)
        };
    }

    #logicalMeterMeaningDeps(sender: CommandSender) {
        return {
            sender,
            repo: this.#logicalMeterMeaningRepo,
            meterForId: async (organizationId: string, meterId: number) =>
                (await this.#logicalMeterRepo.list(organizationId)).find(
                    (meter) => meter.id === meterId
                ) ?? null,
            listMeters: (organizationId: string) =>
                this.#logicalMeterRepo.list(organizationId),
            canAccessDevice: async (
                deviceId: number,
                operation: 'read' | 'update'
            ) => {
                const device = DeviceCollector.getAll().find(
                    (candidate) => candidate.id === deviceId
                );
                return Boolean(
                    device &&
                        sender.evaluateComponentPermission({
                            component: 'devices',
                            operation,
                            itemId: device.shellyID
                        })
                );
            },
            kindExists: productionKindExists
        };
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }
}
