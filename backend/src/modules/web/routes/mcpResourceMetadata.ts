// OAuth protected resource metadata for /mcp (RFC 9728). It tells an MCP
// client which authorization server issues tokens for this server, so it is
// public on purpose and served before every auth gate.

import express from 'express';
import {isZitadelConfigured, tuning} from '../../../config';
import {
    fmPublicBaseUrl,
    mcpOAuthClientLevels,
    oidcScopes,
    zitadelPublicIssuerUrl
} from '../../../config/zitadel';
import {MCP_MOUNT_PATH} from '../../ai/mcpGovernance';
import {httpRouteLimit} from '../rateLimit';

export const OAUTH_PROTECTED_RESOURCE_PATH =
    '/.well-known/oauth-protected-resource';

const METADATA_MAX_AGE_SECONDS = 300;

export interface McpProtectedResource {
    resource: string;
    metadataUrl: string;
    authorizationServer: string;
    scopes: string[];
}

/**
 * This server as an OAuth protected resource, or undefined while browser
 * login is off. The identifier comes from configuration, never the Host
 * header, so a request cannot choose the audience it is told about.
 */
export function mcpProtectedResource(): McpProtectedResource | undefined {
    const baseUrl = fmPublicBaseUrl();
    const issuer = zitadelPublicIssuerUrl();
    // offline_access is left to the client, which adds it when it wants refresh.
    const scopes = oidcScopes().filter((scope) => scope !== 'offline_access');
    if (!isZitadelConfigured() || !baseUrl || !issuer) return undefined;
    if (scopes.length === 0 || mcpOAuthClientLevels().size === 0) {
        return undefined;
    }
    return {
        resource: `${baseUrl}${MCP_MOUNT_PATH}`,
        metadataUrl: `${baseUrl}${OAUTH_PROTECTED_RESOURCE_PATH}${MCP_MOUNT_PATH}`,
        authorizationServer: issuer,
        scopes
    };
}

function serveMetadata(_req: express.Request, res: express.Response): void {
    const described = mcpProtectedResource();
    if (!described) {
        res.status(404).json({error: 'not_found'});
        return;
    }
    res.set('Cache-Control', `max-age=${METADATA_MAX_AGE_SECONDS}`).json({
        resource: described.resource,
        authorization_servers: [described.authorizationServer],
        scopes_supported: described.scopes,
        bearer_methods_supported: ['header']
    });
}

const router = express.Router();

router.get(
    [
        OAUTH_PROTECTED_RESOURCE_PATH,
        `${OAUTH_PROTECTED_RESOURCE_PATH}${MCP_MOUNT_PATH}`
    ],
    httpRouteLimit({
        name: 'oauth-protected-resource',
        // Clients fetch this once per connect and cache it; the docs bucket fits.
        capacityPerMin: tuning.http.rateLimitApiDocsPerMin
    }),
    serveMetadata
);

export default router;
