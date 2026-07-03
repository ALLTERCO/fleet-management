import {validateNotificationBundle} from '../schema';
import {
    type BundleAdapterResult,
    type BundleAdapterWarning,
    buildBundle,
    type ImportedChannel,
    type ImportedRoutingPolicy,
    readArray,
    readObject,
    readString,
    safeId,
    secretWarning
} from './shared';

export interface AlertmanagerExportResult {
    config: Record<string, unknown>;
    warnings: BundleAdapterWarning[];
}

export function importAlertmanagerConfig(input: unknown): BundleAdapterResult {
    const config = readObject(input);
    const warnings: BundleAdapterWarning[] = [];
    const channels = readArray(config.receivers).flatMap((receiver, index) =>
        importReceiver(receiver, `receivers[${index}]`, warnings)
    );
    const routingPolicies = importRouteTree(config.route, warnings);
    return {
        bundle: buildBundle({channels, routingPolicies}),
        warnings
    };
}

export function exportAlertmanagerConfig(
    input: unknown
): AlertmanagerExportResult {
    const bundle = validateNotificationBundle(input);
    const warnings: BundleAdapterWarning[] = [];
    const receivers = readArray(bundle.channels).map((channel, index) =>
        exportReceiver(channel, `channels[${index}]`, warnings)
    );
    const route = exportRouteTree(bundle, warnings);
    return {config: {route, receivers}, warnings};
}

function exportReceiver(
    value: unknown,
    path: string,
    warnings: BundleAdapterWarning[]
): Record<string, unknown> {
    const channel = readObject(value);
    const name = readString(channel.name) ?? readString(channel.id) ?? path;
    const type = readString(channel.type);
    const config = readObject(channel.config);
    if (type === 'email_smtp') {
        return {
            name,
            email_configs: [{to: readArray(config.toAddresses).join(',')}]
        };
    }
    warnings.push(secretWarning(`${path}.config`));
    if (type === 'slack_webhook') return {name, slack_configs: [{}]};
    if (type === 'generic_webhook') return {name, webhook_configs: [{}]};
    warnings.push({
        path,
        message: `Alertmanager export has no native receiver for ${String(type)}`
    });
    return {name};
}

function exportRouteTree(
    bundle: {routingPolicies?: unknown[]},
    _warnings: BundleAdapterWarning[]
): Record<string, unknown> {
    const policies = readArray(bundle.routingPolicies);
    const root = readObject(policies[0]);
    const receiverId = readArray(root.contactPointIds)[0];
    return {
        receiver: readString(receiverId) ?? 'default',
        group_by: readArray(root.groupingKeys).flatMap((entry) =>
            readString(entry) ? [readString(entry) as string] : []
        ),
        matchers: readArray(root.labelMatchers).map((matcher) =>
            JSON.stringify(matcher)
        )
    };
}

function importReceiver(
    value: unknown,
    path: string,
    warnings: BundleAdapterWarning[]
): ImportedChannel[] {
    const receiver = readObject(value);
    const name = readString(receiver.name) ?? path;
    const id = safeId(name, `receiver-${path}`);
    return [
        ...readArray(receiver.email_configs).map((config, index) =>
            emailChannel(id, name, config, `${path}.email_configs[${index}]`)
        ),
        ...readArray(receiver.slack_configs).map((_config, index) => {
            warnings.push(
                secretWarning(`${path}.slack_configs[${index}].api_url`)
            );
            return channel(id, name, 'slack_webhook', {});
        }),
        ...readArray(receiver.webhook_configs).map((_config, index) => {
            warnings.push(
                secretWarning(`${path}.webhook_configs[${index}].url`)
            );
            return channel(id, name, 'generic_webhook', {});
        })
    ];
}

function emailChannel(
    id: string,
    name: string,
    value: unknown,
    _path: string
): ImportedChannel {
    const config = readObject(value);
    const to = readString(config.to);
    if (!to) {
        return channel(id, name, 'email_smtp', {toAddresses: []});
    }
    return channel(id, name, 'email_smtp', {toAddresses: [to]});
}

function channel(
    id: string,
    name: string,
    type: ImportedChannel['type'],
    config: Record<string, unknown>
): ImportedChannel {
    return {id, name, type, config};
}

function importRouteTree(
    route: unknown,
    warnings: BundleAdapterWarning[],
    parentId: string | null = null,
    indexPath = 'route'
): ImportedRoutingPolicy[] {
    const node = readObject(route);
    if (Object.keys(node).length === 0) return [];
    const id = safeId(indexPath, 'route');
    const receiver = readString(node.receiver);
    const policy: ImportedRoutingPolicy = {
        id,
        parentId,
        name: id,
        labelMatchers: readMatchers(node),
        groupingKeys: readArray(node.group_by).flatMap((entry) =>
            readString(entry) ? [readString(entry) as string] : []
        ),
        contactPointIds: receiver ? [safeId(receiver, receiver)] : []
    };
    const children = readArray(node.routes).flatMap((child, index) =>
        importRouteTree(child, warnings, id, `${indexPath}.routes[${index}]`)
    );
    return [policy, ...children];
}

function readMatchers(
    route: Record<string, unknown>
): Array<Record<string, unknown>> {
    const fromObject = Object.entries(readObject(route.match)).map(
        ([label, value]) => ({
            label,
            operator: '=',
            value
        })
    );
    const fromList = readArray(route.matchers).flatMap((entry) => {
        const raw = readString(entry);
        return raw ? [{raw}] : [];
    });
    return [...fromObject, ...fromList];
}
