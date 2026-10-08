import {createHash} from 'node:crypto';
import type {
    EnergyApplyLogicalMeterMeaningChangeResponse,
    EnergyListLogicalMeterMeaningHistoryResponse,
    EnergyListLogicalMeterMeaningReviewQueueParams,
    EnergyListLogicalMeterMeaningReviewQueueResponse,
    EnergyLogicalMeterMeaning,
    EnergyLogicalMeterMeaningChangeImpact,
    EnergyLogicalMeterMeaningEvidence,
    EnergyMeterRole,
    EnergyPreviewLogicalMeterMeaningChangeParams,
    EnergyPreviewLogicalMeterMeaningChangeResponse,
    EnergyUtilityType
} from '../../types/api/energy';
import {
    type QueryTxClient,
    queryRows,
    withQueryTransaction
} from '../PostgresProvider';

const DEFAULT_PAGE_SIZE = 50;
const IMPACT_ID_LIMIT = 50;

export interface LogicalMeterMeaningPreviewDraft {
    current: EnergyLogicalMeterMeaning;
    proposed: EnergyLogicalMeterMeaning;
    affected: EnergyLogicalMeterMeaningChangeImpact;
    eligible: boolean;
    ineligibilityReasons: EnergyPreviewLogicalMeterMeaningChangeResponse['ineligibilityReasons'];
    impactFingerprint: string;
}

export interface LogicalMeterMeaningImpactSnapshot {
    impact: EnergyLogicalMeterMeaningChangeImpact;
    fingerprint: string;
}

export interface LogicalMeterMeaningRepository {
    listReviewQueue(
        organizationId: string,
        params: EnergyListLogicalMeterMeaningReviewQueueParams,
        accessibleMeterIds: readonly number[]
    ): Promise<EnergyListLogicalMeterMeaningReviewQueueResponse>;
    listHistory(
        organizationId: string,
        meterId: number,
        limit: number,
        beforeRevision?: number
    ): Promise<EnergyListLogicalMeterMeaningHistoryResponse>;
    getAt(
        organizationId: string,
        meterId: number,
        at: string
    ): Promise<EnergyLogicalMeterMeaning | null>;
    impact(
        organizationId: string,
        meterId: number,
        from: string,
        to: string | null
    ): Promise<LogicalMeterMeaningImpactSnapshot>;
    savePreview(
        organizationId: string,
        params: EnergyPreviewLogicalMeterMeaningChangeParams,
        draft: LogicalMeterMeaningPreviewDraft,
        requestedBy: string | null
    ): Promise<EnergyPreviewLogicalMeterMeaningChangeResponse>;
    apply(
        organizationId: string,
        params: {previewId: number; meterId: number; expectedRevision: number},
        affected: LogicalMeterMeaningImpactSnapshot,
        appliedBy: string | null
    ): Promise<EnergyApplyLogicalMeterMeaningChangeResponse>;
    previewImpactWindow(
        organizationId: string,
        previewId: number,
        meterId: number
    ): Promise<{from: string; to: string | null} | null>;
}

export const defaultLogicalMeterMeaningRepository: LogicalMeterMeaningRepository =
    {
        listReviewQueue,
        listHistory,
        getAt,
        impact,
        savePreview,
        apply,
        previewImpactWindow
    };

async function listReviewQueue(
    organizationId: string,
    params: EnergyListLogicalMeterMeaningReviewQueueParams,
    accessibleMeterIds: readonly number[]
): Promise<EnergyListLogicalMeterMeaningReviewQueueResponse> {
    if (accessibleMeterIds.length === 0) {
        return {items: [], nextCursor: null};
    }
    const limit = params.limit ?? DEFAULT_PAGE_SIZE;
    const rows = await queryRows<ReviewQueueRow>(
        `WITH candidates AS (
            SELECT meter.id AS meter_id, meter.name, meter.utility_type,
                   meaning.role, meaning.kind_id, meaning.revision,
                   meaning.effective_from,
                   meter.energy_source,
                   CASE
                     WHEN meter.utility_type = 'electric'
                          AND meter.energy_source IN ('solar', 'battery') THEN 0.9
                     WHEN meter.utility_type = 'electric'
                          AND lower(meter.name) ~ '(solar|pv|battery|bess|grid|main|service)' THEN 0.8
                     WHEN meaning.role <> 'aux' THEN 0.7
                     ELSE 0.25
                   END::double precision AS confidence,
                   COALESCE((
                     SELECT jsonb_agg(DISTINCT point.electrical_domain)
                       FROM fm.logical_meter_point point
                      WHERE point.logical_meter_id = meter.id
                        AND point.electrical_domain IS NOT NULL
                   ), '[]'::jsonb) AS point_domains,
                   COALESCE((
                     SELECT jsonb_agg(DISTINCT point.tag)
                       FROM fm.logical_meter_point point
                      WHERE point.logical_meter_id = meter.id
                   ), '[]'::jsonb) AS point_tags,
                   COALESCE((
                     SELECT jsonb_agg(DISTINCT jsonb_build_object(
                         'from', edge.from_node, 'to', edge.to_node
                     ))
                       FROM fm.meter_connection edge
                      WHERE edge.organization_id = meter.organization_id
                        AND edge.meter_id = meter.id
                   ), '[]'::jsonb) AS topology
              FROM fm.logical_meter meter
              JOIN LATERAL (
                  SELECT history.role, history.kind_id, history.revision,
                         history.effective_from
                    FROM fm.logical_meter_meaning_history history
                   WHERE history.organization_id = meter.organization_id
                     AND history.meter_id = meter.id
                     AND history.effective_from <= now()
                     AND (history.effective_to IS NULL OR history.effective_to > now())
                   ORDER BY history.effective_from DESC
                   LIMIT 1
              ) meaning ON TRUE
             WHERE meter.organization_id = $1
               AND meter.id = ANY($2::bigint[])
               AND (meaning.kind_id IS NULL OR meaning.role = 'aux')
        )
        SELECT * FROM candidates
         WHERE $3::double precision IS NULL
            OR confidence < $3
            OR (confidence = $3 AND meter_id < $4)
         ORDER BY confidence DESC, meter_id DESC
         LIMIT $5`,
        [
            organizationId,
            accessibleMeterIds,
            params.cursor?.confidence ?? null,
            params.cursor?.meterId ?? null,
            limit + 1
        ]
    );
    const page = rows.slice(0, limit).map(mapReviewQueueRow);
    const last = page.at(-1);
    return {
        items: page,
        nextCursor:
            rows.length > limit && last
                ? {
                      confidence: last.suggestion.confidence,
                      meterId: last.meterId
                  }
                : null
    };
}

async function listHistory(
    organizationId: string,
    meterId: number,
    limit: number,
    beforeRevision?: number
): Promise<EnergyListLogicalMeterMeaningHistoryResponse> {
    const rows = await queryRows<MeaningRow>(
        `SELECT meter_id, revision, effective_from, effective_to, role, kind_id
           FROM fm.logical_meter_meaning_history
          WHERE organization_id = $1 AND meter_id = $2
            AND ($3::bigint IS NULL OR revision < $3)
          ORDER BY revision DESC
          LIMIT $4`,
        [organizationId, meterId, beforeRevision ?? null, limit + 1]
    );
    const versions = rows.slice(0, limit).map(mapMeaning);
    return {
        versions,
        nextBeforeRevision:
            rows.length > limit ? (versions.at(-1)?.revision ?? null) : null
    };
}

async function getAt(
    organizationId: string,
    meterId: number,
    at: string
): Promise<EnergyLogicalMeterMeaning | null> {
    const rows = await queryRows<MeaningRow>(
        `SELECT meter_id, revision, effective_from, effective_to, role, kind_id
           FROM fm.logical_meter_meaning_history
          WHERE organization_id = $1 AND meter_id = $2
            AND effective_from <= $3
            AND (effective_to IS NULL OR effective_to > $3)
          ORDER BY effective_from DESC, revision DESC
          LIMIT 1`,
        [organizationId, meterId, at]
    );
    return rows[0] ? mapMeaning(rows[0]) : null;
}

async function impact(
    organizationId: string,
    meterId: number,
    from: string,
    to: string | null
): Promise<LogicalMeterMeaningImpactSnapshot> {
    return withQueryTransaction(async (tx) => {
        await tx.query(
            'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
        );
        return impactWithQuery(
            tx.query.bind(tx),
            organizationId,
            meterId,
            from,
            to
        );
    });
}

async function impactWithQuery(
    query: QueryTxClient['query'],
    organizationId: string,
    meterId: number,
    from: string,
    to: string | null
): Promise<LogicalMeterMeaningImpactSnapshot> {
    const [dashboards, alerts, tariffAssignments] = await Promise.all([
        affectedIds(
            `SELECT item.dashboard AS id
               FROM ui.dashboard_item item
               JOIN fm.logical_meter_point point ON point.device = item.device_id
               JOIN fm.logical_meter meter ON meter.id = point.logical_meter_id
               JOIN ui.dashboard dashboard ON dashboard.id = item.dashboard
              WHERE meter.organization_id = $1 AND meter.id = $2
                AND dashboard.organization_id = $1
             UNION
             SELECT ref.dashboard_id AS id
               FROM ui.dashboard_device_ref ref
               JOIN fm.logical_meter_point point ON point.device = ref.device_id
               JOIN fm.logical_meter meter ON meter.id = point.logical_meter_id
              WHERE meter.organization_id = $1 AND meter.id = $2
                AND (ref.channel IS NULL OR ref.channel = point.channel)
             UNION
             SELECT item.dashboard AS id
               FROM ui.dashboard_item item
               JOIN ui.dashboard dashboard ON dashboard.id = item.dashboard
               JOIN fm.logical_meter meter ON meter.organization_id = dashboard.organization_id
               JOIN fm.logical_meter_point point ON point.logical_meter_id = meter.id
               JOIN device.list device
                 ON device.organization_id = meter.organization_id
                AND device.id = point.device
              WHERE meter.organization_id = $1 AND meter.id = $2
                AND (
                    (item.group_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM organization.group_members membership
                         WHERE membership.organization_id = meter.organization_id
                           AND membership.group_id = item.group_id
                           AND membership.subject_type = 'device'
                           AND membership.subject_id = device.external_id
                    ))
                    OR (item.location_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM organization.location_assignments assignment
                         WHERE assignment.organization_id = meter.organization_id
                           AND assignment.location_id = item.location_id
                           AND assignment.subject_type = 'device'
                           AND assignment.subject_id = device.external_id
                    ))
                    OR (item.tag_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM organization.tag_assignments assignment
                         WHERE assignment.organization_id = meter.organization_id
                           AND assignment.tag_id = item.tag_id
                           AND assignment.subject_type = 'device'
                           AND assignment.subject_id = device.external_id
                    ))
                )`,
            organizationId,
            meterId,
            query
        ),
        affectedIds(
            `SELECT DISTINCT scope.rule_id AS id
               FROM notifications.alert_rule_device_scope scope
               JOIN fm.logical_meter_point point ON point.device = scope.device_id
               JOIN fm.logical_meter meter ON meter.id = point.logical_meter_id
              WHERE meter.organization_id = $1 AND meter.id = $2
             UNION
             SELECT DISTINCT scope.rule_id AS id
               FROM notifications.alert_rule_entity_scope scope
               JOIN fm.logical_meter_point point ON point.device = scope.device_id
               JOIN fm.logical_meter meter ON meter.id = point.logical_meter_id
              WHERE scope.organization_id = $1
                AND meter.organization_id = $1 AND meter.id = $2`,
            organizationId,
            meterId,
            query
        ),
        affectedIds(
            `SELECT DISTINCT assignment.id
               FROM organization.tariff_assignment assignment
               JOIN fm.logical_meter meter
                 ON meter.organization_id = assignment.organization_id
               LEFT JOIN fm.logical_meter_point point
                 ON point.logical_meter_id = meter.id
              WHERE meter.organization_id = $1 AND meter.id = $2
                AND (
                    assignment.scope_level = 'organization'
                    OR (assignment.scope_level = 'location'
                        AND assignment.location_id = meter.location_id)
                    OR (assignment.scope_level = 'device'
                        AND assignment.device_id = point.device)
                    OR (assignment.scope_level = 'channel'
                        AND assignment.device_id = point.device
                        AND assignment.channel = point.channel)
                    OR (assignment.scope_level = 'dashboard' AND EXISTS (
                        SELECT 1 FROM ui.dashboard_device_ref ref
                         WHERE ref.dashboard_id = assignment.dashboard_id
                           AND ref.organization_id = meter.organization_id
                           AND ref.device_id = point.device
                           AND (ref.channel IS NULL OR ref.channel = point.channel)
                        UNION ALL
                        SELECT 1 FROM ui.dashboard_item item
                          JOIN ui.dashboard dashboard
                            ON dashboard.id = item.dashboard
                         WHERE item.dashboard = assignment.dashboard_id
                           AND dashboard.organization_id = meter.organization_id
                           AND (
                               item.device_id = point.device
                               OR EXISTS (
                                   SELECT 1 FROM device.list device
                                    WHERE device.organization_id = meter.organization_id
                                      AND device.id = point.device
                                      AND (
                                          (item.group_id IS NOT NULL AND EXISTS (
                                              SELECT 1 FROM organization.group_members membership
                                               WHERE membership.organization_id = meter.organization_id
                                                 AND membership.group_id = item.group_id
                                                 AND membership.subject_type = 'device'
                                                 AND membership.subject_id = device.external_id
                                          ))
                                          OR (item.location_id IS NOT NULL AND EXISTS (
                                              SELECT 1 FROM organization.location_assignments location_assignment
                                               WHERE location_assignment.organization_id = meter.organization_id
                                                 AND location_assignment.location_id = item.location_id
                                                 AND location_assignment.subject_type = 'device'
                                                 AND location_assignment.subject_id = device.external_id
                                          ))
                                          OR (item.tag_id IS NOT NULL AND EXISTS (
                                              SELECT 1 FROM organization.tag_assignments tag_assignment
                                               WHERE tag_assignment.organization_id = meter.organization_id
                                                 AND tag_assignment.tag_id = item.tag_id
                                                 AND tag_assignment.subject_type = 'device'
                                                 AND tag_assignment.subject_id = device.external_id
                                          ))
                                      )
                               )
                           )
                    ))
                )`,
            organizationId,
            meterId,
            query
        )
    ]);
    const impact = {
        dashboards: dashboards.affected,
        alerts: alerts.affected,
        tariffAssignments: tariffAssignments.affected,
        reportInterpretation: {from, to}
    };
    return {
        impact,
        fingerprint: impactSetFingerprint({
            dashboards: dashboards.setFingerprint,
            alerts: alerts.setFingerprint,
            tariffAssignments: tariffAssignments.setFingerprint,
            reportInterpretation: impact.reportInterpretation
        })
    };
}

async function affectedIds(
    sql: string,
    organizationId: string,
    meterId: number,
    query: QueryTxClient['query'] = queryRows
): Promise<{
    affected: {count: number; ids: number[]; truncated: boolean};
    setFingerprint: string;
}> {
    const rows = await query<{
        id: number | string | null;
        total_count: number | string;
        set_fingerprint: string;
    }>(
        `WITH affected AS MATERIALIZED (${sql}),
              summary AS (
                  SELECT count(*) AS total_count,
                         encode(sha256(convert_to(
                             COALESCE(string_agg(id::text, ',' ORDER BY id), ''),
                             'UTF8'
                         )), 'hex') AS set_fingerprint
                    FROM affected
              ),
              page AS (
                  SELECT id FROM affected ORDER BY id LIMIT $3
              )
         SELECT page.id, summary.total_count, summary.set_fingerprint
           FROM summary LEFT JOIN page ON TRUE
          ORDER BY page.id`,
        [organizationId, meterId, IMPACT_ID_LIMIT + 1]
    );
    const ids = rows
        .filter((row) => row.id != null)
        .slice(0, IMPACT_ID_LIMIT)
        .map((row) => Number(row.id));
    const count = Number(rows[0]?.total_count ?? 0);
    return {
        affected: {count, ids, truncated: count > ids.length},
        setFingerprint: rows[0]?.set_fingerprint ?? emptySetFingerprint()
    };
}

async function savePreview(
    organizationId: string,
    params: EnergyPreviewLogicalMeterMeaningChangeParams,
    draft: LogicalMeterMeaningPreviewDraft,
    requestedBy: string | null
): Promise<EnergyPreviewLogicalMeterMeaningChangeResponse> {
    const rows = await queryRows<{id: number}>(
        `INSERT INTO fm.logical_meter_meaning_review (
            organization_id, meter_id, expected_revision, effective_from,
            proposed_role, proposed_kind_id, source_reference,
            current_meaning, impact_snapshot, impact_fingerprint,
            eligible, ineligibility_reasons, requested_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13)
        RETURNING id`,
        [
            organizationId,
            params.meterId,
            params.expectedRevision,
            params.effectiveFrom,
            params.role,
            params.kindId,
            params.sourceReference,
            JSON.stringify(draft.current),
            JSON.stringify(draft.affected),
            draft.impactFingerprint,
            draft.eligible,
            JSON.stringify(draft.ineligibilityReasons),
            requestedBy
        ]
    );
    const previewId = Number(rows[0]?.id);
    if (!Number.isSafeInteger(previewId)) {
        throw new Error('logical-meter meaning preview insert returned no id');
    }
    const {impactFingerprint: _impactFingerprint, ...responseDraft} = draft;
    return {previewId, ...responseDraft};
}

async function apply(
    organizationId: string,
    params: {previewId: number; meterId: number; expectedRevision: number},
    affected: LogicalMeterMeaningImpactSnapshot,
    appliedBy: string | null
): Promise<EnergyApplyLogicalMeterMeaningChangeResponse> {
    return withQueryTransaction(async (tx) => {
        await tx.query(
            `LOCK TABLE fm.logical_meter, fm.logical_meter_point, device.list,
                        ui.dashboard, ui.dashboard_item, ui.dashboard_device_ref,
                        organization.group_members, organization.location_assignments,
                        organization.tag_assignments,
                        notifications.alert_rule_device_scope,
                        notifications.alert_rule_entity_scope,
                        organization.tariff_assignment
                 IN SHARE MODE`
        );
        const windowRows = await tx.query<{
            effective_from: unknown;
            impact_snapshot: unknown;
        }>(
            `SELECT effective_from, impact_snapshot
               FROM fm.logical_meter_meaning_review
              WHERE id = $1 AND organization_id = $2 AND meter_id = $3
              FOR UPDATE`,
            [params.previewId, organizationId, params.meterId]
        );
        const windowRow = windowRows[0];
        if (!windowRow)
            throw new Error('logical-meter meaning preview not found');
        const snapshot = windowRow.impact_snapshot as {
            reportInterpretation?: {to?: string | null};
        };
        const currentImpact = await impactWithQuery(
            tx.query.bind(tx),
            organizationId,
            params.meterId,
            utcString(windowRow.effective_from),
            snapshot.reportInterpretation?.to ?? null
        );
        if (currentImpact.fingerprint !== affected.fingerprint) {
            throw new Error(
                'logical-meter meaning impact changed; preview again'
            );
        }
        const rows = await tx.query<Record<string, unknown>>(
            `SELECT * FROM fm.fn_apply_logical_meter_meaning_review(
                $1::varchar, $2::bigint, $3::bigint, $4::bigint, $5::text, $6::varchar
            )`,
            [
                organizationId,
                params.previewId,
                params.meterId,
                params.expectedRevision,
                currentImpact.fingerprint,
                appliedBy
            ]
        );
        const row = rows[0];
        if (!row)
            throw new Error('logical-meter meaning apply returned no row');
        return {
            previewId: Number(row.preview_id),
            status: 'applied',
            meterId: Number(row.meter_id),
            revision: Number(row.revision),
            effectiveFrom: utcString(row.effective_from),
            appliedAt: utcString(row.applied_at)
        };
    });
}

async function previewImpactWindow(
    organizationId: string,
    previewId: number,
    meterId: number
): Promise<{from: string; to: string | null} | null> {
    const rows = await queryRows<{
        effective_from: unknown;
        impact_snapshot: unknown;
    }>(
        `SELECT effective_from, impact_snapshot
           FROM fm.logical_meter_meaning_review
          WHERE id = $1 AND organization_id = $2 AND meter_id = $3`,
        [previewId, organizationId, meterId]
    );
    const row = rows[0];
    if (!row) return null;
    const snapshot = row.impact_snapshot as {
        reportInterpretation?: {to?: string | null};
    };
    return {
        from: utcString(row.effective_from),
        to: snapshot.reportInterpretation?.to ?? null
    };
}

interface MeaningRow {
    meter_id: number | string;
    revision: number | string;
    effective_from: unknown;
    effective_to: unknown;
    role: EnergyMeterRole;
    kind_id: string | null;
}

interface ReviewQueueRow extends MeaningRow {
    name: string;
    utility_type: EnergyUtilityType;
    energy_source: string | null;
    confidence: number | string;
    point_domains: unknown;
    point_tags: unknown;
    topology: unknown;
}

function mapMeaning(row: MeaningRow): EnergyLogicalMeterMeaning {
    return {
        meterId: Number(row.meter_id),
        revision: Number(row.revision),
        effectiveFrom: nullableUtcString(row.effective_from),
        effectiveTo: nullableUtcString(row.effective_to),
        role: row.role,
        kindId: row.kind_id ?? null
    };
}

function mapReviewQueueRow(
    row: ReviewQueueRow
): EnergyListLogicalMeterMeaningReviewQueueResponse['items'][number] {
    const suggestedRole = roleSuggestion(row);
    const evidence = meaningEvidence(row, suggestedRole);
    return {
        meterId: Number(row.meter_id),
        name: row.name,
        utilityType: row.utility_type,
        current: mapMeaning(row),
        suggestion: {
            role: suggestedRole,
            kindId: row.kind_id ?? null,
            confidence: Number(row.confidence),
            evidence,
            reasonCodes: meaningReasonCodes(row, evidence)
        }
    };
}

function roleSuggestion(row: ReviewQueueRow): EnergyMeterRole {
    if (row.utility_type !== 'electric') return row.role;
    if (row.energy_source === 'solar') return 'pv';
    if (row.energy_source === 'battery') return 'battery';
    const name = row.name.toLowerCase();
    if (/\b(solar|pv)\b/.test(name)) return 'pv';
    if (/\b(battery|bess)\b/.test(name)) return 'battery';
    if (/\b(grid|main|service)\b/.test(name)) return 'grid';
    if (/\b(ev|charger|charging)\b/.test(name)) return 'ev_charge';
    return row.role;
}

function meaningEvidence(
    row: ReviewQueueRow,
    suggestedRole: EnergyMeterRole
): EnergyLogicalMeterMeaningEvidence[] {
    const evidence: EnergyLogicalMeterMeaningEvidence[] = [
        {code: 'declared_role', detail: row.role}
    ];
    if (row.kind_id == null) {
        evidence.push({code: 'missing_end_use', detail: 'kindId is not set'});
    }
    if (row.role === 'aux') {
        evidence.push({code: 'generic_aux_role', detail: 'role is aux'});
    }
    if (row.energy_source) {
        evidence.push({code: 'energy_source', detail: row.energy_source});
    }
    for (const domain of stringArray(row.point_domains).slice(0, 3)) {
        evidence.push({code: 'point_domain', detail: domain});
    }
    for (const tag of stringArray(row.point_tags).slice(0, 3)) {
        evidence.push({code: 'point_tag', detail: tag});
    }
    if (arrayValue(row.topology).length > 0) {
        evidence.push({
            code: 'topology_connection',
            detail: `${arrayValue(row.topology).length} connection(s)`
        });
    }
    if (suggestedRole !== row.role) {
        evidence.push({code: 'name_keyword', detail: row.name});
    }
    return evidence.slice(0, 12);
}

function meaningReasonCodes(
    row: ReviewQueueRow,
    evidence: readonly EnergyLogicalMeterMeaningEvidence[]
): EnergyListLogicalMeterMeaningReviewQueueResponse['items'][number]['suggestion']['reasonCodes'] {
    const reasons: EnergyListLogicalMeterMeaningReviewQueueResponse['items'][number]['suggestion']['reasonCodes'] =
        [];
    if (row.kind_id == null) reasons.push('end_use_unclassified');
    if (row.role === 'aux') reasons.push('role_requires_review');
    if (evidence.some((item) => item.code === 'topology_connection')) {
        reasons.push('role_supported_by_topology');
    }
    if (row.energy_source) reasons.push('role_supported_by_source');
    if (evidence.some((item) => item.code === 'point_domain')) {
        reasons.push('role_supported_by_measurement');
    }
    if (evidence.some((item) => item.code === 'name_keyword')) {
        reasons.push('weak_name_only_evidence');
    }
    return reasons;
}

function impactSetFingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function emptySetFingerprint(): string {
    return createHash('sha256').update('').digest('hex');
}

function nullableUtcString(value: unknown): string | null {
    if (value == null || String(value) === '-infinity') return null;
    return utcString(value);
}

function utcString(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) {
        throw new Error('logical-meter meaning timestamp is invalid');
    }
    return date.toISOString();
}

function arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
    return arrayValue(value).filter(
        (item): item is string => typeof item === 'string'
    );
}
