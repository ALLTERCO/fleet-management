import type express from 'express';
import {mcpCredentialAllowsHttpPath} from '../ai/mcpGovernance';

/**
 * Keeps an MCP-scoped credential on the MCP router. The rule itself lives in
 * mcpGovernance so the WebSocket upgrade enforces the same one — this is only
 * the Express half of it.
 */
export function mcpAudienceGate(): express.RequestHandler {
    return (req, res, next) => {
        if (
            mcpCredentialAllowsHttpPath(req.user?.credentialAudience, req.path)
        ) {
            next();
            return;
        }
        res.status(403).json({
            error: 'This credential is restricted to the MCP endpoint'
        });
    };
}
