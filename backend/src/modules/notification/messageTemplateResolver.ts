// Loads + caches a rule's message template for the delivery path. Cache is
// invalidated by Template.Update / Template.Delete and bounded with a short
// TTL so a freed template can't pin memory.

import {BoundedMap} from '../boundedMap';
import type {ResolvedMessageTemplate} from '../delivery/types';
import {getMessageTemplate} from './MessageTemplateStore';
import {
    isStandardMessageTemplateId,
    standardResolvedMessageTemplate
} from './standardMessageTemplate';

const cache = new BoundedMap<string, ResolvedMessageTemplate | null>({
    maxSize: 500,
    ttlMs: 60_000
});

const key = (organizationId: string, id: number): string =>
    `${organizationId}:${id}`;

export async function resolveMessageTemplate(
    organizationId: string,
    templateId: number | null
): Promise<ResolvedMessageTemplate | null> {
    if (templateId == null) return null;
    if (isStandardMessageTemplateId(templateId)) {
        return standardResolvedMessageTemplate();
    }
    const k = key(organizationId, templateId);
    const cached = cache.get(k);
    if (cached !== undefined) return cached;
    const template = await getMessageTemplate(organizationId, templateId);
    const resolved: ResolvedMessageTemplate | null = template
        ? {bodies: template.bodies, fallbackText: template.fallbackText}
        : null;
    cache.set(k, resolved);
    return resolved;
}

export function invalidateMessageTemplate(
    organizationId: string,
    templateId: number
): void {
    cache.delete(key(organizationId, templateId));
}
