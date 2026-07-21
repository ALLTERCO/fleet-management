// Reads a scope tree + device assignments (location/group/tag) for an org.

import {getLogger} from 'log4js';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {ScopeNode} from './energyReportScopeBreakdown';

const logger = getLogger('scopeBreakdownRepo');

export interface ScopeData {
    nodes: ScopeNode[];
    // device external id -> node ids it is assigned to (may be several).
    deviceNodes: Map<string, number[]>;
}

const EMPTY: ScopeData = {nodes: [], deviceNodes: new Map()};

interface ScopeSource {
    label: string;
    // SELECT must yield columns: id, name, parent_id.
    nodeSql: string;
    // SELECT must yield columns: node_id, subject_id. Params: $1 org, $2 ids[].
    assignSql: string;
}

const LOCATION: ScopeSource = {
    label: 'location',
    nodeSql: `SELECT id, name, parent_location_id AS parent_id
              FROM organization.locations WHERE organization_id = $1`,
    assignSql: `SELECT assignment.location_id AS node_id,
                       device.external_id AS subject_id
                  FROM organization.location_assignments assignment
                  JOIN device.list device
                    ON device.organization_id = assignment.organization_id
                   AND device.id = assignment.device_id
                 WHERE assignment.organization_id = $1
                   AND assignment.subject_type = 'device'
                   AND device.external_id = ANY($2)`
};

const GROUP: ScopeSource = {
    label: 'group',
    nodeSql: `SELECT id, name, parent_group_id AS parent_id
              FROM organization.groups WHERE organization_id = $1`,
    assignSql: `SELECT member.group_id AS node_id,
                       device.external_id AS subject_id
                  FROM organization.group_members member
                  JOIN device.list device
                    ON device.organization_id = member.organization_id
                   AND device.id = member.device_id
                 WHERE member.organization_id = $1
                   AND member.subject_type = 'device'
                   AND device.external_id = ANY($2)`
};

// Tags are flat — no parent.
const TAG: ScopeSource = {
    label: 'tag',
    nodeSql: `SELECT id, name, NULL::integer AS parent_id
              FROM organization.tags WHERE organization_id = $1`,
    assignSql: `SELECT assignment.tag_id AS node_id,
                       device.external_id AS subject_id
                  FROM organization.tag_assignments assignment
                  JOIN device.list device
                    ON device.organization_id = assignment.organization_id
                   AND device.id = assignment.device_id
                 WHERE assignment.organization_id = $1
                   AND assignment.subject_type = 'device'
                   AND device.external_id = ANY($2)`
};

// Best-effort: a breakdown lookup must never fail the whole report.
async function fetchScope(
    source: ScopeSource,
    orgId: string,
    externalIds: readonly string[]
): Promise<ScopeData> {
    if (externalIds.length === 0) return EMPTY;
    try {
        const [nodes, assignments] = await Promise.all([
            PostgresProvider.queryRows<{
                id: number;
                name: string;
                parent_id: number | null;
            }>(source.nodeSql, [orgId]),
            PostgresProvider.queryRows<{node_id: number; subject_id: string}>(
                source.assignSql,
                [orgId, [...externalIds]]
            )
        ]);
        const deviceNodes = new Map<string, number[]>();
        for (const a of assignments) {
            const arr = deviceNodes.get(a.subject_id) ?? [];
            arr.push(a.node_id);
            deviceNodes.set(a.subject_id, arr);
        }
        return {
            nodes: nodes.map((n) => ({
                id: n.id,
                name: n.name,
                parentId: n.parent_id
            })),
            deviceNodes
        };
    } catch (err) {
        logger.warn(
            '%s breakdown read failed for org %s (section skipped): %s',
            source.label,
            orgId,
            err instanceof Error ? err.message : String(err)
        );
        return EMPTY;
    }
}

export function fetchLocationScope(
    orgId: string,
    externalIds: readonly string[]
): Promise<ScopeData> {
    return fetchScope(LOCATION, orgId, externalIds);
}

export function fetchGroupScope(
    orgId: string,
    externalIds: readonly string[]
): Promise<ScopeData> {
    return fetchScope(GROUP, orgId, externalIds);
}

export function fetchTagScope(
    orgId: string,
    externalIds: readonly string[]
): Promise<ScopeData> {
    return fetchScope(TAG, orgId, externalIds);
}
