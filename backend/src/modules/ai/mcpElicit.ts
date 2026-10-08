// Builds the server -> client `elicitation/create` request and reads the
// answer back, per the MCP elicitation spec.
//
// The requested schema stays inside the spec's allowed subset: a flat object of
// primitives. Two questions, so the human answers "do it?" and "keep asking?"
// in one prompt instead of two.
//
// Never used to collect sensitive data — the spec forbids that, and everything
// here is a yes/no about an action the human can already see.

import type {ElicitationResult} from './mcpSessions.js';

export interface ElicitationParams {
    message: string;
    requestedSchema: Record<string, unknown>;
}

export interface ElicitationRequest {
    jsonrpc: '2.0';
    id: string;
    method: 'elicitation/create';
    params: ElicitationParams;
}

const REMEMBER_CHOICES = [
    {const: 'always', title: 'Ask every time'},
    {const: 'session', title: 'Stop asking for a while'},
    {const: 'never', title: 'Stop asking, permanently'}
] as const;

// 2025-11-25 replaced the non-standard `enumNames` with a titled `oneOf`.
const TITLED_ENUM_SINCE = '2025-11-25';

// The choice list in the form the client's negotiated revision defines.
function rememberChoices(protocolVersion: string | undefined) {
    if (protocolVersion && protocolVersion >= TITLED_ENUM_SINCE) {
        return {oneOf: REMEMBER_CHOICES.map((choice) => ({...choice}))};
    }
    return {
        enum: REMEMBER_CHOICES.map((choice) => choice.const),
        enumNames: REMEMBER_CHOICES.map((choice) => choice.title)
    };
}

export function buildElicitationRequest(
    requestId: string,
    summary: string,
    options: {allowRemember?: boolean; protocolVersion?: string} = {}
): ElicitationRequest {
    return {
        jsonrpc: '2.0',
        id: requestId,
        method: 'elicitation/create',
        params: buildElicitationParams(summary, options)
    };
}

/** The approval form, the same whichever way the question travels. */
export function buildElicitationParams(
    summary: string,
    options: {allowRemember?: boolean; protocolVersion?: string} = {}
): ElicitationParams {
    const {allowRemember = true, protocolVersion} = options;
    const remember = {
        remember: {
            type: 'string',
            title: 'Ask me again?',
            description:
                'Whether to keep asking for this exact action on this exact target.',
            ...rememberChoices(protocolVersion),
            default: 'always'
        }
    };
    return {
        message: summary,
        requestedSchema: {
            type: 'object',
            properties: {
                approve: {
                    type: 'boolean',
                    title: 'Run this action',
                    description: summary,
                    default: false
                },
                ...(allowRemember ? remember : {})
            },
            required: ['approve']
        }
    };
}

/**
 * How long a "stop asking" answer lasts.
 * - `none`    keep asking every time (the default, and every refusal)
 * - `ttl`     stop asking until the approval expires
 * - `forever` stop asking, until someone revokes the key
 */
export type RememberScope = 'none' | 'ttl' | 'forever';

// Anything short of an explicit accept-with-approve is a refusal: decline,
// cancel, a timeout, or a malformed answer all mean "did not approve". A
// remember choice never survives a refusal.
export function readElicitationAnswer(result: ElicitationResult): {
    approved: boolean;
    remember: RememberScope;
} {
    if (result.action !== 'accept') return {approved: false, remember: 'none'};
    const approved = result.content?.approve === true;
    if (!approved) return {approved: false, remember: 'none'};
    return {approved: true, remember: rememberScope(result.content?.remember)};
}

function rememberScope(value: unknown): RememberScope {
    // `true` is the older boolean shape; keep honouring it as the bounded
    // choice, never as the permanent one.
    if (value === true || value === 'session') return 'ttl';
    if (value === 'never') return 'forever';
    return 'none';
}
