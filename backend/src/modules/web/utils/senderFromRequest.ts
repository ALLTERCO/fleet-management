// Shared CommandSender builder. buildSender is sync; senderFromUser
// also awaits loadV2EffectiveShape for one-shot request handlers.

import {getLogger} from 'log4js';
import type {WebSocket} from 'ws';
import CommandSender from '../../../model/CommandSender';
import RpcError from '../../../rpc/RpcError';
import type {PrincipalType, user_t} from '../../../types';
import {formatError} from '../../util/formatError';

const logger = getLogger('senderFromUser');

// Service accounts (nodered/grafana) carry group 'automation_service'; FM-issued
// PATs carry a credentialId. Both are automations — everything else is a human.
function principalTypeOf(user: user_t): PrincipalType {
    if (user.group === 'automation_service' || user.credentialId) {
        return 'service_user';
    }
    return 'user';
}

export interface SenderFromUserOptions {
    sourceIp?: string;
    socket?: WebSocket;
}

export function buildSender(
    user: user_t,
    options: SenderFromUserOptions = {}
): CommandSender {
    const roles = user.roles ?? (user.group ? [user.group] : []);
    // trusted=true only via CommandSender.INTERNAL / .PLUGIN constructor opts,
    // never inferred from user.group (closes a dev-mode DB-seed foot-gun).
    return new CommandSender({
        permissions: user.permissions ?? [],
        roles,
        username: user.username,
        displayName: user.displayName,
        userId: user.userId,
        organizationId: user.organizationId,
        tenantPinned: user.tenantPinned,
        isPlatformAdmin: user.isPlatformAdmin,
        mfaPresent: user.mfaPresent,
        sourceIp: options.sourceIp,
        socket: options.socket,
        credentialBoundary: user.credentialBoundary,
        v2Shape: user.effectiveShape,
        principalType: principalTypeOf(user)
    });
}

export async function senderFromUser(
    user: user_t,
    options: SenderFromUserOptions = {}
): Promise<CommandSender> {
    const sender = buildSender(user, options);
    // Pre-computed shape (scoped tokens) skips the resolver round-trip.
    if (user.effectiveShape) return sender;
    try {
        await sender.loadV2EffectiveShape();
    } catch (err) {
        if (err instanceof RpcError) throw err;
        // Log stack server-side; never ship it to the client. The wire
        // error carries a generic reason so the transport maps to 503,
        // not 500.
        logger.error(
            'loadV2EffectiveShape failed for user=%s org=%s: %s',
            user.username,
            user.organizationId,
            formatError(err)
        );
        throw RpcError.Unavailable(
            'authz-shape',
            'effective-shape load failed'
        );
    }
    return sender;
}
