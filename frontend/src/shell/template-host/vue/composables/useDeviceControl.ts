import {
    createCommand,
    type FleetCommand,
    type FleetCommandOptions
} from '../../core/command';
import type {DeviceControlRequest} from '../../core/types';
import {useFleet} from '../provider';

export type UseDeviceControlOptions<T> = Omit<
    FleetCommandOptions<T>,
    'submit'
> & {
    request(next: T): DeviceControlRequest;
};

/** Vue owns reactivity by subscribing to the returned neutral command store. */
export function useDeviceControl<T>(
    options: UseDeviceControlOptions<T>
): FleetCommand<T> {
    const fleet = useFleet();
    return createCommand({
        confirmed: options.confirmed,
        permitted: options.permitted,
        timeoutMs: options.timeoutMs,
        submit: (next) => fleet.controls.submit(options.request(next))
    });
}
