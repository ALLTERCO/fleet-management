// Shared auth helpers for the Notification handlers.
import RpcError from '../../../rpc/RpcError';
import type CommandSender from '../../CommandSender';

export function requireAuthenticatedUser(sender: CommandSender): string {
    const userId = sender.getUserId();
    if (!userId) {
        throw RpcError.Unauthorized();
    }

    return userId;
}

export function auditActor(sender: CommandSender): string | null {
    return sender.getUser()?.username ?? null;
}
