import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

export type FleetSensorDomain = ReturnType<typeof createSensorDomain>;

type SensorMethod = Extract<HostMethod, `sensor.${string}`>;

export function createSensorDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<SensorMethod>(access);
    return {
        history(
            params: HostParams<'sensor.query'>
        ): Promise<HostResult<'sensor.query'>> {
            return call('sensor.query', params);
        },
        events(
            params: HostParams<'sensor.events'>
        ): Promise<HostResult<'sensor.events'>> {
            return call('sensor.events', params);
        }
    };
}
