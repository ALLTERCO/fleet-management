// Alert-notification template tokens — mirror of backend TEMPLATE_TOKENS
// (see backend/src/modules/alert/templateRenderer.ts).
//
// Adding a token = update this AND the backend catalogue. Keeping the two
// in sync manually is the price for not introducing a shared package; a
// mismatch surfaces as "missing token" in the preview render output.

export interface TemplateTokenDescriptor {
    /** Dotted path the user writes inside `{{ }}`. */
    token: string;
    /** Human label shown as the completion list's main label. */
    label: string;
    /** Short hint shown as the completion list's detail + tooltip. */
    description: string;
    /** Example value; surfaces in the tooltip so the user knows the shape. */
    example: string;
}

export const TEMPLATE_TOKENS: readonly TemplateTokenDescriptor[] = [
    {
        token: 'alert.title',
        label: 'Alert title',
        description: 'Evaluator-generated summary line.',
        example: 'Battery below 20 % on 34CDB0A1B2C3'
    },
    {
        token: 'alert.message',
        label: 'Alert message',
        description: 'Evaluator-generated message.',
        example: 'Device battery is at 18 %, below the 20 % threshold.'
    },
    {
        token: 'alert.severity',
        label: 'Severity',
        description: "'info', 'warning', or 'critical'.",
        example: 'warning'
    },
    {
        token: 'alert.state',
        label: 'State',
        description: "'active', 'acknowledged', 'resolved'.",
        example: 'active'
    },
    {
        token: 'alert.source.type',
        label: 'Source type',
        description: "'device', 'entity', 'group', 'location', 'tag'.",
        example: 'device'
    },
    {
        token: 'alert.source.id',
        label: 'Source id',
        description: 'Subject id (shelly_id for devices).',
        example: '34CDB0A1B2C3'
    },
    {
        token: 'alert.firedAt',
        label: 'Fired at',
        description: 'ISO 8601 timestamp.',
        example: '2025-04-24T14:30:00.000Z'
    },
    {
        token: 'alert.activeSince',
        label: 'Active since',
        description: 'ISO 8601 of first activation.',
        example: '2025-04-24T14:30:00.000Z'
    },
    {
        token: 'rule.id',
        label: 'Rule id',
        description: 'Numeric rule id.',
        example: '42'
    },
    {
        token: 'rule.name',
        label: 'Rule name',
        description: 'Human-readable rule name.',
        example: 'Battery low on winter stores'
    },
    {
        token: 'rule.kind',
        label: 'Rule kind',
        description: 'Internal rule kind.',
        example: 'battery_below'
    }
] as const;
