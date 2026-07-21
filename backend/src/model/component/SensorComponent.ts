/**
 * Sensor namespace — cross-device read of discrete device_sensor events
 * (door/window/motion/flood/smoke/button/...). Numeric sensor history stays
 * on Energy.Query (see model/energy/queryHandler.ts) since it already shares
 * that method's bucket/scale/domain shape; this component owns only the
 * append-only events side, which does not fit that shape.
 */

import {resolveDeviceIds} from '../../modules/PostgresProvider';
import {defaultEnergyRepository} from '../../modules/repositories/EnergyRepository';
import {
    defaultSensorRepository,
    type SensorRepository
} from '../../modules/repositories/SensorRepository';
import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    SENSOR_DESCRIBE,
    SENSOR_EVENTS_PARAMS_SCHEMA,
    SENSOR_QUERY_PARAMS_SCHEMA,
    type SensorEventsParams,
    type SensorEventsResponse,
    type SensorQueryParams,
    type SensorQueryResponse
} from '../../types/api/sensor';
import type CommandSender from '../CommandSender';
import {handleSensorEvents} from '../sensor/eventsHandler';
import {handleSensorQuery} from '../sensor/queryHandler';
import Component from './Component';

export default class SensorComponent extends Component {
    /** Overridable for tests — production uses the lazily-constructed default. */
    readonly #repoOverride?: SensorRepository;

    constructor(repoOverride?: SensorRepository) {
        super('sensor', {
            set_config_methods: false,
            auto_apply_config: false
        });
        this.#repoOverride = repoOverride;
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return SENSOR_DESCRIBE;
    }

    @Component.Expose('Query')
    @Component.NoPermissions
    async getQuery(
        params: unknown,
        sender: CommandSender
    ): Promise<SensorQueryResponse> {
        const v = validateOrThrow<SensorQueryParams>(
            params,
            SENSOR_QUERY_PARAMS_SCHEMA
        );
        const sensorRepo =
            this.#repoOverride ?? (await defaultSensorRepository());
        // Scope/permission resolution is shared with Energy.* via resolveScope,
        // which takes the EnergyRepository; the numeric read uses sensorRepo.
        const scopeRepo = await defaultEnergyRepository();
        return handleSensorQuery(v, sender, scopeRepo, sensorRepo);
    }

    @Component.Expose('Events')
    @Component.NoPermissions
    async getEvents(
        params: unknown,
        sender: CommandSender
    ): Promise<SensorEventsResponse> {
        const v = validateOrThrow<SensorEventsParams>(
            params,
            SENSOR_EVENTS_PARAMS_SCHEMA
        );
        const repo = this.#repoOverride ?? (await defaultSensorRepository());
        return handleSensorEvents(v, sender, repo, resolveDeviceIds);
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }
}
