const EXTERNAL_CONNECTION_LABELS: Readonly<Record<string, string>> = {
    ble: 'BLE',
    cloud: 'Cloud',
    eth: 'Ethernet',
    knx: 'KNX',
    matter: 'Matter',
    mdns: 'mDNS',
    modbus: 'Modbus',
    mqtt: 'MQTT',
    serial: 'Serial',
    service: 'Service',
    web: 'Web',
    wifi: 'Wi-Fi',
    ws: 'WebSocket',
    zigbee: 'Zigbee'
};

export function externalConnectionLabel(family: string): string {
    return EXTERNAL_CONNECTION_LABELS[family] ?? family;
}

export function deviceSubresourceLabel(input: {
    componentKey: string;
    family: string;
    itemLabel?: string | null;
}): string {
    return (
        input.itemLabel ??
        DEVICE_SUBRESOURCE_LABELS[input.family] ??
        input.componentKey
    );
}

export function firmwareFamilyLabel(family: string): string {
    return (
        DEVICE_SUBRESOURCE_LABELS[family] ??
        EXTERNAL_CONNECTION_LABELS[family] ??
        family
    );
}

export function connectorDeviceLabel(input: {
    externalId: string;
    jdocName?: string | null;
    rowName?: string | null;
}): string {
    return input.jdocName ?? input.rowName ?? input.externalId;
}

export function connectorPointLabel(input: {
    label?: string | null;
    componentKey: string;
}): string {
    return input.label ?? input.componentKey;
}

export function operationJobLabel(input: {
    kind: string;
    id: number | string;
}): string {
    return `${input.kind} job ${input.id}`;
}

export function operationUnitLabel(input: {
    kind: string;
    unitId: number | string;
}): string {
    return `${input.kind} unit ${input.unitId}`;
}

export function credentialStateLabel(): string {
    return 'Credential state';
}

export function actionTemplateLabel(input: {
    actionId: number;
    actionLabel?: string | null;
}): string {
    return input.actionLabel ?? `Action ${input.actionId}`;
}

export function assignmentSubjectLabel(input: {
    subjectType: 'user' | 'user_group';
    subjectId: string;
}): string {
    if (input.subjectType === 'user_group')
        return `User group ${input.subjectId}`;
    return `User ${input.subjectId}`;
}

const DEVICE_SUBRESOURCE_LABELS: Readonly<Record<string, string>> = {
    addon_peripheral: 'Add-on peripheral',
    addon_pro_output_peripheral: 'Pro output peripheral',
    ble_cloud_relay: 'BLE cloud relay',
    ble_cloud_relay_info: 'BLE cloud relay info',
    ble_paired_device: 'BLE paired device',
    bluassist_bond: 'BLU assistant bond',
    bluassist_connection: 'BLU assistant connection',
    eth_client: 'Ethernet client',
    media: 'Media item',
    media_album: 'Media album',
    media_artist: 'Media artist',
    radio_favourite: 'Radio favourite',
    schedule: 'Schedule',
    script: 'Script',
    thermostat_schedule_profile: 'Thermostat schedule profile',
    thermostat_schedule_rule: 'Thermostat schedule rule',
    trv_schedule: 'TRV schedule',
    webhook: 'Webhook',
    wifi_client: 'Wi-Fi client',
    wifi_saved_network: 'Wi-Fi saved network',
    xmod: 'XMOD module'
};
