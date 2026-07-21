/** fleetSummary.* — org-wide live energy summary, cached ~5s. */

import * as log4js from 'log4js';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as Observability from '../../modules/Observability';
import {
    defaultEnergyRepository,
    type EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    FLEET_SUMMARY_DESCRIBE,
    FLEET_SUMMARY_GET_ENERGY_PARAMS,
    type FleetSummaryEnergy
} from '../../types/api/fleetSummary';
import type AbstractDevice from '../AbstractDevice';
import type CommandSender from '../CommandSender';
import {sumLiveLoad} from '../energy/liveLoad';
import Component from './Component';

const logger = log4js.getLogger('fleetSummary');
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
    value: FleetSummaryEnergy;
    expiresAt: number;
}

interface GetEnergyParams {
    organizationId?: string;
}

export default class FleetSummaryComponent extends Component {
    static get describe(): DescribeOutput {
        return FLEET_SUMMARY_DESCRIBE;
    }

    readonly #cache = new Map<string, CacheEntry>();
    readonly #repoOverride?: EnergyRepository;

    constructor(opts?: {repoOverride?: EnergyRepository}) {
        super('fleetSummary', {viewer_visible: true});
        this.#repoOverride = opts?.repoOverride;
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.Expose('GetEnergy')
    @Component.NoAudit
    @Component.CrudPermission('dashboards', 'read')
    async getEnergy(
        params: unknown,
        sender: CommandSender
    ): Promise<FleetSummaryEnergy> {
        const p = validateOrThrow<GetEnergyParams>(
            params,
            FLEET_SUMMARY_GET_ENERGY_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const unrestricted = sender.hasUnrestrictedDeviceRead();

        const now = Date.now();
        // Only an unrestricted caller sees the org-wide total, so only they may
        // read or write the shared per-org cache. A scope-restricted caller
        // bypasses it and aggregates over its own accessible subset (mirrors a
        // row-secured query skipping shared acceleration).
        if (unrestricted) {
            const cached = this.#cache.get(orgId);
            if (cached && cached.expiresAt > now) return cached.value;
        }

        const shellyIDs = await resolveScopeShellyIDs(orgId, 'fleet', null);
        // Filter-then-aggregate: a restricted viewer sees a total over the
        // devices they may see; an unrestricted caller sees every org device.
        const visible = unrestricted
            ? shellyIDs
            : [...(await sender.filterAccessibleDevices(shellyIDs))];
        const devices = visible
            .map((s) => DeviceCollector.getDevice(s))
            .filter((d): d is NonNullable<typeof d> => d != null);
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        const liveLoadWatts = sumLiveLoad(devices);
        const energyTodayWh = await sumEnergyTagToday(
            repo,
            devices,
            'total_act_energy'
        );
        const solarTodayWh = await sumEnergyTagToday(
            repo,
            devices,
            'total_act_ret_energy'
        );

        const value: FleetSummaryEnergy = {
            liveLoadWatts,
            energyTodayWh,
            solarTodayWh,
            asOf: new Date(now).toISOString()
        };
        if (unrestricted) {
            this.#cache.set(orgId, {value, expiresAt: now + CACHE_TTL_MS});
        }
        return value;
    }
}

// ── helpers ───────────────────────────────────────────────────

async function sumEnergyTagToday(
    repo: EnergyRepository,
    devices: readonly AbstractDevice[],
    tag: 'total_act_energy' | 'total_act_ret_energy'
): Promise<number> {
    if (devices.length === 0) return 0;
    try {
        const {internalIds} = await repo.resolveDevices(
            devices.map((d) => d.shellyID)
        );
        if (internalIds.length === 0) return 0;
        // Read the existing 15-minute energy buckets for today and sum them.
        // Do not request or create a daily rollup here.
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const rows = await repo.queryEnergyStats({
            internalIds,
            from: todayStart,
            to: new Date(),
            tags: [tag],
            bucket: '15 minutes',
            // Fleet total is AC-mains electricity; DC domains never mix in.
            commodity: 'electricity',
            electricalSource: 'ac_mains',
            perDevice: false
        });
        let wh = 0;
        for (const r of rows) wh += toNumber(r.agg_value);
        return wh;
    } catch (err) {
        // Keep the rest of the summary alive; surface the energy gap via a
        // metric + log rather than failing the whole org-wide read.
        Observability.incrementCounter('fleet_summary_energy_failures', 1);
        logger.warn('fleet energy-today rollup read failed tag=%s', tag, err);
        return 0;
    }
}

function toNumber(v: unknown): number {
    return typeof v === 'number' ? v : Number(v ?? 0);
}
