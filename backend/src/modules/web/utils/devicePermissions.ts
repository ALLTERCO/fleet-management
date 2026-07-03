import {getLogger} from 'log4js';
import type {WebSocket} from 'ws';
import type CommandSender from '../../../model/CommandSender';
import {
    canPerformComponentOperation,
    isComponentPermissionAllowed
} from '../../../modules/authz/evaluator';
import type {user_t} from '../../../types';
import {ConnectionContext} from '../ws/ConnectionContext';
import {senderFromUser} from './senderFromRequest';

const logger = getLogger('device-permissions');

// Injectable so the fail-closed path is testable without a live sender.
export interface CanExecuteDeps {
    resolveSender: (user: user_t) => Promise<CommandSender>;
}

const defaultDeps: CanExecuteDeps = {resolveSender: senderFromUser};

// V2-only. No admin fast-path — the class-of-user shortcut skipped the
// resolver's org-boundary check and let tenant admins reach cross-tenant
// devices via WS direct relay. A check that errors denies (fail closed): a
// permission check must answer true/false, never throw into a void-fired relay.
export async function canExecuteOnDevice(
    user: user_t,
    shellyID: string,
    socket?: WebSocket,
    deps: CanExecuteDeps = defaultDeps
): Promise<boolean> {
    try {
        const ctx = socket ? ConnectionContext.forSocket(socket) : undefined;
        const sender = ctx ? ctx.sender : await deps.resolveSender(user);
        return isComponentPermissionAllowed(
            canPerformComponentOperation(sender, 'devices', 'execute', shellyID)
        );
    } catch (err) {
        logger.error(
            'permission check failed for %s, denying: %s',
            shellyID,
            err
        );
        return false;
    }
}
