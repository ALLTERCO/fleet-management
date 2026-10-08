// Who "the Node-RED service account" is. Safety rules, audit tags and the
// activity report all key on this one answer.

import type CommandSender from '../../model/CommandSender';
import type {user_t} from '../../types';

export const NODE_RED_SERVICE_USERNAME = 'fleet-nodered';

const SERVICE_GROUP = 'automation_service';

/** The resolved user behind the Node-RED service token. */
export function isNodeRedServiceUser(user: user_t | undefined): boolean {
    return (
        user?.username === NODE_RED_SERVICE_USERNAME &&
        user.group === SERVICE_GROUP
    );
}

/** The same identity, seen after it became a CommandSender. */
export function isNodeRedServiceSender(sender: CommandSender): boolean {
    return (
        sender.getUser()?.username === NODE_RED_SERVICE_USERNAME &&
        sender.getPrincipalType() === 'service_user'
    );
}
