// Shared helper used by webhook-family adapters that accept a JSON
// template in their endpoint config. Single source of truth for
// rendering + parsing + fallback behavior so every adapter behaves
// identically when the template is malformed.

import {buildDeliveryContext} from '../../alert/templateContext';
import {renderTemplate} from '../../alert/templateRenderer';
import type {DeliveryContext, DeliveryPayload} from '../types';

// The rule template (if any) is rendered once upstream and placed on
// context.templateBody. These let each adapter consume that single rendered
// output instead of re-deriving it from its own config template.

/** Rendered plain-text body for this channel (or the fallback), if any. */
export function templateText(context: DeliveryContext): string | undefined {
    const r = context.templateBody?.rendered;
    return typeof r === 'string' ? r : undefined;
}

/** Rendered structured body (Block Kit / Adaptive Card / email parts), if any. */
export function templateObject(
    context: DeliveryContext
): Record<string, unknown> | unknown[] | undefined {
    const r = context.templateBody?.rendered;
    return r && typeof r === 'object'
        ? (r as Record<string, unknown> | unknown[])
        : undefined;
}

/** Render a JSON template against the payload. A malformed configured template
 *  fails the delivery instead of silently sending the default body. */
export function renderTemplatedBody<T>(
    template: string | null | undefined,
    payload: DeliveryPayload,
    providerLabel: string
): T | undefined {
    if (!template) return undefined;

    const rendered = renderTemplate(template, buildDeliveryContext(payload), {
        escapeMode: 'json'
    });

    try {
        return JSON.parse(rendered.rendered) as T;
    } catch (err) {
        throw new Error(
            `${providerLabel}: custom template is not valid JSON after rendering` +
                `${rendered.missingTokens.length > 0 ? ` (missing tokens: ${rendered.missingTokens.join(',')})` : ''}` +
                `: ${err instanceof Error ? err.message : String(err)}`
        );
    }
}
