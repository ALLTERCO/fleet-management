import {isValidTimezone} from '../../modules/location/isoData.js';
import {
    defaultGasConversionRepository,
    type GasConversionRepository
} from '../../modules/repositories/GasConversionRepository.js';
import {type SqlStateMap, translatePgError} from '../../rpc/dbErrors.js';
import type {DescribeOutput} from '../../rpc/describe.js';
import RpcError from '../../rpc/RpcError.js';
import {validateOrThrow} from '../../rpc/validateOrThrow.js';
import {
    GAS_CONVERSION_DESCRIBE,
    GAS_CV_LIST_SCHEMA,
    GAS_CV_SCHEMA,
    GAS_PROFILE_LIST_SCHEMA,
    GAS_PROFILE_SCHEMA,
    GAS_ZONE_LIST_SCHEMA,
    GAS_ZONE_SCHEMA
} from '../../types/api/gasConversion.js';
import type CommandSender from '../CommandSender.js';
import Component from './Component.js';

// A refused CHECK is the table judging the payload, so it stays a validation
// error and names the rule when it can. Anything else the database says keeps
// its own meaning through translatePgError.
const PROFILE_WRITE_SQLSTATES: SqlStateMap = {
    checkViolation: (constraint) =>
        constraint === 'gas_conversion_unit_definition_chk'
            ? 'GasUnitDefinitionMismatch'
            : 'ValidationFailed'
};

export default class GasConversionComponent extends Component {
    constructor(private readonly overrideRepo?: GasConversionRepository) {
        super('gasConversion', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }
    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }
    private async repo() {
        return this.overrideRepo ?? defaultGasConversionRepository();
    }
    private org(sender: CommandSender): string {
        const org = sender.getOrganizationId();
        if (!org) throw RpcError.Unauthorized();
        return org;
    }
    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return GAS_CONVERSION_DESCRIBE;
    }
    @Component.Expose('UpsertZone')
    @Component.CrudPermission('reports', 'update')
    async upsertZone(params: unknown, sender: CommandSender) {
        const payload = validateOrThrow<Record<string, unknown>>(
            params,
            GAS_ZONE_SCHEMA
        );
        if (!isValidTimezone(String(payload.timezone)))
            throw RpcError.InvalidParams('timezone must be a valid IANA zone');
        return {
            id: await (await this.repo()).upsertZone(this.org(sender), payload)
        };
    }
    @Component.Expose('UpsertProfile')
    @Component.CrudPermission('reports', 'update')
    async upsertProfile(params: unknown, sender: CommandSender) {
        const payload = validateOrThrow<Record<string, unknown>>(
            params,
            GAS_PROFILE_SCHEMA
        );
        requireIsoDate(payload.effectiveFrom, 'effectiveFrom');
        if (payload.effectiveTo != null) {
            requireIsoDate(payload.effectiveTo, 'effectiveTo');
        }
        const corrected = payload.volumeState === 'corrected';
        const correctionFactor = nullablePositive(payload.correctionFactor);
        if (
            (corrected &&
                (payload.correctionMode !== 'none' ||
                    correctionFactor !== null)) ||
            (!corrected &&
                (payload.correctionMode === 'none' ||
                    correctionFactor === null))
        ) {
            throw RpcError.InvalidParams(
                'Corrected volume requires mode none and no correction factor; uncorrected volume requires an explicit mode and positive factor.'
            );
        }
        const metricFactor = nullablePositive(payload.metricFactor);
        if (
            (payload.meteredUnit === 'm3' && metricFactor !== null) ||
            (payload.meteredUnit !== 'm3' && metricFactor === null)
        ) {
            throw RpcError.InvalidParams(
                'm3 profiles must not set a metric factor; ft3/ccf profiles require an explicit positive conversion-to-m3 factor.'
            );
        }
        if (
            typeof payload.effectiveTo === 'string' &&
            payload.effectiveTo <= String(payload.effectiveFrom)
        ) {
            throw RpcError.InvalidParams(
                'effectiveTo is an exclusive date and must be after effectiveFrom.'
            );
        }
        const org = this.org(sender);
        try {
            return {
                id: await (await this.repo()).upsertProfile(org, payload)
            };
        } catch (err) {
            throw translatePgError(
                err,
                'gas conversion profile upsert',
                PROFILE_WRITE_SQLSTATES
            );
        }
    }
    @Component.Expose('AddCalorificValue')
    @Component.CrudPermission('reports', 'update')
    async addCalorificValue(params: unknown, sender: CommandSender) {
        const payload = validateOrThrow<Record<string, unknown>>(
            params,
            GAS_CV_SCHEMA
        );
        requireIsoDate(payload.gasDay, 'gasDay');
        requireDateTime(payload.publishedAt, 'publishedAt');
        return {
            id: await (await this.repo()).addCalorificValue(
                this.org(sender),
                payload
            )
        };
    }

    @Component.Expose('ListZones')
    @Component.CrudPermission('reports', 'read')
    async listZones(params: unknown, sender: CommandSender) {
        const query = validateOrThrow<Record<string, unknown>>(
            params,
            GAS_ZONE_LIST_SCHEMA
        );
        return (await this.repo()).listZones({
            orgId: this.org(sender),
            ...pageQuery(query)
        });
    }

    @Component.Expose('ListProfiles')
    @Component.CrudPermission('reports', 'read')
    async listProfiles(params: unknown, sender: CommandSender) {
        const query = validateOrThrow<Record<string, unknown>>(
            params,
            GAS_PROFILE_LIST_SCHEMA
        );
        return (await this.repo()).listAdminProfiles({
            orgId: this.org(sender),
            deviceExternalId:
                typeof query.deviceExternalId === 'string'
                    ? query.deviceExternalId
                    : undefined,
            channel:
                typeof query.channel === 'number' ? query.channel : undefined,
            ...pageQuery(query)
        });
    }

    @Component.Expose('ListCalorificValues')
    @Component.CrudPermission('reports', 'read')
    async listCalorificValues(params: unknown, sender: CommandSender) {
        const query = validateOrThrow<Record<string, unknown>>(
            params,
            GAS_CV_LIST_SCHEMA
        );
        if (query.gasDayFrom != null) {
            requireIsoDate(query.gasDayFrom, 'gasDayFrom');
        }
        if (query.gasDayTo != null) {
            requireIsoDate(query.gasDayTo, 'gasDayTo');
        }
        if (
            typeof query.gasDayFrom === 'string' &&
            typeof query.gasDayTo === 'string' &&
            query.gasDayTo < query.gasDayFrom
        ) {
            throw RpcError.InvalidParams(
                'gasDayTo must be on or after gasDayFrom.'
            );
        }
        return (await this.repo()).listCalorificValues({
            orgId: this.org(sender),
            pricingZoneId:
                typeof query.pricingZoneId === 'number'
                    ? query.pricingZoneId
                    : undefined,
            gasDayFrom:
                typeof query.gasDayFrom === 'string'
                    ? query.gasDayFrom
                    : undefined,
            gasDayTo:
                typeof query.gasDayTo === 'string' ? query.gasDayTo : undefined,
            ...pageQuery(query)
        });
    }
}

function nullablePositive(value: unknown): number | null {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function pageQuery(query: Record<string, unknown>): {
    limit?: number;
    beforeId?: number;
} {
    return {
        limit: typeof query.limit === 'number' ? query.limit : undefined,
        beforeId:
            typeof query.beforeId === 'number' ? query.beforeId : undefined
    };
}

function requireIsoDate(value: unknown, field: string): void {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw RpcError.InvalidParams(`${field} must be a YYYY-MM-DD date.`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
    ) {
        throw RpcError.InvalidParams(`${field} must be a real calendar date.`);
    }
}

function requireDateTime(value: unknown, field: string): void {
    if (
        typeof value !== 'string' ||
        !value.includes('T') ||
        !Number.isFinite(Date.parse(value))
    ) {
        throw RpcError.InvalidParams(`${field} must be an ISO date-time.`);
    }
}
