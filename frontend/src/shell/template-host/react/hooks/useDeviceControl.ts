import type {FleetCommandOptions} from '../../core/command';
import type {DeviceControlRequest} from '../../core/types';
import {useFleet} from '../FleetProvider';
import {type UseFleetCommandResult, useFleetCommand} from './useFleetCommand';

export type UseDeviceControlOptions<T> = Omit<
    FleetCommandOptions<T>,
    'submit'
> & {
    request(next: T): DeviceControlRequest;
};

/** Physical-command lifecycle over the semantic control surface. */
export function useDeviceControl<T>(
    options: UseDeviceControlOptions<T>
): UseFleetCommandResult<T> {
    const fleet = useFleet();
    return useFleetCommand({
        confirmed: options.confirmed,
        permitted: options.permitted,
        timeoutMs: options.timeoutMs,
        submit: (next) => fleet.controls.submit(options.request(next))
    });
}
