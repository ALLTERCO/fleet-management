// React binding of the shared physical-command state machine.

import {useCallback, useRef} from 'react';
import {
    createCommand,
    type FleetCommandOptions,
    type FleetCommandToken
} from '../../core/command';
import type {FleetCommandState} from '../../core/types';
import {useFleetStore} from './useFleetStore';
import {useRetained} from './useRetained';

export type UseFleetCommandResult<T> = FleetCommandState<T> & {
    run(next: T): Promise<FleetCommandToken>;
    confirm(token: FleetCommandToken, observed: T): boolean;
};

export function useFleetCommand<T>(
    options: FleetCommandOptions<T>
): UseFleetCommandResult<T> {
    // Refreshed every render so a rerender that retargets the control commands
    // the current device, not the one captured at mount.
    const submit = useRef(options.submit);
    submit.current = options.submit;
    const send = useCallback((next: T) => submit.current(next), []);

    const command = useRetained(
        () =>
            createCommand({
                confirmed: options.confirmed,
                permitted: options.permitted,
                timeoutMs: options.timeoutMs,
                submit: send
            }),
        [options.confirmed, options.permitted, options.timeoutMs, send]
    );

    const snapshot = useFleetStore(command);
    return {...snapshot, run: command.run, confirm: command.confirm};
}
