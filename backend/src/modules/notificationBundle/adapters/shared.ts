import {
    NOTIFICATION_BUNDLE_VERSION,
    type NotificationBundle,
    validateNotificationBundle
} from '../schema';

export interface BundleAdapterWarning {
    path: string;
    message: string;
}

export interface BundleAdapterResult {
    bundle: NotificationBundle;
    warnings: BundleAdapterWarning[];
}

export type ChannelType =
    | 'email_smtp'
    | 'generic_webhook'
    | 'slack_webhook'
    | 'teams_workflow_webhook'
    | 'telegram_bot';

export interface ImportedChannel {
    id: string;
    name: string;
    type: ChannelType;
    config: Record<string, unknown>;
}

export interface ImportedRoutingPolicy {
    id: string;
    parentId?: string | null;
    name: string;
    labelMatchers?: Array<Record<string, unknown>>;
    severityMatchers?: string[];
    contactPointIds?: string[];
    groupingKeys?: string[];
}

export function buildBundle(input: {
    channels: ImportedChannel[];
    routingPolicies: ImportedRoutingPolicy[];
}): NotificationBundle {
    return validateNotificationBundle({
        schema: 'fm.notification.bundle',
        version: NOTIFICATION_BUNDLE_VERSION,
        exportedAt: new Date(0).toISOString(),
        channels: input.channels,
        routingPolicies: input.routingPolicies
    });
}

export function safeId(value: string, fallback: string): string {
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
}

export function readObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

export function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function secretWarning(path: string): BundleAdapterWarning {
    return {
        path,
        message: 'secret value omitted; map it explicitly during import'
    };
}
