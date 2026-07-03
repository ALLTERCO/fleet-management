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

        const now = Date.now();
        const cached = this.#cache.get(orgId);
        if (cached && cached.expiresAt > now) return cached.value;

        const shellyIDs = await resolveScopeShellyIDs(orgId, 'fleet', null);
        const devices = shellyIDs
            .map((s) => DeviceCollector.getDevice(s))
            .filter((d): d is NonNullable<typeof d> => d != null);
        const repo = this.#repoOverride ?? (await defaultEnergyRepository());
        const liveLoadWatts = sumLiveLoad(devices);
        const energyTodayWh = await sumEnergyToday(repo, devices);
        const solarTodayWh = sumSolarToday(devices);

        const value: FleetSummaryEnergy = {
            liveLoadWatts,
            energyTodayWh,
            solarTodayWh,
            asOf: new Date(now).toISOString()
        };
        this.#cache.set(orgId, {value, expiresAt: now + CACHE_TTL_MS});
        return value;
    }
}

// ── helpers ───────────────────────────────────────────────────

async function sumEnergyToday(
    repo: EnergyRepository,
    devices: readonly AbstractDevice[]
): Promise<number> {
    if (devices.length === 0) return 0;
    try {
        const {internalIds} = await repo.resolveDevices(
            devices.map((d) => d.shellyID)
        );
        if (internalIds.length === 0) return 0;
        // One batched rollup read for the whole fleet instead of a query
        // per device. bucket '1 day' routes to the 15-min rollup; today's
        // total_act_energy is already summed there, in Wh.
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const rows = await repo.queryEnergyStats({
            internalIds,
            from: todayStart,
            to: new Date(),
            tags: ['total_act_energy'],
            bucket: '1 day',
            perDevice: false
        });
        let wh = 0;
        for (const r of rows) wh += toNumber(r.agg_value);
        return wh;
    } catch (err) {
        // Keep the rest of the summary alive; surface the energy gap via a
        // metric + log rather than failing the whole org-wide read.
        Observability.incrementCounter('fleet_summary_energy_failures', 1);
        logger.warn('fleet energy-today rollup read failed', err);
        return 0;
    }
}

function toNumber(v: unknown): number {
    return typeof v === 'number' ? v : Number(v ?? 0);
}

// Solar/PV detection: devices flagged via `pv:` component prefix OR
// a `generation` mode marker on em channels. Returns 0 if none found.
function sumSolarToday(_devices: readonly AbstractDevice[]): number {
    // TODO: surface from explicit PV device metadata + per-channel mode.
    return 0;
}
