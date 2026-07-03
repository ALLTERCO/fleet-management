import express from 'express';
import {configRc, tuning} from '../../../config';
import type {user_t} from '../../../types';
import type {FleetRole} from '../../../types/api/authzCatalog';
import {
    type GrafanaProxyUser,
    type GrafanaRole,
    proxyGrafanaRequest
} from './grafanaProxyHandler';

const router = express.Router();
const grafanaUrl = configRc.graphs?.grafana?.endpoint;

// Persona → Grafana built-in role. Admin = full read/write/admin in Grafana,
// Editor = create/edit dashboards, Viewer = read-only. Anything not listed
// falls through to Viewer.
const ROLE_MAP: Partial<Record<FleetRole, GrafanaRole>> = {
    admin: 'Admin',
    automation_admin: 'Admin',
    manager: 'Editor',
    editor: 'Editor'
};

function resolveUpstream(reqUrl: string): string {
    const ms = '/grafana';
    if (!reqUrl.startsWith(ms)) return `${grafanaUrl}${reqUrl}`;
    return `${grafanaUrl}${reqUrl.slice(ms.length)}`;
}

export function mapGrafanaRole(user: user_t): GrafanaRole {
    if (user.group === 'admin') return 'Admin';
    for (const role of user.roles ?? []) {
        const mapped = ROLE_MAP[role];
        if (mapped) return mapped;
    }
    return 'Viewer';
}

function toProxyUser(user: user_t | undefined): GrafanaProxyUser | undefined {
    if (!user?.username) return undefined;
    return {
        username: user.username,
        organizationId: user.organizationId,
        role: mapGrafanaRole(user)
    };
}

// router.use matches the bare `/grafana/` root; Express 5 `/*splat` misses it.
router.use(async (req, res) => {
    await proxyGrafanaRequest(req, res, resolveUpstream(req.url), {
        timeoutMs: tuning.grafana.proxyTimeoutMs,
        maxBytes: tuning.grafana.proxyMaxBytes,
        proxySecret: tuning.grafana.proxySecret || undefined,
        user: toProxyUser(req.user)
    });
});

export default router;
