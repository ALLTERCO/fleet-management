// Who may open the Node-RED editor. The same adapter the Automation RPCs use,
// so a persona given inside Fleet Manager opens the editor exactly when it
// opens the RPCs.

import {canManageAutomations} from '../../model/component/authzPermissions';
import type {user_t} from '../../types';
import {senderFromUser} from '../web/utils/senderFromRequest';

export async function mayUseNodeRedEditor(
    user: user_t | undefined
): Promise<boolean> {
    if (!user || user.username === '<UNAUTHORIZED>') return false;
    const sender = await senderFromUser(user);
    return canManageAutomations(sender);
}
