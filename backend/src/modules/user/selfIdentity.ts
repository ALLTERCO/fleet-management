// The caller's own identity for User.GetMe, built from the session sender.

import {getLogger} from 'log4js';
import type CommandSender from '../../model/CommandSender';
import type {
    SelfActorKind,
    SelfCredentialSummary,
    SelfIdentity
} from '../../types/api/user';
import {readOrganizationProfile} from '../organizationModel';
import {formatError} from '../util/formatError';

const logger = getLogger('selfIdentity');

export type OrganizationNameReader = (
    organizationId: string
) => Promise<string | null>;

// Per session: the sender's organization is fixed, and GetMe reruns on every
// permission refresh. A rename shows on the next connection.
const organizationNameBySession = new WeakMap<CommandSender, string | null>();

export async function readOrganizationName(
    organizationId: string
): Promise<string | null> {
    const profile = await readOrganizationProfile(organizationId);
    return profile?.displayName ?? profile?.name ?? null;
}

export async function buildSelfIdentity(
    sender: CommandSender,
    readName: OrganizationNameReader = readOrganizationName
): Promise<SelfIdentity> {
    const user = sender.getUser();
    const email = sender.getEmail();
    return {
        userId: sender.getUserId() ?? null,
        username: user?.username ?? null,
        displayName: user?.displayName ?? null,
        email: email?.address ?? null,
        emailVerified: email?.verified ?? null,
        organizationId: sender.getOrganizationId() ?? null,
        organizationName: await organizationNameFor(sender, readName),
        actorKind: actorKindOf(sender),
        credential: credentialSummaryOf(sender)
    };
}

export function actorKindOf(sender: CommandSender): SelfActorKind {
    if (sender.isTrusted()) return 'system';
    if (sender.getCredentialId()) return 'scoped_key';
    return sender.getPrincipalType() === 'service_user'
        ? 'service_account'
        : 'human';
}

function credentialSummaryOf(
    sender: CommandSender
): SelfCredentialSummary | null {
    const id = sender.getCredentialId();
    if (!id) return null;
    return {
        id,
        audience: [...sender.getCredentialAudience()],
        boundary: sender.getCredentialBoundary() ?? null
    };
}

async function organizationNameFor(
    sender: CommandSender,
    readName: OrganizationNameReader
): Promise<string | null> {
    const organizationId = sender.getOrganizationId();
    if (!organizationId) return null;
    if (organizationNameBySession.has(sender)) {
        return organizationNameBySession.get(sender) ?? null;
    }
    const name = await readNameOrNull(organizationId, readName);
    if (name !== undefined) organizationNameBySession.set(sender, name);
    return name ?? null;
}

// Display-only: identity and permissions must still load when it fails.
async function readNameOrNull(
    organizationId: string,
    readName: OrganizationNameReader
): Promise<string | null | undefined> {
    try {
        return await readName(organizationId);
    } catch (err) {
        logger.warn(
            'organization name unavailable org=%s: %s',
            organizationId,
            formatError(err)
        );
        return undefined;
    }
}
