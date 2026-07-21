import type express from 'express';
import {hasMcpAudience} from '../ai/mcpGovernance';

export function mcpAudienceAllowsPath(
    audience: string[] | undefined,
    path: string
): boolean {
    if (!hasMcpAudience(audience)) return true;
    return path === '/mcp' || path.startsWith('/mcp/');
}

export function mcpAudienceGate(): express.RequestHandler {
    return (req, res, next) => {
        if (mcpAudienceAllowsPath(req.user?.credentialAudience, req.path)) {
            next();
            return;
        }
        res.status(403).json({
            error: 'This credential is restricted to the MCP endpoint'
        });
    };
}
