import {validateNotificationBundle} from '../schema';
import {
    type BundleAdapterResult,
    type BundleAdapterWarning,
    buildBundle,
    type ChannelType,
    type ImportedChannel,
    type ImportedRoutingPolicy,
    readArray,
    readObject,
    readString,
    safeId,
    secretWarning
} from './shared';

export interface GrafanaExportResult {
    config: Record<string, unknown>;
    warnings: BundleAdapterWarning[];
}

export function importGrafanaProvisioning(input: unknown): BundleAdapterResult {
    const config = readObject(input);
    const warnings: BundleAdapterWarning[] = [];
    const channels = readArray(config.contactPoints).flatMap((point, index) =>
        importContactPoint(point, `contactPoints[${index}]`, warnings)
    );
    const policies = readArray(
        config.notificationPolicies ?? config.policies
    ).map((policy, index) => importPolicy(policy, index));
    return {
        bundle: buildBundle({channels, routingPolicies: policies}),
        warnings
    };
}

export function exportGrafanaProvisioning(input: unknown): GrafanaExportResult {
    const bundle = validateNotificationBundle(input);
    const warnings: BundleAdapterWarning[] = [];
    return {
        config: {
            contactPoints: readArray(bundle.channels).map((channel, index) =>
                exportContactPoint(channel, `channels[${index}]`, warnings)
            ),
            policies: readArray(bundle.routingPolicies).map((policy, index) =>
                exportPolicy(policy, index)
            )
        },
        warnings
    };
}

function exportContactPoint(
    value: unknown,
    path: string,
    warnings: BundleAdapterWarning[]
): Record<string, unknown> {
    const channel = readObject(value);
    const name = readString(channel.name) ?? readString(channel.id) ?? path;
    const type = readString(channel.type);
    return {
        name,
        receivers: [
            {
                name,
                type: grafanaReceiverType(type, path, warnings),
                settings: grafanaReceiverSettings(channel, path, warnings)
            }
        ]
    };
}

function grafanaReceiverType(
    type: string | null,
    path: string,
    warnings: BundleAdapterWarning[]
): string {
    if (type === 'email_smtp') return 'email';
    if (type === 'slack_webhook') return 'slack';
    if (type === 'generic_webhook') return 'webhook';
    if (type === 'teams_workflow_webhook') return 'teams';
    if (type === 'telegram_bot') return 'telegram';
    warnings.push({
        path,
        message: `unsupported FM channel type: ${String(type)}`
    });
    return 'webhook';
}

function grafanaReceiverSettings(
    channel: Record<string, unknown>,
    path: string,
    warnings: BundleAdapterWarning[]
): Record<string, unknown> {
    const type = readString(channel.type);
    const config = readObject(channel.config);
    if (type === 'email_smtp') {
        return {addresses: readArray(config.toAddresses).join(';')};
    }
    warnings.push(secretWarning(`${path}.config`));
    return {};
}

function exportPolicy(value: unknown, index: number): Record<string, unknown> {
    const policy = readObject(value);
    return {
        name: readString(policy.name) ?? `Policy ${index + 1}`,
        receiver: readString(readArray(policy.contactPointIds)[0]) ?? undefined,
        group_by: readArray(policy.groupingKeys)
    };
}

function importContactPoint(
    value: unknown,
    path: string,
    warnings: BundleAdapterWarning[]
): ImportedChannel[] {
    const point = readObject(value);
    const name = readString(point.name) ?? path;
    return readArray(point.receivers).flatMap((receiver, index) =>
        importReceiver(receiver, name, `${path}.receivers[${index}]`, warnings)
    );
}

function importReceiver(
    value: unknown,
    contactPointName: string,
    path: string,
    warnings: BundleAdapterWarning[]
): ImportedChannel[] {
    const receiver = readObject(value);
    const type = mapGrafanaReceiverType(readString(receiver.type));
    if (!type) {
        warnings.push({
            path,
            message: `unsupported Grafana receiver type: ${String(receiver.type)}`
        });
        return [];
    }
    const settings = readObject(receiver.settings);
    const name = readString(receiver.name) ?? contactPointName;
    const id = safeId(name, path);
    return [
        {
            id,
            name,
            type,
            config: receiverConfig(type, settings, path, warnings)
        }
    ];
}

function mapGrafanaReceiverType(type: string | null): ChannelType | null {
    if (type === 'email') return 'email_smtp';
    if (type === 'slack') return 'slack_webhook';
    if (type === 'webhook') return 'generic_webhook';
    if (type === 'teams') return 'teams_workflow_webhook';
    if (type === 'telegram') return 'telegram_bot';
    return null;
}

function receiverConfig(
    type: ChannelType,
    settings: Record<string, unknown>,
    path: string,
    warnings: BundleAdapterWarning[]
): Record<string, unknown> {
    if (type === 'email_smtp') {
        const addresses = readString(settings.addresses);
        return {
            toAddresses: addresses
                ? addresses
                      .split(/[;,]/)
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                : []
        };
    }
    warnings.push(secretWarning(`${path}.settings`));
    return {};
}

function importPolicy(value: unknown, index: number): ImportedRoutingPolicy {
    const policy = readObject(value);
    const receiver = readString(policy.receiver);
    return {
        id: safeId(
            readString(policy.name) ?? `policy-${index}`,
            `policy-${index}`
        ),
        name: readString(policy.name) ?? `Policy ${index + 1}`,
        contactPointIds: receiver ? [safeId(receiver, receiver)] : [],
        groupingKeys: readArray(policy.group_by).flatMap((entry) =>
            readString(entry) ? [readString(entry) as string] : []
        )
    };
}
