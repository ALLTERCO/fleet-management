// Vue binding of the shared physical-command state machine. It returns the
// neutral command store, the same shape useDeviceControl already hands out.

import {getCurrentScope, onScopeDispose} from 'vue';
import {
    createCommand,
    type FleetCommand,
    type FleetCommandOptions
} from '../../core/command';

export function useFleetCommand<T>(
    options: FleetCommandOptions<T>
): FleetCommand<T> {
    const command = createCommand(options);
    // A command holds a timeout, so leaving the scope has to end it.
    if (getCurrentScope()) onScopeDispose(() => command.dispose());
    return command;
}
