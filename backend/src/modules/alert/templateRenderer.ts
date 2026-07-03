// Alert notification template renderer — used by both the delivery
// pipeline (AlertEngine) and the Notification.RenderTemplate preview RPC
// so what the UI previews is exactly what gets delivered.
// Output cap via FM_TEMPLATE_MAX_OUTPUT_CHARS prevents runaway templates.

import {envInt} from '../../config/envReader';
import {SAMPLE_CONTEXTS} from './templateContext';

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface TokenDescriptor {
    token: string;
    label: string;
    description: string;
    /** Example value pulled from SAMPLE_CONTEXTS so there's one source. */
    example: string;
}

// A token's example comes from whichever sample kind actually produces it
// (context.* keys are kind-specific), so every advertised token shows a value.
function exampleFor(path: string): string {
    for (const sample of Object.values(SAMPLE_CONTEXTS)) {
        const value = resolvePath(sample, path);
        if (value == null) continue;
        const formatted = formatValue(value, 'none');
        if (formatted.length > 0) return formatted;
    }
    return '';
}

// Curated text for the context.* keys worth explaining. Every other key the
// engine emits still appears (derived below) with a generic note.
const CONTEXT_TOKEN_META: Record<string, {label: string; description: string}> =
    {
        shellyID: {
            label: 'Device shellyID',
            description: 'Gateway shellyID for the device that matched.'
        },
        channel: {
            label: 'Channel',
            description: 'Channel index of the signal.'
        },
        percent: {
            label: 'Percent',
            description: 'Battery/percent reading (battery_below etc).'
        },
        current: {
            label: 'Current reading',
            description: 'Numeric reading that triggered the rule.'
        },
        threshold: {
            label: 'Threshold',
            description: 'Configured threshold the reading crossed.'
        },
        operator: {
            label: 'Operator',
            description: "'gt'|'gte'|'lt'|'lte'|'eq'|'neq' for threshold rules."
        },
        component: {
            label: 'Component',
            description: 'Status component path, e.g. "temperature:0".'
        },
        field: {
            label: 'Field',
            description: 'Field on the component, e.g. "tC".'
        },
        error: {
            label: 'Error',
            description: 'Failure detail (firmware/backup/automation failed).'
        },
        offlineForSec: {
            label: 'Offline for (s)',
            description: 'Seconds offline (device_offline).'
        },
        expectedIntervalSec: {
            label: 'Expected interval (s)',
            description: 'Heartbeat interval that was missed.'
        },
        rate: {label: 'Rate', description: 'Observed rate of change.'},
        deltaValue: {
            label: 'Delta',
            description: 'Change amount over the window.'
        },
        windowSec: {
            label: 'Window (s)',
            description: 'Evaluation window seconds.'
        },
        notChangedForSec: {
            label: 'Unchanged for (s)',
            description: 'Seconds the reading stayed flat (stuck_sensor).'
        },
        mean: {label: 'Mean', description: 'Learned mean (anomaly_band).'},
        stdDev: {
            label: 'Std dev',
            description: 'Learned std deviation (anomaly_band).'
        },
        upperBound: {label: 'Upper bound', description: 'Learned upper band.'},
        lowerBound: {label: 'Lower bound', description: 'Learned lower band.'},
        direction: {
            label: 'Direction',
            description: "'above'/'below' the band."
        },
        previous: {
            label: 'Previous value',
            description: 'Prior value (change_event).'
        },
        componentType: {
            label: 'Component type',
            description: 'Device component type.'
        },
        componentKey: {
            label: 'Component key',
            description: 'Component key, e.g. "em:0".'
        },
        event: {label: 'Event', description: 'Device-pushed event name.'},
        ts: {
            label: 'Event timestamp',
            description: 'Unix seconds of the device event.'
        },
        attrs: {
            label: 'Event attributes',
            description: 'Extra attributes on the event.'
        },
        automationId: {
            label: 'Automation id',
            description: 'Automation that failed.'
        },
        automationName: {
            label: 'Automation name',
            description: 'Automation name.'
        },
        matchedLeafIds: {
            label: 'Matched leaves',
            description: 'Sub-rules that matched.'
        },
        explanation: {
            label: 'Explanation',
            description: 'Why the composite matched.'
        },
        ruleId: {
            label: 'Rule id (context)',
            description: 'Rule id echoed in context.'
        }
    };

// Every context.* key any evaluator emits — derived from the per-kind sample
// payloads (the SSOT) so the palette can never fall behind the engine.
const CONTEXT_KEYS: readonly string[] = [
    ...new Set(
        Object.values(SAMPLE_CONTEXTS).flatMap((ctx) =>
            Object.keys((ctx.context ?? {}) as Record<string, unknown>)
        )
    )
].sort();

const STATIC_TOKENS: ReadonlyArray<readonly [string, string, string]> = [
    ['alert.id', 'Alert id', 'Numeric alert instance id (for links).'],
    ['alert.title', 'Alert title', 'Evaluator-generated summary line.'],
    ['alert.message', 'Alert message', 'Evaluator-generated message.'],
    ['alert.severity', 'Severity', "'info', 'warning', or 'critical'."],
    [
        'alert.state',
        'State',
        "'pending', 'active', 'acknowledged', 'recovering', 'no_data', 'evaluation_error', or 'resolved'."
    ],
    [
        'alert.source.type',
        'Source type',
        "'device', 'component', 'group', 'location', 'tag'."
    ],
    ['alert.source.id', 'Source id', 'Subject id (shelly_id for devices).'],
    ['alert.firedAt', 'Fired at', 'ISO 8601 timestamp.'],
    ['alert.activeSince', 'Active since', 'ISO 8601 of first activation.'],
    ['rule.id', 'Rule id', 'Numeric rule id.'],
    ['rule.name', 'Rule name', 'Human-readable rule name.'],
    ['rule.kind', 'Rule kind', 'Internal rule kind.'],
    [
        'rule.runbookUrl',
        'Runbook URL',
        'Optional URL to the org-authored runbook for this rule.'
    ],
    [
        'display.severityLabel',
        'Severity label',
        'Human-readable severity label for messages.'
    ],
    [
        'display.severityEmoji',
        'Severity emoji',
        'Emoji configured for the alert severity.'
    ],
    [
        'display.severityColor',
        'Severity color',
        'Hex color configured for the alert severity.'
    ],
    ['display.stateLabel', 'State label', 'Human-readable alert state label.'],
    [
        'display.stateEmoji',
        'State emoji',
        'Emoji configured for lifecycle states.'
    ],
    [
        'labels',
        'Labels',
        'Free-form labels resolved from rule.labels_template at fire time.'
    ]
];

/** Token catalog — the UI renders this as an insert-token menu. */
export const TEMPLATE_TOKENS: readonly TokenDescriptor[] = Object.freeze(
    [
        ...STATIC_TOKENS,
        ...CONTEXT_KEYS.map((key): readonly [string, string, string] => [
            `context.${key}`,
            CONTEXT_TOKEN_META[key]?.label ?? key,
            CONTEXT_TOKEN_META[key]?.description ??
                'Evaluator-produced value; present for some rule kinds.'
        ])
    ].map(([token, label, description]) => ({
        token,
        label,
        description,
        example: exampleFor(token)
    }))
);

function resolvePath(
    context: Record<string, unknown>,
    path: string
): unknown | undefined {
    let cursor: unknown = context;
    for (const segment of path.split('.')) {
        if (cursor == null || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
}

/** Escape mode per output context — plain, JSON literal, HTML, or the
 *  two Telegram variants (markdown_v2, telegram_html). */
export type TemplateEscapeMode =
    | 'none'
    | 'json'
    | 'html'
    | 'markdown_v2'
    | 'telegram_html';

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// Telegram HTML reserves only these three in text/attribute context.
function escapeTelegramHtml(value: string): string {
    return value.replace(/[&<>]/g, (c) => HTML_ESCAPES[c] ?? c);
}

// MarkdownV2 reserves 18 chars — backslash-escape each.
const MARKDOWN_V2_RE = /[_*[\]()~`>#+\-=|{}.!\\]/g;
function escapeMarkdownV2(value: string): string {
    return value.replace(MARKDOWN_V2_RE, (c) => `\\${c}`);
}

function formatValue(value: unknown, mode: TemplateEscapeMode): string {
    if (value == null) return '';
    if (typeof value === 'string') {
        // JSON: stringify + strip outer quotes so it fits inside caller's own "...".
        if (mode === 'json') return JSON.stringify(value).slice(1, -1);
        if (mode === 'html') return escapeHtml(value);
        if (mode === 'telegram_html') return escapeTelegramHtml(value);
        if (mode === 'markdown_v2') return escapeMarkdownV2(value);
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}

export interface RenderResult {
    rendered: string;
    missingTokens: string[];
    truncated: boolean;
}

export interface RenderOptions {
    escapeMode?: TemplateEscapeMode;
}

// Conditional block: {{#is_critical}}…{{/is_critical}}. Supported flags:
//   is_critical / is_warning / is_info  — severity
//   is_active / is_acknowledged / is_resolved — state
//   is_recovery — state === 'resolved'
//   is_renotify — re-notification context (passed in via context.isRenotify)
const BLOCK_RE = /\{\{#(is_[a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

function evaluateConditional(
    flag: string,
    context: Record<string, unknown>
): boolean {
    const alert = (context.alert ?? {}) as Record<string, unknown>;
    const severity = String(alert.severity ?? '');
    const state = String(alert.state ?? '');
    switch (flag) {
        case 'is_critical':
            return severity === 'critical';
        case 'is_warning':
            return severity === 'warning';
        case 'is_info':
            return severity === 'info';
        case 'is_active':
            return state === 'active';
        case 'is_acknowledged':
            return state === 'acknowledged';
        case 'is_resolved':
            return state === 'resolved';
        case 'is_recovery':
            return state === 'resolved';
        case 'is_renotify':
            return Boolean(
                (context.context as Record<string, unknown> | undefined)
                    ?.isRenotify
            );
        default:
            return false;
    }
}

function expandConditionalBlocks(
    template: string,
    context: Record<string, unknown>
): string {
    return template.replace(BLOCK_RE, (_match, flag: string, body: string) =>
        evaluateConditional(flag, context) ? body : ''
    );
}

export function renderTemplate(
    template: string,
    context: Record<string, unknown>,
    options: RenderOptions = {}
): RenderResult {
    const mode = options.escapeMode ?? 'none';
    const missing = new Set<string>();
    // Resolve conditional blocks BEFORE token substitution so dropped
    // branches never report their tokens as missing.
    const afterConditionals = expandConditionalBlocks(template, context);
    const rendered = afterConditionals.replace(
        TOKEN_RE,
        (_match, path: string) => {
            const value = resolvePath(context, path);
            if (value === undefined) {
                missing.add(path);
                return '';
            }
            return formatValue(value, mode);
        }
    );

    const cap = envInt('FM_TEMPLATE_MAX_OUTPUT_CHARS', 4000);
    const truncated = rendered.length > cap;
    return {
        rendered: truncated ? rendered.slice(0, cap) : rendered,
        missingTokens: [...missing].sort(),
        truncated
    };
}
