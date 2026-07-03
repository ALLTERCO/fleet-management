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

import * as DeviceCollector from '../../modules/DeviceCollector';
import {energyOverrideCache} from '../../modules/energyOverrideCache';
import {refreshDeviceOverrides} from '../../modules/energyOverrideLoader';
import {loadKind} from '../../modules/kindRepository';
import * as classificationRepo from '../../modules/repositories/EnergyClassificationRepository';
import {
    defaultEnergyRepository,
    type EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import * as logicalMeterRepo from '../../modules/repositories/LogicalMeterRepository';
import * as meterConnectionRepo from '../../modules/repositories/MeterConnectionRepository';
import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ENERGY_CURRENT_PARAMS_SCHEMA,
    ENERGY_DELETE_LOGICAL_METER_PARAMS_SCHEMA,
    ENERGY_DELETE_METER_CONNECTION_PARAMS_SCHEMA,
    ENERGY_DESCRIBE,
    ENERGY_GET_RESET_AUDIT_PARAMS_SCHEMA,
    ENERGY_LIST_LOGICAL_METERS_PARAMS_SCHEMA,
    ENERGY_LIST_MEASUREMENT_POINTS_PARAMS_SCHEMA,
    ENERGY_LIST_METER_CONNECTIONS_PARAMS_SCHEMA,
    ENERGY_QUERY_PARAMS_SCHEMA,
    ENERGY_SAVE_LOGICAL_METER_PARAMS_SCHEMA,
    ENERGY_SAVE_METER_CONNECTION_PARAMS_SCHEMA,
    ENERGY_SET_POINT_OVERRIDE_PARAMS_SCHEMA,
    type EnergyCurrentParams,
    type EnergyCurrentResponse,
    type EnergyDeleteLogicalMeterParams,
    type EnergyDeleteLogicalMeterResponse,
    type EnergyDeleteMeterConnectionParams,
    type EnergyDeleteMeterConnectionResponse,
    type EnergyGetResetAuditParams,
    type EnergyGetResetAuditResponse,
    type EnergyListLogicalMetersParams,
    type EnergyListLogicalMetersResponse,
    type EnergyListMeasurementPointsParams,
    type EnergyListMeasurementPointsResponse,
    type EnergyListMeterConnectionsParams,
    type EnergyListMeterConnectionsResponse,
    type EnergyQueryParams,
    type EnergyQueryResponse,
    type EnergySaveLogicalMeterParams,
    type EnergySaveLogicalMeterResponse,
    type EnergySaveMeterConnectionParams,
    type EnergySaveMeterConnectionResponse,
    type EnergySetPointOverrideParams,
    type EnergySetPointOverrideResponse
} from '../../types/api/energy';
import type CommandSender from '../CommandSender';
import {handleEnergyCurrent} from '../energy/currentHandler';
import {handleListMeasurementPoints} from '../energy/listMeasurementPointsHandler';
import {
    handleDeleteLogicalMeter,
    handleListLogicalMeters,
    handleSaveLogicalMeter,
    type LogicalMeterRepoSeam
} from '../energy/logicalMeterHandlers';
import {
    handleDeleteMeterConnection,
    handleListMeterConnections,
    handleSaveMeterConnection,
    type MeterConnectionRepoSeam
} from '../energy/meterConnectionHandlers';
import {handleEnergyMeterQuery} from '../energy/meterQueryHandler';
import {
    handleSetPointOverride,
    type PointOverrideRepoSeam
} from '../energy/pointOverrideHandler';
import {handleEnergyQuery} from '../energy/queryHandler';
import {
    productionFetcher as defaultResetAuditFetcher,
    handleGetResetAudit,
    type ResetAuditFetcher
} from '../energy/resetAuditHandler';
import Component from './Component';

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

// A meter's group/location tag must reference the caller's own scope tree.
const productionGroupExists = logicalMeterRepo.groupBelongsToOrg;
const productionLocationExists = logicalMeterRepo.locationBelongsToOrg;

interface EnergyComponentOverrides {
    resetAuditFetcher?: ResetAuditFetcher;
    logicalMeterRepo?: LogicalMeterRepoSeam;
    meterConnectionRepo?: MeterConnectionRepoSeam;
    pointOverrideRepo?: PointOverrideRepoSeam;
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
            groupExists: productionGroupExists,
            locationExists: productionLocationExists
        });
    }

    @Component.Expose('SaveLogicalMeter')
    @Component.CrudPermission('devices', 'update')
    async saveLogicalMeter(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySaveLogicalMeterResponse> {
        const v = validateOrThrow<EnergySaveLogicalMeterParams>(
            params,
            ENERGY_SAVE_LOGICAL_METER_PARAMS_SCHEMA
        );
        return handleSaveLogicalMeter(v, {
            sender,
            repo: this.#logicalMeterRepo,
            kindExists: productionKindExists,
            groupExists: productionGroupExists,
            locationExists: productionLocationExists
        });
    }

    @Component.Expose('DeleteLogicalMeter')
    @Component.CrudPermission('devices', 'update')
    async deleteLogicalMeter(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyDeleteLogicalMeterResponse> {
        const v = validateOrThrow<EnergyDeleteLogicalMeterParams>(
            params,
            ENERGY_DELETE_LOGICAL_METER_PARAMS_SCHEMA
        );
        return handleDeleteLogicalMeter(v, {
            sender,
            repo: this.#logicalMeterRepo,
            kindExists: productionKindExists,
            groupExists: productionGroupExists,
            locationExists: productionLocationExists
        });
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
    @Component.CrudPermission('devices', 'update')
    async saveMeterConnection(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergySaveMeterConnectionResponse> {
        const v = validateOrThrow<EnergySaveMeterConnectionParams>(
            params,
            ENERGY_SAVE_METER_CONNECTION_PARAMS_SCHEMA
        );
        return handleSaveMeterConnection(v, this.#meterConnectionDeps(sender));
    }

    @Component.Expose('DeleteMeterConnection')
    @Component.CrudPermission('devices', 'update')
    async deleteMeterConnection(
        params: unknown,
        sender: CommandSender
    ): Promise<EnergyDeleteMeterConnectionResponse> {
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

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }
}
