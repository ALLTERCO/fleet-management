import {McpError} from './mcpErrors';
import {findCatalogEntry} from './mcpPolicy';

interface Workflow {
    id: string;
    description: string;
    methods: string[];
    steps: string[];
    limits: string[];
}

const WORKFLOWS: readonly Workflow[] = [
    {
        id: 'operation_discovery',
        description: 'Find exact operations and their permission requirements.',
        methods: [],
        steps: [
            'Use list_operation_coverage to find HTTP, integration and event equivalents or external interfaces; follow nextCursor.',
            'Use list_methods with namespace and follow nextCursor.',
            'Use get_api_method before calling fm_read or fm_write.',
            'Use fm_capabilities to inspect MCP level and role restrictions.'
        ],
        limits: [
            'Catalog entries describe APIs; they do not prove runtime availability or caller authorization.'
        ]
    },
    {
        id: 'node_red_graph',
        description:
            'Author and deploy a complete Node-RED graph with revision checks.',
        methods: [
            'automation.Graph.Get',
            'automation.Graph.ReadPage',
            'automation.Graph.Validate',
            'automation.Graph.Create',
            'automation.Graph.Update',
            'automation.Graph.Delete'
        ],
        steps: [
            'Read the graph and revision. For large graphs page Graph.ReadPage with expectedRevision and advance offset by the actual returned item count.',
            'Preserve all configuration and subflow references when reconstructing the complete graph.',
            'Validate installed node types and wiring, then create or update with complete:true and expectedRevision.',
            'Read back the deployed graph; exercise its intended trigger and observe the target separately.'
        ],
        limits: [
            'Arbitrary graphs require tenant-wide automation authority.',
            'A revision conflict requires a fresh read and reconciliation.',
            'Structural and installed-type validation cannot prove arbitrary node code behavior.'
        ]
    },
    {
        id: 'visual_assets',
        description: 'Upload, read, label and delete visual assets.',
        methods: [
            'asset.Upload',
            'asset.List',
            'asset.ReadChunk',
            'asset.SetLabel',
            'asset.Delete'
        ],
        steps: [
            'Upload a bounded base64 asset with its content type.',
            'Read chunks using the returned asset identity and verify checksum and total size.',
            'Use SetLabel to edit metadata and Delete when the asset is no longer referenced.'
        ],
        limits: [
            'Existing MIME, size and organization ownership rules apply.',
            'Referenced assets cannot be deleted.'
        ]
    },
    {
        id: 'file_transfer',
        description:
            'Transfer supported Fleet files through owner-bound upload sessions.',
        methods: [
            'fileTransfer.Begin',
            'fileTransfer.Get',
            'fileTransfer.WriteChunk',
            'fileTransfer.Finalize',
            'fileTransfer.Cancel',
            'fileTransfer.ReadChunk'
        ],
        steps: [
            'Read the exact Begin schema and select a supported upload kind and target.',
            'Begin the upload with its declared size and SHA-256.',
            'Write bounded chunks at the expected offset; use Get after a lost response to recover the current offset.',
            'Finalize once with an idempotencyKey and poll fm_get_operation.',
            'Use ReadChunk with supported kind and artifactId values; temporary firmware uses kind firmware_temporary and the artifactId returned by Finalize.',
            'Cancel open sessions when no longer needed. Expired staging files are cleaned automatically without new upload traffic.'
        ],
        limits: [
            'No arbitrary filesystem path or external URL is accepted.',
            'Firmware uploads require platform authority. Temporary downloads require device update permission and the initiating upload owner; they expire at the returned expiresAt.',
            'Workers must share upload storage and Redis for restart and cross-worker recovery.',
            'An uncertain finalize outcome must be reconciled with fm_reconcile_operation before attempting another upload.'
        ]
    },
    {
        id: 'durable_mutation',
        description:
            'Recover the recorded outcome of a write without executing it twice.',
        methods: [],
        steps: [
            'Supply an idempotencyKey to fm_write; confirm the prepared write when requested.',
            'Keep the returned operationId and poll fm_get_operation using the initiating credential.',
            'After a disconnect, reuse the same method, parameters and key to retrieve the same receipt.',
            'Call fm_reconcile_operation to inspect authoritative Backup/Firmware job or fileTransfer.Finalize state.',
            'Only use returned resume or cancel actions through fm_write; normal authorization and confirmation still apply.'
        ],
        limits: [
            'Credential issuance cannot use persisted receipts.',
            'Completed receipts expire after 24 hours; unknown outcomes keep their keys.',
            'executor_lost means the process lost its lease, not that the external action failed.',
            'A succeeded receipt means the RPC returned; a domain job may still need its own status polling.',
            'Use Job.Capabilities to discover safe cancellation and resume for backup and firmware jobs. Cancel stops undispatched work; dispatched effects can continue. Resume never replays an unresolved effect. Firmware URL requests have no persisted MCP recovery adapter.',
            'Open uploads may be resumed or cancelled only when the original operation is inactive. Claimed or uncertain finalization cannot be safely replayed.',
            'Operations without an adapter remain explicitly unsupported for target reconciliation.'
        ]
    },
    {
        id: 'event_history',
        description:
            'Read retained job and observed device events and subscribe to resource updates.',
        methods: [],
        steps: [
            'Read the fm://events resource, optionally filtered with deviceId or jobId.',
            'Follow nextUri to page; retain the signed cursor for later polling.',
            'Subscribe to the same resource URI and open the authenticated MCP GET stream for change notifications.',
            'Read the resource after a notification; reconnect using the same session and transport Last-Event-ID.'
        ],
        limits: [
            'Every read and delivery checks current permissions. Cursors belong to one tenant, user, credential and filter.',
            'historyGap means retained history is incomplete. Notifications can be duplicated and do not contain event payloads.',
            'Only captured job and device event types are retained. Device observations are best effort; job updates are journaled in the database transaction.',
            'Resource notifications do not guarantee an AI host wakes a model or runs an automation.'
        ]
    }
];

export function listWorkflows(input: Record<string, unknown> = {}) {
    if (
        Object.keys(input).some((key) => key !== 'query') ||
        (input.query !== undefined && typeof input.query !== 'string')
    ) {
        throw new McpError('invalid_params', 'query must be a string');
    }
    const query = String(input.query ?? '')
        .trim()
        .toLowerCase();
    const items = WORKFLOWS.filter(
        (workflow) =>
            !query ||
            `${workflow.id} ${workflow.description} ${workflow.methods.join(' ')}`
                .toLowerCase()
                .includes(query)
    ).map((workflow) => ({
        ...workflow,
        methods: workflow.methods.map((method) => {
            const entry = findCatalogEntry(method);
            return {
                method,
                catalogued: !!entry,
                readOnly: entry?.safety.readOnlyHint ?? null
            };
        }),
        runtimeAvailability: 'checked_on_execution'
    }));
    return {items, total: items.length};
}
