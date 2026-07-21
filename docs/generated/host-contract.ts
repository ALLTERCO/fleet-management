// AUTO-GENERATED — do not edit by hand.
// Source: backend/src/types/api/*.ts (_DESCRIBE) + host-namespace-guide.ts
// Regenerate: cd backend && npm run generate

export interface HostContract {
    /** SensorAddon.GetPeripherals. */
    'addon.sensor.getperipherals': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** SensorAddon.OneWireScan. */
    'addon.sensor.onewirescan': {
        params: {shellyID: string};
        result: {devices?: unknown[]};
    };
    /** SensorAddon.AddPeripheral. */
    'addon.sensor.addperipheral': {
        params: {
            shellyID: string;
            type: string;
            attrs?: Record<string, unknown>;
        };
        result: Record<string, unknown>;
    };
    /** SensorAddon.RemovePeripheral. */
    'addon.sensor.removeperipheral': {
        params: {shellyID: string; component: string};
        result: null;
    };
    /** ProOutputAddon.GetPeripherals. */
    'addon.prooutput.getperipherals': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** ProOutputAddon.AddPeripheral. */
    'addon.prooutput.addperipheral': {
        params: {shellyID: string; type: string};
        result: Record<string, unknown>;
    };
    /** ProOutputAddon.RemovePeripheral. */
    'addon.prooutput.removeperipheral': {
        params: {shellyID: string; component: string};
        result: null;
    };
    /** {component}.GetConfig on addon peripheral components. */
    'addon.peripheral.getconfig': {
        params: {
            shellyID: string;
            component:
                | 'Temperature'
                | 'Humidity'
                | 'Illuminance'
                | 'Input'
                | 'Voltmeter'
                | 'Switch'
                | 'DevicePower';
            id: number;
        };
        result: Record<string, unknown>;
    };
    /** {component}.SetConfig on addon peripheral components. */
    'addon.peripheral.setconfig': {
        params: {
            shellyID: string;
            component:
                | 'Temperature'
                | 'Humidity'
                | 'Illuminance'
                | 'Input'
                | 'Voltmeter'
                | 'Switch'
                | 'DevicePower';
            id: number;
            config: Record<string, unknown>;
        };
        result: {restart_required: boolean};
    };
    /** Return the addon namespace contract (methods, schemas, permissions, errors). */
    'addon.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List every registered RPC namespace/command. */
    'admin.listcommands': {
        params: Record<string, never>;
        result: {
            items: string[];
            total: number;
            limit?: number;
            offset?: number;
            has_more?: boolean;
        };
    };
    /** Invoke an allowlisted PostgresProvider method. Super-admin recovery only. */
    'admin.postgrescall': {
        params: {name: string; args?: Record<string, unknown>; txId?: number};
        result: Record<string, unknown>;
    };
    /** Register saved devices not yet in memory. Picks up devices inserted out-of-band without an FM restart; leaves connected devices untouched. */
    'admin.reconciledevices': {
        params: Record<string, never>;
        result: {registered: number};
    };
    /** Return the admin namespace contract (methods, schemas, permissions, errors). */
    'admin.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Return backend-driven alert rule kinds, scope support, and config schemas. */
    'alert.rule.listkinds': {
        params: Record<string, never>;
        result: {
            items: Array<{
                key:
                    | 'device_offline'
                    | 'device_back_online'
                    | 'battery_below'
                    | 'smoke_alarm'
                    | 'flood_alarm'
                    | 'motion_detected'
                    | 'component_threshold'
                    | 'component_state'
                    | 'firmware_operation_failed'
                    | 'backup_operation_failed'
                    | 'automation_run_failed'
                    | 'grafana_alert'
                    | 'heartbeat'
                    | 'energy_consumption_threshold'
                    | 'rate_of_change'
                    | 'stuck_sensor'
                    | 'composite'
                    | 'anomaly_band'
                    | 'change_event'
                    | 'device_event';
                label: string;
                defaultSeverity: 'info' | 'warning' | 'critical';
                evaluationMode:
                    | 'event'
                    | 'state'
                    | 'absence'
                    | 'window'
                    | 'composite';
                initialEvaluation: boolean;
                dataSource:
                    | 'runtime_event'
                    | 'latest_status'
                    | 'presence_store'
                    | 'history_store'
                    | 'mixed';
                supportsForSec: boolean;
                clearBehavior:
                    | 'manual'
                    | 'recovery_event'
                    | 'state_recovery'
                    | 'absence_recovery'
                    | 'window_recovery'
                    | 'composite_recovery';
                eventReplayPolicy:
                    | 'future_only'
                    | 'durable_replay'
                    | 'not_applicable';
                phaseAvailable: 1;
                supportsManualResolve: boolean;
                supportsAutoResolve: boolean;
                supportedScopeTypes: Array<
                    'device' | 'component' | 'group' | 'location' | 'tag'
                >;
                configSchema: Record<string, unknown>;
            }>;
        };
    };
    /** Discover numeric metric paths (component + field) from live device status. Feeds the sensor threshold rule builder. */
    'alert.rule.listmetricpaths': {
        params: {organizationId?: string; shellyID?: string};
        result: {
            items: Array<{
                component: string;
                field: string;
                label?: string;
                deviceClass?:
                    | 'temperature'
                    | 'humidity'
                    | 'power'
                    | 'energy'
                    | 'current'
                    | 'voltage'
                    | 'battery'
                    | 'motion'
                    | 'opening'
                    | 'smoke'
                    | 'gas'
                    | 'carbon_monoxide'
                    | 'moisture'
                    | 'illuminance'
                    | 'pressure'
                    | 'co2'
                    | 'tvoc'
                    | 'signal_strength'
                    | 'presence'
                    | 'occupancy'
                    | 'tamper'
                    | 'vibration'
                    | 'garage_door'
                    | 'lock'
                    | 'sound'
                    | 'switch'
                    | 'other';
                unit?: string;
            }>;
        };
    };
    /** Discover metric and state component paths from live device status. Feeds threshold and state rule builders. */
    'alert.rule.listcomponentpaths': {
        params: {organizationId?: string; shellyID?: string};
        result: {
            items: Array<{
                component: string;
                field: string;
                kind: 'metric' | 'state';
                valueType: 'number' | 'boolean' | 'string';
                label?: string;
                deviceClass?:
                    | 'temperature'
                    | 'humidity'
                    | 'power'
                    | 'energy'
                    | 'current'
                    | 'voltage'
                    | 'battery'
                    | 'motion'
                    | 'opening'
                    | 'smoke'
                    | 'gas'
                    | 'carbon_monoxide'
                    | 'moisture'
                    | 'illuminance'
                    | 'pressure'
                    | 'co2'
                    | 'tvoc'
                    | 'signal_strength'
                    | 'presence'
                    | 'occupancy'
                    | 'tamper'
                    | 'vibration'
                    | 'garage_door'
                    | 'lock'
                    | 'sound'
                    | 'switch'
                    | 'other';
                unit?: string;
                values?: Array<number | string | boolean>;
            }>;
        };
    };
    /** Accessible devices that can host the given rule kind, judged from their reported components. Drives the rule builder device picker. */
    'alert.rule.listeligibledevices': {
        params: {
            organizationId?: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            config?: Record<string, unknown>;
        };
        result: {shellyIDs: string[]};
    };
    /** List alert rules in the caller organization. */
    'alert.rule.list': {
        params: {
            organizationId?: string;
            enabled?: boolean;
            kind?:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                kind:
                    | 'device_offline'
                    | 'device_back_online'
                    | 'battery_below'
                    | 'smoke_alarm'
                    | 'flood_alarm'
                    | 'motion_detected'
                    | 'component_threshold'
                    | 'component_state'
                    | 'firmware_operation_failed'
                    | 'backup_operation_failed'
                    | 'automation_run_failed'
                    | 'grafana_alert'
                    | 'heartbeat'
                    | 'energy_consumption_threshold'
                    | 'rate_of_change'
                    | 'stuck_sensor'
                    | 'composite'
                    | 'anomaly_band'
                    | 'change_event'
                    | 'device_event';
                enabled: boolean;
                severity: 'info' | 'warning' | 'critical';
                scope: {
                    deviceIds?: string[];
                    componentIds?: string[];
                    groupIds?: number[];
                    locationIds?: number[];
                    tagIds?: number[];
                };
                dedupeWindowSec: number;
                cooldownSec: number;
                destinationGroupIds: number[];
                destinationChannelIds: number[];
                deliveryMode: 'instant' | 'digest';
                digestWindowMinutes: number | null;
                ownerUserId: string | null;
                summaryTemplate: string | null;
                messageTemplate: string | null;
                autoResolve: boolean;
                config: Record<string, unknown>;
                groupBy: Array<
                    | 'organization_id'
                    | 'rule_id'
                    | 'severity'
                    | 'kind'
                    | 'subject_type'
                > | null;
                runbookUrl: string | null;
                templateId: number | null;
                lastFiredAt: string | null;
                createdAt: string;
                updatedAt: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return one alert rule. */
    'alert.rule.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            enabled: boolean;
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            dedupeWindowSec: number;
            cooldownSec: number;
            destinationGroupIds: number[];
            destinationChannelIds: number[];
            deliveryMode: 'instant' | 'digest';
            digestWindowMinutes: number | null;
            ownerUserId: string | null;
            summaryTemplate: string | null;
            messageTemplate: string | null;
            autoResolve: boolean;
            config: Record<string, unknown>;
            groupBy: Array<
                | 'organization_id'
                | 'rule_id'
                | 'severity'
                | 'kind'
                | 'subject_type'
            > | null;
            runbookUrl: string | null;
            templateId: number | null;
            lastFiredAt: string | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Create an alert rule with backend-validated scope, routing, and config. */
    'alert.rule.create': {
        params: {
            organizationId?: string;
            name: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            enabled?: boolean;
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            dedupeWindowSec?: number;
            cooldownSec?: number;
            destinationGroupIds?: number[];
            destinationChannelIds?: number[];
            deliveryMode?: 'instant' | 'digest';
            digestWindowMinutes?: number | null;
            ownerUserId?: string | null;
            summaryTemplate?: string | null;
            messageTemplate?: string | null;
            autoResolve?: boolean;
            config?: Record<string, unknown>;
            groupBy?: Array<
                | 'organization_id'
                | 'rule_id'
                | 'severity'
                | 'kind'
                | 'subject_type'
            > | null;
            runbookUrl?: string | null;
            templateId?: number | null;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            enabled: boolean;
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            dedupeWindowSec: number;
            cooldownSec: number;
            destinationGroupIds: number[];
            destinationChannelIds: number[];
            deliveryMode: 'instant' | 'digest';
            digestWindowMinutes: number | null;
            ownerUserId: string | null;
            summaryTemplate: string | null;
            messageTemplate: string | null;
            autoResolve: boolean;
            config: Record<string, unknown>;
            groupBy: Array<
                | 'organization_id'
                | 'rule_id'
                | 'severity'
                | 'kind'
                | 'subject_type'
            > | null;
            runbookUrl: string | null;
            templateId: number | null;
            lastFiredAt: string | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Update an alert rule. */
    'alert.rule.update': {
        params: {
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                enabled?: boolean;
                severity?: 'info' | 'warning' | 'critical';
                scope?: {
                    deviceIds?: string[];
                    componentIds?: string[];
                    groupIds?: number[];
                    locationIds?: number[];
                    tagIds?: number[];
                };
                dedupeWindowSec?: number;
                cooldownSec?: number;
                destinationGroupIds?: number[];
                destinationChannelIds?: number[];
                deliveryMode?: 'instant' | 'digest';
                digestWindowMinutes?: number | null;
                ownerUserId?: string | null;
                summaryTemplate?: string | null;
                messageTemplate?: string | null;
                autoResolve?: boolean;
                config?: Record<string, unknown>;
                groupBy?: Array<
                    | 'organization_id'
                    | 'rule_id'
                    | 'severity'
                    | 'kind'
                    | 'subject_type'
                > | null;
                runbookUrl?: string | null;
                templateId?: number | null;
            };
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            enabled: boolean;
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            dedupeWindowSec: number;
            cooldownSec: number;
            destinationGroupIds: number[];
            destinationChannelIds: number[];
            deliveryMode: 'instant' | 'digest';
            digestWindowMinutes: number | null;
            ownerUserId: string | null;
            summaryTemplate: string | null;
            messageTemplate: string | null;
            autoResolve: boolean;
            config: Record<string, unknown>;
            groupBy: Array<
                | 'organization_id'
                | 'rule_id'
                | 'severity'
                | 'kind'
                | 'subject_type'
            > | null;
            runbookUrl: string | null;
            templateId: number | null;
            lastFiredAt: string | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete an alert rule if no alert instances still reference it. */
    'alert.rule.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean; id: number};
    };
    /** Return a matching rule (same kind + severity + scope + config + throttling) in this org, if any. Call before Create/Update to warn on accidental duplicates. */
    'alert.rule.checkduplicate': {
        params: {
            organizationId?: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            dedupeWindowSec?: number;
            cooldownSec?: number;
            config?: Record<string, unknown>;
            excludeId?: number;
        };
        result: {duplicate: null | {id: number; name: string}};
    };
    /** List pre-built alert rule templates. Frontend renders these in the builder "from template" picker. */
    'alert.rule.listtemplates': {
        params: {category?: string};
        result: {
            items: Array<{
                id: number;
                organizationId: string | null;
                templateKey: string;
                category: string;
                label: string;
                description: string | null;
                kind:
                    | 'device_offline'
                    | 'device_back_online'
                    | 'battery_below'
                    | 'smoke_alarm'
                    | 'flood_alarm'
                    | 'motion_detected'
                    | 'component_threshold'
                    | 'component_state'
                    | 'firmware_operation_failed'
                    | 'backup_operation_failed'
                    | 'automation_run_failed'
                    | 'grafana_alert'
                    | 'heartbeat'
                    | 'energy_consumption_threshold'
                    | 'rate_of_change'
                    | 'stuck_sensor'
                    | 'composite'
                    | 'anomaly_band'
                    | 'change_event'
                    | 'device_event';
                severity: 'info' | 'warning' | 'critical';
                scope: {
                    deviceIds?: string[];
                    componentIds?: string[];
                    groupIds?: number[];
                    locationIds?: number[];
                    tagIds?: number[];
                };
                config: Record<string, unknown>;
                dedupeWindowSec: number;
                cooldownSec: number;
                summaryTemplate: string | null;
                messageTemplate: string | null;
                autoResolve: boolean;
                authorUserId: string | null;
            }>;
        };
    };
    /** Instantiate an alert rule from a template. Template supplies kind/severity/config/throttling defaults; caller supplies name + scope + destinations and optional overrides. */
    'alert.rule.createfromtemplate': {
        params: {
            organizationId?: string;
            templateKey: string;
            name: string;
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            destinationGroupIds?: number[];
            destinationChannelIds?: number[];
            enabled?: boolean;
            ownerUserId?: string | null;
            configOverride?: Record<string, unknown>;
            summaryTemplateOverride?: string | null;
            messageTemplateOverride?: string | null;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            enabled: boolean;
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            dedupeWindowSec: number;
            cooldownSec: number;
            destinationGroupIds: number[];
            destinationChannelIds: number[];
            deliveryMode: 'instant' | 'digest';
            digestWindowMinutes: number | null;
            ownerUserId: string | null;
            summaryTemplate: string | null;
            messageTemplate: string | null;
            autoResolve: boolean;
            config: Record<string, unknown>;
            groupBy: Array<
                | 'organization_id'
                | 'rule_id'
                | 'severity'
                | 'kind'
                | 'subject_type'
            > | null;
            runbookUrl: string | null;
            templateId: number | null;
            lastFiredAt: string | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Author an org-scoped alert rule template. organization_id is set from sender authority. */
    'alert.rule.template.create': {
        params: {
            organizationId?: string;
            templateKey: string;
            category: string;
            label: string;
            description?: string | null;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            severity: 'info' | 'warning' | 'critical';
            scope?: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            config?: Record<string, unknown>;
            dedupeWindowSec?: number;
            cooldownSec?: number;
            summaryTemplate?: string | null;
            messageTemplate?: string | null;
            autoResolve?: boolean;
        };
        result: {
            id: number;
            organizationId: string | null;
            templateKey: string;
            category: string;
            label: string;
            description: string | null;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            config: Record<string, unknown>;
            dedupeWindowSec: number;
            cooldownSec: number;
            summaryTemplate: string | null;
            messageTemplate: string | null;
            autoResolve: boolean;
            authorUserId: string | null;
        };
    };
    /** Edit an org-authored template. Only the original author may edit. */
    'alert.rule.template.update': {
        params: {
            organizationId?: string;
            id: number;
            label?: string;
            description?: string | null;
            severity?: 'info' | 'warning' | 'critical';
            scope?: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            config?: Record<string, unknown>;
            dedupeWindowSec?: number;
            cooldownSec?: number;
            summaryTemplate?: string | null;
            messageTemplate?: string | null;
            autoResolve?: boolean;
        };
        result: {
            id: number;
            organizationId: string | null;
            templateKey: string;
            category: string;
            label: string;
            description: string | null;
            kind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            severity: 'info' | 'warning' | 'critical';
            scope: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            config: Record<string, unknown>;
            dedupeWindowSec: number;
            cooldownSec: number;
            summaryTemplate: string | null;
            messageTemplate: string | null;
            autoResolve: boolean;
            authorUserId: string | null;
        };
    };
    /** Delete an org-authored template. Only the original author may delete. */
    'alert.rule.template.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean};
    };
    /** Return the per-rule firing history (created + triggered transitions joined with source subject), newest first. */
    'alert.rule.listfirings': {
        params: {
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                transitionId: number;
                alertId: number;
                action: 'created' | 'triggered';
                firedAt: string;
                source: {
                    organizationId: string;
                    subjectType:
                        | 'device'
                        | 'component'
                        | 'group'
                        | 'location'
                        | 'tag';
                    subjectId: string;
                };
                severity: 'info' | 'warning' | 'critical';
                title: string;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Dry-run a rule (saved ruleId or draft spec) against current device state. Side-effect-free. Event-driven kinds return supportedKind=false. */
    'alert.rule.preview': {
        params: {
            organizationId?: string;
            ruleId?: number;
            kind?:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            severity?: 'info' | 'warning' | 'critical';
            scope?: {
                deviceIds?: string[];
                componentIds?: string[];
                groupIds?: number[];
                locationIds?: number[];
                tagIds?: number[];
            };
            config?: Record<string, unknown>;
            dedupeWindowSec?: number;
            cooldownSec?: number;
        };
        result: {
            matches: Array<{
                subject: {
                    organizationId: string;
                    subjectType:
                        | 'device'
                        | 'component'
                        | 'group'
                        | 'location'
                        | 'tag';
                    subjectId: string;
                };
                title: string;
                message: string;
                severity: 'info' | 'warning' | 'critical';
                fingerprint: string;
                context: Record<string, unknown>;
            }>;
            matchCount: number;
            scanned: number;
            supportedKind: boolean;
            truncated: boolean;
            note: string | null;
        };
    };
    /** List alert instances in the caller organization. */
    'alert.instance.list': {
        params: {
            organizationId?: string;
            state?:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity?: 'info' | 'warning' | 'critical';
            ruleId?: number;
            sourceType?: 'device' | 'component' | 'group' | 'location' | 'tag';
            sourceId?: string;
            locationIds?: number[];
            groupIds?: number[];
            tagIds?: number[];
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                ruleId: number;
                ruleKind:
                    | 'device_offline'
                    | 'device_back_online'
                    | 'battery_below'
                    | 'smoke_alarm'
                    | 'flood_alarm'
                    | 'motion_detected'
                    | 'component_threshold'
                    | 'component_state'
                    | 'firmware_operation_failed'
                    | 'backup_operation_failed'
                    | 'automation_run_failed'
                    | 'grafana_alert'
                    | 'heartbeat'
                    | 'energy_consumption_threshold'
                    | 'rate_of_change'
                    | 'stuck_sensor'
                    | 'composite'
                    | 'anomaly_band'
                    | 'change_event'
                    | 'device_event';
                state:
                    | 'pending'
                    | 'active'
                    | 'acknowledged'
                    | 'recovering'
                    | 'cleared_unack'
                    | 'cleared_ack'
                    | 'no_data'
                    | 'evaluation_error'
                    | 'resolved';
                severity: 'info' | 'warning' | 'critical';
                source: {
                    organizationId: string;
                    subjectType:
                        | 'device'
                        | 'component'
                        | 'group'
                        | 'location'
                        | 'tag';
                    subjectId: string;
                };
                title: string;
                message: string;
                fingerprint: string;
                activeSince: string;
                lastTriggeredAt: string;
                acknowledgedAt: string | null;
                acknowledgedBy: {
                    userId: string;
                    displayName?: string | null;
                } | null;
                ackComment: string | null;
                resolvedAt: string | null;
                silencedUntil: string | null;
                silenceReason: string | null;
                counts: {
                    notificationsCreated: number;
                    deliveryJobsCreated: number;
                };
                context: Record<string, unknown>;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return one alert instance. */
    'alert.instance.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            ruleId: number;
            ruleKind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            state:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity: 'info' | 'warning' | 'critical';
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            };
            title: string;
            message: string;
            fingerprint: string;
            activeSince: string;
            lastTriggeredAt: string;
            acknowledgedAt: string | null;
            acknowledgedBy: {
                userId: string;
                displayName?: string | null;
            } | null;
            ackComment: string | null;
            resolvedAt: string | null;
            silencedUntil: string | null;
            silenceReason: string | null;
            counts: {notificationsCreated: number; deliveryJobsCreated: number};
            context: Record<string, unknown>;
        };
    };
    /** List state transitions for one alert instance. */
    'alert.instance.listtransitions': {
        params: {
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                at: string;
                action:
                    | 'created'
                    | 'pending'
                    | 'triggered'
                    | 'acknowledged'
                    | 'unacknowledged'
                    | 'silenced'
                    | 'unsilenced'
                    | 'recovering'
                    | 'cleared_unack'
                    | 'cleared_ack'
                    | 'no_data'
                    | 'evaluation_error'
                    | 'resolved';
                actor: {userId: string; displayName?: string | null} | null;
                data: Record<string, unknown>;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Acknowledge one active alert instance. */
    'alert.instance.ack': {
        params: {organizationId?: string; id: number; comment?: string};
        result: {
            id: number;
            organizationId: string;
            ruleId: number;
            ruleKind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            state:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity: 'info' | 'warning' | 'critical';
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            };
            title: string;
            message: string;
            fingerprint: string;
            activeSince: string;
            lastTriggeredAt: string;
            acknowledgedAt: string | null;
            acknowledgedBy: {
                userId: string;
                displayName?: string | null;
            } | null;
            ackComment: string | null;
            resolvedAt: string | null;
            silencedUntil: string | null;
            silenceReason: string | null;
            counts: {notificationsCreated: number; deliveryJobsCreated: number};
            context: Record<string, unknown>;
        };
    };
    /** Return an acknowledged alert instance to active state. */
    'alert.instance.unack': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            ruleId: number;
            ruleKind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            state:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity: 'info' | 'warning' | 'critical';
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            };
            title: string;
            message: string;
            fingerprint: string;
            activeSince: string;
            lastTriggeredAt: string;
            acknowledgedAt: string | null;
            acknowledgedBy: {
                userId: string;
                displayName?: string | null;
            } | null;
            ackComment: string | null;
            resolvedAt: string | null;
            silencedUntil: string | null;
            silenceReason: string | null;
            counts: {notificationsCreated: number; deliveryJobsCreated: number};
            context: Record<string, unknown>;
        };
    };
    /** Silence an alert instance until a given timestamp. */
    'alert.instance.silence': {
        params: {
            organizationId?: string;
            id: number;
            until: string;
            reason?: string | null;
        };
        result: {
            id: number;
            organizationId: string;
            ruleId: number;
            ruleKind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            state:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity: 'info' | 'warning' | 'critical';
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            };
            title: string;
            message: string;
            fingerprint: string;
            activeSince: string;
            lastTriggeredAt: string;
            acknowledgedAt: string | null;
            acknowledgedBy: {
                userId: string;
                displayName?: string | null;
            } | null;
            ackComment: string | null;
            resolvedAt: string | null;
            silencedUntil: string | null;
            silenceReason: string | null;
            counts: {notificationsCreated: number; deliveryJobsCreated: number};
            context: Record<string, unknown>;
        };
    };
    /** Clear the silence window for an alert instance. */
    'alert.instance.unsilence': {
        params: {organizationId?: string; id: number; comment?: string};
        result: {
            id: number;
            organizationId: string;
            ruleId: number;
            ruleKind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            state:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity: 'info' | 'warning' | 'critical';
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            };
            title: string;
            message: string;
            fingerprint: string;
            activeSince: string;
            lastTriggeredAt: string;
            acknowledgedAt: string | null;
            acknowledgedBy: {
                userId: string;
                displayName?: string | null;
            } | null;
            ackComment: string | null;
            resolvedAt: string | null;
            silencedUntil: string | null;
            silenceReason: string | null;
            counts: {notificationsCreated: number; deliveryJobsCreated: number};
            context: Record<string, unknown>;
        };
    };
    /** Manually resolve a manual-resolve-capable alert instance. */
    'alert.instance.resolvemanual': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            ruleId: number;
            ruleKind:
                | 'device_offline'
                | 'device_back_online'
                | 'battery_below'
                | 'smoke_alarm'
                | 'flood_alarm'
                | 'motion_detected'
                | 'component_threshold'
                | 'component_state'
                | 'firmware_operation_failed'
                | 'backup_operation_failed'
                | 'automation_run_failed'
                | 'grafana_alert'
                | 'heartbeat'
                | 'energy_consumption_threshold'
                | 'rate_of_change'
                | 'stuck_sensor'
                | 'composite'
                | 'anomaly_band'
                | 'change_event'
                | 'device_event';
            state:
                | 'pending'
                | 'active'
                | 'acknowledged'
                | 'recovering'
                | 'cleared_unack'
                | 'cleared_ack'
                | 'no_data'
                | 'evaluation_error'
                | 'resolved';
            severity: 'info' | 'warning' | 'critical';
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            };
            title: string;
            message: string;
            fingerprint: string;
            activeSince: string;
            lastTriggeredAt: string;
            acknowledgedAt: string | null;
            acknowledgedBy: {
                userId: string;
                displayName?: string | null;
            } | null;
            ackComment: string | null;
            resolvedAt: string | null;
            silencedUntil: string | null;
            silenceReason: string | null;
            counts: {notificationsCreated: number; deliveryJobsCreated: number};
            context: Record<string, unknown>;
        };
    };
    /** Append a free-form annotation to an alert instance. */
    'alert.instance.annotate': {
        params: {
            organizationId?: string;
            alertInstanceId: number;
            body: string;
        };
        result: {
            id: number;
            alertInstanceId: number;
            organizationId: string;
            author: {userId: string; displayName?: string | null};
            body: string;
            createdAt: string;
            editedAt: string | null;
        };
    };
    /** List annotations attached to an alert instance. */
    'alert.instance.listannotations': {
        params: {organizationId?: string; alertInstanceId: number};
        result: {
            items: Array<{
                id: number;
                alertInstanceId: number;
                organizationId: string;
                author: {userId: string; displayName?: string | null};
                body: string;
                createdAt: string;
                editedAt: string | null;
            }>;
        };
    };
    /** Edit an annotation; only the original author may edit. */
    'alert.instance.editannotation': {
        params: {organizationId?: string; id: number; body: string};
        result: {
            id: number;
            alertInstanceId: number;
            organizationId: string;
            author: {userId: string; displayName?: string | null};
            body: string;
            createdAt: string;
            editedAt: string | null;
        };
    };
    /** Delete an annotation; only the original author may delete. */
    'alert.instance.deleteannotation': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean};
    };
    /** Return the alert namespace contract (methods, schemas, permissions, errors). */
    'alert.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Enable Alexa skill integration with provided OAuth tokens. */
    'alexa.enable': {
        params: {
            access_token: string;
            refresh_token: string;
            entities: string[];
        };
        result: {
            cmd: 'enable';
            params: {
                access_token: string;
                refresh_token: string;
                entities: string[];
            };
        };
    };
    /** Disable Alexa skill integration and clear tokens. */
    'alexa.disable': {
        params: Record<string, unknown>;
        result: {cmd: 'disable'};
    };
    /** Return the alexa namespace contract (methods, schemas, permissions, errors). */
    'alexa.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Per-device contributor breakdown for a time window on a chosen metric — drives brush-to-compare on time-series + heatmap charts. */
    'analytics.attributewindow': {
        params: {
            metric: 'consumption' | 'power' | 'voltage' | 'temperature';
            from: string;
            to: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            devices?: string[];
            topN?: number;
            aggregation?: 'sum' | 'avg' | 'max' | 'latest';
        };
        result: {
            metric: string;
            from: string;
            to: string;
            aggregation: string;
            unit: string;
            totalValue: number;
            contributors: Array<{
                deviceId: number;
                shellyID: string;
                deviceName: string;
                value: number;
                share: number;
                sampleCount: number;
            }>;
            truncated: boolean;
            truncatedCount: number;
        };
    };
    /** Return the analytics namespace contract (methods, schemas, permissions, errors). */
    'analytics.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List the organization's visual assets. Used by the asset picker to show reusable images across all device decoration surfaces. */
    'asset.list': {
        params: {
            organizationId?: string;
            limit?: number;
            cursor?: string;
            search?: string;
            context?: string;
        };
        result: {
            items: Array<{
                id: string;
                url: string;
                sha256: string;
                contentType: string;
                sizeBytes: number;
                label: string | null;
                uploadedBy: string | null;
                context: string;
                created: string;
            }>;
            nextCursor: string | null;
        };
    };
    /** Rename a stored asset for easier library discovery. */
    'asset.setlabel': {
        params: {id: string; label: string | null; organizationId?: string};
        result: {
            id: string;
            url: string;
            sha256: string;
            contentType: string;
            sizeBytes: number;
            label: string | null;
            uploadedBy: string | null;
            context: string;
            created: string;
        };
    };
    /** Remove an asset. Refuses (AssetInUse) if any device or group still references it. */
    'asset.delete': {
        params: {id: string; organizationId?: string};
        result: {deleted: true; id: string};
    };
    /** One-shot: rewrite image-path columns into asset UUIDs. Idempotent. */
    'asset.migrateimages': {
        params: Record<string, never>;
        result: {
            actor: string;
            startedAt: string;
            finishedAt: string;
            tables: Array<{
                table: string;
                scanned: number;
                alreadyUuid: number;
                migrated: number;
                fileMissing: number;
                failed: number;
            }>;
        };
    };
    /** Return the asset namespace contract (methods, schemas, permissions, errors). */
    'asset.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'assignment.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Attach a persona to a user or group with scope. */
    'assignment.create': {
        params: {
            subjectType: 'user' | 'user_group';
            subjectId: string;
            personaId: string;
            scope: {
                all?: boolean;
                device_ids?: string[];
                location_ids?: number[];
                device_group_ids?: number[];
                device_tags?: string[];
                dashboard_ids?: number[];
                plugin_keys?: string[];
                waiting_room_ids?: string[];
                configuration_keys?: string[];
                report_ids?: number[];
                organization_ids?: string[];
                alert_ids?: string[];
                notification_ids?: string[];
                integration_keys?: string[];
                automation_ids?: string[];
                actions?: string[];
            };
            reason?: string | null;
            comment?: string | null;
            expiresAt?: string | null;
        };
        result: Record<string, unknown>;
    };
    /** Remove an assignment. */
    'assignment.delete': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** List assignments attached to a specific user or group. */
    'assignment.listforsubject': {
        params: {subjectType: 'user' | 'user_group'; subjectId: string};
        result: Record<string, unknown>;
    };
    /** List subjects that have a given persona attached. */
    'assignment.listforpersona': {
        params: {personaId: string};
        result: Record<string, unknown>;
    };
    /** List assignments whose scope references a specific resource. Backs the ShareDialog "Shared with" panel. */
    'assignment.listforresource': {
        params: {
            resourceType:
                | 'dashboard'
                | 'location'
                | 'group'
                | 'device'
                | 'tag'
                | 'plugin'
                | 'waiting_room'
                | 'configuration'
                | 'report'
                | 'organization'
                | 'alert'
                | 'notification'
                | 'integration'
                | 'automation'
                | 'action';
            resourceId: string | number;
        };
        result: Record<string, unknown>;
    };
    /** List assignments unused for thresholdDays (defaults to FM_AUTHZ_UNUSED_THRESHOLD_DAYS). Used by the least-privilege recommender to suggest revokes. */
    'assignment.listunused': {
        params: {thresholdDays?: number};
        result: Record<string, unknown>;
    };
    /** Search the audit log with optional time range, event-type, username, and shellyID filters. */
    'audit.query': {
        params: {
            from?: string;
            to?: string;
            eventTypes?: Array<
                | 'login'
                | 'logout'
                | 'rpc'
                | 'device_online'
                | 'device_offline'
                | 'device_add'
                | 'device_delete'
                | 'device_reconnect_replace'
                | 'config_change'
                | 'permission_change'
                | 'mcp_tool_call'
            >;
            username?: string;
            shellyId?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                ts: string;
                event_type: string;
                username?: string | null;
                shelly_id?: string | null;
                shelly_ids?: string[] | null;
                method?: string | null;
                params?: Record<string, unknown> | null;
                success?: boolean;
                error_message?: string | null;
                ip_address?: string | null;
                [key: string]: unknown;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Export matching audit rows to a CSV file; returns a one-time download URL. */
    'audit.export': {
        params: {from: string; to: string; eventTypes?: string[]};
        result: {
            filename: string;
            downloadUrl: string;
            downloadTicketUrl: string;
            rows: number;
            generated: string;
        };
    };
    /** Return the audit namespace contract (methods, schemas, permissions, errors). */
    'audit.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Issue a short-lived, single-purpose bearer token bound to the callers org. Plaintext is returned once; only its SHA-256 hash is persisted. */
    'auth.mintscopedtoken': {
        params: {
            purpose: 'devices.create';
            ttlSec?: number;
            organizationId?: string;
        };
        result: {
            token: string;
            expiresAt: string;
            organizationId: string;
            purpose: string;
        };
    };
    /** Return the auth namespace contract (methods, schemas, permissions, errors). */
    'auth.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'authz_audit.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** List authz audit entries scoped to current tenant. Supports filtering by time range, actor, action, target. */
    'authz_audit.list': {
        params: {
            from?: string;
            to?: string;
            actorId?: string;
            action?: string;
            targetType?:
                | 'persona'
                | 'user_group'
                | 'assignment'
                | 'certificate'
                | 'credential'
                | 'user'
                | 'variable'
                | 'alert_instance'
                | 'report_config'
                | 'report'
                | 'notification_template'
                | 'notification_destination';
            targetId?: string;
            limit?: number;
            offset?: number;
        };
        result: Record<string, unknown>;
    };
    /** List device backups, optionally filtered by shellyID. */
    'backup.list': {
        params: {shellyID?: string; limit?: number; offset?: number};
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Fetch backup metadata by id. */
    'backup.get': {params: {id: string}; result: Record<string, unknown>};
    /** Pull a fresh backup from a device and persist it. */
    'backup.downloadfromdevice': {
        params: {
            shellyID: string;
            name?: string;
            contents?: Record<string, boolean>;
        };
        result: Record<string, unknown>;
    };
    /** Queue a backend-owned backup creation job for one or more devices. */
    'backup.startdownloadjob': {
        params: {
            shellyIDs: string[];
            name?: string;
            contents?: Record<string, boolean>;
            idempotencyKey?: string;
        };
        result: {jobId: string};
    };
    /** Rename a stored backup. */
    'backup.rename': {
        params: {id: string; name: string};
        result: Record<string, unknown>;
    };
    /** Delete a backup by id. */
    'backup.delete': {params: {id: string}; result: Record<string, unknown>};
    /** Restore a backup to a device. */
    'backup.restoretodevice': {
        params: {
            id: string;
            shellyID: string;
            restore?: Record<string, boolean>;
        };
        result: Record<string, unknown>;
    };
    /** Queue a backend-owned backup restore job for one device. */
    'backup.startrestorejob': {
        params: {
            id: string;
            shellyID: string;
            restore?: Record<string, boolean>;
            idempotencyKey?: string;
        };
        result: {jobId: string};
    };
    /** Return the raw backup payload (base64) and metadata. */
    'backup.getfile': {
        params: {id: string};
        result: {data: string; name: string; size?: number};
    };
    /** Return the backup namespace contract (methods, schemas, permissions, errors). */
    'backup.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Record (upsert) the actual bill for a billing period. */
    'bill.set': {
        params: {
            periodStart: string;
            periodEnd: string;
            actualCost: number;
            currency?: string;
        };
        result: {
            id: number;
            periodStart: string;
            periodEnd: string;
            actualCost: number;
            currency: string;
        };
    };
    /** List recorded bills, optionally within a date range. */
    'bill.list': {
        params: {from?: string; to?: string};
        result: Record<string, unknown>;
    };
    /** Delete a recorded bill. */
    'bill.delete': {params: {id: number}; result: Record<string, unknown>};
    /** Return the bill namespace contract (methods, schemas, permissions, errors). */
    'bill.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** BLE.SetConfig — radio enable + RPC-over-BLE / observer toggles. */
    'ble.setconfig': {
        params: {
            shellyID: string;
            config: {
                enable?: boolean;
                rpc?: {enable?: boolean};
                observer?: {enable?: boolean};
            };
        };
        result: {restart_required: boolean};
    };
    /** BLE.GetConfig — current BLE radio + observer config. */
    'ble.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BLE.GetStatus — runtime BLE radio status. */
    'ble.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BLE.StartPairing — enable pairing mode for `timeout` seconds (default 180). */
    'ble.startpairing': {
        params: {shellyID: string; timeout?: number};
        result: Record<string, unknown>;
    };
    /** BLE.StopPairing — disable pairing mode. */
    'ble.stoppairing': {params: {shellyID: string}; result: null};
    /** BLE.ListPairedDevices — paired BLE devices: [{addr, ctime, atime}]. */
    'ble.listpaireddevices': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BLE.DeletePairedDevice — remove one paired device by addr. */
    'ble.deletepaireddevice': {
        params: {shellyID: string; addr: string};
        result: null;
    };
    /** BLE.CloudRelay.List — paired cloud-relay devices. */
    'ble.cloudrelay.list': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BLE.CloudRelay.ListInfos — extended info for cloud-relay bonds. */
    'ble.cloudrelay.listinfos': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the ble namespace contract (methods, schemas, permissions, errors). */
    'ble.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** bluassist.Scan — proxies GATTC.Scan on a BLU Assistant and enriches results with BTHome parsing + fleet cross-reference. */
    'bluassist.scan': {
        params: {
            shellyID: string;
            active?: boolean;
            duration_ms?: number;
            window_ms?: number;
            interval_ms?: number;
            rssi_thr?: number;
            shellyOnly?: boolean;
        };
        result: {
            results: Array<{
                addr: string;
                rssi: number;
                advData?: string;
                parsed?: {
                    isShellyBlu: boolean;
                    encrypted: boolean;
                    localName?: string;
                    modelId?: number;
                    modelString?: string;
                    productName?: string;
                };
                knownInFleet?: {
                    externalId: string;
                    name: string;
                    gatewayShellyId: string;
                };
            }>;
            scanned: number;
        };
    };
    /** bluassist.Connect — open a GATT connection to the addr. Counts against the device 5-slot pool. */
    'bluassist.connect': {
        params: {shellyID: string; addr: string; timeout_ms?: number};
        result: {
            conn_id: number;
            addr?: string;
            mtu?: number;
            [key: string]: unknown;
        };
    };
    /** bluassist.Disconnect — close a GATT connection by conn_id or addr. */
    'bluassist.disconnect': {
        params: {shellyID: string; conn_id?: number; addr?: string};
        result: Record<string, unknown>;
    };
    /** bluassist.Discover — enumerate services and characteristics on a connected peripheral. */
    'bluassist.discover': {
        params: {shellyID: string; conn_id?: number; addr?: string};
        result: {
            services?: Array<Record<string, unknown>>;
            [key: string]: unknown;
        };
    };
    /** bluassist.Read — read a characteristic by handle or svc+chr UUID. */
    'bluassist.read': {
        params: {
            shellyID: string;
            conn_id: number;
            handle?: number;
            svc?: string;
            chr?: string;
        };
        result: {data?: string; [key: string]: unknown};
    };
    /** bluassist.Write — write a characteristic by handle or svc+chr UUID. data is hex. */
    'bluassist.write': {
        params: {
            shellyID: string;
            conn_id: number;
            data: string;
            handle?: number;
            svc?: string;
            chr?: string;
            response?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** bluassist.SetNotify — subscribe (notify/indicate) or unsubscribe (none) to a characteristic. */
    'bluassist.setnotify': {
        params: {
            shellyID: string;
            conn_id: number;
            mode: 'none' | 'notify' | 'indicate';
            handle?: number;
            svc?: string;
            chr?: string;
        };
        result: Record<string, unknown>;
    };
    /** bluassist.Call — high-level RPC over BLE (used by BLU TRV and similar protocols). */
    'bluassist.call': {
        params: {
            shellyID: string;
            addr: string;
            method: string;
            params?: Record<string, unknown>;
        };
        result: Record<string, unknown>;
    };
    /** bluassist.Bond.Enable — globally allow/deny bonding on the device. */
    'bluassist.bond.enable': {
        params: {shellyID: string; enable: boolean};
        result: Record<string, unknown>;
    };
    /** bluassist.Bond.Has — check whether a bond record exists for the addr. */
    'bluassist.bond.has': {
        params: {shellyID: string; addr: string};
        result: {have_bond?: boolean; [key: string]: unknown};
    };
    /** bluassist.Bond.Delete — remove the bond record for the addr. */
    'bluassist.bond.delete': {
        params: {shellyID: string; addr: string};
        result: Record<string, unknown>;
    };
    /** bluassist.Connection.List — FM-tracked active GATT connections for the device. Capacity is the device pool (5). */
    'bluassist.connection.list': {
        params: {shellyID: string};
        result: {
            slots: Array<{
                conn_id: number;
                addr: string;
                openedAt: string;
                discoveredAt?: string;
                mtu?: number;
            }>;
            capacity: number;
            inUse: number;
        };
    };
    /** Return the bluassist namespace contract (methods, schemas, permissions, errors). */
    'bluassist.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** BluGw.SetConfig — gateway config (e.g. sys_led_enable). */
    'blugw.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** BluGw.GetConfig. */
    'blugw.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BluGw.GetStatus. */
    'blugw.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the blugw namespace contract (methods, schemas, permissions, errors). */
    'blugw.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Battery Monitor status — SOC, SOH, voltage, errors. */
    'bm.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Battery Monitor config. */
    'bm.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Battery Monitor SetConfig — opaque pass-through. */
    'bm.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Return the bm namespace contract (methods, schemas, permissions, errors). */
    'bm.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Branding.GetPolicy — current (live) label policy. */
    'branding.getpolicy': {
        params: {orgId: string};
        result: Record<string, unknown>;
    };
    /** Branding.GetPreview — unsaved draft policy (before activate). */
    'branding.getpreview': {
        params: {orgId: string};
        result: Record<string, unknown>;
    };
    /** Branding.GetDefault — Zitadel factory-default policy. */
    'branding.getdefault': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Branding.SetPolicy — write the draft label policy. Activate to publish. */
    'branding.setpolicy': {
        params: {
            orgId: string;
            primaryColor?: string;
            warnColor?: string;
            backgroundColor?: string;
            fontColor?: string;
            primaryColorDark?: string;
            warnColorDark?: string;
            backgroundColorDark?: string;
            fontColorDark?: string;
            hideLoginNameSuffix?: boolean;
            disableWatermark?: boolean;
            themeMode?:
                | 'THEME_MODE_AUTO'
                | 'THEME_MODE_LIGHT'
                | 'THEME_MODE_DARK';
        };
        result: {ok: boolean};
    };
    /** Branding.Activate — promote the draft policy to live on the login page. */
    'branding.activate': {params: {orgId: string}; result: {ok: boolean}};
    /** Branding.Reset — drop the org override; instance default applies. */
    'branding.reset': {params: {orgId: string}; result: {ok: boolean}};
    /** Branding.SetLogo — base64 PNG/SVG/JPEG/WebP, light or dark. */
    'branding.setlogo': {
        params: {
            orgId: string;
            fileBase64: string;
            contentType:
                | 'image/png'
                | 'image/svg+xml'
                | 'image/jpeg'
                | 'image/webp';
            theme: 'light' | 'dark';
        };
        result: {ok: boolean};
    };
    /** Branding.DeleteLogo — drop the uploaded logo. */
    'branding.deletelogo': {
        params: {orgId: string; theme: 'light' | 'dark'};
        result: {ok: boolean};
    };
    /** Branding.SetIcon — favicon-class image, light or dark. */
    'branding.seticon': {
        params: {
            orgId: string;
            fileBase64: string;
            contentType:
                | 'image/png'
                | 'image/svg+xml'
                | 'image/x-icon'
                | 'image/webp';
            theme: 'light' | 'dark';
        };
        result: {ok: boolean};
    };
    /** Branding.DeleteIcon — drop the uploaded icon. */
    'branding.deleteicon': {
        params: {orgId: string; theme: 'light' | 'dark'};
        result: {ok: boolean};
    };
    /** Branding.SetFont — base64 TTF font for login screens. */
    'branding.setfont': {
        params: {
            orgId: string;
            fileBase64: string;
            contentType:
                | 'font/ttf'
                | 'application/font-ttf'
                | 'application/x-font-ttf';
        };
        result: {ok: boolean};
    };
    /** Branding.DeleteFont — drop the uploaded custom font. */
    'branding.deletefont': {params: {orgId: string}; result: {ok: boolean}};
    /** Branding.GetMailTemplate — custom HTML scaffold Zitadel renders every transactional email into. Returns {template, isDefault}. */
    'branding.getmailtemplate': {
        params: {orgId: string};
        result: Record<string, unknown>;
    };
    /** Branding.SetMailTemplate — replace the org email HTML scaffold. Use Go-template placeholders (e.g. {{.Title}}, {{.URL}}). */
    'branding.setmailtemplate': {
        params: {orgId: string; html: string};
        result: {ok: boolean};
    };
    /** Branding.ResetMailTemplate — drop the org override; Zitadel default template applies again. */
    'branding.resetmailtemplate': {
        params: {orgId: string};
        result: {ok: boolean};
    };
    /** Return the branding namespace contract (methods, schemas, permissions, errors). */
    'branding.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List devices that can bridge BLE/BTHome peripherals. */
    'bthome.listgateways': {
        params: Record<string, never>;
        result: {items: Array<{shellyID: string; name: string}>};
    };
    /** Start BTHome device discovery on a gateway. */
    'bthome.startdiscovery': {
        params: {shellyID: string; duration?: number};
        result: {success: true; duration: number};
    };
    /** Manually pair a BTHome device by MAC address. */
    'bthome.device.addmanual': {
        params: {
            shellyID: string;
            mac: string;
            name?: string;
            productName?: string;
            modelId?: string;
        };
        result: {success: true; alreadyPaired: boolean};
    };
    /** Remove a paired BTHome device and its sensors. */
    'bthome.device.remove': {
        params: {shellyID: string; id: number};
        result: {success: true};
    };
    /** Rename a paired BTHome device. */
    'bthome.device.rename': {
        params: {shellyID: string; id: number; name: string | null};
        result: {success: true};
    };
    /** List known objects for a paired BTHome device. */
    'bthome.device.getknownobjects': {
        params: {shellyID: string; id: number};
        result: {id?: number; objects?: unknown[]; knownObjects?: unknown[]};
    };
    /** Set or clear the AES-128 key for a paired BTHome device. */
    'bthome.device.setkey': {
        params: {shellyID: string; id: number; key: string | null};
        result: {success: true};
    };
    /** Read BTHome object metadata from the gateway. */
    'bthome.object.listinfos': {
        params: {shellyID: string; objIds?: number[]};
        result: {
            objects: unknown[];
            offset: number;
            count: number;
            total: number;
        };
    };
    /** Backend-orchestrated BTHome pair workflow. */
    'bthome.sensor.pair': {
        params: {
            shellyID: string;
            mac: string;
            productName?: string;
            modelId?: string;
        };
        result: Record<string, unknown>;
    };
    /** Create a BTHome sensor component from a known object. */
    'bthome.sensor.add': {
        params: {
            shellyID: string;
            id: number;
            addr: string;
            obj_id: number;
            idx: number;
            name?: string;
            meta?: Record<string, unknown>;
            [key: string]: unknown;
        };
        result: {success: true};
    };
    /** Rename a BTHome sensor. */
    'bthome.sensor.rename': {
        params: {shellyID: string; id: number; name: string | null};
        result: {success: true};
    };
    /** Delete a BTHome sensor. */
    'bthome.sensor.delete': {
        params: {shellyID: string; id: number};
        result: {success: true};
    };
    /** Start backend-orchestrated BTHome control learning. */
    'bthome.control.startlearning': {
        params: {shellyID: string; inputId: number};
        result: {success: true};
    };
    /** Stop BTHome control learning. */
    'bthome.control.stoplearning': {
        params: {shellyID: string};
        result: {success: true};
    };
    /** List learned BTHome control bindings. */
    'bthome.control.list': {
        params: {shellyID: string};
        result: {bindings: unknown[]};
    };
    /** Read backend BTHome control learning state. */
    'bthome.control.getlearningstate': {
        params: {shellyID: string};
        result: {state?: Record<string, unknown> | null};
    };
    /** Delete one BTHome control binding, or all when id is omitted. */
    'bthome.control.delete': {
        params: {shellyID: string; id?: number};
        result: Record<string, unknown>;
    };
    /** BTHome.GetConfig (top-level — empty per spec). */
    'bthome.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BTHome.GetStatus — {discovery?, errors[]}. */
    'bthome.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** BTHome.SetConfig (top-level — currently no fields per spec). */
    'bthome.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: null;
    };
    /** BTHome.ResetEncryptionCounter — reset BLU encryption counter. */
    'bthome.resetencryptioncounter': {params: {shellyID: string}; result: null};
    /** BTHomeDevice.GetConfig — per-device config + meta. */
    'bthome.device.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BTHomeDevice.GetStatus — runtime: rssi/battery/last_updated_ts/paired/fw_ver/errors. */
    'bthome.device.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BTHomeDevice.SetConfig — partial config patch (name, key, meta). */
    'bthome.device.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** BTHomeSensor.GetConfig — {id, addr, name, meta, obj_id, idx}. */
    'bthome.sensor.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BTHomeSensor.GetStatus — latest reading {id, value, last_updated_ts}. */
    'bthome.sensor.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BTHomeSensor.SetConfig — partial config patch. */
    'bthome.sensor.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** BTHomeControl.GetConfig — {id, blu_remote_cover_mode}. */
    'bthome.control.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BTHomeControl.GetStatus — full state (different from GetLearningState). */
    'bthome.control.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BTHomeControl.SetConfig — {blu_remote_cover_mode}. restart_required. */
    'bthome.control.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** BTHomeControl.Create — bind a BLU remote to an output component. */
    'bthome.control.create': {
        params: {
            shellyID: string;
            output: string;
            inputs: Array<Record<string, unknown>>;
        };
        result: Record<string, unknown>;
    };
    /** BTHomeControl.Update — replace output/inputs of an existing binding. */
    'bthome.control.update': {
        params: {
            shellyID: string;
            id: number;
            output: string;
            inputs: Array<Record<string, unknown>>;
        };
        result: null;
    };
    /** BTHomeControl.Enumerate — outputs that can be bound to BLU remotes. */
    'bthome.control.enumerate': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the bthome namespace contract (methods, schemas, permissions, errors). */
    'bthome.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Button.Trigger — programmatically fire a button event (single_push / double_push / long_push / ...). */
    'button.trigger': {
        params: {shellyID: string; id: number; event: string};
        result: null;
    };
    /** Button.SetConfig — name / debounce / hold-times. */
    'button.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Button.GetConfig — fetch persisted button config by id. */
    'button.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Button.GetStatus — last event + counters for the button. */
    'button.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the button namespace contract (methods, schemas, permissions, errors). */
    'button.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Apply a partial camera config update. */
    'camera.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Camera.GetConfig. */
    'camera.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Camera.GetStatus. */
    'camera.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** CameraZone.GetConfig. */
    'camera.zone.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** CameraZone.GetStatus. */
    'camera.zone.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Storage.GetStatus. */
    'camera.storage.getstatus': {
        params: {shellyID: string; id?: number};
        result: Record<string, unknown>;
    };
    /** Return the camera capability set for this channel. */
    'camera.getcapabilities': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Trigger a one-shot image capture. */
    'camera.captureimage': {
        params: {shellyID: string; id: number; stream?: number};
        result: Record<string, unknown>;
    };
    /** Start recording to on-device storage. */
    'camera.startrecording': {
        params: {
            shellyID: string;
            id: number;
            duration: number;
            stream: number;
        };
        result: Record<string, unknown>;
    };
    /** Stop an active recording. */
    'camera.stoprecording': {
        params: {shellyID: string; id: number; rec_id?: string};
        result: Record<string, unknown>;
    };
    /** Add a detection zone to the camera. */
    'camera.addzone': {
        params: {
            shellyID: string;
            id: number;
            enable: boolean;
            type: 'motion' | 'privacy';
            coordinates: number[];
            color?: number[];
            name?: string;
        };
        result: Record<string, unknown>;
    };
    /** Remove a detection zone by id. */
    'camera.deletezone': {
        params: {shellyID: string; id: number; zone_id: number};
        result: Record<string, unknown>;
    };
    /** Apply a partial zone config update. */
    'camera.zone.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** List files in on-device storage. */
    'camera.storage.list': {
        params: {shellyID: string; id?: number; offset?: number};
        result: Record<string, unknown>;
    };
    /** Delete a named file from on-device storage. */
    'camera.storage.delete': {
        params: {shellyID: string; id?: number; media_id: string};
        result: Record<string, unknown>;
    };
    /** Format on-device storage (destructive). */
    'camera.storage.format': {
        params: {shellyID: string; id?: number};
        result: Record<string, unknown>;
    };
    /** Eject the storage medium. */
    'camera.storage.eject': {
        params: {shellyID: string; id?: number};
        result: Record<string, unknown>;
    };
    /** Return on-device storage config. */
    'camera.storage.getconfig': {
        params: {shellyID: string; id?: number};
        result: Record<string, unknown>;
    };
    /** Apply a partial storage config update. */
    'camera.storage.setconfig': {
        params: {
            shellyID: string;
            id?: number;
            config: Record<string, unknown>;
        };
        result: Record<string, unknown>;
    };
    /** Streamer.Offer — initiate WebRTC session. */
    'camera.streamer.offer': {
        params: {shellyID: string; ice_servers: unknown[]; stream_id: number};
        result: {sdp?: string; session_id?: string; candidates?: unknown[]};
    };
    /** Streamer.Answer — complete WebRTC handshake. */
    'camera.streamer.answer': {
        params: {
            shellyID: string;
            session_id: string;
            sdp: string;
            candidates: unknown[];
            end_of_candidates: boolean;
        };
        result: Record<string, unknown>;
    };
    /** Streamer.SetStreamSource — switch active stream. */
    'camera.streamer.setstreamsource': {
        params: {shellyID: string; session_id: string; stream_id: number};
        result: Record<string, unknown>;
    };
    /** Streamer.StopStream — end a WebRTC session and free the device stream slot. */
    'camera.streamer.stopstream': {
        params: {shellyID: string; session_id: string};
        result: Record<string, unknown>;
    };
    /** Return the camera namespace contract (methods, schemas, permissions, errors). */
    'camera.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Circuit Breaker status — state, trip cause, last events. */
    'cb.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Circuit Breaker config. */
    'cb.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Circuit Breaker SetConfig — opaque pass-through. */
    'cb.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Circuit Breaker Set — engage (output:true) or disengage (output:false). */
    'cb.set': {
        params: {shellyID: string; id: number; output: boolean};
        result: Record<string, unknown>;
    };
    /** Circuit Breaker activity log — last 50 lever events. */
    'cb.getlog': {
        params: {shellyID: string; id: number; after?: number};
        result: Record<string, unknown>;
    };
    /** Return the cb namespace contract (methods, schemas, permissions, errors). */
    'cb.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** CCT.Set — ct/brightness/transition/state. */
    'cct.set': {
        params: {
            shellyID: string;
            id: number;
            on?: boolean;
            brightness?: number;
            ct?: number;
            transition?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** CCT.Toggle. */
    'cct.toggle': {params: {shellyID: string; id: number}; result: unknown};
    /** CCT.SetConfig. */
    'cct.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** CCT.GetConfig. */
    'cct.getconfig': {params: {shellyID: string; id: number}; result: unknown};
    /** CCT.GetStatus. */
    'cct.getstatus': {params: {shellyID: string; id: number}; result: unknown};
    /** CCT.DimUp — optional fade_rate [1,5]. */
    'cct.dimup': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** CCT.DimDown — optional fade_rate [1,5]. */
    'cct.dimdown': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** CCT.DimStop. */
    'cct.dimstop': {params: {shellyID: string; id: number}; result: unknown};
    /** Return the cct namespace contract (methods, schemas, permissions, errors). */
    'cct.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'certificate.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** List certificates with optional filters. */
    'certificate.list': {
        params: {
            kind?:
                | 'root_ca'
                | 'client_pair'
                | 'server_bundle'
                | 'device'
                | 'other';
            source?: 'imported' | 'fm-issued';
            slot?:
                | 'root_ca'
                | 'client_cert'
                | 'client_key'
                | 'server_ca'
                | 'server_cert'
                | 'server_key';
            tag?: string;
            groupId?: number;
            expiringWithinDays?: number;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Full metadata for one cert. PEM body included only when includePem=true (admin). */
    'certificate.get': {
        params: {id: string; includePem?: boolean};
        result: Record<string, unknown>;
    };
    /** Import an unencrypted PEM cert (and optional unencrypted private key). Encrypted keys / PFX are rejected per Shelly TLS KB. */
    'certificate.import': {
        params: {
            name: string;
            kind:
                | 'root_ca'
                | 'client_pair'
                | 'server_bundle'
                | 'device'
                | 'other';
            pem: string;
            privateKeyPem?: string;
            tags?: string[];
        };
        result: Record<string, unknown>;
    };
    /** Update mutable cert fields (name only). PEM is immutable after import. */
    'certificate.update': {
        params: {id: string; name?: string};
        result: Record<string, unknown>;
    };
    /** Delete a cert. Refuses if currently pushed and not yet replaced. */
    'certificate.delete': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** Replace the tag set on a cert. Free-form labels for filter/search. */
    'certificate.settags': {
        params: {id: string; tags: string[]};
        result: Record<string, unknown>;
    };
    /** Replace the device-group bindings (typed FK to organization.groups). */
    'certificate.setgroups': {
        params: {id: string; groupIds: number[]};
        result: Record<string, unknown>;
    };
    /** Export cert PEM (+ optional private key). Audited every call. */
    'certificate.export': {
        params: {id: string; includePrivateKey?: boolean};
        result: Record<string, unknown>;
    };
    /** FM signs a leaf cert for a shellyID against the local Shelly Fleet Manager Root CA. */
    'certificate.issuedevicecert': {
        params: {shellyId: string; validityDays?: number; name?: string};
        result: Record<string, unknown>;
    };
    /** FM signs an operator-supplied CSR against the local Shelly Fleet Manager Root CA. Operator keeps the private key on the device that generated the CSR. */
    'certificate.signcsr': {
        params: {csrPem: string; validityDays?: number; name?: string};
        result: Record<string, unknown>;
    };
    /** Returns {defaultValidityDays, maxValidityDays} from FM env. Frontend reads these instead of mirroring FM_UI_CERT_* runtime config. */
    'certificate.getissuedefaults': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Resolve the target and report which devices are compatible vs skipped (offline / firmware too old / unsupported key algo / slot incompat) plus warnings (clock skew, enhanced_security off). */
    'certificate.preflightpush': {
        params: {
            certificateId: string;
            slot:
                | 'root_ca'
                | 'client_cert'
                | 'client_key'
                | 'server_ca'
                | 'server_cert'
                | 'server_key';
            target: {
                deviceIds?: string[];
                groupIds?: number[];
                tagKeys?: string[];
            };
        };
        result: Record<string, unknown>;
    };
    /** Queue a push job that fans the cert out to the resolved target devices in the chosen slot. Returns {jobId, deviceCount}. */
    'certificate.pushtodevices': {
        params: {
            certificateId: string;
            slot:
                | 'root_ca'
                | 'client_cert'
                | 'client_key'
                | 'server_ca'
                | 'server_cert'
                | 'server_key';
            target: {
                deviceIds?: string[];
                groupIds?: number[];
                tagKeys?: string[];
            };
        };
        result: Record<string, unknown>;
    };
    /** Polling fallback for the WS push event stream. */
    'certificate.pushstatus': {
        params: {jobId: string};
        result: Record<string, unknown>;
    };
    /** List push history scoped by cert / device / job. */
    'certificate.listpushes': {
        params: {
            certificateId?: string;
            deviceId?: string;
            jobId?: string;
            limit?: number;
            offset?: number;
        };
        result: Record<string, unknown>;
    };
    /** Return backend-driven channel provider descriptors and config schemas. */
    'channel.listproviders': {
        params: Record<string, never>;
        result: {
            items: Array<{
                key:
                    | 'email_smtp'
                    | 'generic_webhook'
                    | 'slack_webhook'
                    | 'teams_workflow_webhook'
                    | 'telegram_bot'
                    | 'push_fcm'
                    | 'sms_twilio'
                    | 'voice_twilio'
                    | 'webhook_signed';
                label: string;
                phaseAvailable: 3 | 4 | 5;
                enabled: boolean;
                configSchema: Record<string, unknown>;
                testSupported: boolean;
                templateFields: string[];
                smtpPresets?: Array<{
                    key: string;
                    label: string;
                    category:
                        | 'personal'
                        | 'workspace'
                        | 'transactional'
                        | 'regional'
                        | 'custom';
                    host: string;
                    port: number;
                    secure: boolean;
                    appPasswordOnly?: boolean;
                    oauthRequired?: boolean;
                    notes?: string;
                    docsUrl?: string;
                }>;
                emailCaps?: {
                    maxAttachments: number;
                    maxAttachmentBytes: number;
                    allowHttpAttachments: boolean;
                    assetOrgQuotaBytes: number;
                    assetAllowedContentTypes: string[];
                };
            }>;
        };
    };
    /** List channels in the caller organization. */
    'channel.list': {
        params: {
            organizationId?: string;
            provider?:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            enabled?: boolean;
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                provider:
                    | 'email_smtp'
                    | 'generic_webhook'
                    | 'slack_webhook'
                    | 'teams_workflow_webhook'
                    | 'telegram_bot'
                    | 'push_fcm'
                    | 'sms_twilio'
                    | 'voice_twilio'
                    | 'webhook_signed';
                name: string;
                enabled: boolean;
                config: Record<string, unknown>;
                secretState: {hasSecretFields: boolean};
                lastTestAt: string | null;
                lastTestStatus: 'success' | 'failed' | null;
                lastDeliveryAt: string | null;
                lastDeliveryStatus: 'success' | 'failed' | null;
                health: {
                    consecutiveFailures: number;
                    lastSuccessAt: string | null;
                    lastFailureAt: string | null;
                    autoDisabledAt: string | null;
                    disableReason: string | null;
                };
                quietHours: {
                    startHour: number;
                    endHour: number;
                    timezone: string;
                } | null;
                createdAt: string;
                updatedAt: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return one channel. */
    'channel.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            provider:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            name: string;
            enabled: boolean;
            config: Record<string, unknown>;
            secretState: {hasSecretFields: boolean};
            lastTestAt: string | null;
            lastTestStatus: 'success' | 'failed' | null;
            lastDeliveryAt: string | null;
            lastDeliveryStatus: 'success' | 'failed' | null;
            health: {
                consecutiveFailures: number;
                lastSuccessAt: string | null;
                lastFailureAt: string | null;
                autoDisabledAt: string | null;
                disableReason: string | null;
            };
            quietHours: {
                startHour: number;
                endHour: number;
                timezone: string;
            } | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Create a channel. Secret fields are stored separately and encrypted. */
    'channel.create': {
        params: {
            organizationId?: string;
            provider:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            name: string;
            enabled?: boolean;
            config: Record<string, unknown>;
            quietHours?: {
                startHour: number;
                endHour: number;
                timezone: string;
            } | null;
        };
        result: {
            id: number;
            organizationId: string;
            provider:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            name: string;
            enabled: boolean;
            config: Record<string, unknown>;
            secretState: {hasSecretFields: boolean};
            lastTestAt: string | null;
            lastTestStatus: 'success' | 'failed' | null;
            lastDeliveryAt: string | null;
            lastDeliveryStatus: 'success' | 'failed' | null;
            health: {
                consecutiveFailures: number;
                lastSuccessAt: string | null;
                lastFailureAt: string | null;
                autoDisabledAt: string | null;
                disableReason: string | null;
            };
            quietHours: {
                startHour: number;
                endHour: number;
                timezone: string;
            } | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Update a channel. Omitted secret fields are preserved. */
    'channel.update': {
        params: {
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                enabled?: boolean;
                config?: Record<string, unknown>;
                quietHours?: {
                    startHour: number;
                    endHour: number;
                    timezone: string;
                } | null;
            };
        };
        result: {
            id: number;
            organizationId: string;
            provider:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            name: string;
            enabled: boolean;
            config: Record<string, unknown>;
            secretState: {hasSecretFields: boolean};
            lastTestAt: string | null;
            lastTestStatus: 'success' | 'failed' | null;
            lastDeliveryAt: string | null;
            lastDeliveryStatus: 'success' | 'failed' | null;
            health: {
                consecutiveFailures: number;
                lastSuccessAt: string | null;
                lastFailureAt: string | null;
                autoDisabledAt: string | null;
                disableReason: string | null;
            };
            quietHours: {
                startHour: number;
                endHour: number;
                timezone: string;
            } | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete a channel if no destination groups still reference it. */
    'channel.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean; id: number};
    };
    /** Validate and optionally send a provider-specific test message through the channel. */
    'channel.test': {
        params: {
            organizationId?: string;
            id: number;
            dryRun?: boolean;
            payload?: {title?: string; message?: string};
        };
        result: {
            channelId: number;
            state: 'success' | 'failed';
            testedAt: string;
            errorMessage: string | null;
        };
    };
    /** Clear consecutive_failures + auto_disabled_at and (by default) re-enable after an auto-disable. */
    'channel.resethealth': {
        params: {organizationId?: string; id: number; reEnable?: boolean};
        result: {
            id: number;
            organizationId: string;
            provider:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            name: string;
            enabled: boolean;
            config: Record<string, unknown>;
            secretState: {hasSecretFields: boolean};
            lastTestAt: string | null;
            lastTestStatus: 'success' | 'failed' | null;
            lastDeliveryAt: string | null;
            lastDeliveryStatus: 'success' | 'failed' | null;
            health: {
                consecutiveFailures: number;
                lastSuccessAt: string | null;
                lastFailureAt: string | null;
                autoDisabledAt: string | null;
                disableReason: string | null;
            };
            quietHours: {
                startHour: number;
                endHour: number;
                timezone: string;
            } | null;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Return the channel namespace contract (methods, schemas, permissions, errors). */
    'channel.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Client.SetSubscription — narrow the current socket session feed to specific event types and/or device IDs. Empty params clear the filter. */
    'client.setsubscription': {
        params: {eventTypes?: string[]; deviceIds?: string[]};
        result: {ok: boolean};
    };
    /** Return the client namespace contract (methods, schemas, permissions, errors). */
    'client.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Cloud.SetConfig — toggle Shelly cloud connection. */
    'cloud.setconfig': {
        params: {shellyID: string; config: {enable?: boolean; server?: string}};
        result: {restart_required: boolean};
    };
    /** Cloud.GetConfig — current Shelly cloud config. */
    'cloud.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Cloud.GetStatus — Shelly cloud connectivity state. */
    'cloud.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the cloud namespace contract (methods, schemas, permissions, errors). */
    'cloud.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Cover.Open — optional duration in seconds. */
    'cover.open': {
        params: {
            shellyID: string;
            id: number;
            duration?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** Cover.Close — optional duration in seconds. */
    'cover.close': {
        params: {
            shellyID: string;
            id: number;
            duration?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** Cover.Stop. */
    'cover.stop': {params: {shellyID: string; id: number}; result: unknown};
    /** Cover.GoToPosition — pos and/or slat_pos. */
    'cover.gotoposition': {
        params: {
            shellyID: string;
            id: number;
            pos?: number;
            slat_pos?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** Cover.Calibrate. */
    'cover.calibrate': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Cover.SetConfig. */
    'cover.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** Cover.ResetCounters. */
    'cover.resetcounters': {
        params: {shellyID: string; id: number; types?: string[]};
        result: unknown;
    };
    /** Cover.GetConfig. */
    'cover.getconfig': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Cover.GetStatus. */
    'cover.getstatus': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Return the cover namespace contract (methods, schemas, permissions, errors). */
    'cover.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'credential.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** List per-device credentials (no plaintext). Filters by device or last_rotation_status. */
    'credential.list': {
        params: {
            deviceId?: string;
            status?: 'ok' | 'failed' | 'unknown';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Single device credential metadata (no plaintext). */
    'credential.get': {
        params: {deviceId: string};
        result: Record<string, unknown>;
    };
    /** Admin-only plaintext reveal. Audited every call, rate-limited via FM_CREDENTIAL_REVEAL_PER_ADMIN_PER_DAY. */
    'credential.reveal': {
        params: {deviceId: string; justification?: string};
        result: Record<string, unknown>;
    };
    /** Operator-initiated rotation. Generates a strong random password and pushes via Shelly.SetAuth. Failed devices excluded from bulk by default; pass includeFlagged=true to override. */
    'credential.rotate': {
        params: {
            target: {
                deviceIds?: string[];
                groupIds?: number[];
                tagKeys?: string[];
            };
            includeFlagged?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** Set a specific password on a single device. Plaintext returned once in response. */
    'credential.set': {
        params: {deviceId: string; password: string};
        result: Record<string, unknown>;
    };
    /** Disable Web UI auth on the target devices via Shelly.SetAuth ha1=null. */
    'credential.clear': {
        params: {
            target: {
                deviceIds?: string[];
                groupIds?: number[];
                tagKeys?: string[];
            };
        };
        result: Record<string, unknown>;
    };
    /** Retry a failed push using the stored new ha1. Recovers from transient device errors. */
    'credential.retry': {
        params: {pushId: number};
        result: Record<string, unknown>;
    };
    /** Operator confirms a failed push left the device on its previous password — clears the flag without retrying. */
    'credential.confirmold': {
        params: {pushId: number};
        result: Record<string, unknown>;
    };
    /** List devices whose last rotation failed (action surface). */
    'credential.listfailed': {
        params: {limit?: number; offset?: number};
        result: Record<string, unknown>;
    };
    /** Polling fallback for credential push job state and per-device rows. */
    'credential.pushstatus': {
        params: {jobId: string};
        result: Record<string, unknown>;
    };
    /** List credential push history scoped by device / job / status. */
    'credential.listpushes': {
        params: {
            deviceId?: string;
            jobId?: string;
            status?: 'queued' | 'in_progress' | 'ok' | 'failed' | 'unknown';
            limit?: number;
            offset?: number;
        };
        result: Record<string, unknown>;
    };
    /** Cury.GetConfig. */
    'cury.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Cury.SetConfig. */
    'cury.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Cury.GetStatus. */
    'cury.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Cury.SetMode — inserts predefined schedules for room type. */
    'cury.setmode': {
        params: {
            shellyID: string;
            id: number;
            mode?:
                | null
                | 'hall'
                | 'bedroom'
                | 'living_room'
                | 'lavatory_room'
                | 'reception'
                | 'workplace';
        };
        result: null;
    };
    /** Cury.SetAwayMode — toggle away mode. */
    'cury.setawaymode': {
        params: {shellyID: string; id: number; on: boolean};
        result: null;
    };
    /** Cury.Set — control vial slot heating. */
    'cury.set': {
        params: {
            shellyID: string;
            id: number;
            slot: 'left' | 'right';
            on?: boolean;
            intensity?: number;
        };
        result: null;
    };
    /** Cury.Boost — start boost on slot. */
    'cury.boost': {
        params: {shellyID: string; id: number; slot: 'left' | 'right'};
        result: {boost?: {started_at?: number; duration?: number}};
    };
    /** Cury.StopBoost — cancel active boost on slot. */
    'cury.stopboost': {
        params: {shellyID: string; id: number; slot: 'left' | 'right'};
        result: {was_on?: boolean};
    };
    /** Cury.GetVialInfo. */
    'cury.getvialinfo': {
        params: {shellyID: string; id: number; slot?: 'left' | 'right'};
        result: Record<string, unknown>;
    };
    /** Return the cury namespace contract (methods, schemas, permissions, errors). */
    'cury.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** DALI.GetConfig (singleton — empty per spec). */
    'dali.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** DALI.SetConfig (singleton — currently no fields per spec). */
    'dali.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** DALI.GetStatus. */
    'dali.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** DALI.StartScan; result arrives via scan_complete NotifyEvent. */
    'dali.startscan': {params: {shellyID: string}; result: null};
    /** DALI.PingKnownDevices; result arrives via ping_complete NotifyEvent. */
    'dali.pingknowndevices': {params: {shellyID: string}; result: null};
    /** Group.GetStatus on DALI-capable firmware. */
    'dali.group.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Group.GetConfig on DALI-capable firmware. */
    'dali.group.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Group.SetConfig on DALI-capable firmware. */
    'dali.group.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Group.Set on DALI-capable firmware. */
    'dali.group.set': {
        params: {
            shellyID: string;
            id: number;
            on?: boolean;
            brightness?: number;
            transition?: number;
        };
        result: Record<string, unknown>;
    };
    /** Return the dali namespace contract (methods, schemas, permissions, errors). */
    'dali.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List dashboards scoped to the caller organization. Trusted senders may pass organizationId to override. */
    'dashboard.list': {
        params: {organizationId?: string};
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                dashboardType:
                    | 'classic'
                    | 'analytics'
                    | 'overview'
                    | 'energy'
                    | 'environment'
                    | 'control'
                    | 'safety'
                    | 'map';
                scope: {groupId?: number; locationId?: number; tagId?: number};
                isDefault: boolean;
                isPinned: boolean;
                displayOrder: number | null;
                settings: {
                    tariff: number | null;
                    currency: string | null;
                    defaultRange: string;
                    refreshInterval: number;
                    enabledMetrics: string[];
                    chartSettings: Record<string, unknown>;
                    tariffMode: 'single' | 'day_night' | 'tou';
                    dayRate: number | null;
                    nightRate: number | null;
                    dayStart: string;
                    dayEnd: string;
                    tariffTimezone: string | null;
                    tariffWindows: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays: string[] | null;
                    emissionFactorGPerKWh: number | null;
                    emissionFactorMbmGPerKWh: number | null;
                    co2BudgetKg?: number | null;
                    tariffId?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
                items: Array<{
                    id: number;
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order: number;
                    size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                    mobileLayout: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                createdAt: string;
                updatedAt: string | null;
            }>;
            total: number;
        };
    };
    /** Fetch a single dashboard by id. */
    'dashboard.get': {
        params: {id: number};
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Fetch per-dashboard user preferences (tariff, currency, default range, enabled metrics, ...). Returns defaults when unset. */
    'dashboard.getsettings': {
        params: {dashboardId: number};
        result: {
            dashboardId: number;
            tariff?: number | null;
            currency?: string | null;
            defaultRange?: string | null;
            refreshInterval?: number | null;
            enabledMetrics?: string[];
            chartSettings?: Record<string, unknown>;
            tariffMode?: 'single' | 'day_night' | 'tou';
            dayRate?: number | null;
            nightRate?: number | null;
            dayStart?: string;
            dayEnd?: string;
            tariffTimezone?: string | null;
            tariffWindows?: Array<{
                from: string;
                to: string;
                rate: number;
                label: string;
            }> | null;
            tariffWeekendOverride?: Array<{
                from: string;
                to: string;
                rate: number;
                label: string;
            }> | null;
            tariffHolidays?: string[] | null;
            emissionFactorGPerKWh?: number | null;
            emissionFactorMbmGPerKWh?: number | null;
            co2BudgetKg?: number | null;
            tariffId?: number | null;
            peakDeviceIds?: string[] | null;
            pvMode?: 'parallel' | 'backup' | 'balcony' | null;
            pvGridRefs?: Array<{
                device: string;
                channel?: number | null;
            }> | null;
            pvGenerationRefs?: Array<{
                device: string;
                channel?: number | null;
            }> | null;
            [key: string]: unknown;
        };
    };
    /** Upsert any subset of the dashboard settings fields. */
    'dashboard.setsettings': {
        params: {
            dashboardId: number;
            tariff?: number;
            tariffId?: number | null;
            currency?: string;
            defaultRange?: string;
            refreshInterval?: number;
            enabledMetrics?: string[];
            chartSettings?: Record<string, unknown>;
            tariffMode?: 'single' | 'day_night' | 'tou';
            dayRate?: number | null;
            nightRate?: number | null;
            dayStart?: string;
            dayEnd?: string;
            tariffTimezone?: string | null;
            tariffWindows?: Array<{
                from: string;
                to: string;
                rate: number;
                label: string;
            }> | null;
            tariffWeekendOverride?: Array<{
                from: string;
                to: string;
                rate: number;
                label: string;
            }> | null;
            tariffHolidays?: string[] | null;
            emissionFactorGPerKWh?: number | null;
            emissionFactorMbmGPerKWh?: number | null;
            co2BudgetKg?: number | null;
            peakDeviceIds?: string[] | null;
            pvMode?: 'parallel' | 'backup' | 'balcony' | null;
            pvGridRefs?: Array<{
                device: string;
                channel?: number | null;
            }> | null;
            pvGenerationRefs?: Array<{
                device: string;
                channel?: number | null;
            }> | null;
        };
        result: {success: true; dashboardId: number};
    };
    /** Create a dashboard. dashboardType: classic / analytics / overview / energy / environment / control / safety / map. Optional scope axis: locationId, groupId, or tagId (mutually exclusive). */
    'dashboard.create': {
        params: {
            organizationId?: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope?: {locationId?: number; groupId?: number; tagId?: number};
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Patch name / dashboardType / scope. scope: null clears every axis; scope: { locationId | groupId | tagId } (exactly one) replaces the current axis. Cross-org refs rejected with DomainError CrossOrgReference. */
    'dashboard.update': {
        params: {
            id: number;
            name?: string;
            dashboardType?:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope?: null | {
                locationId?: number;
                groupId?: number;
                tagId?: number;
            };
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete a dashboard and all its items. */
    'dashboard.delete': {params: {id: number}; result: {deleted: number}};
    /** Delete multiple dashboards and all their items in one call. Org-scoped: only the caller org’s dashboards are removed; returns the ids actually deleted. */
    'dashboard.deletebulk': {
        params: {ids: number[]};
        result: {deleted: number[]};
    };
    /** Add a widget to a dashboard. Returns the new item id. */
    'dashboard.additem': {
        params: {
            dashboard: number;
            type: number;
            item: number;
            order?: number;
            sub_item?: string | null;
            size?: string;
        };
        result: {id: number};
    };
    /** Resize a widget in-place. */
    'dashboard.updateitemsize': {
        params: {dashboard: number; itemId: number; size: string};
        result: {updated: number; size: string};
    };
    /** Remove a widget from a dashboard. */
    'dashboard.removeitem': {
        params: {dashboard: number; itemId: number};
        result: {removed: number};
    };
    /** Reorder widgets by passing the new itemId sequence. */
    'dashboard.reorderitems': {
        params: {dashboard: number; itemIds: number[]};
        result: {reordered: number};
    };
    /** Persist per-user dashboard ordering. Server filters unknown ids and appends visible ids the caller omitted. */
    'dashboard.reorder': {
        params: {ids: number[]};
        result: {ok: boolean; ids: number[]};
    };
    /** Return the UI registry snapshot (widgets, menu items, available dashboard types). */
    'dashboard.getuiconfig': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** List items on a dashboard (new structured shape). */
    'dashboard.item.list': {
        params: {dashboardId: number};
        result: {
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
        };
    };
    /** Add a single item by {kind, deviceId|groupId|locationId|tagId|actionId|widgetKind, ...}. Returns updated dashboard. */
    'dashboard.item.add': {
        params: {
            dashboardId: number;
            kind:
                | 'device'
                | 'entity'
                | 'group'
                | 'location'
                | 'tag'
                | 'action'
                | 'widget';
            deviceId?: number | null;
            entitySubId?: string | null;
            groupId?: number | null;
            locationId?: number | null;
            tagId?: number | null;
            actionId?: number | null;
            widgetKind?: string | null;
            widgetConfig?: Record<string, unknown> | null;
            order?: number;
            size?: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
            mobileLayout?: null | {
                hidden?: boolean;
                size?: '1x1' | '2x1' | '1x2' | '2x2';
                order?: number;
            };
            gridX?: number | null;
            gridY?: number | null;
            gridW?: number | null;
            gridH?: number | null;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Insert N items in one call. Returns the updated dashboard. */
    'dashboard.item.addbulk': {
        params: {
            dashboardId: number;
            items: Array<{
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order?: number;
                size?: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout?: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Patch size / entitySubId / widgetConfig / order / mobileLayout. Returns updated dashboard. */
    'dashboard.item.update': {
        params: {
            dashboardId: number;
            itemId: number;
            size?: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
            entitySubId?: string | null;
            widgetConfig?: Record<string, unknown> | null;
            order?: number;
            mobileLayout?: null | {
                hidden?: boolean;
                size?: '1x1' | '2x1' | '1x2' | '2x2';
                order?: number;
            };
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Remove a single item. Returns updated dashboard. */
    'dashboard.item.remove': {
        params: {dashboardId: number; itemId: number};
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Atomically set item order from the supplied id sequence. Returns updated dashboard. */
    'dashboard.item.reorder': {
        params: {dashboardId: number; itemIds: number[]};
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Replace all items in one transaction. Returns updated dashboard. */
    'dashboard.item.setall': {
        params: {
            dashboardId: number;
            items: Array<{
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order?: number;
                size?: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout?: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** List templates available to the org (org-scoped + builtins; org overrides shadow). */
    'dashboard.template.list': {
        params: {
            dashboardType?:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            includeBuiltin?: boolean;
            organizationId?: string;
        };
        result: {
            items: Array<{
                key: string;
                label: string;
                description?: string | null;
                dashboardType:
                    | 'classic'
                    | 'analytics'
                    | 'overview'
                    | 'energy'
                    | 'environment'
                    | 'control'
                    | 'safety'
                    | 'map';
                organizationId: string | null;
                isBuiltin: boolean;
                seed: {
                    detectsEntityTypes?: string[];
                    staticItems?: Array<{
                        kind:
                            | 'device'
                            | 'entity'
                            | 'group'
                            | 'location'
                            | 'tag'
                            | 'action'
                            | 'widget';
                        deviceId?: number | null;
                        entitySubId?: string | null;
                        groupId?: number | null;
                        locationId?: number | null;
                        tagId?: number | null;
                        actionId?: number | null;
                        widgetKind?: string | null;
                        widgetConfig?: Record<string, unknown> | null;
                        order?: number;
                        size?:
                            | '1x1'
                            | '2x1'
                            | '2x2'
                            | '1x2'
                            | '4x1'
                            | '4x2'
                            | '4x4';
                        mobileLayout?: null | {
                            hidden?: boolean;
                            size?: '1x1' | '2x1' | '1x2' | '2x2';
                            order?: number;
                        };
                        gridX?: number | null;
                        gridY?: number | null;
                        gridW?: number | null;
                        gridH?: number | null;
                    }>;
                    settings?: {
                        tariff?: number | null;
                        currency?: string | null;
                        defaultRange?: string;
                        refreshInterval?: number;
                        enabledMetrics?: string[];
                        chartSettings?: Record<string, unknown>;
                        tariffMode?: 'single' | 'day_night' | 'tou';
                        dayRate?: number | null;
                        nightRate?: number | null;
                        dayStart?: string;
                        dayEnd?: string;
                        tariffTimezone?: string | null;
                        tariffWindows?: Array<{
                            from: string;
                            to: string;
                            rate: number;
                            label: string;
                        }> | null;
                        tariffWeekendOverride?: Array<{
                            from: string;
                            to: string;
                            rate: number;
                            label: string;
                        }> | null;
                        tariffHolidays?: string[] | null;
                        emissionFactorGPerKWh?: number | null;
                        emissionFactorMbmGPerKWh?: number | null;
                        co2BudgetKg?: number | null;
                        peakDeviceIds?: string[] | null;
                        pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                        pvGridRefs?: Array<{
                            device: string;
                            channel?: number | null;
                        }> | null;
                        pvGenerationRefs?: Array<{
                            device: string;
                            channel?: number | null;
                        }> | null;
                    };
                };
                createdAt: string;
                updatedAt?: string | null;
            }>;
        };
    };
    /** Resolve a template by key (org-scoped first, then builtin). */
    'dashboard.template.get': {
        params: {key: string; organizationId?: string};
        result: {
            key: string;
            label: string;
            description?: string | null;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            organizationId: string | null;
            isBuiltin: boolean;
            seed: {
                detectsEntityTypes?: string[];
                staticItems?: Array<{
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order?: number;
                    size?:
                        | '1x1'
                        | '2x1'
                        | '2x2'
                        | '1x2'
                        | '4x1'
                        | '4x2'
                        | '4x4';
                    mobileLayout?: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                settings?: {
                    tariff?: number | null;
                    currency?: string | null;
                    defaultRange?: string;
                    refreshInterval?: number;
                    enabledMetrics?: string[];
                    chartSettings?: Record<string, unknown>;
                    tariffMode?: 'single' | 'day_night' | 'tou';
                    dayRate?: number | null;
                    nightRate?: number | null;
                    dayStart?: string;
                    dayEnd?: string;
                    tariffTimezone?: string | null;
                    tariffWindows?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays?: string[] | null;
                    emissionFactorGPerKWh?: number | null;
                    emissionFactorMbmGPerKWh?: number | null;
                    co2BudgetKg?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
            };
            createdAt: string;
            updatedAt?: string | null;
        };
    };
    /** Show what items the template would materialize against the given scope (without creating). */
    'dashboard.template.preview': {
        params: {
            key: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            organizationId?: string;
        };
        result: {
            items: Array<{
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order?: number;
                size?: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout?: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            missingDevices: number;
        };
    };
    /** Create an org-scoped template. Cannot create builtins via API. */
    'dashboard.template.create': {
        params: {
            key: string;
            label: string;
            description?: string | null;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            seed: {
                detectsEntityTypes?: string[];
                staticItems?: Array<{
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order?: number;
                    size?:
                        | '1x1'
                        | '2x1'
                        | '2x2'
                        | '1x2'
                        | '4x1'
                        | '4x2'
                        | '4x4';
                    mobileLayout?: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                settings?: {
                    tariff?: number | null;
                    currency?: string | null;
                    defaultRange?: string;
                    refreshInterval?: number;
                    enabledMetrics?: string[];
                    chartSettings?: Record<string, unknown>;
                    tariffMode?: 'single' | 'day_night' | 'tou';
                    dayRate?: number | null;
                    nightRate?: number | null;
                    dayStart?: string;
                    dayEnd?: string;
                    tariffTimezone?: string | null;
                    tariffWindows?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays?: string[] | null;
                    emissionFactorGPerKWh?: number | null;
                    emissionFactorMbmGPerKWh?: number | null;
                    co2BudgetKg?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
            };
            organizationId?: string;
        };
        result: {
            key: string;
            label: string;
            description?: string | null;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            organizationId: string | null;
            isBuiltin: boolean;
            seed: {
                detectsEntityTypes?: string[];
                staticItems?: Array<{
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order?: number;
                    size?:
                        | '1x1'
                        | '2x1'
                        | '2x2'
                        | '1x2'
                        | '4x1'
                        | '4x2'
                        | '4x4';
                    mobileLayout?: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                settings?: {
                    tariff?: number | null;
                    currency?: string | null;
                    defaultRange?: string;
                    refreshInterval?: number;
                    enabledMetrics?: string[];
                    chartSettings?: Record<string, unknown>;
                    tariffMode?: 'single' | 'day_night' | 'tou';
                    dayRate?: number | null;
                    nightRate?: number | null;
                    dayStart?: string;
                    dayEnd?: string;
                    tariffTimezone?: string | null;
                    tariffWindows?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays?: string[] | null;
                    emissionFactorGPerKWh?: number | null;
                    emissionFactorMbmGPerKWh?: number | null;
                    co2BudgetKg?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
            };
            createdAt: string;
            updatedAt?: string | null;
        };
    };
    /** Patch label / description / seed of an org-scoped template. Builtins are read-only. */
    'dashboard.template.update': {
        params: {
            key: string;
            label?: string;
            description?: string | null;
            seed?: {
                detectsEntityTypes?: string[];
                staticItems?: Array<{
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order?: number;
                    size?:
                        | '1x1'
                        | '2x1'
                        | '2x2'
                        | '1x2'
                        | '4x1'
                        | '4x2'
                        | '4x4';
                    mobileLayout?: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                settings?: {
                    tariff?: number | null;
                    currency?: string | null;
                    defaultRange?: string;
                    refreshInterval?: number;
                    enabledMetrics?: string[];
                    chartSettings?: Record<string, unknown>;
                    tariffMode?: 'single' | 'day_night' | 'tou';
                    dayRate?: number | null;
                    nightRate?: number | null;
                    dayStart?: string;
                    dayEnd?: string;
                    tariffTimezone?: string | null;
                    tariffWindows?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays?: string[] | null;
                    emissionFactorGPerKWh?: number | null;
                    emissionFactorMbmGPerKWh?: number | null;
                    co2BudgetKg?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
            };
            organizationId?: string;
        };
        result: {
            key: string;
            label: string;
            description?: string | null;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            organizationId: string | null;
            isBuiltin: boolean;
            seed: {
                detectsEntityTypes?: string[];
                staticItems?: Array<{
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order?: number;
                    size?:
                        | '1x1'
                        | '2x1'
                        | '2x2'
                        | '1x2'
                        | '4x1'
                        | '4x2'
                        | '4x4';
                    mobileLayout?: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                settings?: {
                    tariff?: number | null;
                    currency?: string | null;
                    defaultRange?: string;
                    refreshInterval?: number;
                    enabledMetrics?: string[];
                    chartSettings?: Record<string, unknown>;
                    tariffMode?: 'single' | 'day_night' | 'tou';
                    dayRate?: number | null;
                    nightRate?: number | null;
                    dayStart?: string;
                    dayEnd?: string;
                    tariffTimezone?: string | null;
                    tariffWindows?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays?: string[] | null;
                    emissionFactorGPerKWh?: number | null;
                    emissionFactorMbmGPerKWh?: number | null;
                    co2BudgetKg?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
            };
            createdAt: string;
            updatedAt?: string | null;
        };
    };
    /** Delete an org-scoped template. Builtins are read-only. */
    'dashboard.template.delete': {
        params: {key: string; organizationId?: string};
        result: {deleted: string};
    };
    /** Capture a dashboard's items + settings as a new org-scoped template. */
    'dashboard.template.savefromdashboard': {
        params: {
            dashboardId: number;
            key: string;
            label: string;
            description?: string | null;
            organizationId?: string;
        };
        result: {
            key: string;
            label: string;
            description?: string | null;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            organizationId: string | null;
            isBuiltin: boolean;
            seed: {
                detectsEntityTypes?: string[];
                staticItems?: Array<{
                    kind:
                        | 'device'
                        | 'entity'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'action'
                        | 'widget';
                    deviceId?: number | null;
                    entitySubId?: string | null;
                    groupId?: number | null;
                    locationId?: number | null;
                    tagId?: number | null;
                    actionId?: number | null;
                    widgetKind?: string | null;
                    widgetConfig?: Record<string, unknown> | null;
                    order?: number;
                    size?:
                        | '1x1'
                        | '2x1'
                        | '2x2'
                        | '1x2'
                        | '4x1'
                        | '4x2'
                        | '4x4';
                    mobileLayout?: null | {
                        hidden?: boolean;
                        size?: '1x1' | '2x1' | '1x2' | '2x2';
                        order?: number;
                    };
                    gridX?: number | null;
                    gridY?: number | null;
                    gridW?: number | null;
                    gridH?: number | null;
                }>;
                settings?: {
                    tariff?: number | null;
                    currency?: string | null;
                    defaultRange?: string;
                    refreshInterval?: number;
                    enabledMetrics?: string[];
                    chartSettings?: Record<string, unknown>;
                    tariffMode?: 'single' | 'day_night' | 'tou';
                    dayRate?: number | null;
                    nightRate?: number | null;
                    dayStart?: string;
                    dayEnd?: string;
                    tariffTimezone?: string | null;
                    tariffWindows?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffWeekendOverride?: Array<{
                        from: string;
                        to: string;
                        rate: number;
                        label: string;
                    }> | null;
                    tariffHolidays?: string[] | null;
                    emissionFactorGPerKWh?: number | null;
                    emissionFactorMbmGPerKWh?: number | null;
                    co2BudgetKg?: number | null;
                    peakDeviceIds?: string[] | null;
                    pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                    pvGridRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                    pvGenerationRefs?: Array<{
                        device: string;
                        channel?: number | null;
                    }> | null;
                };
            };
            createdAt: string;
            updatedAt?: string | null;
        };
    };
    /** Returns the org's current default dashboard id, or null if none set. */
    'dashboard.getdefault': {
        params: {organizationId?: string};
        result: {id?: number | null};
    };
    /** Marks one dashboard as default; clears any other default for this org atomically. */
    'dashboard.setdefault': {
        params: {id: number; organizationId?: string};
        result: {id: number};
    };
    /** Clear the org default dashboard. */
    'dashboard.cleardefault': {
        params: {organizationId?: string};
        result: Record<string, never>;
    };
    /** Per-user pinned dashboards (sortOrder, pinnedAt). Survives across devices. */
    'dashboard.listpinned': {
        params: Record<string, never>;
        result: {
            items: Array<{
                dashboardId: number;
                sortOrder: number;
                pinnedAt: string;
            }>;
        };
    };
    /** Pin a dashboard for the calling user. */
    'dashboard.pin': {
        params: {id: number; sortOrder?: number};
        result: {pinned: true};
    };
    /** Unpin a dashboard for the calling user. */
    'dashboard.unpin': {params: {id: number}; result: {unpinned: true}};
    /** Reorder pinned dashboards by passing the new id sequence. */
    'dashboard.reorderpins': {
        params: {ids: number[]};
        result: Record<string, never>;
    };
    /** Deep-copy a dashboard within the same org. Optional scope override. */
    'dashboard.clone': {
        params: {
            id: number;
            name: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Export a dashboard. format: 'fm' (default) returns the Dashboard shape; 'grafana' returns Grafana JSON (schemaVersion 39). */
    'dashboard.export': {
        params: {id: number; format?: 'fm' | 'grafana'};
        result: {format: 'fm' | 'grafana'; json: Record<string, unknown>};
    };
    /** Import a dashboard. format: 'fm' (default) accepts the Dashboard shape; 'grafana' accepts Grafana JSON (schemaVersion ≥ 39). */
    'dashboard.import': {
        params: {
            json: Record<string, unknown>;
            format?: 'fm' | 'grafana';
            name?: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            organizationId?: string;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            dashboardType:
                | 'classic'
                | 'analytics'
                | 'overview'
                | 'energy'
                | 'environment'
                | 'control'
                | 'safety'
                | 'map';
            scope: {groupId?: number; locationId?: number; tagId?: number};
            isDefault: boolean;
            isPinned: boolean;
            displayOrder: number | null;
            settings: {
                tariff: number | null;
                currency: string | null;
                defaultRange: string;
                refreshInterval: number;
                enabledMetrics: string[];
                chartSettings: Record<string, unknown>;
                tariffMode: 'single' | 'day_night' | 'tou';
                dayRate: number | null;
                nightRate: number | null;
                dayStart: string;
                dayEnd: string;
                tariffTimezone: string | null;
                tariffWindows: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffWeekendOverride: Array<{
                    from: string;
                    to: string;
                    rate: number;
                    label: string;
                }> | null;
                tariffHolidays: string[] | null;
                emissionFactorGPerKWh: number | null;
                emissionFactorMbmGPerKWh: number | null;
                co2BudgetKg?: number | null;
                tariffId?: number | null;
                peakDeviceIds?: string[] | null;
                pvMode?: 'parallel' | 'backup' | 'balcony' | null;
                pvGridRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
                pvGenerationRefs?: Array<{
                    device: string;
                    channel?: number | null;
                }> | null;
            };
            items: Array<{
                id: number;
                kind:
                    | 'device'
                    | 'entity'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'action'
                    | 'widget';
                deviceId?: number | null;
                entitySubId?: string | null;
                groupId?: number | null;
                locationId?: number | null;
                tagId?: number | null;
                actionId?: number | null;
                widgetKind?: string | null;
                widgetConfig?: Record<string, unknown> | null;
                order: number;
                size: '1x1' | '2x1' | '2x2' | '1x2' | '4x1' | '4x2' | '4x4';
                mobileLayout: null | {
                    hidden?: boolean;
                    size?: '1x1' | '2x1' | '1x2' | '2x2';
                    order?: number;
                };
                gridX?: number | null;
                gridY?: number | null;
                gridW?: number | null;
                gridH?: number | null;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** List recent activity for one dashboard (create, update, share, etc.). Newest first; clamped to 200 entries. */
    'dashboard.activity.list': {
        params: {dashboardId: number; limit?: number};
        result: {
            items: Array<{
                id: number;
                dashboardId: number;
                organizationId: string;
                actorUserId: string | null;
                eventKind:
                    | 'created'
                    | 'updated'
                    | 'shared'
                    | 'unshared'
                    | 'cloned'
                    | 'pinned'
                    | 'unpinned'
                    | 'owner_changed'
                    | 'item_added'
                    | 'item_removed';
                detail: Record<string, unknown>;
                occurredAt: string;
            }>;
        };
    };
    /** Return the dashboard namespace contract (methods, schemas, permissions, errors). */
    'dashboard.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Paginated slim device list (capability-filtered per user). */
    'device.list': {
        params: {
            filters?: Record<string, unknown>;
            limit?: number;
            offset?: number;
            include?: string[];
            [key: string]: unknown;
        };
        result: {
            items: unknown[];
            total: number;
            limit?: number;
            offset?: number;
            has_more?: boolean;
        };
    };
    /** Device metadata only — no status/settings/memberships. */
    'device.getinfo': {
        params: {shellyID: string};
        result: {shellyID?: string; [key: string]: unknown};
    };
    /** Device configuration profiles. */
    'device.getsetup': {
        params: {shellyID?: string; mode?: 'json' | 'rpc'};
        result: Record<string, unknown>;
    };
    /** Raw device RPC escape hatch for advanced/admin integrations. Prefer semantic Fleet Manager APIs for product flows. */
    'device.call': {
        params: {
            shellyID: string;
            method: string;
            params?: Record<string, unknown>;
        };
        result: Record<string, unknown>;
    };
    /** Full device object by shellyID. */
    'device.get': {params: {shellyID: string}; result: Record<string, unknown>};
    /** Permanently purge a device and all its history. Irreversible — the everyday delete should use Retire. */
    'device.delete': {params: {shellyID: string}; result: {deleted: string}};
    /** Retire (soft-delete) a device: hide it from fleet lists but keep its id and history. Reversible via Restore. */
    'device.retire': {params: {shellyID: string}; result: {retired: string}};
    /** Restore a retired device with its full history. */
    'device.restore': {params: {shellyID: string}; result: {restored: string}};
    /** List retired devices (the trash) available to restore or purge. */
    'device.listretired': {
        params: Record<string, never>;
        result: {
            devices: Array<{
                id?: number;
                external_id?: string;
                organization_id?: string;
                kind?: string | null;
                deleted_at?: string;
            }>;
        };
    };
    /** Check whether a newly admitted Shelly can replace an existing Fleet device without breaking logical-meter point usage. */
    'device.checkreplacement': {
        params: {oldShellyID: string; newShellyID: string};
        result: {
            oldShellyID: string;
            newShellyID: string;
            oldDeviceId: number;
            newDeviceId: number;
            compatibility:
                | 'exact_match'
                | 'compatible_mapping'
                | 'incompatible';
            requirements: Array<{
                channel: number;
                phase: 'a' | 'b' | 'c' | 'z';
                tag: string;
                electricalDomain?: string | null;
                logicalMeterId?: number;
                logicalMeterName?: string;
                utilityType?: string;
                role?: string;
                source?: 'history' | 'live';
                componentKey?: string | null;
                [key: string]: unknown;
            }>;
            available: Array<{
                channel: number;
                phase: 'a' | 'b' | 'c' | 'z';
                tag: string;
                electricalDomain?: string | null;
                logicalMeterId?: number;
                logicalMeterName?: string;
                utilityType?: string;
                role?: string;
                source?: 'history' | 'live';
                componentKey?: string | null;
                [key: string]: unknown;
            }>;
            missing: Array<{
                channel: number;
                phase: 'a' | 'b' | 'c' | 'z';
                tag: string;
                electricalDomain?: string | null;
                logicalMeterId?: number;
                logicalMeterName?: string;
                utilityType?: string;
                role?: string;
                source?: 'history' | 'live';
                componentKey?: string | null;
                [key: string]: unknown;
            }>;
            remapCandidates: Array<{
                required: {
                    channel: number;
                    phase: 'a' | 'b' | 'c' | 'z';
                    tag: string;
                    electricalDomain?: string | null;
                    logicalMeterId?: number;
                    logicalMeterName?: string;
                    utilityType?: string;
                    role?: string;
                    source?: 'history' | 'live';
                    componentKey?: string | null;
                    [key: string]: unknown;
                };
                candidates: Array<{
                    channel: number;
                    phase: 'a' | 'b' | 'c' | 'z';
                    tag: string;
                    electricalDomain?: string | null;
                    logicalMeterId?: number;
                    logicalMeterName?: string;
                    utilityType?: string;
                    role?: string;
                    source?: 'history' | 'live';
                    componentKey?: string | null;
                    [key: string]: unknown;
                }>;
            }>;
            warnings: string[];
        };
    };
    /** Atomically keep the old Fleet device id but swap it to the new physical Shelly external id, with an audit row. */
    'device.replacehardware': {
        params: {
            oldShellyID: string;
            newShellyID: string;
            confirmedMapping?: Record<string, unknown>;
        };
        result: {
            deviceId: number;
            oldShellyID: string;
            newShellyID: string;
            auditId: number;
        };
    };
    /** Get the catalog kind classification for a device (null = unclassified). */
    'device.getkind': {
        params: {shellyID: string};
        result: {
            shellyID: string;
            kind: string | null;
            costCenter?: string | null;
        };
    };
    /** Set the device catalog kind. Pass kind=null to clear it. */
    'device.setkind': {
        params: {
            shellyID: string;
            kind: string | null;
            costCenter?: string | null;
        };
        result: {
            shellyID: string;
            kind: string | null;
            costCenter?: string | null;
        };
    };
    /** Override the stock product image with a library asset (UUID). Pass imageAssetId=null to clear the override. */
    'device.setimage': {
        params: {
            shellyID: string;
            imageAssetId: string | null;
            icon?: string | null;
            accent?: string | null;
        };
        result: {
            shellyID: string;
            imageAssetId: string | null;
            icon: string | null;
            accent: string | null;
        };
    };
    /** Read the per-physical-device image override. Returns imageAssetId=null when no override is set. */
    'device.getimage': {
        params: {shellyID: string};
        result: {
            shellyID: string;
            imageAssetId: string | null;
            icon: string | null;
            accent: string | null;
        };
    };
    /** Device EM channel inventory. */
    'device.getdevicechannels': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Device online/offline timeline over a time range. */
    'device.getstatustimeline': {
        params: {shellyID: string; field: string; from: string; to: string};
        result: {
            shellyID: string;
            field: string;
            from: string;
            to: string;
            data: Array<{
                ts?: unknown;
                value?: number | null;
                prevValue?: number | null;
            }>;
        };
    };
    /** Device status chart time-series. */
    'device.getstatushistory': {
        params: {shellyID: string; field: string; from: string; to: string};
        result: {
            shellyID: string;
            field: string;
            from: string;
            to: string;
            data: Array<{
                bucket?: string;
                avgVal?: number | null;
                minVal?: number | null;
                maxVal?: number | null;
            }>;
        };
    };
    /** Cytoscape-shaped {nodes, edges} for visualization. Edges come from BT-mesh bthomedevice parent→children and cross-device thermostat→switch actuator bindings (intra-device shelly://self/... is omitted). Nodes carry type ("hub"=paired host, "device"=plain host or BLE peer) + status ("on"|"off"|"warn"; BLE peers default to "warn" since liveness is not known). Scope via groupId / locationId / shellyID; unscoped returns the full accessible fleet. Group containment is computed client-side from group memberships, not emitted here. */
    'device.topology': {
        params: {groupId?: number; locationId?: number; shellyID?: string};
        result: {
            nodes: Array<{
                id: string;
                label: string;
                type: 'hub' | 'device' | 'group';
                status?: 'on' | 'off' | 'warn';
            }>;
            edges: Array<{source: string; target: string; weight?: number}>;
        };
    };
    /** Read a backend-owned relationship graph for one center device. Current implementation supports bounded depth=1 or depth=2 traversal and direction filtering. */
    'device.relationships.get': {
        params: {
            shellyID: string;
            depth?: 1 | 2;
            include?: Array<
                | 'membership'
                | 'visuals'
                | 'costCenter'
                | 'serves'
                | 'components'
                | 'virtualBindings'
                | 'virtualDependents'
                | 'bluetooth'
                | 'provenance'
                | 'extraction'
                | 'alerts'
                | 'automations'
                | 'notificationRouting'
                | 'dashboards'
                | 'energyClassification'
                | 'operations'
                | 'securityState'
                | 'accessGrants'
                | 'deviceSchedules'
                | 'deviceScripts'
                | 'deviceWebhooks'
                | 'deviceSubresources'
                | 'externalConnections'
                | 'health'
                | 'recentHistory'
            >;
            direction?: 'both' | 'outgoing' | 'incoming';
        };
        result: {
            center: string;
            nodes: Array<{
                id: string;
                type:
                    | 'device.physical'
                    | 'device.bluetooth'
                    | 'device.virtual'
                    | 'device.extracted'
                    | 'device.connector'
                    | 'component'
                    | 'entity'
                    | 'virtual.role'
                    | 'blu.transport'
                    | 'profile'
                    | 'asset.visual'
                    | 'cost.center'
                    | 'group'
                    | 'location'
                    | 'tag'
                    | 'dashboard'
                    | 'dashboard.item'
                    | 'action.template'
                    | 'automation.flow'
                    | 'automation.node'
                    | 'alert.rule'
                    | 'maintenance.window'
                    | 'notification.routing_policy'
                    | 'notification.destination_group'
                    | 'notification.channel'
                    | 'notification.on_call_schedule'
                    | 'energy.classification'
                    | 'history.event'
                    | 'operation.job'
                    | 'operation.unit'
                    | 'credential.state'
                    | 'certificate'
                    | 'assignment.grant'
                    | 'user'
                    | 'user.group'
                    | 'device.schedule'
                    | 'device.script'
                    | 'device.webhook'
                    | 'device.subresource'
                    | 'external.connection'
                    | 'connector.point';
                label: string;
                status?:
                    | 'healthy'
                    | 'warning'
                    | 'critical'
                    | 'unknown'
                    | 'disabled'
                    | 'stale'
                    | 'offline'
                    | 'unavailable';
                externalId?: string;
                kind?: string;
                icon?: string;
                imageAssetId?: string | null;
                meta?: Record<string, unknown>;
            }>;
            edges: Array<{
                id: string;
                type:
                    | 'has_component'
                    | 'has_entity'
                    | 'binds_role_to_source'
                    | 'source_feeds_virtual_role'
                    | 'depends_on_source'
                    | 'used_by_virtual_device'
                    | 'extracts_from'
                    | 'promoted_from_gateway_component'
                    | 'transported_by_gateway'
                    | 'heard_by_gateway'
                    | 'uses_profile'
                    | 'has_visual_asset'
                    | 'charged_to_cost_center'
                    | 'serves'
                    | 'belongs_to_group'
                    | 'located_in'
                    | 'tagged_with'
                    | 'child_of_group'
                    | 'child_of_location'
                    | 'shown_on_dashboard'
                    | 'dashboard_contains_item'
                    | 'dashboard_item_refs_device'
                    | 'dashboard_item_refs_entity'
                    | 'dashboard_item_refs_component'
                    | 'dashboard_item_refs_group'
                    | 'dashboard_item_refs_location'
                    | 'dashboard_item_refs_tag'
                    | 'dashboard_item_refs_action'
                    | 'automation_refs_device'
                    | 'device_event_feeds_automation'
                    | 'automation_calls_rpc'
                    | 'targets_device'
                    | 'has_credential_state'
                    | 'has_certificate'
                    | 'grants_access_to_device'
                    | 'grant_assigned_to_subject'
                    | 'controls'
                    | 'controlled_by'
                    | 'watched_by_alert_rule'
                    | 'suppressed_by_maintenance_window'
                    | 'routes_alert_to_destination_group'
                    | 'routes_alert_to_channel'
                    | 'routes_alert_to_on_call_schedule'
                    | 'destination_group_contains_channel'
                    | 'classified_as_energy_role'
                    | 'recorded_history_event'
                    | 'used_by_device_schedule'
                    | 'runs_device_script'
                    | 'triggers_device_webhook'
                    | 'hosts_device_subresource'
                    | 'subresource_refs_component'
                    | 'virtual_group_contains_component'
                    | 'ledstrip_effect_uses_script'
                    | 'has_connector_point'
                    | 'configured_external_connection'
                    | 'external_connection_refs_component'
                    | 'connector_point_maps_to_component'
                    | 'replaced_source'
                    | 'retired_source';
                source: string;
                target: string;
                label?: string;
                status?:
                    | 'healthy'
                    | 'warning'
                    | 'critical'
                    | 'unknown'
                    | 'disabled'
                    | 'stale'
                    | 'offline'
                    | 'unavailable';
                direction: 'outgoing' | 'incoming';
                meta?: Record<string, unknown>;
            }>;
            summaries: Array<{
                severity: 'info' | 'warning' | 'critical';
                text: string;
                nodeIds?: string[];
                edgeIds?: string[];
                reasonCode?: string;
            }>;
            generatedAt: string;
            depth: 1 | 2;
            truncated: boolean;
        };
    };
    /** Read a paged, backend-owned relationship graph set for accessible devices. Results are derived from device.Relationships.Get; no materialized relationship table is used. */
    'device.relationships.query': {
        params: {
            shellyIDs?: string[];
            depth?: 1 | 2;
            include?: Array<
                | 'membership'
                | 'visuals'
                | 'costCenter'
                | 'serves'
                | 'components'
                | 'virtualBindings'
                | 'virtualDependents'
                | 'bluetooth'
                | 'provenance'
                | 'extraction'
                | 'alerts'
                | 'automations'
                | 'notificationRouting'
                | 'dashboards'
                | 'energyClassification'
                | 'operations'
                | 'securityState'
                | 'accessGrants'
                | 'deviceSchedules'
                | 'deviceScripts'
                | 'deviceWebhooks'
                | 'deviceSubresources'
                | 'externalConnections'
                | 'health'
                | 'recentHistory'
            >;
            direction?: 'both' | 'outgoing' | 'incoming';
            limit?: number;
            cursor?: string;
        };
        result: {
            items: Array<{
                center: string;
                nodes: Array<{
                    id: string;
                    type:
                        | 'device.physical'
                        | 'device.bluetooth'
                        | 'device.virtual'
                        | 'device.extracted'
                        | 'device.connector'
                        | 'component'
                        | 'entity'
                        | 'virtual.role'
                        | 'blu.transport'
                        | 'profile'
                        | 'asset.visual'
                        | 'cost.center'
                        | 'group'
                        | 'location'
                        | 'tag'
                        | 'dashboard'
                        | 'dashboard.item'
                        | 'action.template'
                        | 'automation.flow'
                        | 'automation.node'
                        | 'alert.rule'
                        | 'maintenance.window'
                        | 'notification.routing_policy'
                        | 'notification.destination_group'
                        | 'notification.channel'
                        | 'notification.on_call_schedule'
                        | 'energy.classification'
                        | 'history.event'
                        | 'operation.job'
                        | 'operation.unit'
                        | 'credential.state'
                        | 'certificate'
                        | 'assignment.grant'
                        | 'user'
                        | 'user.group'
                        | 'device.schedule'
                        | 'device.script'
                        | 'device.webhook'
                        | 'device.subresource'
                        | 'external.connection'
                        | 'connector.point';
                    label: string;
                    status?:
                        | 'healthy'
                        | 'warning'
                        | 'critical'
                        | 'unknown'
                        | 'disabled'
                        | 'stale'
                        | 'offline'
                        | 'unavailable';
                    externalId?: string;
                    kind?: string;
                    icon?: string;
                    imageAssetId?: string | null;
                    meta?: Record<string, unknown>;
                }>;
                edges: Array<{
                    id: string;
                    type:
                        | 'has_component'
                        | 'has_entity'
                        | 'binds_role_to_source'
                        | 'source_feeds_virtual_role'
                        | 'depends_on_source'
                        | 'used_by_virtual_device'
                        | 'extracts_from'
                        | 'promoted_from_gateway_component'
                        | 'transported_by_gateway'
                        | 'heard_by_gateway'
                        | 'uses_profile'
                        | 'has_visual_asset'
                        | 'charged_to_cost_center'
                        | 'serves'
                        | 'belongs_to_group'
                        | 'located_in'
                        | 'tagged_with'
                        | 'child_of_group'
                        | 'child_of_location'
                        | 'shown_on_dashboard'
                        | 'dashboard_contains_item'
                        | 'dashboard_item_refs_device'
                        | 'dashboard_item_refs_entity'
                        | 'dashboard_item_refs_component'
                        | 'dashboard_item_refs_group'
                        | 'dashboard_item_refs_location'
                        | 'dashboard_item_refs_tag'
                        | 'dashboard_item_refs_action'
                        | 'automation_refs_device'
                        | 'device_event_feeds_automation'
                        | 'automation_calls_rpc'
                        | 'targets_device'
                        | 'has_credential_state'
                        | 'has_certificate'
                        | 'grants_access_to_device'
                        | 'grant_assigned_to_subject'
                        | 'controls'
                        | 'controlled_by'
                        | 'watched_by_alert_rule'
                        | 'suppressed_by_maintenance_window'
                        | 'routes_alert_to_destination_group'
                        | 'routes_alert_to_channel'
                        | 'routes_alert_to_on_call_schedule'
                        | 'destination_group_contains_channel'
                        | 'classified_as_energy_role'
                        | 'recorded_history_event'
                        | 'used_by_device_schedule'
                        | 'runs_device_script'
                        | 'triggers_device_webhook'
                        | 'hosts_device_subresource'
                        | 'subresource_refs_component'
                        | 'virtual_group_contains_component'
                        | 'ledstrip_effect_uses_script'
                        | 'has_connector_point'
                        | 'configured_external_connection'
                        | 'external_connection_refs_component'
                        | 'connector_point_maps_to_component'
                        | 'replaced_source'
                        | 'retired_source';
                    source: string;
                    target: string;
                    label?: string;
                    status?:
                        | 'healthy'
                        | 'warning'
                        | 'critical'
                        | 'unknown'
                        | 'disabled'
                        | 'stale'
                        | 'offline'
                        | 'unavailable';
                    direction: 'outgoing' | 'incoming';
                    meta?: Record<string, unknown>;
                }>;
                summaries: Array<{
                    severity: 'info' | 'warning' | 'critical';
                    text: string;
                    nodeIds?: string[];
                    edgeIds?: string[];
                    reasonCode?: string;
                }>;
                generatedAt: string;
                depth: 1 | 2;
                truncated: boolean;
            }>;
            nextCursor?: string;
            generatedAt: string;
            truncated: boolean;
        };
    };
    /** Return the device namespace contract (methods, schemas, permissions, errors). */
    'device.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Search the device change journal by time range, device IDs, component, and kind. */
    'deviceevents.query': {
        params: {
            from?: string;
            to?: string;
            shellyIds?: string[];
            component?: string;
            kind?: 'state_change' | 'event' | 'config';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                ts: string;
                received_ts?: string;
                shelly_id: string;
                organization_id?: string | null;
                component: string;
                field: string;
                prev?: unknown;
                next?: unknown;
                kind: 'state_change' | 'event' | 'config';
                source?: 'device' | 'command' | 'unknown' | null;
                [key: string]: unknown;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return the deviceevents namespace contract (methods, schemas, permissions, errors). */
    'deviceevents.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List built-in device ingress security/config profiles. */
    'deviceingress.profile.list': {
        params: Record<string, never>;
        result: {
            items: Array<{
                id:
                    | 'wall-display-local-ws'
                    | 'shelly-pro-em-wss-token'
                    | 'shelly-pro-em-wss-certificate'
                    | 'modbus-tcp-connector';
                name: string;
                securityModel: 'certificate' | 'direct_token' | 'connector';
                transport:
                    | 'wss'
                    | 'ws'
                    | 'modbus_tcp'
                    | 'ble'
                    | 'cloud_api'
                    | 'connector_internal';
                riskLevel: 'strong' | 'compatible' | 'legacy';
                [key: string]: unknown;
            }>;
        };
    };
    /** Which device auth methods this deployment accepts — the single source of truth for the UI. Certificate is always false for Shelly WS. */
    'deviceingress.authmethods': {
        params: Record<string, never>;
        result: {token: boolean; approvedId: boolean; certificate: boolean};
    };
    /** Create an org-scoped ingress identity. */
    'deviceingress.identity.create': {
        params: {
            subjectType:
                | 'device'
                | 'connector'
                | 'gateway'
                | 'represented_device';
            subjectId: string;
            displayName: string;
            securityModel: 'certificate' | 'direct_token' | 'connector';
            transport:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            riskLevel: 'strong' | 'compatible' | 'legacy';
            expectedExternalId?: string | null;
            scopeKind?: 'device' | 'group' | 'location' | null;
            scopeRef?: string | null;
        };
        result: {
            id: string;
            organizationId: string;
            subjectType:
                | 'device'
                | 'connector'
                | 'gateway'
                | 'represented_device';
            subjectId: string;
            displayName: string;
            securityModel: 'certificate' | 'direct_token' | 'connector';
            transport:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            riskLevel: 'strong' | 'compatible' | 'legacy';
            status:
                | 'pending'
                | 'active'
                | 'disabled'
                | 'quarantined'
                | 'deleted';
            expectedExternalId?: string | null;
            lastSeenAt?: string | null;
            [key: string]: unknown;
        };
    };
    /** Get one org-scoped ingress identity. */
    'deviceingress.identity.get': {
        params: {id: string};
        result: {
            id: string;
            organizationId: string;
            subjectType:
                | 'device'
                | 'connector'
                | 'gateway'
                | 'represented_device';
            subjectId: string;
            displayName: string;
            securityModel: 'certificate' | 'direct_token' | 'connector';
            transport:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            riskLevel: 'strong' | 'compatible' | 'legacy';
            status:
                | 'pending'
                | 'active'
                | 'disabled'
                | 'quarantined'
                | 'deleted';
            expectedExternalId?: string | null;
            lastSeenAt?: string | null;
            [key: string]: unknown;
        };
    };
    /** Update operator-editable ingress identity metadata. */
    'deviceingress.identity.update': {
        params: {
            id: string;
            displayName?: string;
            expectedExternalId?: string | null;
        };
        result: {
            id: string;
            organizationId: string;
            subjectType:
                | 'device'
                | 'connector'
                | 'gateway'
                | 'represented_device';
            subjectId: string;
            displayName: string;
            securityModel: 'certificate' | 'direct_token' | 'connector';
            transport:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            riskLevel: 'strong' | 'compatible' | 'legacy';
            status:
                | 'pending'
                | 'active'
                | 'disabled'
                | 'quarantined'
                | 'deleted';
            expectedExternalId?: string | null;
            lastSeenAt?: string | null;
            [key: string]: unknown;
        };
    };
    /** Disable an ingress identity and close live connections. */
    'deviceingress.identity.disable': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** List org-scoped ingress identities. */
    'deviceingress.identity.list': {
        params: {
            status?:
                | 'pending'
                | 'active'
                | 'disabled'
                | 'quarantined'
                | 'deleted';
            securityModel?: 'certificate' | 'direct_token' | 'connector';
            transport?:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            limit?: number;
            offset?: number;
        };
        result: Record<string, unknown>;
    };
    /** Create a direct-token credential and return the raw token once. */
    'deviceingress.credential.createtoken': {
        params: {identityId: string; validityDays?: number};
        result: Record<string, unknown>;
    };
    /** Create a pending replacement credential. */
    'deviceingress.credential.rotate': {
        params: {
            identityId: string;
            credentialType: 'certificate' | 'token';
            validityDays?: number;
            certificateId?: string;
        };
        result: Record<string, unknown>;
    };
    /** Finalize a pending credential rotation. */
    'deviceingress.credential.finalizerotation': {
        params: {credentialId: string};
        result: Record<string, unknown>;
    };
    /** Cancel a pending credential rotation. */
    'deviceingress.credential.cancelrotation': {
        params: {credentialId: string};
        result: Record<string, unknown>;
    };
    /** Revoke a credential and close matching live sockets. */
    'deviceingress.credential.revoke': {
        params: {credentialId: string};
        result: Record<string, unknown>;
    };
    /** Mint a device-agnostic, time-boxed enrollment token; returns the one-time link. */
    'deviceingress.enrollmenttoken.create': {
        params: {
            validityMinutes: number;
            maxUses?: number;
            preferredProfileId?:
                | 'wall-display-local-ws'
                | 'shelly-pro-em-wss-token'
                | 'shelly-pro-em-wss-certificate'
                | 'modbus-tcp-connector';
        };
        result: Record<string, unknown>;
    };
    /** List the org enrollment tokens. */
    'deviceingress.enrollmenttoken.list': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Revoke an active enrollment token before it is used. */
    'deviceingress.enrollmenttoken.revoke': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** List ingress connection history and live connection rows. */
    'deviceingress.connection.list': {
        params: {
            identityId?: string;
            result?: 'accepted' | 'waiting_room' | 'rejected';
            limit?: number;
            offset?: number;
        };
        result: Record<string, unknown>;
    };
    /** Get one org-scoped ingress connection row. */
    'deviceingress.connection.get': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** Disconnect a live ingress connection and mark history. */
    'deviceingress.connection.disconnect': {
        params: {id: string; reason?: string};
        result: Record<string, unknown>;
    };
    /** List rejected ingress attempts with fixable/blocked filters. */
    'deviceingress.rejection.list': {
        params: {
            severity?: 'fixable' | 'blocked';
            reasonCode?:
                | 'token_expired'
                | 'pending_token_not_finalized'
                | 'certificate_expired'
                | 'certificate_not_yet_valid'
                | 'wrong_transport'
                | 'legacy_ws_disabled'
                | 'connection_cap_reached'
                | 'rate_limit_exceeded'
                | 'identity_disabled'
                | 'device_not_bound'
                | 'token_revoked'
                | 'certificate_revoked'
                | 'certificate_cross_org'
                | 'device_id_mismatch'
                | 'blocked_ip'
                | 'operator_quarantine'
                | 'credential_replay_suspected'
                | 'unknown_security_model'
                | 'malformed_handshake';
            limit?: number;
            offset?: number;
        };
        result: Record<string, unknown>;
    };
    /** Resolve a rejected ingress entry after operator action. */
    'deviceingress.rejection.resolve': {
        params: {id: string; note?: string};
        result: Record<string, unknown>;
    };
    /** Create a mobile/local provisioning plan. Certificate setup also requires certificate management permission. */
    'deviceingress.setup.plan': {
        params: {
            reportedExternalId: string;
            model?: string;
            firmware?: string;
            capabilities?: Record<string, unknown>;
            preferredProfileId?:
                | 'wall-display-local-ws'
                | 'shelly-pro-em-wss-token'
                | 'shelly-pro-em-wss-certificate'
                | 'modbus-tcp-connector';
            certificateId?: string;
            certificateCsrPem?: string;
            issueCertificate?: boolean;
            certificateName?: string;
            certificateValidityDays?: number;
        };
        result: {
            sessionId: string;
            identity: {
                id: string;
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'connector'
                    | 'gateway'
                    | 'represented_device';
                subjectId: string;
                displayName: string;
                securityModel: 'certificate' | 'direct_token' | 'connector';
                transport:
                    | 'wss'
                    | 'ws'
                    | 'modbus_tcp'
                    | 'ble'
                    | 'cloud_api'
                    | 'connector_internal';
                riskLevel: 'strong' | 'compatible' | 'legacy';
                status:
                    | 'pending'
                    | 'active'
                    | 'disabled'
                    | 'quarantined'
                    | 'deleted';
                expectedExternalId?: string | null;
                lastSeenAt?: string | null;
                [key: string]: unknown;
            };
            credential: {
                id?: string;
                identityId?: string;
                credentialType?: 'certificate' | 'token';
                state?:
                    | 'active'
                    | 'pending'
                    | 'expired'
                    | 'revoked'
                    | 'superseded';
                tokenPrefix?: string | null;
                certificateId?: string | null;
                certificateFingerprint?: string | null;
                notBefore?: string | null;
                notAfter?: string | null;
                [key: string]: unknown;
            } | null;
            profile: {
                id:
                    | 'wall-display-local-ws'
                    | 'shelly-pro-em-wss-token'
                    | 'shelly-pro-em-wss-certificate'
                    | 'modbus-tcp-connector';
                name: string;
                securityModel: 'certificate' | 'direct_token' | 'connector';
                transport:
                    | 'wss'
                    | 'ws'
                    | 'modbus_tcp'
                    | 'ble'
                    | 'cloud_api'
                    | 'connector_internal';
                riskLevel: 'strong' | 'compatible' | 'legacy';
                [key: string]: unknown;
            };
            preferredApplyMethod:
                | 'ble'
                | 'local_http'
                | 'ws_rpc'
                | 'connector'
                | 'manual';
            expiresAt: string;
            bundle: {
                organizationId: string;
                identityId: string;
                securityModel: 'certificate' | 'direct_token' | 'connector';
                transport:
                    | 'wss'
                    | 'ws'
                    | 'modbus_tcp'
                    | 'ble'
                    | 'cloud_api'
                    | 'connector_internal';
                riskLevel: 'strong' | 'compatible' | 'legacy';
                applyMethod:
                    | 'ble'
                    | 'local_http'
                    | 'ws_rpc'
                    | 'connector'
                    | 'manual';
                deviceConfig: {
                    ws: {
                        enable: boolean;
                        server: string;
                        ssl_ca?: string;
                        [key: string]: unknown;
                    };
                    [key: string]: unknown;
                };
                certificates?: unknown;
                tokenOnce?: string;
                warnings?: string[];
                requiresReboot: boolean;
                sessionId?: string;
                [key: string]: unknown;
            };
            [key: string]: unknown;
        };
    };
    /** Fetch a short-lived provisioning bundle. Certificate bundles also require certificate management permission. */
    'deviceingress.setup.bundle': {
        params: {sessionId: string};
        result: {
            id: string;
            organizationId: string;
            profileId:
                | 'wall-display-local-ws'
                | 'shelly-pro-em-wss-token'
                | 'shelly-pro-em-wss-certificate'
                | 'modbus-tcp-connector';
            status: string;
            bundle: {
                organizationId: string;
                identityId: string;
                securityModel: 'certificate' | 'direct_token' | 'connector';
                transport:
                    | 'wss'
                    | 'ws'
                    | 'modbus_tcp'
                    | 'ble'
                    | 'cloud_api'
                    | 'connector_internal';
                riskLevel: 'strong' | 'compatible' | 'legacy';
                applyMethod:
                    | 'ble'
                    | 'local_http'
                    | 'ws_rpc'
                    | 'connector'
                    | 'manual';
                deviceConfig: {
                    ws: {
                        enable: boolean;
                        server: string;
                        ssl_ca?: string;
                        [key: string]: unknown;
                    };
                    [key: string]: unknown;
                };
                certificates?: unknown;
                tokenOnce?: string;
                warnings?: string[];
                requiresReboot: boolean;
                sessionId?: string;
                [key: string]: unknown;
            };
            bundleFetchCount?: number;
            expiresAt?: string;
            [key: string]: unknown;
        };
    };
    /** Report mobile/local provisioning apply result. */
    'deviceingress.setup.reportapply': {
        params: {
            sessionId: string;
            status: 'applied' | 'partial' | 'failed';
            applyMethod:
                | 'ble'
                | 'local_http'
                | 'ws_rpc'
                | 'connector'
                | 'manual';
            errorCode?: string;
            errorMessage?: string;
        };
        result: Record<string, unknown>;
    };
    /** Return the deviceIngress namespace contract (methods, schemas, permissions, errors). */
    'deviceingress.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** DevicePower.SetConfig — config object (currently empty per spec). */
    'devicepower.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: null;
    };
    /** DevicePower.GetConfig. */
    'devicepower.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** DevicePower.GetStatus — {id, battery:{V,percent}, external:{present}}. */
    'devicepower.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the devicepower namespace contract (methods, schemas, permissions, errors). */
    'devicepower.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Reach out to a device at a given host (IP or hostname), configure its outbound websocket to point at FM, reboot it, and record an admission intent so it auto-joins the requesting org on reconnect. */
    'discovery.admitdevice': {
        params: {
            host: string;
            password?: string;
            organizationId?: string;
            groupId?: number;
        };
        result: {
            shellyId: string;
            gen: 2 | 3 | 4;
            rebootingMs: number;
            intentRecorded: true;
            expectedConnectionWithinSec: number;
        };
    };
    /** Read-only probe of a LAN-reachable Shelly device by IP or hostname. Returns its identity, firmware, and whether it requires auth or is already in this organization's fleet. No mutation — the wizard shows this to the user before AdmitDevice writes the WS config. */
    'discovery.probe': {
        params: {host: string; organizationId?: string};
        result: {
            ip: string;
            shellyId: string;
            gen: 2 | 3 | 4;
            model: string;
            ver: string;
            mac: string;
            authRequired: boolean;
            authDomain: string | null;
            alreadyKnown: boolean;
            inWaitingRoom: boolean;
        };
    };
    /** Active mDNS sweep for Shelly devices on the local network, cross-referenced with the device list and active admission intents. */
    'discovery.scanlan': {
        params: {timeoutMs?: number; organizationId?: string};
        result: {
            hits: Array<{
                ip: string;
                shellyId: string;
                model: string;
                gen: 1 | 2 | 3 | 4;
                mac: string;
                alreadyKnown: boolean;
                inWaitingRoom: boolean;
            }>;
            scannedAt: string;
            durationMs: number;
            warnings: string[];
        };
    };
    /** Return the discovery namespace contract (methods, schemas, permissions, errors). */
    'discovery.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** domain_policy.GetPolicy — per-org domain policy (effective). */
    'domain_policy.getpolicy': {
        params: {orgId: string};
        result: Record<string, unknown>;
    };
    /** domain_policy.SetPolicy — write per-org domain policy override. */
    'domain_policy.setpolicy': {
        params: {
            orgId: string;
            userLoginMustBeDomain?: boolean;
            validateOrgDomains?: boolean;
            smtpSenderAddressMatchesInstanceDomain?: boolean;
        };
        result: {ok: boolean};
    };
    /** domain_policy.Reset — drop org override; instance default applies. */
    'domain_policy.reset': {params: {orgId: string}; result: {ok: boolean}};
    /** domain_policy.GetInstance — instance-wide default policy. */
    'domain_policy.getinstance': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** domain_policy.SetInstance — instance-wide default policy. */
    'domain_policy.setinstance': {
        params: {
            userLoginMustBeDomain?: boolean;
            validateOrgDomains?: boolean;
            smtpSenderAddressMatchesInstanceDomain?: boolean;
        };
        result: {ok: boolean};
    };
    /** Return the domain_policy namespace contract (methods, schemas, permissions, errors). */
    'domain_policy.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** EM.SetConfig — triphase energy meter config. */
    'em.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** EM.GetConfig. */
    'em.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EM.GetStatus. */
    'em.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EM.GetCTTypes — supported current-transformer types. */
    'em.getcttypes': {
        params: {shellyID: string; id: number};
        result: {supported: string[]};
    };
    /** EM.PhaseToPhaseCalib — phases must carry equal voltage and a minimum load. */
    'em.phasetophasecalib': {
        params: {shellyID: string; id: number; from: string; to: string};
        result: null;
    };
    /** EM.PhaseToPhaseCalibReset — clears one phase calibration. */
    'em.phasetophasecalibreset': {
        params: {shellyID: string; id: number; phase: string};
        result: null;
    };
    /** Return the em namespace contract (methods, schemas, permissions, errors). */
    'em.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** EM1.SetConfig — monophase energy meter config. */
    'em1.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** EM1.GetConfig. */
    'em1.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EM1.GetStatus. */
    'em1.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EM1.GetCTTypes — supported current-transformer types. */
    'em1.getcttypes': {
        params: {shellyID: string; id: number};
        result: {supported: string[]};
    };
    /** EM1.CalibrateFrom — calibrate this phase from another. Requires >=500W load. */
    'em1.calibratefrom': {
        params: {shellyID: string; id: number; other_id: number};
        result: {restart_required: boolean};
    };
    /** EM1.RevertToFactoryCalibration. */
    'em1.reverttofactorycalibration': {
        params: {shellyID: string; id: number};
        result: {restart_required: boolean};
    };
    /** Return the em1 namespace contract (methods, schemas, permissions, errors). */
    'em1.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** EM1Data.SetConfig. */
    'em1data.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** EM1Data.GetConfig. */
    'em1data.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EM1Data.GetStatus. */
    'em1data.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EM1Data.GetData — saved emeter data values. */
    'em1data.getdata': {
        params: {
            shellyID: string;
            id: number;
            ts: number;
            end_ts?: number;
            add_keys?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** EM1Data.GetRecords — saved emeter data time intervals. */
    'em1data.getrecords': {
        params: {shellyID: string; id: number; ts?: number};
        result: Record<string, unknown>;
    };
    /** EM1Data.GetNetEnergies — period must be 300/900/1800/3600 (device-validated). */
    'em1data.getnetenergies': {
        params: {
            shellyID: string;
            id: number;
            ts: number;
            period: number;
            end_ts?: number;
            add_keys?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** EM1Data.ResetCounters. */
    'em1data.resetcounters': {
        params: {shellyID: string; id: number};
        result: null;
    };
    /** EM1Data.DeleteAllData — wipes device-side history (irreversible). */
    'em1data.deletealldata': {
        params: {shellyID: string; id: number};
        result: null;
    };
    /** Return the em1data namespace contract (methods, schemas, permissions, errors). */
    'em1data.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** EMData.SetConfig. */
    'emdata.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** EMData.GetConfig. */
    'emdata.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EMData.GetStatus. */
    'emdata.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** EMData.GetData — saved emeter data values. {keys, data:[{ts, period, values}]}. */
    'emdata.getdata': {
        params: {
            shellyID: string;
            id: number;
            ts: number;
            end_ts?: number;
            add_keys?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** EMData.GetRecords — saved emeter data time intervals. */
    'emdata.getrecords': {
        params: {shellyID: string; id: number; ts?: number};
        result: Record<string, unknown>;
    };
    /** EMData.GetNetEnergies — period must be 300/900/1800/3600 (device-validated). */
    'emdata.getnetenergies': {
        params: {
            shellyID: string;
            id: number;
            ts: number;
            period: number;
            end_ts?: number;
            add_keys?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** EMData.ResetCounters. */
    'emdata.resetcounters': {
        params: {shellyID: string; id: number};
        result: null;
    };
    /** EMData.DeleteAllData — wipes device-side history (irreversible). */
    'emdata.deletealldata': {
        params: {shellyID: string; id: number};
        result: null;
    };
    /** Return the emdata namespace contract (methods, schemas, permissions, errors). */
    'emdata.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Unified time-series read for energy (device_em.stats) and sensor (device_sensor) tags. Group / devices / fleet scope selected by params. Mixed tag sets fan out in parallel. Values are scaled to display units (kWh / V / A / W / °C / % / lux). Omit limit to return the full set (up to the server OOM ceiling); set limit to paginate. total is a lower bound, not exact — has_more is the authoritative "more data exists" signal. */
    'energy.query': {
        params: {
            from: string;
            to: string;
            tags: Array<
                | 'total_act_energy'
                | 'total_act_ret_energy'
                | 'volume_l'
                | 'volume_m3'
                | 'thermal_energy_kwh'
                | 'power'
                | 'volume_flow_m3h'
                | 'volume_storage_l'
                | 'voltage'
                | 'current'
                | 'min_voltage'
                | 'max_voltage'
                | 'min_current'
                | 'max_current'
                | 'soc'
                | 'soh'
                | 'cycles'
                | 'charge_ah'
                | 'discharge_ah'
                | 'temperature'
                | 'humidity'
                | 'luminance'
                | 'pressure'
                | 'dewpoint'
                | 'co2'
                | 'tvoc'
                | 'pm25'
                | 'pm10'
                | 'moisture'
                | 'uv'
                | 'conductivity'
                | 'wind_direction'
                | 'precipitation'
                | 'battery'
                | 'distance'
            >;
            commodity?: 'electricity' | 'water' | 'gas' | 'heat';
            electricalSource?: 'ac_mains' | 'dc_pv' | 'dc_battery' | 'dc_bus';
            bucket?:
                | '1 minute'
                | '5 minutes'
                | '15 minutes'
                | '30 minutes'
                | '1 hour'
                | '6 hours'
                | '12 hours'
                | '1 day'
                | '1 week'
                | '1 month';
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            devices?: string[];
            meterIds?: number[];
            perDevice?: boolean;
            perPhase?: boolean;
            timezone?: string;
            limit?: number;
            offset?: number;
            groupBy?: 'meter' | 'role' | 'kind' | 'utility';
            totals?: boolean;
        };
        result: {
            items: Array<{
                bucket: string;
                meterId?: number;
                device: number;
                shellyID: string | null;
                tag: string;
                domain: string;
                value: number;
                min?: number | null;
                max?: number | null;
                phase?: 'a' | 'b' | 'c';
                source?: string;
            }>;
            groups?: Array<{
                bucket: string;
                groupBy: 'meter' | 'role' | 'kind' | 'utility';
                key: string;
                label: string;
                unit: string;
                value: number;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
            meta: {
                from: string;
                to: string;
                bucket: string;
                executionMs: number;
                fromMaterializedView?: boolean;
            };
        };
    };
    /** Live instantaneous active power (W) read from in-memory device status — no DB. Selector: scope (group / fleet), devices, or meterIds (one of). detail=total returns one signed sum; device returns per-device sums; channel adds a per-(component, phase) breakdown so a UI can show or pick individual switches or meter phases. components[] narrows to a chosen subset. With meterIds, detail=meter returns per-logical-meter watts (total/meter only, no components); formula meters are rejected — use Query for their energy. Pair with Query for history; poll this (~1–3s) for "now". */
    'energy.current': {
        params: {
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            devices?: string[];
            meterIds?: number[];
            components?: string[];
            detail?: 'total' | 'device' | 'channel' | 'meter';
        };
        result: {
            watts: number;
            asOf: string;
            onlineDevices: number;
            devices?: Array<{
                shellyID: string;
                online: boolean;
                watts: number;
                channels?: Array<{
                    componentKey: string;
                    phase: 'a' | 'b' | 'c' | 'z';
                    watts: number;
                }>;
            }>;
            meters?: Array<{meterId: number; watts: number}>;
        };
    };
    /** Fix the one fact a device cannot state — the electrical domain or tag of an unknown point (e.g. a voltmeter that may be AC or DC). Writes the tier-1 operator override; the next NotifyStatus frame uses it immediately. All other facts are auto-derived. */
    'energy.setpointoverride': {
        params: {
            deviceId: number;
            componentKey: string;
            channel: number;
            tag:
                | 'power'
                | 'apparent_power'
                | 'reactive_power'
                | 'voltage'
                | 'current'
                | 'frequency'
                | 'power_factor'
                | 'total_power'
                | 'total_apparent_power'
                | 'total_current'
                | 'neutral_current'
                | 'total_act_energy'
                | 'total_act_ret_energy'
                | 'percentage'
                | 'temperature_c'
                | 'temperature_f'
                | 'volume_l'
                | 'volume_m3'
                | 'volume_storage_l'
                | 'volume_flow_m3h'
                | 'thermal_energy_kwh'
                | 'soc'
                | 'soh'
                | 'cycles'
                | 'charge_ah'
                | 'discharge_ah';
            electricalDomain:
                | 'ac_mains'
                | 'dc_pv'
                | 'dc_battery'
                | 'dc_bus'
                | 'thermal'
                | 'gas'
                | 'unspecified';
        };
        result: {ok: boolean};
    };
    /** Per-(device, channel, tag) reset history from device_em.lifetime_counters — surfaces devices that may have a firmware glitch or that an operator pressed ResetCounters on. */
    'energy.getresetaudit': {
        params: {deviceId?: number; windowDays?: number};
        result: {
            items: Array<{
                deviceId: number;
                channel: number;
                tag: string;
                resetCount: number;
                lastResetAt?: string | null;
                lastSeenAt?: string | null;
            }>;
        };
    };
    /** List a device or scope wireable measurement points for the device Energy assignment UI. Primary source is stored device_em history (hasHistory); the live snapshot adds the componentKey label and isLiveNow. source=history/both can query historical energy; source=live has no history yet. assignedMeterId marks wired points. */
    'energy.listmeasurementpoints': {
        params: {
            shellyID?: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            includeAssigned?: boolean;
        };
        result: {
            points: Array<{
                deviceId: number;
                shellyID: string;
                componentKey: string | null;
                channel: number;
                phase: 'a' | 'b' | 'c' | 'z';
                tag:
                    | 'power'
                    | 'apparent_power'
                    | 'reactive_power'
                    | 'voltage'
                    | 'current'
                    | 'frequency'
                    | 'power_factor'
                    | 'total_power'
                    | 'total_apparent_power'
                    | 'total_current'
                    | 'neutral_current'
                    | 'total_act_energy'
                    | 'total_act_ret_energy'
                    | 'percentage'
                    | 'temperature_c'
                    | 'temperature_f'
                    | 'volume_l'
                    | 'volume_m3'
                    | 'volume_storage_l'
                    | 'volume_flow_m3h'
                    | 'thermal_energy_kwh'
                    | 'soc'
                    | 'soh'
                    | 'cycles'
                    | 'charge_ah'
                    | 'discharge_ah';
                electricalDomain:
                    | 'ac_mains'
                    | 'dc_pv'
                    | 'dc_battery'
                    | 'dc_bus'
                    | 'thermal'
                    | 'gas'
                    | 'unspecified';
                source: 'history' | 'live' | 'both';
                hasHistory: boolean;
                isLiveNow: boolean;
                assignedMeterId?: number;
                sampleValue?: number | null;
                sampleTs?: string | null;
            }>;
        };
    };
    /** List the org logical meters with their meaning (utility / role / kind) and their assigned channel points. Optional group / location scope narrows the set. Reports and device Energy assignment read this. */
    'energy.listlogicalmeters': {
        params: {scope?: {groupId?: number; locationId?: number}};
        result: {
            meters: Array<{
                id: number;
                name: string;
                utilityType: 'electric' | 'gas' | 'water' | 'heat';
                role:
                    | 'grid'
                    | 'pv'
                    | 'battery'
                    | 'generator'
                    | 'ev_charge'
                    | 'load'
                    | 'aux'
                    | 'supply'
                    | 'production'
                    | 'storage'
                    | 'usage';
                kindId?: string | null;
                phaseMode:
                    | 'single_phase'
                    | 'three_phase'
                    | 'independent_channels'
                    | 'dc'
                    | 'unknown';
                aggregationMode: 'sum_points' | 'formula';
                points: Array<{
                    deviceId: number;
                    componentKey?: string | null;
                    channel?: number;
                    phase?: 'a' | 'b' | 'c' | 'z';
                    tag:
                        | 'power'
                        | 'apparent_power'
                        | 'reactive_power'
                        | 'voltage'
                        | 'current'
                        | 'frequency'
                        | 'power_factor'
                        | 'total_power'
                        | 'total_apparent_power'
                        | 'total_current'
                        | 'neutral_current'
                        | 'total_act_energy'
                        | 'total_act_ret_energy'
                        | 'percentage'
                        | 'temperature_c'
                        | 'temperature_f'
                        | 'volume_l'
                        | 'volume_m3'
                        | 'volume_storage_l'
                        | 'volume_flow_m3h'
                        | 'thermal_energy_kwh'
                        | 'soc'
                        | 'soh'
                        | 'cycles'
                        | 'charge_ah'
                        | 'discharge_ah';
                    electricalDomain?:
                        | 'ac_mains'
                        | 'dc_pv'
                        | 'dc_battery'
                        | 'dc_bus'
                        | 'thermal'
                        | 'gas'
                        | 'unspecified'
                        | null;
                    directionHint?:
                        | 'import'
                        | 'export'
                        | 'charge'
                        | 'discharge'
                        | null;
                }>;
                groupId?: number | null;
                locationId?: number | null;
                costCenter?: string | null;
                parentMeterId?: number | null;
                virtualFormula?: {
                    kind: 'sum';
                    terms: Array<{
                        meterId: number;
                        sign: 1 | -1;
                        share?: number;
                    }>;
                } | null;
            }>;
        };
    };
    /** Create (omit id) or update one logical meter — the meaning the user sets. role is scoped by utilityType; a physical meter carries points + aggregationMode=sum_points, a calculated meter carries a formula + aggregationMode=formula. Returns the saved meter. */
    'energy.savelogicalmeter': {
        params: {
            id?: number;
            name: string;
            utilityType: 'electric' | 'gas' | 'water' | 'heat';
            role:
                | 'grid'
                | 'pv'
                | 'battery'
                | 'generator'
                | 'ev_charge'
                | 'load'
                | 'aux'
                | 'supply'
                | 'production'
                | 'storage'
                | 'usage';
            kindId?: string | null;
            phaseMode?:
                | 'single_phase'
                | 'three_phase'
                | 'independent_channels'
                | 'dc'
                | 'unknown';
            aggregationMode: 'sum_points' | 'formula';
            points?: Array<{
                deviceId: number;
                componentKey?: string | null;
                channel?: number;
                phase?: 'a' | 'b' | 'c' | 'z';
                tag:
                    | 'power'
                    | 'apparent_power'
                    | 'reactive_power'
                    | 'voltage'
                    | 'current'
                    | 'frequency'
                    | 'power_factor'
                    | 'total_power'
                    | 'total_apparent_power'
                    | 'total_current'
                    | 'neutral_current'
                    | 'total_act_energy'
                    | 'total_act_ret_energy'
                    | 'percentage'
                    | 'temperature_c'
                    | 'temperature_f'
                    | 'volume_l'
                    | 'volume_m3'
                    | 'volume_storage_l'
                    | 'volume_flow_m3h'
                    | 'thermal_energy_kwh'
                    | 'soc'
                    | 'soh'
                    | 'cycles'
                    | 'charge_ah'
                    | 'discharge_ah';
                electricalDomain?:
                    | 'ac_mains'
                    | 'dc_pv'
                    | 'dc_battery'
                    | 'dc_bus'
                    | 'thermal'
                    | 'gas'
                    | 'unspecified'
                    | null;
                directionHint?:
                    | 'import'
                    | 'export'
                    | 'charge'
                    | 'discharge'
                    | null;
            }>;
            groupId?: number | null;
            locationId?: number | null;
            costCenter?: string | null;
            parentMeterId?: number | null;
            virtualFormula?: {
                kind: 'sum';
                terms: Array<{meterId: number; sign: 1 | -1; share?: number}>;
            } | null;
        };
        result: {
            meter: {
                id: number;
                name: string;
                utilityType: 'electric' | 'gas' | 'water' | 'heat';
                role:
                    | 'grid'
                    | 'pv'
                    | 'battery'
                    | 'generator'
                    | 'ev_charge'
                    | 'load'
                    | 'aux'
                    | 'supply'
                    | 'production'
                    | 'storage'
                    | 'usage';
                kindId?: string | null;
                phaseMode:
                    | 'single_phase'
                    | 'three_phase'
                    | 'independent_channels'
                    | 'dc'
                    | 'unknown';
                aggregationMode: 'sum_points' | 'formula';
                points: Array<{
                    deviceId: number;
                    componentKey?: string | null;
                    channel?: number;
                    phase?: 'a' | 'b' | 'c' | 'z';
                    tag:
                        | 'power'
                        | 'apparent_power'
                        | 'reactive_power'
                        | 'voltage'
                        | 'current'
                        | 'frequency'
                        | 'power_factor'
                        | 'total_power'
                        | 'total_apparent_power'
                        | 'total_current'
                        | 'neutral_current'
                        | 'total_act_energy'
                        | 'total_act_ret_energy'
                        | 'percentage'
                        | 'temperature_c'
                        | 'temperature_f'
                        | 'volume_l'
                        | 'volume_m3'
                        | 'volume_storage_l'
                        | 'volume_flow_m3h'
                        | 'thermal_energy_kwh'
                        | 'soc'
                        | 'soh'
                        | 'cycles'
                        | 'charge_ah'
                        | 'discharge_ah';
                    electricalDomain?:
                        | 'ac_mains'
                        | 'dc_pv'
                        | 'dc_battery'
                        | 'dc_bus'
                        | 'thermal'
                        | 'gas'
                        | 'unspecified'
                        | null;
                    directionHint?:
                        | 'import'
                        | 'export'
                        | 'charge'
                        | 'discharge'
                        | null;
                }>;
                groupId?: number | null;
                locationId?: number | null;
                costCenter?: string | null;
                parentMeterId?: number | null;
                virtualFormula?: {
                    kind: 'sum';
                    terms: Array<{
                        meterId: number;
                        sign: 1 | -1;
                        share?: number;
                    }>;
                } | null;
            };
        };
    };
    /** Delete one logical meter; its points revert to unassigned facts and any child meter is detached from it. */
    'energy.deletelogicalmeter': {
        params: {id: number};
        result: {deleted: boolean};
    };
    /** List the org topology edges — which node each logical meter sits between and the direction a positive value flows. Powers rich energy/resource flow views. */
    'energy.listmeterconnections': {
        params: Record<string, unknown>;
        result: {
            connections: Array<{
                id: number;
                meterId: number;
                fromNode:
                    | 'grid'
                    | 'ac_bus'
                    | 'house_load'
                    | 'pv_dc'
                    | 'inverter'
                    | 'battery_dc'
                    | 'generator'
                    | 'thermal_loop'
                    | 'water_supply'
                    | 'gas_supply';
                toNode:
                    | 'grid'
                    | 'ac_bus'
                    | 'house_load'
                    | 'pv_dc'
                    | 'inverter'
                    | 'battery_dc'
                    | 'generator'
                    | 'thermal_loop'
                    | 'water_supply'
                    | 'gas_supply';
                positiveDirection: 'from_to' | 'to_from' | 'bidirectional';
            }>;
        };
    };
    /** Create (omit id) or update one topology edge between two nodes for a logical meter. Re-saving the same edge updates its direction. Returns the saved connection. */
    'energy.savemeterconnection': {
        params: {
            id?: number;
            meterId: number;
            fromNode:
                | 'grid'
                | 'ac_bus'
                | 'house_load'
                | 'pv_dc'
                | 'inverter'
                | 'battery_dc'
                | 'generator'
                | 'thermal_loop'
                | 'water_supply'
                | 'gas_supply';
            toNode:
                | 'grid'
                | 'ac_bus'
                | 'house_load'
                | 'pv_dc'
                | 'inverter'
                | 'battery_dc'
                | 'generator'
                | 'thermal_loop'
                | 'water_supply'
                | 'gas_supply';
            positiveDirection?: 'from_to' | 'to_from' | 'bidirectional';
        };
        result: {
            connection: {
                id: number;
                meterId: number;
                fromNode:
                    | 'grid'
                    | 'ac_bus'
                    | 'house_load'
                    | 'pv_dc'
                    | 'inverter'
                    | 'battery_dc'
                    | 'generator'
                    | 'thermal_loop'
                    | 'water_supply'
                    | 'gas_supply';
                toNode:
                    | 'grid'
                    | 'ac_bus'
                    | 'house_load'
                    | 'pv_dc'
                    | 'inverter'
                    | 'battery_dc'
                    | 'generator'
                    | 'thermal_loop'
                    | 'water_supply'
                    | 'gas_supply';
                positiveDirection: 'from_to' | 'to_from' | 'bidirectional';
            };
        };
    };
    /** Delete one topology edge by id. */
    'energy.deletemeterconnection': {
        params: {id: number};
        result: {deleted: boolean};
    };
    /** Return the energy namespace contract (methods, schemas, permissions, errors). */
    'energy.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Paginated list of entities the caller can read, filtered against device-level access. */
    'entity.list': {
        params: {limit?: number; offset?: number};
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return the normalized summary of a single entity. Replaces Entity.GetInfo (removed in the Phase 1 cutover). */
    'entity.get': {
        params: {id: string};
        result: {
            id: string;
            name: string;
            type: string;
            source: string;
            online: boolean;
            properties: Record<string, unknown>;
        };
    };
    /** Return the JSON Schema for an action on a specific entity. Callers use this to build forms or validate InvokeAction params without hardcoding shapes. */
    'entity.getactionschema': {
        params: {id: string; action: string};
        result: {type: string; action: string; schema: Record<string, unknown>};
    };
    /** Invoke a capability action on an entity (toggle, setBrightness, open/close, ...). Backend translates to the right Shelly device RPC. */
    'entity.invokeaction': {
        params: {id: string; action: string; params?: Record<string, unknown>};
        result: {id: string; action: string; result: unknown};
    };
    /** Return the backend-declared capability set for an entity — what actions it supports. */
    'entity.getcapabilities': {
        params: {id: string};
        result: {type: string; actions: string[]; maintenanceActions: string[]};
    };
    /** Return the entity namespace contract (methods, schemas, permissions, errors). */
    'entity.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Eth.SetConfig — wired interface config. ipv4mode/IP/gateway/dhcp_start_ip/dhcp_end_ip values gated by device. */
    'eth.setconfig': {
        params: {
            shellyID: string;
            config: {
                enable?: boolean;
                server_mode?: boolean;
                ipv4mode?: string;
                ip?: string | null;
                netmask?: string | null;
                gw?: string | null;
                nameserver?: string | null;
                dhcp_start_ip?: string | null;
                dhcp_end_ip?: string | null;
            };
        };
        result: {restart_required: boolean};
    };
    /** Eth.GetConfig — current ethernet configuration. */
    'eth.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Eth.GetStatus — link state, ip, ip6 of the ethernet interface. */
    'eth.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Eth.ListClients — DHCP leases when the device is in Ethernet server_mode. */
    'eth.listclients': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the eth namespace contract (methods, schemas, permissions, errors). */
    'eth.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Fan status — on, speed, RPM, errors. */
    'fan.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Fan config. */
    'fan.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Fan SetConfig — opaque pass-through. */
    'fan.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Fan Set — on/off and speed (0-100). */
    'fan.set': {
        params: {shellyID: string; id: number; on?: boolean; speed?: number};
        result: Record<string, unknown>;
    };
    /** Return the fan namespace contract (methods, schemas, permissions, errors). */
    'fan.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Register a manual update for one or more devices. */
    'firmware.registermanualupdate': {
        params: {shellyIDs: string[]; ttlMs?: number; ownerToken?: string};
        result: Record<string, unknown>;
    };
    /** Cancel a previously registered manual update. */
    'firmware.unregistermanualupdate': {
        params: {shellyIDs: string[]; ownerToken?: string};
        result: Record<string, unknown>;
    };
    /** Start a backend-owned firmware update job for one or more devices. */
    'firmware.startupdatejob': {
        params: {
            shellyIDs: string[];
            channel?: 'stable' | 'beta';
            url?: string;
            targetBuildIdHint?: string;
            idempotencyKey?: string;
            allowDowngrade?: boolean;
        };
        result: {jobId: string};
    };
    /** Check for firmware updates on many devices in one call. Fans out server-side and returns a per-device result (checked/offline/error). */
    'firmware.checkforupdatebulk': {
        params: {shellyIDs: string[]};
        result: {
            items: Array<{
                shellyID: string;
                status: 'checked' | 'offline' | 'error';
                stable?: {version: string; build_id?: string};
                beta?: {version: string; build_id?: string};
                error?: string;
            }>;
        };
    };
    /** List devices with auto-update configured. */
    'firmware.getautoupdatedevices': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Return the supported auto-update modes. */
    'firmware.getautoupdatemodes': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Enable or disable auto-update for a single device. */
    'firmware.setautoupdate': {
        params: {shellyID: string; enabled: boolean};
        result: Record<string, unknown>;
    };
    /** Bulk enable/disable auto-update. */
    'firmware.setautoupdatebulk': {
        params: {shellyIDs: string[]; enabled: boolean};
        result: Record<string, unknown>;
    };
    /** Return the current auto-update status for a device. */
    'firmware.getautoupdatestatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the auto-update mode for a device. */
    'firmware.getautoupdatemode': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Set the auto-update mode for a single device. */
    'firmware.setautoupdatemode': {
        params: {shellyID: string; mode: 'off' | 'stable' | 'beta'};
        result: Record<string, unknown>;
    };
    /** Bulk set the auto-update mode for a list of devices. */
    'firmware.setautoupdatemodebulk': {
        params: {shellyIDs: string[]; mode: 'off' | 'stable' | 'beta'};
        result: Record<string, unknown>;
    };
    /** Return the global default firmware channel (stable/beta). */
    'firmware.getautoupdatechannel': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Set the global default firmware channel (stable/beta) for legacy enables. */
    'firmware.setautoupdatechannel': {
        params: {channel: 'stable' | 'beta'};
        result: Record<string, unknown>;
    };
    /** Return metadata for the most recent scheduler run. */
    'firmware.getlastautoupdaterun': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Check auto-update candidates and enqueue durable firmware update jobs. */
    'firmware.triggerautoupdate': {
        params: Record<string, never>;
        result: {
            checked: number;
            queued: number;
            skipped: number;
            failed: number;
            jobs: Array<{
                jobId: string;
                tenantId: string;
                channel: 'stable' | 'beta';
                shellyIDs: string[];
            }>;
            results: Array<{
                shellyID: string;
                status:
                    | 'queued'
                    | 'no_update'
                    | 'offline'
                    | 'failed'
                    | 'skipped';
                channel?: 'stable' | 'beta';
                jobId?: string;
                error?: string;
            }>;
        };
    };
    /** List firmware library entries (uploaded binaries + metadata). */
    'firmware.listlibrary': {
        params: Record<string, never>;
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Mint a short-lived ticket for POST /media/uploadFirmwareFile. */
    'firmware.createuploadticket': {
        params: Record<string, never>;
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Mint a 1-hour download URL for a library entry. */
    'firmware.createlibrarydownloadurl': {
        params: {id: string};
        result: {url: string};
    };
    /** Patch metadata on a library entry. */
    'firmware.updatelibraryentry': {
        params: {
            id: string;
            name?: string;
            app?: string;
            model?: string;
            ver?: string;
            fwId?: string;
            channel?: 'stable' | 'beta' | 'custom' | '';
            tags?: string;
        };
        result: {success: true; item: Record<string, unknown>};
    };
    /** Delete a library entry by id. */
    'firmware.deletelibraryentry': {
        params: {id: string};
        result: {success: true};
    };
    /** Return the firmware namespace contract (methods, schemas, permissions, errors). */
    'firmware.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Aggregate live in-memory device metrics for a slice (group / location / tag / fleet). No historical DB scan; offline devices skipped. */
    'fleet.getmetrics': {
        params: {
            organizationId?: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
        };
        result: {
            scopeKind: 'group' | 'location' | 'tag' | 'fleet';
            scopeId: number | null;
            devices: Array<{
                id: number;
                shellyID: string;
                name: string;
                online: boolean;
                hasEmChannels: boolean;
                hasEm1Channels: boolean;
            }>;
            metrics: Record<string, unknown>;
            phaseMetrics: Record<string, unknown> | null;
            [key: string]: unknown;
        };
    };
    /** Return capability keys derived from the slice devices live entities — device is single source of truth. */
    'fleet.getcapabilities': {
        params: {
            organizationId?: string;
            scope?: {groupId?: number; locationId?: number; tagId?: number};
        };
        result: {
            scopeKind: 'group' | 'location' | 'tag' | 'fleet';
            scopeId: number | null;
            capabilities: string[];
            deviceCount: number;
        };
    };
    /** Return the fleet namespace contract (methods, schemas, permissions, errors). */
    'fleet.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Per-location live load for the Energy map overlay; baselineWatts is null until a rolling baseline source exists. Cached ~5s. */
    'fleetmap.getenergysnapshot': {
        params: {organizationId?: string};
        result: {
            pins: Array<{
                locationId: number;
                currentLoadWatts: number;
                baselineWatts: number | null;
            }>;
            asOf: string;
        };
    };
    /** Per-location avg signal health (0..100) + device count for the Signal map overlay. */
    'fleetmap.getsignalsnapshot': {
        params: {organizationId?: string};
        result: {
            pins: Array<{
                locationId: number;
                signalHealth: number;
                deviceCount: number;
            }>;
            asOf: string;
        };
    };
    /** Per-location open-alert count + top severity + oldest activeSince for the Alert map overlay (heatmap layer). */
    'fleetmap.getalertsnapshot': {
        params: {organizationId?: string};
        result: {
            pins: Array<{
                locationId: number;
                openAlertCount: number;
                topSeverity: 'critical' | 'warning' | 'info' | null;
                oldestActiveSince: string | null;
            }>;
            asOf: string;
        };
    };
    /** Return the fleetMap namespace contract (methods, schemas, permissions, errors). */
    'fleetmap.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Org-wide live load + cumulative energy delivered/generated today. Cached server-side ~5s. */
    'fleetsummary.getenergy': {
        params: {organizationId?: string};
        result: {
            liveLoadWatts: number;
            energyTodayWh: number;
            solarTodayWh: number;
            asOf: string;
        };
    };
    /** Return the fleetSummary namespace contract (methods, schemas, permissions, errors). */
    'fleetsummary.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Flood.SetConfig — name / alarm_mode (disabled|normal|intense|rain) / report_holdoff. */
    'flood.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Flood.GetConfig. */
    'flood.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Flood.GetStatus — {id, alarm, mute, errors[]}. */
    'flood.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the flood namespace contract (methods, schemas, permissions, errors). */
    'flood.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Return the Grafana integration config snapshot. */
    'grafana.getconfig': {
        params: Record<string, unknown>;
        result: {
            ds?: Record<string, unknown>;
            folder?: Record<string, unknown>;
            dashboards?: Array<Record<string, unknown>>;
            [key: string]: unknown;
        };
    };
    /** Return a single dashboard entry filtered by slug. */
    'grafana.getdashboard': {
        params: {slug: string};
        result: Record<string, unknown>;
    };
    /** Return the grafana namespace contract (methods, schemas, permissions, errors). */
    'grafana.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Create a group. Unique sibling-name per parent. */
    'group.create': {
        params: {
            organizationId?: string;
            name: string;
            description?: string | null;
            groupType?: 'standard' | 'operational' | 'critical' | 'custom';
            kind?: string;
            metadata?: Record<string, unknown>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            parentGroupId: number | null;
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            membershipMode: 'manual';
            kind: string;
            metadata: Record<string, unknown>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            imageAssetId: string | null;
            revision: number;
            isLegacy: boolean;
            effectiveSeverityFloor: 'info' | 'warning' | 'critical' | null;
            effectiveRetentionDays: number | null;
            effectiveAuditRetentionDays: number | null;
            policySources?: {
                severityFloor: 'set' | 'inherited';
                retentionDays: 'set' | 'inherited';
                auditRetentionDays: 'set' | 'inherited';
            };
            createdAt: string;
            updatedAt: string | null;
            counts?: {
                childLocations?: number;
                childGroups?: number;
                devices?: number;
                entities?: number;
                locations?: number;
                tags?: number;
                descendantDevices?: number;
                descendantEntities?: number;
                groupsReferencingLocation?: number;
            };
        };
    };
    /** Partial-update a group. Cycle-safe parent changes. */
    'group.update': {
        params: {
            organizationId?: string;
            id: number;
            expectedRevision?: number;
            patch: {
                name?: string;
                description?: string | null;
                groupType?: 'standard' | 'operational' | 'critical' | 'custom';
                kind?: string;
                metadata?: Record<string, unknown>;
                visual?: {icon?: string; accent?: string; imageModel?: string};
                imageAssetId?: string | null;
            };
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            parentGroupId: number | null;
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            membershipMode: 'manual';
            kind: string;
            metadata: Record<string, unknown>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            imageAssetId: string | null;
            revision: number;
            isLegacy: boolean;
            effectiveSeverityFloor: 'info' | 'warning' | 'critical' | null;
            effectiveRetentionDays: number | null;
            effectiveAuditRetentionDays: number | null;
            policySources?: {
                severityFloor: 'set' | 'inherited';
                retentionDays: 'set' | 'inherited';
                auditRetentionDays: 'set' | 'inherited';
            };
            createdAt: string;
            updatedAt: string | null;
            counts?: {
                childLocations?: number;
                childGroups?: number;
                devices?: number;
                entities?: number;
                locations?: number;
                tags?: number;
                descendantDevices?: number;
                descendantEntities?: number;
                groupsReferencingLocation?: number;
            };
        };
    };
    /** Delete a group. Rejected if it has child groups. Members cascade. */
    'group.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean; id: number};
    };
    /** Fetch one group by id. */
    'group.get': {
        params: {organizationId?: string; id: number; includeSummary?: boolean};
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            parentGroupId: number | null;
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            membershipMode: 'manual';
            kind: string;
            metadata: Record<string, unknown>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            imageAssetId: string | null;
            revision: number;
            isLegacy: boolean;
            effectiveSeverityFloor: 'info' | 'warning' | 'critical' | null;
            effectiveRetentionDays: number | null;
            effectiveAuditRetentionDays: number | null;
            policySources?: {
                severityFloor: 'set' | 'inherited';
                retentionDays: 'set' | 'inherited';
                auditRetentionDays: 'set' | 'inherited';
            };
            createdAt: string;
            updatedAt: string | null;
            counts?: {
                childLocations?: number;
                childGroups?: number;
                devices?: number;
                entities?: number;
                locations?: number;
                tags?: number;
                descendantDevices?: number;
                descendantEntities?: number;
                groupsReferencingLocation?: number;
            };
        };
    };
    /** List groups. Optional parent filter: omit = all, null = roots only, integer = children of that parent. */
    'group.list': {
        params: {
            organizationId?: string;
            parentGroupId?: number | null;
            query?: string;
            groupType?: 'standard' | 'operational' | 'critical' | 'custom';
            includeSummary?: boolean;
            limit?: number;
            offset?: number;
            sortBy?: 'name' | 'groupType' | 'createdAt' | 'updatedAt';
            sortDir?: 'asc' | 'desc';
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                description: string | null;
                parentGroupId: number | null;
                groupType: 'standard' | 'operational' | 'critical' | 'custom';
                membershipMode: 'manual';
                kind: string;
                metadata: Record<string, unknown>;
                visual: {icon?: string; accent?: string; imageModel?: string};
                imageAssetId: string | null;
                revision: number;
                isLegacy: boolean;
                effectiveSeverityFloor: 'info' | 'warning' | 'critical' | null;
                effectiveRetentionDays: number | null;
                effectiveAuditRetentionDays: number | null;
                policySources?: {
                    severityFloor: 'set' | 'inherited';
                    retentionDays: 'set' | 'inherited';
                    auditRetentionDays: 'set' | 'inherited';
                };
                createdAt: string;
                updatedAt: string | null;
                counts?: {
                    childLocations?: number;
                    childGroups?: number;
                    devices?: number;
                    entities?: number;
                    locations?: number;
                    tags?: number;
                    descendantDevices?: number;
                    descendantEntities?: number;
                    groupsReferencingLocation?: number;
                };
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Direct children of the given group. */
    'group.children': {
        params: {
            organizationId?: string;
            id: number;
            includeSummary?: boolean;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                description: string | null;
                parentGroupId: number | null;
                groupType: 'standard' | 'operational' | 'critical' | 'custom';
                membershipMode: 'manual';
                kind: string;
                metadata: Record<string, unknown>;
                visual: {icon?: string; accent?: string; imageModel?: string};
                imageAssetId: string | null;
                revision: number;
                isLegacy: boolean;
                effectiveSeverityFloor: 'info' | 'warning' | 'critical' | null;
                effectiveRetentionDays: number | null;
                effectiveAuditRetentionDays: number | null;
                policySources?: {
                    severityFloor: 'set' | 'inherited';
                    retentionDays: 'set' | 'inherited';
                    auditRetentionDays: 'set' | 'inherited';
                };
                createdAt: string;
                updatedAt: string | null;
                counts?: {
                    childLocations?: number;
                    childGroups?: number;
                    devices?: number;
                    entities?: number;
                    locations?: number;
                    tags?: number;
                    descendantDevices?: number;
                    descendantEntities?: number;
                    groupsReferencingLocation?: number;
                };
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Breadcrumb from root to the given group. */
    'group.path': {
        params: {organizationId?: string; id: number};
        result: {items: Array<{id: number; name: string}>};
    };
    /** List members of a group with optional subject-type filter. */
    'group.listmembers': {
        params: {
            organizationId?: string;
            id: number;
            subjectType?: 'device' | 'entity' | 'location';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                subjectType: 'device' | 'entity' | 'location';
                subjectId: string;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Flat {groupId, subjectId} list of device memberships — one round-trip for UIs that render many groups at once. Optional `ids` narrows the scope; otherwise returns all groups the caller can read. */
    'group.listdevicememberships': {
        params: {organizationId?: string; ids?: number[]};
        result: {items: Array<{groupId: number; subjectId: string}>};
    };
    /** Batch-add subject members. Idempotent: already-present rows skipped. */
    'group.addmembers': {
        params: {
            organizationId?: string;
            id: number;
            members: Array<{
                subjectType: 'device' | 'entity' | 'location';
                subjectId: string;
            }>;
        };
        result: {
            id: number;
            added: Array<{
                subjectType: 'device' | 'entity' | 'location';
                subjectId: string;
            }>;
        };
    };
    /** Batch-remove subject members. */
    'group.removemembers': {
        params: {
            organizationId?: string;
            id: number;
            members: Array<{
                subjectType: 'device' | 'entity' | 'location';
                subjectId: string;
            }>;
        };
        result: {
            id: number;
            removed: Array<{
                subjectType: 'device' | 'entity' | 'location';
                subjectId: string;
            }>;
        };
    };
    /** Paginated audit-log timeline for devices that are members of the group (or its descendants). Filter by time window and event types. */
    'group.listactivity': {
        params: {
            organizationId?: string;
            id: number;
            from?: string;
            to?: string;
            eventTypes?: string[];
            includeDescendants?: boolean;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                auditId: number;
                ts: string;
                eventType: string;
                username: string | null;
                shellyId: string | null;
                shellyIds: string[];
                method: string | null;
                params: Record<string, unknown>;
                success: boolean;
                errorMessage: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** List group kinds. Optional `category` filter narrows to one bucket family. */
    'group.kind.list': {
        params: {category?: string; query?: string};
        result: {
            items: Array<{
                id: string;
                displayName: string;
                description: string | null;
                category: string;
                icon: string | null;
                metadataSchema: Record<string, unknown>;
                sortOrder: number;
            }>;
        };
    };
    /** Fetch one group kind by id. */
    'group.kind.get': {
        params: {id: string};
        result: {
            id: string;
            displayName: string;
            description: string | null;
            category: string;
            icon: string | null;
            metadataSchema: Record<string, unknown>;
            sortOrder: number;
        };
    };
    /** Return the group namespace contract (methods, schemas, permissions, errors). */
    'group.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** HTTP.GET — fetch a URL via HTTP/HTTPS GET from the device. */
    'http.get': {
        params: {
            shellyID: string;
            url: string;
            timeout?: number;
            ssl_ca?: string | null;
        };
        result: Record<string, unknown>;
    };
    /** HTTP.POST — POST data via HTTP/HTTPS from the device. */
    'http.post': {
        params: {
            shellyID: string;
            url: string;
            body?: string;
            body_b64?: string;
            content_type?: string;
            timeout?: number;
            ssl_ca?: string | null;
        };
        result: Record<string, unknown>;
    };
    /** HTTP.Request — generic outbound HTTP (method ∈ GET/POST/PUT/HEAD/DELETE). */
    'http.request': {
        params: {
            shellyID: string;
            method: string;
            url: string;
            body?: string;
            body_b64?: string;
            headers?: Record<string, unknown>;
            timeout?: number;
            ssl_ca?: string | null;
        };
        result: Record<string, unknown>;
    };
    /** Return the http namespace contract (methods, schemas, permissions, errors). */
    'http.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Humidity.SetConfig — name / report_thr / offset. */
    'humidity.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Humidity.GetConfig. */
    'humidity.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Humidity.GetStatus — {id, rh, errors?}. */
    'humidity.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the humidity namespace contract (methods, schemas, permissions, errors). */
    'humidity.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Identity.RotateActionSigningKeys — recreate Action V2 GDPR + grant-change targets. Old keys move to _PREVIOUS slots; FM keeps both verifying through the replay window. */
    'identity.rotateactionsigningkeys': {
        params: Record<string, never>;
        result: {
            gdprTargetId: string;
            grantTargetId: string;
            rotatedAt?: string;
        };
    };
    /** Identity.ListIdentityProviders — list configured external IdPs (OIDC, SAML, social). */
    'identity.listidentityproviders': {
        params: Record<string, never>;
        result: Array<{
            id?: string;
            name?: string;
            type?: string;
            state?: string;
        }>;
    };
    /** identity.AddOidcProvider — register a generic OIDC IdP at instance scope. */
    'identity.addoidcprovider': {
        params: {
            name: string;
            issuer: string;
            clientId: string;
            clientSecret: string;
            scopes?: string[];
            autoCreation?: boolean;
        };
        result: {ok: boolean};
    };
    /** Identity.DeleteIdentityProvider — remove an IdP by id. */
    'identity.deleteidentityprovider': {
        params: {id: string};
        result: {ok: boolean};
    };
    /** Identity.GetScimSettings — current SCIM v2 inbound provisioning state + endpoint URL. */
    'identity.getscimsettings': {
        params: Record<string, never>;
        result: {
            enabled: boolean;
            endpoint: string;
            managementApiHint?: string;
        };
    };
    /** Identity.SetScimEnabled — flip Zitadel SCIM endpoint on/off via FM_ZITADEL_SCIM_ENABLED. */
    'identity.setscimenabled': {
        params: {enabled: boolean};
        result: {ok: boolean};
    };
    /** Identity.GetJwtIntentSettings — JWT IdP intent (urn:ietf:params:oauth:grant-type:jwt-bearer) endpoint + docs link. */
    'identity.getjwtintentsettings': {
        params: Record<string, never>;
        result: {
            enabled: boolean;
            tokenEndpoint: string;
            grantType?: string;
            documentation?: string;
        };
    };
    /** Identity.GetSmtpSettings — instance-wide Zitadel identity-email SMTP provider, with secrets redacted. Platform/provider-support only; tenant admins manage notification channels instead. */
    'identity.getsmtpsettings': {
        params: Record<string, never>;
        result: {
            enabled: boolean;
            configured: boolean;
            id?: string;
            state?: string;
            authMode: 'none' | 'plain';
            host: string;
            senderAddress: string;
            senderName: string;
            tls: boolean;
            user?: string;
            replyToAddress?: string;
            description?: string;
            passwordSet: boolean;
        };
    };
    /** Identity.SetSmtpSettings — create/update/deactivate the instance-wide Zitadel identity-email SMTP provider for login/reset/verification/invite mail. Platform/provider-support only; not tenant/org-scoped. */
    'identity.setsmtpsettings': {
        params: {
            enabled: boolean;
            authMode: 'none' | 'plain';
            host?: string;
            senderAddress?: string;
            senderName?: string;
            tls?: boolean;
            user?: string;
            password?: string;
            replyToAddress?: string;
            description?: string;
        };
        result: {ok: boolean};
    };
    /** Identity.TestSmtpSettings — ask Zitadel to send a test email through draft identity SMTP settings. Platform/provider-support only; the SMTP password must be supplied for plain-auth tests because Zitadel does not expose saved secrets. */
    'identity.testsmtpsettings': {
        params: {
            receiverAddress: string;
            authMode: 'none' | 'plain';
            id?: string;
            host?: string;
            senderAddress?: string;
            senderName?: string;
            tls?: boolean;
            user?: string;
            password?: string;
        };
        result: {ok: boolean};
    };
    /** Return the identity namespace contract (methods, schemas, permissions, errors). */
    'identity.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Illuminance.SetConfig — name / dark_thr / bright_thr. */
    'illuminance.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Illuminance.GetConfig. */
    'illuminance.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Illuminance.GetStatus. */
    'illuminance.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the illuminance namespace contract (methods, schemas, permissions, errors). */
    'illuminance.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Input.Trigger — synthesize an input event. */
    'input.trigger': {
        params: {
            shellyID: string;
            id: number;
            event?: string;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** Input.SetConfig. */
    'input.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** Input.ResetCounters. */
    'input.resetcounters': {
        params: {shellyID: string; id: number; types?: string[]};
        result: unknown;
    };
    /** Input.GetConfig. */
    'input.getconfig': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Input.GetStatus. */
    'input.getstatus': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Input.CheckExpression — evaluate a comparison expression against the input. */
    'input.checkexpression': {
        params: {shellyID: string; expr: string; inputs: Array<number | null>};
        result: unknown;
    };
    /** Return the input namespace contract (methods, schemas, permissions, errors). */
    'input.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Restore active backend-owned operation jobs for the current tenant. */
    'job.listactive': {
        params: {
            kinds?: Array<'certificate' | 'credential' | 'backup' | 'firmware'>;
            limit?: number;
        };
        result: {
            items: Array<{
                id: string;
                kind: 'certificate' | 'credential' | 'backup' | 'firmware';
                status: 'queued' | 'running' | 'done' | 'failed';
                total: number;
                doneCount: number;
                failCount: number;
                createdAt: string;
                startedAt: string | null;
                endedAt: string | null;
                createdBy: string | null;
                metadata: Record<string, unknown>;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Read one backend-owned operation job by id in the current tenant. */
    'job.get': {
        params: {
            jobId: string;
            kind?: 'certificate' | 'credential' | 'backup' | 'firmware';
        };
        result: {
            id: string;
            kind: 'certificate' | 'credential' | 'backup' | 'firmware';
            status: 'queued' | 'running' | 'done' | 'failed';
            total: number;
            doneCount: number;
            failCount: number;
            createdAt: string;
            startedAt: string | null;
            endedAt: string | null;
            createdBy: string | null;
            metadata: Record<string, unknown>;
        };
    };
    /** Return the job namespace contract (methods, schemas, permissions, errors). */
    'job.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List kinds (vendor + this org custom), optionally filtered by appliesTo. */
    'kind.list': {
        params: {appliesTo?: 'device' | 'group' | 'both'};
        result: Record<string, unknown>;
    };
    /** Get one kind (vendor or this org custom). */
    'kind.get': {
        params: {id: string};
        result: {
            id: string;
            name: string;
            category: string;
            icon?: string | null;
            appliesTo: 'device' | 'group' | 'both';
            source: 'vendor' | 'custom';
        };
    };
    /** Create a custom kind for this org. */
    'kind.create': {
        params: {
            slug: string;
            name: string;
            category: string;
            icon?: string | null;
            appliesTo: 'device' | 'group' | 'both';
        };
        result: {
            id: string;
            name: string;
            category: string;
            icon?: string | null;
            appliesTo: 'device' | 'group' | 'both';
            source: 'vendor' | 'custom';
        };
    };
    /** Update a custom kind owned by this org. */
    'kind.update': {
        params: {
            id: string;
            name: string;
            category: string;
            icon?: string | null;
            appliesTo: 'device' | 'group' | 'both';
        };
        result: {
            id: string;
            name: string;
            category: string;
            icon?: string | null;
            appliesTo: 'device' | 'group' | 'both';
            source: 'vendor' | 'custom';
        };
    };
    /** Delete a custom kind; blocked while devices/groups still reference it. */
    'kind.delete': {params: {id: string}; result: Record<string, unknown>};
    /** Return the kind namespace contract (methods, schemas, permissions, errors). */
    'kind.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** KNX.SetConfig — global enable / individual address / routing. Pro line only. */
    'knx.setconfig': {
        params: {
            shellyID: string;
            config: {enable?: boolean; ia?: string; routing?: {addr?: string}};
        };
        result: {restart_required: boolean};
    };
    /** KNX.GetConfig — global KNX config (enable / ia / routing). */
    'knx.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** KNX.GetStatus — global component status (empty per spec). */
    'knx.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** KNX.GetComponentConfig — fetch per-component KNX binding (cmd/fb group addresses). */
    'knx.getcomponentconfig': {
        params: {shellyID: string; key: string};
        result: Record<string, unknown>;
    };
    /** KNX.SetComponentConfig — bind a switch/light/cover/input to KNX group addresses. */
    'knx.setcomponentconfig': {
        params: {
            shellyID: string;
            key: string;
            config: Record<string, unknown>;
        };
        result: {restart_required: boolean};
    };
    /** KNX.ListComponents — paginated list of KNX-bound components. */
    'knx.listcomponents': {
        params: {shellyID: string; offset?: number};
        result: Record<string, unknown>;
    };
    /** Return the knx namespace contract (methods, schemas, permissions, errors). */
    'knx.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** KVS.Get — read value + etag for one key. */
    'kvs.get': {
        params: {shellyID: string; key: string};
        result: Record<string, unknown>;
    };
    /** KVS.GetMany — paginated value reads. `match` is a glob filter (device-validated). */
    'kvs.getmany': {
        params: {shellyID: string; match?: string; offset?: number};
        result: Record<string, unknown>;
    };
    /** KVS.Set — write a key. Pass `etag` for compare-and-set; device rejects on mismatch. */
    'kvs.set': {
        params: {shellyID: string; key: string; value: unknown; etag?: string};
        result: Record<string, unknown>;
    };
    /** KVS.Delete — remove a key. Optional `etag` for compare-and-delete. */
    'kvs.delete': {
        params: {shellyID: string; key: string; etag?: string};
        result: Record<string, unknown>;
    };
    /** KVS.List — paginated key listing without values. */
    'kvs.list': {
        params: {shellyID: string; match?: string; offset?: number};
        result: Record<string, unknown>;
    };
    /** Return the kvs namespace contract (methods, schemas, permissions, errors). */
    'kvs.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** LedStrip.GetConfig — current strip configuration. */
    'ledstrip.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** LedStrip.SetConfig — protocol, num_leds, effects allow-list. */
    'ledstrip.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** LedStrip.GetStatus — live on/brightness/rgb/effect/palette. */
    'ledstrip.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** LedStrip.Set — update any subset of runtime fields (on, brightness, rgb, effect, palette, speed, intensity). */
    'ledstrip.set': {
        params: {shellyID: string; id: number; [key: string]: unknown};
        result: Record<string, unknown>;
    };
    /** LedStrip.ListAllProtocols — protocol catalog for this build. */
    'ledstrip.listallprotocols': {
        params: {shellyID: string; id: number};
        result: {protocols: string[]};
    };
    /** LedStrip.ListAllPalettes — palette catalog with color stops. */
    'ledstrip.listallpalettes': {
        params: {shellyID: string; id: number};
        result: {palettes: Array<Record<string, unknown>>; total?: number};
    };
    /** LedStrip.ListAllEffects — effect catalog (paginated). Each entry carries a `mods` array advertising which runtime fields apply. */
    'ledstrip.listalleffects': {
        params: {shellyID: string; id: number; offset?: number};
        result: {
            effects: Array<Record<string, unknown>>;
            offset?: number;
            total?: number;
        };
    };
    /** LedStrip.AddEffect — enable an effect from the catalog. */
    'ledstrip.addeffect': {
        params: {shellyID: string; id: number; effect: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** LedStrip.RemoveEffect — disable an effect by key. */
    'ledstrip.removeeffect': {
        params: {shellyID: string; id: number; effect: string};
        result: Record<string, unknown>;
    };
    /** LedStrip.NextEffect — cycle to the next enabled effect. */
    'ledstrip.nexteffect': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** LedStrip.AddScriptEffect — bind a Script component as a custom effect source. */
    'ledstrip.addscripteffect': {
        params: {shellyID: string; id: number; script_id: number};
        result: Record<string, unknown>;
    };
    /** LedStrip.RemoveScriptEffect — unbind a script effect. */
    'ledstrip.removescripteffect': {
        params: {shellyID: string; id: number; script_id: number};
        result: Record<string, unknown>;
    };
    /** Return the ledstrip namespace contract (methods, schemas, permissions, errors). */
    'ledstrip.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Light.Set — state/brightness/temp/transition. */
    'light.set': {
        params: {
            shellyID: string;
            id: number;
            on?: boolean;
            brightness?: number;
            transition?: number;
            temp?: number;
            toggle_after?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** Light.Toggle. */
    'light.toggle': {params: {shellyID: string; id: number}; result: unknown};
    /** Light.SetConfig. */
    'light.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** Light.Calibrate. */
    'light.calibrate': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Light.GetConfig. */
    'light.getconfig': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Light.GetStatus. */
    'light.getstatus': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Light.DimUp — incremental brighten (optional step). */
    'light.dimup': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** Light.DimDown — incremental dim (optional step). */
    'light.dimdown': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** Light.DimStop — stop ongoing dim ramp. */
    'light.dimstop': {params: {shellyID: string; id: number}; result: unknown};
    /** Light.ResetCounters. */
    'light.resetcounters': {
        params: {shellyID: string; id: number; types?: string[]};
        result: unknown;
    };
    /** Light.SetAll — set output/brightness on ALL Light components at once. At least one of on/brightness required. */
    'light.setall': {params: unknown; result: null};
    /** Return the light namespace contract (methods, schemas, permissions, errors). */
    'light.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** LNM stats — tx_msgs, rx_msgs, since (preview). */
    'lnm.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** LNM instance config. */
    'lnm.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** LNM SetConfig — opaque pass-through (addr, tx, rx). */
    'lnm.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Create a new LNM instance (id 200-299). */
    'lnm.create': {
        params: {
            shellyID: string;
            config: Record<string, unknown>;
            id?: number;
        };
        result: Record<string, unknown>;
    };
    /** Delete an existing LNM instance. */
    'lnm.delete': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the lnm namespace contract (methods, schemas, permissions, errors). */
    'lnm.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Create a location. kindFields is validated against the per-kind schema returned by Location.ListKinds. Unique sibling-name per parent. */
    'location.create': {
        params: {
            organizationId?: string;
            name: string;
            kind:
                | 'continent'
                | 'country'
                | 'region'
                | 'county'
                | 'city'
                | 'neighborhood'
                | 'campus'
                | 'site'
                | 'building'
                | 'office'
                | 'floor'
                | 'area'
                | 'room'
                | 'zone';
            parentLocationId?: number | null;
            sortOrder?: number;
            kindFields?: Record<string, unknown>;
            customFields?: Record<string, string | number | boolean | null>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'continent'
                | 'country'
                | 'region'
                | 'county'
                | 'city'
                | 'neighborhood'
                | 'campus'
                | 'site'
                | 'building'
                | 'office'
                | 'floor'
                | 'area'
                | 'room'
                | 'zone';
            parentLocationId: number | null;
            sortOrder: number;
            kindFields: Record<string, unknown>;
            customFields: Record<string, string | number | boolean | null>;
            effective: {
                timezone: string | null;
                countryCode: string | null;
                currency: string | null;
                regulatoryZone: string | null;
                complianceTags: string[];
            };
            coordinateStatus: {
                state: 'mapped' | 'address_only' | 'missing_address';
                summary: string;
            };
            createdAt: string;
            updatedAt: string | null;
            counts?: {
                childLocations?: number;
                childGroups?: number;
                devices?: number;
                entities?: number;
                locations?: number;
                tags?: number;
                descendantDevices?: number;
                descendantEntities?: number;
                groupsReferencingLocation?: number;
            };
        };
    };
    /** Partial-update a location. Cycle-safe parent changes. kindFields replaces the stored object. */
    'location.update': {
        params: {
            organizationId?: string;
            id: number;
            name?: string;
            parentLocationId?: number | null;
            sortOrder?: number;
            kindFields?: Record<string, unknown>;
            customFields?: Record<string, string | number | boolean | null>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'continent'
                | 'country'
                | 'region'
                | 'county'
                | 'city'
                | 'neighborhood'
                | 'campus'
                | 'site'
                | 'building'
                | 'office'
                | 'floor'
                | 'area'
                | 'room'
                | 'zone';
            parentLocationId: number | null;
            sortOrder: number;
            kindFields: Record<string, unknown>;
            customFields: Record<string, string | number | boolean | null>;
            effective: {
                timezone: string | null;
                countryCode: string | null;
                currency: string | null;
                regulatoryZone: string | null;
                complianceTags: string[];
            };
            coordinateStatus: {
                state: 'mapped' | 'address_only' | 'missing_address';
                summary: string;
            };
            createdAt: string;
            updatedAt: string | null;
            counts?: {
                childLocations?: number;
                childGroups?: number;
                devices?: number;
                entities?: number;
                locations?: number;
                tags?: number;
                descendantDevices?: number;
                descendantEntities?: number;
                groupsReferencingLocation?: number;
            };
        };
    };
    /** Delete a location. Blocked if it has children or assignments. */
    'location.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean};
    };
    /** Fetch one location by id with inherited effective fields resolved. */
    'location.get': {
        params: {organizationId?: string; id: number; includeSummary?: boolean};
        result: {
            id: number;
            organizationId: string;
            name: string;
            kind:
                | 'continent'
                | 'country'
                | 'region'
                | 'county'
                | 'city'
                | 'neighborhood'
                | 'campus'
                | 'site'
                | 'building'
                | 'office'
                | 'floor'
                | 'area'
                | 'room'
                | 'zone';
            parentLocationId: number | null;
            sortOrder: number;
            kindFields: Record<string, unknown>;
            customFields: Record<string, string | number | boolean | null>;
            effective: {
                timezone: string | null;
                countryCode: string | null;
                currency: string | null;
                regulatoryZone: string | null;
                complianceTags: string[];
            };
            coordinateStatus: {
                state: 'mapped' | 'address_only' | 'missing_address';
                summary: string;
            };
            createdAt: string;
            updatedAt: string | null;
            counts?: {
                childLocations?: number;
                childGroups?: number;
                devices?: number;
                entities?: number;
                locations?: number;
                tags?: number;
                descendantDevices?: number;
                descendantEntities?: number;
                groupsReferencingLocation?: number;
            };
        };
    };
    /** List locations. Optional parent filter: omit = all, null = roots only, integer = children of that parent. */
    'location.list': {
        params: {
            organizationId?: string;
            parentLocationId?: number | null;
            kind?:
                | 'continent'
                | 'country'
                | 'region'
                | 'county'
                | 'city'
                | 'neighborhood'
                | 'campus'
                | 'site'
                | 'building'
                | 'office'
                | 'floor'
                | 'area'
                | 'room'
                | 'zone';
            rootsOnly?: boolean;
            query?: string;
            limit?: number;
            offset?: number;
            includeSummary?: boolean;
            includeEffective?: boolean;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                kind:
                    | 'continent'
                    | 'country'
                    | 'region'
                    | 'county'
                    | 'city'
                    | 'neighborhood'
                    | 'campus'
                    | 'site'
                    | 'building'
                    | 'office'
                    | 'floor'
                    | 'area'
                    | 'room'
                    | 'zone';
                parentLocationId: number | null;
                sortOrder: number;
                kindFields: Record<string, unknown>;
                customFields: Record<string, string | number | boolean | null>;
                effective: {
                    timezone: string | null;
                    countryCode: string | null;
                    currency: string | null;
                    regulatoryZone: string | null;
                    complianceTags: string[];
                };
                coordinateStatus: {
                    state: 'mapped' | 'address_only' | 'missing_address';
                    summary: string;
                };
                createdAt: string;
                updatedAt: string | null;
                counts?: {
                    childLocations?: number;
                    childGroups?: number;
                    devices?: number;
                    entities?: number;
                    locations?: number;
                    tags?: number;
                    descendantDevices?: number;
                    descendantEntities?: number;
                    groupsReferencingLocation?: number;
                };
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Direct children of the given location. */
    'location.children': {
        params: {
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
            includeSummary?: boolean;
            includeEffective?: boolean;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                kind:
                    | 'continent'
                    | 'country'
                    | 'region'
                    | 'county'
                    | 'city'
                    | 'neighborhood'
                    | 'campus'
                    | 'site'
                    | 'building'
                    | 'office'
                    | 'floor'
                    | 'area'
                    | 'room'
                    | 'zone';
                parentLocationId: number | null;
                sortOrder: number;
                kindFields: Record<string, unknown>;
                customFields: Record<string, string | number | boolean | null>;
                effective: {
                    timezone: string | null;
                    countryCode: string | null;
                    currency: string | null;
                    regulatoryZone: string | null;
                    complianceTags: string[];
                };
                coordinateStatus: {
                    state: 'mapped' | 'address_only' | 'missing_address';
                    summary: string;
                };
                createdAt: string;
                updatedAt: string | null;
                counts?: {
                    childLocations?: number;
                    childGroups?: number;
                    devices?: number;
                    entities?: number;
                    locations?: number;
                    tags?: number;
                    descendantDevices?: number;
                    descendantEntities?: number;
                    groupsReferencingLocation?: number;
                };
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Breadcrumb from root to the given location. */
    'location.path': {
        params: {organizationId?: string; id: number};
        result: {
            items: Array<{
                id: number;
                name: string;
                kind:
                    | 'continent'
                    | 'country'
                    | 'region'
                    | 'county'
                    | 'city'
                    | 'neighborhood'
                    | 'campus'
                    | 'site'
                    | 'building'
                    | 'office'
                    | 'floor'
                    | 'area'
                    | 'room'
                    | 'zone';
            }>;
        };
    };
    /** Per-kind field descriptors + option-set snapshots. Frontend renders the Create/Update form from this response. */
    'location.listkinds': {
        params: Record<string, never>;
        result: {
            kinds: Array<{
                kind:
                    | 'continent'
                    | 'country'
                    | 'region'
                    | 'county'
                    | 'city'
                    | 'neighborhood'
                    | 'campus'
                    | 'site'
                    | 'building'
                    | 'office'
                    | 'floor'
                    | 'area'
                    | 'room'
                    | 'zone';
                label: string;
                allowedParents: Array<
                    | 'continent'
                    | 'country'
                    | 'region'
                    | 'county'
                    | 'city'
                    | 'neighborhood'
                    | 'campus'
                    | 'site'
                    | 'building'
                    | 'office'
                    | 'floor'
                    | 'area'
                    | 'room'
                    | 'zone'
                >;
                allowRoot: boolean;
                fields: Array<{
                    key: string;
                    label: string;
                    description: string;
                    group:
                        | 'identity'
                        | 'physical'
                        | 'contact'
                        | 'hours'
                        | 'compliance'
                        | 'operational'
                        | 'environmental'
                        | 'custom';
                    widget:
                        | 'text'
                        | 'number'
                        | 'iso'
                        | 'combobox'
                        | 'multiCombobox'
                        | 'address'
                        | 'geo'
                        | 'contact'
                        | 'operatingHours'
                        | 'environmentalSetpoint';
                    optionSet?: string;
                    min?: number;
                    max?: number;
                    pattern?: string;
                    unit?: string;
                    placeholder?: string;
                }>;
                inheritableFields: string[];
                sortRank: number;
            }>;
            optionSets: Record<
                string,
                {
                    field: string;
                    kind: 'enum' | 'combobox' | 'iso';
                    values: string[];
                    allowCustom: boolean;
                    multi: boolean;
                }
            >;
        };
    };
    /** Typeahead place lookup over GeoNames (countries, admin, cities) with Nominatim fallback. */
    'location.searchplaces': {
        params: {
            query: string;
            biasCountryCode?: string;
            limit?: number;
            precision?: 'place' | 'street';
        };
        result: {
            candidates: Array<{
                kind: 'country' | 'admin' | 'city' | 'street';
                geonameid?: number;
                name: string;
                asciiname?: string;
                countryCode: string;
                countryName?: string;
                adminCode?: string;
                adminName?: string;
                city?: string;
                streetName?: string;
                houseNumber?: string;
                postalCode?: string;
                lat: number;
                lng: number;
                timezone?: string;
                weight: number;
                score: number;
            }>;
            source: 'local' | 'cache' | 'nominatim' | 'local-weak';
        };
    };
    /** All countries from the GeoNames reference. Cached at boot. */
    'location.listcountries': {
        params: Record<string, never>;
        result: {
            countries: Array<{
                iso2: string;
                iso3: string;
                name: string;
                continent: string;
                capital?: string;
                lat?: number;
                lng?: number;
            }>;
        };
    };
    /** First-level admin divisions (state/province/region) for a country. */
    'location.listregions': {
        params: {countryCode: string};
        result: {
            regions: Array<{
                code: string;
                countryCode: string;
                name: string;
                lat: number;
                lng: number;
            }>;
        };
    };
    /** Resolve missing geo coords for legacy locations. Paginated; call repeatedly until remaining=0. */
    'location.backfillgeo': {
        params: {
            organizationId?: string;
            batchSize?: number;
            forceRefresh?: boolean;
        };
        result: {
            processed: number;
            updated: number;
            skipped: number;
            unresolved: number;
            remaining: number;
            errors: Array<{locationId: number; reason: string}>;
        };
    };
    /** Mint a short-lived ticket for POST /api/uploads/floor-plan. */
    'location.floorplan.createuploadticket': {
        params: {locationId: number};
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Live device RSSI projected onto location geo as {lat,lng,weight} heatmap points. Weight is 0..1 (RSSI normalised from -100..-30 dBm). Only devices assigned to a geo-equipped location are included. */
    'location.signalheatmap': {
        params: {organizationId?: string};
        result: {points: Array<{lat: number; lng: number; weight: number}>};
    };
    /** Windowed per-device audit events projected onto location geo. Returns deck.gl TripsLayer-shaped {id, path:[[lng,lat]…], timestamps:[secs…]}. Useful for fleet event playback (online/offline, RPC, alerts) over a map. */
    'location.eventreplay': {
        params: {
            organizationId?: string;
            from: string;
            to: string;
            eventTypes?: string[];
            maxDevices?: number;
        };
        result: {
            trips: Array<{id: string; path: number[][]; timestamps: number[]}>;
        };
    };
    /** Upsert primary location assignment for a device/entity. */
    'location.setassignment': {
        params: {
            organizationId?: string;
            subjectType: 'device' | 'entity' | 'group';
            subjectId: string;
            locationId: number;
        };
        result: {
            organizationId: string;
            subjectType: 'device' | 'entity' | 'group';
            subjectId: string;
            locationId: number;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Assign many subjects to one location in a single atomic call. */
    'location.setassignments': {
        params: {
            organizationId?: string;
            locationId: number;
            subjects: Array<{
                subjectType: 'device' | 'entity' | 'group';
                subjectId: string;
            }>;
        };
        result: {
            locationId: number;
            assigned: Array<{
                organizationId: string;
                subjectType: 'device' | 'entity' | 'group';
                subjectId: string;
                locationId: number;
                createdAt: string;
                updatedAt: string | null;
            }>;
        };
    };
    /** Remove the primary location assignment for a device/entity. removed=false if no assignment existed. */
    'location.removeassignment': {
        params: {
            organizationId?: string;
            subjectType: 'device' | 'entity' | 'group';
            subjectId: string;
        };
        result: {
            removed: boolean;
            assignment?: {
                organizationId: string;
                subjectType: 'device' | 'entity' | 'group';
                subjectId: string;
                locationId: number;
                createdAt: string;
                updatedAt: string | null;
            } | null;
        };
    };
    /** List location assignments with optional filters. */
    'location.listassignments': {
        params: {
            organizationId?: string;
            subjectType?: 'device' | 'entity' | 'group';
            subjectId?: string;
            locationId?: number;
            locationIds?: number[];
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                organizationId: string;
                subjectType: 'device' | 'entity' | 'group';
                subjectId: string;
                locationId: number;
                createdAt: string;
                updatedAt: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return the location namespace contract (methods, schemas, permissions, errors). */
    'location.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** login_text.GetText — current login UI strings per language. */
    'login_text.gettext': {
        params: {orgId: string; language: string};
        result: Record<string, unknown>;
    };
    /** login_text.GetDefault — Zitadel factory-default UI strings. */
    'login_text.getdefault': {
        params: {language: string};
        result: Record<string, unknown>;
    };
    /** login_text.SetText — override login UI strings (any of ~30 screen blocks). */
    'login_text.settext': {
        params: {
            orgId: string;
            language: string;
            text: Record<string, unknown>;
        };
        result: {ok: boolean};
    };
    /** login_text.Reset — drop org login-text overrides for a language. */
    'login_text.reset': {
        params: {orgId: string; language: string};
        result: {ok: boolean};
    };
    /** Return the login_text namespace contract (methods, schemas, permissions, errors). */
    'login_text.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Send an email via the configured SMTP transport. */
    'mail.send': {
        params: {
            from?: string;
            to: string | string[];
            cc?: string | string[];
            bcc?: string | string[];
            subject?: string;
            text?: string;
            html?: string;
            [key: string]: unknown;
        };
        result: Record<string, unknown>;
    };
    /** Return the mail namespace contract (methods, schemas, permissions, errors). */
    'mail.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Matter.SetConfig. */
    'matter.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Matter.GetSetupCode. */
    'matter.getsetupcode': {
        params: {shellyID: string};
        result: {qr_code: string; manual_code: string};
    };
    /** Matter.GetConfig. */
    'matter.getconfig': {params: {shellyID: string}; result: unknown};
    /** Matter.GetStatus. */
    'matter.getstatus': {params: {shellyID: string}; result: unknown};
    /** Matter.FactoryReset — clear Matter fabric/credentials. */
    'matter.factoryreset': {params: {shellyID: string}; result: null};
    /** Return the matter namespace contract (methods, schemas, permissions, errors). */
    'matter.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** MbRtuClient.SetConfig — Modbus RTU client config (currently no fields per spec). */
    'mbrtuclient.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** MbRtuClient.GetConfig. */
    'mbrtuclient.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** MbRtuClient.GetStatus. */
    'mbrtuclient.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Read holding registers (FC 0x03). 16-bit values from slave memory. */
    'mbrtuclient.readholdingregisters': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            qty: number;
        };
        result: Record<string, unknown>;
    };
    /** Read input registers (FC 0x04). 16-bit read-only values from slave. */
    'mbrtuclient.readinputregisters': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            qty: number;
        };
        result: Record<string, unknown>;
    };
    /** Read discrete inputs (FC 0x02). Single-bit read-only flags. */
    'mbrtuclient.readdiscreteinputs': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            qty: number;
        };
        result: Record<string, unknown>;
    };
    /** Read coils (FC 0x01). Single-bit read/write flags. */
    'mbrtuclient.readcoils': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            qty: number;
        };
        result: Record<string, unknown>;
    };
    /** Write multiple holding registers (FC 0x10). */
    'mbrtuclient.writeholdingregisters': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            values: number[];
        };
        result: Record<string, unknown>;
    };
    /** Write a single holding register (FC 0x06). */
    'mbrtuclient.writesingleregister': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            value: number;
        };
        result: Record<string, unknown>;
    };
    /** Write multiple coils (FC 0x0F). */
    'mbrtuclient.writecoils': {
        params: {
            shellyID: string;
            id: number;
            sid: number;
            addr: number;
            values: boolean[];
        };
        result: Record<string, unknown>;
    };
    /** Return the mbrtuclient namespace contract (methods, schemas, permissions, errors). */
    'mbrtuclient.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Returns whether the mDNS responder is currently running. */
    'mdns.getstatus': {
        params: Record<string, unknown>;
        result: {running: boolean};
    };
    /** Returns the persisted mDNS responder configuration. */
    'mdns.getconfig': {
        params: Record<string, unknown>;
        result: {enable?: boolean};
    };
    /** Enable or disable the mDNS responder. Persists across restarts. */
    'mdns.setconfig': {
        params: {config: {enable?: boolean}};
        result: Record<string, unknown>;
    };
    /** Return the mdns namespace contract (methods, schemas, permissions, errors). */
    'mdns.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List visible background images with signed asset URLs. */
    'media.background.list': {
        params: Record<string, never>;
        result: {thumbnails: string[]; displays: string[]; originals: string[]};
    };
    /** Mint a short-lived ticket for POST /media/uploadBackground. */
    'media.background.createuploadticket': {
        params: Record<string, never>;
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Delete a visible background image. */
    'media.background.delete': {
        params: {fileName: string};
        result: {success: boolean};
    };
    /** List report images with signed asset URLs. */
    'media.reportimage.list': {
        params: Record<string, never>;
        result: {thumbnails: string[]; displays: string[]; originals: string[]};
    };
    /** Mint a short-lived ticket for POST /media/uploadReportImage. */
    'media.reportimage.createuploadticket': {
        params: Record<string, never>;
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Media.GetConfig. */
    'media.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.GetStatus — playback state, volume, item counts. */
    'media.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.SetVolume — 0..10. */
    'media.setvolume': {
        params: {shellyID: string; volume: number};
        result: Record<string, unknown>;
    };
    /** Media.IncreaseVolume. */
    'media.increasevolume': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.DecreaseVolume. */
    'media.decreasevolume': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.Play. */
    'media.player.play': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.Pause. */
    'media.player.pause': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.PlayOrPause. */
    'media.player.playorpause': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.Stop. */
    'media.player.stop': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.Next. */
    'media.player.next': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.Previous. */
    'media.player.previous': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.ListAudioAlbums. */
    'media.listaudioalbums': {
        params: {shellyID: string};
        result: {list?: unknown[]};
    };
    /** Media.ListAudioArtists. */
    'media.listaudioartists': {
        params: {shellyID: string};
        result: {list?: unknown[]};
    };
    /** Media.Radio.Stop. */
    'media.radio.stop': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.Radio.PlayNextFavourite. */
    'media.radio.playnextfavourite': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.Radio.PlayPreviousFavourite. */
    'media.radio.playpreviousfavourite': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Media.PutMedia — chunked upload, returns next offset and restart_required. */
    'media.putmedia': {
        params: {
            shellyID: string;
            filename: string;
            data?: string;
            offset?: number;
            last?: boolean;
        };
        result: {restart_required?: boolean; offset?: number};
    };
    /** Media.MediaPlayer.PlayAlert. */
    'media.player.playalert': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Media.Radio.PlayFavourite. */
    'media.radio.playfavourite': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Media.Radio.ListFavourites. */
    'media.radio.listfavourites': {
        params: {shellyID: string};
        result: {list?: unknown[]};
    };
    /** Media.MediaPlayer.PlayRingtone. */
    'media.player.playringtone': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Media.MediaPlayer.PlayAudioClip. */
    'media.player.playaudioclip': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Media.Delete. */
    'media.delete': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Media.Reload — rescan storage; optional `name` filters to one item. */
    'media.reload': {
        params: {shellyID: string; name?: string};
        result: {restart_required?: boolean};
    };
    /** Media.List. */
    'media.list': {
        params: {shellyID: string};
        result: {list?: unknown[]; items?: unknown[]};
    };
    /** Return the media namespace contract (methods, schemas, permissions, errors). */
    'media.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** message_text.GetText — read message text for type+language. */
    'message_text.gettext': {
        params: {
            orgId: string;
            type:
                | 'init'
                | 'password_reset'
                | 'verify_email'
                | 'verify_phone'
                | 'verify_sms_otp'
                | 'verify_email_otp'
                | 'domain_claimed'
                | 'passwordless_registration'
                | 'password_change'
                | 'invite_user';
            language: string;
        };
        result: Record<string, unknown>;
    };
    /** message_text.GetDefault — Zitadel factory-default text. */
    'message_text.getdefault': {
        params: {
            type:
                | 'init'
                | 'password_reset'
                | 'verify_email'
                | 'verify_phone'
                | 'verify_sms_otp'
                | 'verify_email_otp'
                | 'domain_claimed'
                | 'passwordless_registration'
                | 'password_change'
                | 'invite_user';
            language: string;
        };
        result: Record<string, unknown>;
    };
    /** message_text.SetText — override message text for type+language. */
    'message_text.settext': {
        params: {
            orgId: string;
            type:
                | 'init'
                | 'password_reset'
                | 'verify_email'
                | 'verify_phone'
                | 'verify_sms_otp'
                | 'verify_email_otp'
                | 'domain_claimed'
                | 'passwordless_registration'
                | 'password_change'
                | 'invite_user';
            language: string;
            title?: string;
            preHeader?: string;
            subject?: string;
            greeting?: string;
            text?: string;
            buttonText?: string;
            footerText?: string;
        };
        result: {ok: boolean};
    };
    /** message_text.Reset — drop org override; instance default applies. */
    'message_text.reset': {
        params: {
            orgId: string;
            type:
                | 'init'
                | 'password_reset'
                | 'verify_email'
                | 'verify_phone'
                | 'verify_sms_otp'
                | 'verify_email_otp'
                | 'domain_claimed'
                | 'passwordless_registration'
                | 'password_change'
                | 'invite_user';
            language: string;
        };
        result: {ok: boolean};
    };
    /** Return the message_text namespace contract (methods, schemas, permissions, errors). */
    'message_text.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'mobile.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Composite endpoint for mobile app launch — returns slim device list, waiting-room count, alert counts, and identity in one round trip. Sections the caller cannot read are returned with visible=false. */
    'mobile.getbootstrap': {
        params: {deviceLimit?: number};
        result: Record<string, unknown>;
    };
    /** Returns devices changed since the given timestamp + current waiting-room count. For mobile resume / incremental refresh. */
    'mobile.syncdelta': {
        params: {since: string};
        result: Record<string, unknown>;
    };
    /** Modbus.SetConfig — Modbus TCP/RTU enable toggle. */
    'modbus.setconfig': {
        params: {shellyID: string; config: {enable?: boolean}};
        result: {restart_required: boolean};
    };
    /** Modbus.GetConfig — current Modbus configuration. */
    'modbus.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Modbus.GetStatus — Modbus connectivity / activity status. */
    'modbus.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the modbus namespace contract (methods, schemas, permissions, errors). */
    'modbus.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Mqtt.SetConfig — device-side MQTT client config. */
    'mqtt.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Mqtt.GetConfig — current MQTT client config (password redacted). */
    'mqtt.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Mqtt.GetStatus — broker connectivity state. */
    'mqtt.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the mqtt namespace contract (methods, schemas, permissions, errors). */
    'mqtt.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Register a push-notification token for the caller. Idempotent per (token, user_id). */
    'notification.subscribe': {
        params: {token: string};
        result: {id?: number | null; token: string; userId: string};
    };
    /** List every push-notification token across every user. */
    'notification.listtokens': {
        params: {limit?: number; offset?: number};
        result: {
            items: Array<{
                id?: number | null;
                token?: string | null;
                userId?: string | null;
                created?: string | null;
                updated?: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** List inbox items for the authenticated caller. */
    'notification.inbox.list': {
        params: {
            organizationId?: string;
            state?: 'unread' | 'read';
            kind?:
                | 'alert_created'
                | 'alert_updated'
                | 'alert_resolved'
                | 'alert_digest';
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                userId: string;
                kind:
                    | 'alert_created'
                    | 'alert_updated'
                    | 'alert_resolved'
                    | 'alert_digest';
                state: 'unread' | 'read';
                alertId: number | null;
                source: {
                    organizationId: string;
                    subjectType:
                        | 'device'
                        | 'component'
                        | 'group'
                        | 'location'
                        | 'tag';
                    subjectId: string;
                } | null;
                title: string;
                message: string;
                createdAt: string;
                readAt: string | null;
                availableActions: Array<
                    | 'mark_read'
                    | 'mark_unread'
                    | 'acknowledge_alert'
                    | 'unacknowledge_alert'
                    | 'silence_alert'
                    | 'unsilence_alert'
                    | 'open_source'
                >;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return one inbox item for the authenticated caller. */
    'notification.inbox.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            userId: string;
            kind:
                | 'alert_created'
                | 'alert_updated'
                | 'alert_resolved'
                | 'alert_digest';
            state: 'unread' | 'read';
            alertId: number | null;
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            } | null;
            title: string;
            message: string;
            createdAt: string;
            readAt: string | null;
            availableActions: Array<
                | 'mark_read'
                | 'mark_unread'
                | 'acknowledge_alert'
                | 'unacknowledge_alert'
                | 'silence_alert'
                | 'unsilence_alert'
                | 'open_source'
            >;
        };
    };
    /** Mark one inbox item as read. */
    'notification.inbox.markread': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            userId: string;
            kind:
                | 'alert_created'
                | 'alert_updated'
                | 'alert_resolved'
                | 'alert_digest';
            state: 'unread' | 'read';
            alertId: number | null;
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            } | null;
            title: string;
            message: string;
            createdAt: string;
            readAt: string | null;
            availableActions: Array<
                | 'mark_read'
                | 'mark_unread'
                | 'acknowledge_alert'
                | 'unacknowledge_alert'
                | 'silence_alert'
                | 'unsilence_alert'
                | 'open_source'
            >;
        };
    };
    /** Mark one inbox item as unread. */
    'notification.inbox.markunread': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            userId: string;
            kind:
                | 'alert_created'
                | 'alert_updated'
                | 'alert_resolved'
                | 'alert_digest';
            state: 'unread' | 'read';
            alertId: number | null;
            source: {
                organizationId: string;
                subjectType:
                    | 'device'
                    | 'component'
                    | 'group'
                    | 'location'
                    | 'tag';
                subjectId: string;
            } | null;
            title: string;
            message: string;
            createdAt: string;
            readAt: string | null;
            availableActions: Array<
                | 'mark_read'
                | 'mark_unread'
                | 'acknowledge_alert'
                | 'unacknowledge_alert'
                | 'silence_alert'
                | 'unsilence_alert'
                | 'open_source'
            >;
        };
    };
    /** Mark every unread inbox item as read for the caller. */
    'notification.inbox.markallread': {
        params: {organizationId?: string};
        result: {updatedCount: number};
    };
    /** Static capability descriptor for the destination-group editor. Phase-1 lock — no nested groups, teams, or escalation. */
    'notification.destination.getmodel': {
        params: Record<string, never>;
        result: {
            version: 1;
            memberTypes: Array<'user' | 'channel' | 'push_token'>;
            capabilities: {
                nestedGroups: false;
                teamMembers: false;
                escalationLevels: false;
            };
        };
    };
    /** List destination groups in the caller org. */
    'notification.destination.list': {
        params: {
            organizationId?: string;
            enabled?: boolean;
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                description: string | null;
                enabled: boolean;
                createdAt: string;
                updatedAt: string | null;
                counts: {members: number; rulesReferencing: number};
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Fetch one destination group. */
    'notification.destination.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            enabled: boolean;
            createdAt: string;
            updatedAt: string | null;
            counts: {members: number; rulesReferencing: number};
        };
    };
    /** Create a destination group. */
    'notification.destination.create': {
        params: {
            organizationId?: string;
            name: string;
            description?: string | null;
            enabled?: boolean;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            enabled: boolean;
            createdAt: string;
            updatedAt: string | null;
            counts: {members: number; rulesReferencing: number};
        };
    };
    /** Patch-update a destination group. */
    'notification.destination.update': {
        params: {
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                description?: string | null;
                enabled?: boolean;
            };
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            enabled: boolean;
            createdAt: string;
            updatedAt: string | null;
            counts: {members: number; rulesReferencing: number};
        };
    };
    /** Delete a destination group. Rejected while any alert rule still references it. */
    'notification.destination.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean; id: number};
    };
    /** List members of a destination group. */
    'notification.destination.listmembers': {
        params: {
            organizationId?: string;
            id: number;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                memberType: 'user' | 'channel' | 'push_token';
                memberId: string;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Add members to a destination group. Idempotent on duplicates. */
    'notification.destination.addmembers': {
        params: {
            organizationId?: string;
            id: number;
            members: Array<{
                memberType: 'user' | 'channel' | 'push_token';
                memberId: string;
            }>;
        };
        result: {
            id: number;
            added: Array<{
                memberType: 'user' | 'channel' | 'push_token';
                memberId: string;
            }>;
        };
    };
    /** Remove members from a destination group. */
    'notification.destination.removemembers': {
        params: {
            organizationId?: string;
            id: number;
            members: Array<{
                memberType: 'user' | 'channel' | 'push_token';
                memberId: string;
            }>;
        };
        result: {
            id: number;
            removed: Array<{
                memberType: 'user' | 'channel' | 'push_token';
                memberId: string;
            }>;
        };
    };
    /** List delivery jobs. Filter by channel, state, provider, alert, and time window. */
    'notification.history.list': {
        params: {
            organizationId?: string;
            channelId?: number;
            state?:
                | 'queued'
                | 'processing'
                | 'succeeded'
                | 'failed'
                | 'superseded'
                | 'dead_letter';
            provider?:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'push_fcm'
                | 'sms_twilio'
                | 'voice_twilio'
                | 'webhook_signed';
            alertId?: number;
            from?: string;
            to?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                alertId: number | null;
                inboxItemId: number | null;
                channelId: number;
                state:
                    | 'queued'
                    | 'processing'
                    | 'succeeded'
                    | 'failed'
                    | 'superseded'
                    | 'dead_letter';
                createdAt: string;
                completedAt: string | null;
                attemptCount: number;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Fetch one delivery job with its attempt history (newest first). */
    'notification.history.get': {
        params: {organizationId?: string; id: number};
        result: {
            job: {
                id: number;
                organizationId: string;
                alertId: number | null;
                inboxItemId: number | null;
                channelId: number;
                state:
                    | 'queued'
                    | 'processing'
                    | 'succeeded'
                    | 'failed'
                    | 'superseded'
                    | 'dead_letter';
                createdAt: string;
                completedAt: string | null;
                attemptCount: number;
            };
            attempts: Array<{
                id: number;
                jobId: number;
                channelId: number;
                state: 'succeeded' | 'failed';
                attemptedAt: string;
                httpStatus: number | null;
                providerCode: string | null;
                errorMessage: string | null;
            }>;
        };
    };
    /** Re-enqueue a terminally-failed delivery job. Rejected unless state=failed/dead_letter and the backing alert still exists. */
    'notification.history.requeue': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            alertId: number | null;
            inboxItemId: number | null;
            channelId: number;
            state:
                | 'queued'
                | 'processing'
                | 'succeeded'
                | 'failed'
                | 'superseded'
                | 'dead_letter';
            createdAt: string;
            completedAt: string | null;
            attemptCount: number;
        };
    };
    /** Render a notification template against a real alert (sampleAlertId) or a synthesized sample for a rule kind. Uses the same renderer as delivery. */
    'notification.rendertemplate': {
        params: {
            organizationId?: string;
            template: string;
            sampleAlertId?: number;
            ruleKind?: string;
            ruleName?: string;
        };
        result: {
            rendered: string;
            missingTokens: string[];
            truncated: boolean;
            tokens: Array<{
                token: string;
                label: string;
                description: string;
                example: string;
            }>;
        };
    };
    /** Render the full email body (html + text) for an email channel. Uses the configured htmlTemplate/textTemplate overrides if given, otherwise the branded default. The html is safe to iframe. */
    'notification.renderemailpreview': {
        params: {
            organizationId?: string;
            channelId?: number;
            emailTemplateId?: number;
            subjectTemplate?: string;
            htmlTemplate?: string;
            textTemplate?: string;
            attachments?: Array<{
                filename: string;
                url?: string;
                assetId?: number;
                cid?: string;
                contentType?: string;
            }>;
            sampleAlertId?: number;
            ruleKind?: string;
            ruleName?: string;
        };
        result: {
            subject: string;
            html: string;
            text: string;
            missingTokens: string[];
            truncated: boolean;
            attachments: Array<{
                filename: string;
                url: string;
                cid?: string;
                contentType?: string;
                reachable: boolean;
                error?: string;
            }>;
        };
    };
    /** Validate a Fleet Manager notification bundle. Secrets are rejected by default; no data is written. */
    'notification.bundle.validate': {
        params: {
            organizationId?: string;
            bundle: Record<string, unknown>;
            channelMappings?: Record<string, number>;
        };
        result: {
            dryRun: true;
            bundle: Record<string, unknown>;
            warnings: Array<{path: string; message: string}>;
        };
    };
    /** Validate a Fleet Manager notification bundle and return create/update/unsupported operations. No data is written. */
    'notification.bundle.planimport': {
        params: {
            organizationId?: string;
            bundle: Record<string, unknown>;
            channelMappings?: Record<string, number>;
        };
        result: {
            dryRun: true;
            bundle: Record<string, unknown>;
            operations: Array<{
                resourceType: 'routing_policy' | 'on_call_schedule' | 'channel';
                key: string;
                action: 'create' | 'update' | 'unsupported';
                message: string;
                conflicts: Array<{path: string; message: string}>;
                requiresSecretMapping: boolean;
                mappingKeys: string[];
            }>;
            warnings: Array<{path: string; message: string}>;
            conflicts: Array<{path: string; message: string}>;
        };
    };
    /** Apply safe notification bundle resources. Routing policies and on-call schedules are written; secret-bearing channels are skipped until secret mapping is supplied. */
    'notification.bundle.applyimport': {
        params: {
            organizationId?: string;
            bundle: Record<string, unknown>;
            channelMappings?: Record<string, number>;
        };
        result: {
            dryRun: false;
            bundle: Record<string, unknown>;
            operations: Array<{
                resourceType: 'routing_policy' | 'on_call_schedule' | 'channel';
                key: string;
                action: 'create' | 'update' | 'unsupported';
                message: string;
                conflicts: Array<{path: string; message: string}>;
                requiresSecretMapping: boolean;
                mappingKeys: string[];
            }>;
            applied: Array<{
                resourceType: 'routing_policy' | 'on_call_schedule' | 'channel';
                key: string;
                action: 'create' | 'update' | 'unsupported';
                message: string;
                conflicts: Array<{path: string; message: string}>;
                requiresSecretMapping: boolean;
                mappingKeys: string[];
            }>;
            skipped: Array<{
                resourceType: 'routing_policy' | 'on_call_schedule' | 'channel';
                key: string;
                action: 'create' | 'update' | 'unsupported';
                message: string;
                conflicts: Array<{path: string; message: string}>;
                requiresSecretMapping: boolean;
                mappingKeys: string[];
            }>;
            warnings: Array<{path: string; message: string}>;
            conflicts: Array<{path: string; message: string}>;
        };
    };
    /** Export the native FM notification bundle for the caller org. Secrets are never exported. */
    'notification.bundle.export': {
        params: {organizationId?: string};
        result: {
            dryRun: true;
            bundle: Record<string, unknown>;
            warnings: Array<{path: string; message: string}>;
        };
    };
    /** Convert Grafana provisioning JSON into an FM notification bundle candidate. Dry-run only; secrets are omitted with warnings. */
    'notification.bundle.importgrafana': {
        params: {organizationId?: string; config: Record<string, unknown>};
        result: {
            dryRun: true;
            bundle: Record<string, unknown>;
            warnings: Array<{path: string; message: string}>;
        };
    };
    /** Convert Prometheus Alertmanager JSON-style config into an FM notification bundle candidate. Dry-run only; secrets are omitted with warnings. */
    'notification.bundle.importalertmanager': {
        params: {organizationId?: string; config: Record<string, unknown>};
        result: {
            dryRun: true;
            bundle: Record<string, unknown>;
            warnings: Array<{path: string; message: string}>;
        };
    };
    /** Convert an FM notification bundle into Grafana provisioning JSON. Dry-run only; secrets are never exported. */
    'notification.bundle.exportgrafana': {
        params: {
            organizationId?: string;
            bundle: Record<string, unknown>;
            channelMappings?: Record<string, number>;
        };
        result: {
            dryRun: true;
            config: Record<string, unknown>;
            warnings: Array<{path: string; message: string}>;
        };
    };
    /** Convert an FM notification bundle into Prometheus Alertmanager JSON-style config. Dry-run only; secrets are never exported. */
    'notification.bundle.exportalertmanager': {
        params: {
            organizationId?: string;
            bundle: Record<string, unknown>;
            channelMappings?: Record<string, number>;
        };
        result: {
            dryRun: true;
            config: Record<string, unknown>;
            warnings: Array<{path: string; message: string}>;
        };
    };
    /** List notification preferences for the authenticated user in the caller org. */
    'notification.preference.list': {
        params: {organizationId?: string};
        result: {
            items: Array<{
                userId: string;
                channelType:
                    | 'email_smtp'
                    | 'generic_webhook'
                    | 'slack_webhook'
                    | 'teams_workflow_webhook'
                    | 'telegram_bot'
                    | 'in_app';
                severityFilters: Array<'info' | 'warning' | 'critical'>;
                quietHours: Record<string, unknown>;
                digestPreference: Record<string, unknown>;
                disabled: boolean;
                createdAt: string;
                updatedAt: string | null;
            }>;
        };
    };
    /** Set one notification channel preference for the authenticated user. */
    'notification.preference.set': {
        params: {
            organizationId?: string;
            channelType:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'in_app';
            severityFilters: Array<'info' | 'warning' | 'critical'>;
            quietHours: Record<string, unknown>;
            digestPreference: Record<string, unknown>;
            disabled: boolean;
        };
        result: {
            userId: string;
            channelType:
                | 'email_smtp'
                | 'generic_webhook'
                | 'slack_webhook'
                | 'teams_workflow_webhook'
                | 'telegram_bot'
                | 'in_app';
            severityFilters: Array<'info' | 'warning' | 'critical'>;
            quietHours: Record<string, unknown>;
            digestPreference: Record<string, unknown>;
            disabled: boolean;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** List on-call schedules for the caller organization. */
    'notification.oncall.list': {
        params: {organizationId?: string; enabledOnly?: boolean};
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                timezone: string;
                rotationRules: Array<Record<string, unknown>>;
                overrides: Array<Record<string, unknown>>;
                target: Record<string, unknown>;
                enabled: boolean;
                createdAt: string;
                updatedAt: string | null;
            }>;
        };
    };
    /** Create or update one organization-scoped on-call schedule. */
    'notification.oncall.set': {
        params: {
            organizationId?: string;
            scheduleId?: number;
            name: string;
            timezone: string;
            rotationRules: Array<Record<string, unknown>>;
            overrides: Array<Record<string, unknown>>;
            target: Record<string, unknown>;
            enabled?: boolean;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            timezone: string;
            rotationRules: Array<Record<string, unknown>>;
            overrides: Array<Record<string, unknown>>;
            target: Record<string, unknown>;
            enabled: boolean;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete one organization-scoped on-call schedule. */
    'notification.oncall.delete': {
        params: {organizationId?: string; scheduleId: number};
        result: {deleted: boolean};
    };
    /** Resolve the active on-call users for one schedule at a specific time. */
    'notification.oncall.resolve': {
        params: {organizationId?: string; scheduleId: number; at?: string};
        result: {
            scheduleId: string;
            userIds: string[];
            source: 'override' | 'rotation' | 'target' | 'empty';
        };
    };
    /** List notification routing policies for the caller org. */
    'notification.routing.list': {
        params: {organizationId?: string; enabledOnly?: boolean};
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                parentPolicyId: number | null;
                name: string;
                sortOrder: number;
                labelMatchers: Array<Record<string, unknown>>;
                severityMatchers: Array<'info' | 'warning' | 'critical'>;
                resourceSelectors: Array<Record<string, unknown>>;
                contactPoints: Array<Record<string, unknown>>;
                groupingKeys: string[];
                muteWindows: Array<Record<string, unknown>>;
                runtimeSilences: Array<Record<string, unknown>>;
                inhibitionRules: Array<Record<string, unknown>>;
                escalationStages: Array<Record<string, unknown>>;
                enabled: boolean;
                createdAt: string;
                updatedAt: string | null;
            }>;
        };
    };
    /** Create or update one notification routing policy for the caller org. */
    'notification.routing.set': {
        params: {
            organizationId?: string;
            policyId?: number;
            parentPolicyId?: number | null;
            name: string;
            sortOrder?: number;
            labelMatchers: Array<Record<string, unknown>>;
            severityMatchers: Array<'info' | 'warning' | 'critical'>;
            resourceSelectors: Array<Record<string, unknown>>;
            contactPoints: Array<Record<string, unknown>>;
            groupingKeys: string[];
            muteWindows: Array<Record<string, unknown>>;
            runtimeSilences: Array<Record<string, unknown>>;
            inhibitionRules: Array<Record<string, unknown>>;
            escalationStages: Array<Record<string, unknown>>;
            enabled?: boolean;
        };
        result: {
            id: number;
            organizationId: string;
            parentPolicyId: number | null;
            name: string;
            sortOrder: number;
            labelMatchers: Array<Record<string, unknown>>;
            severityMatchers: Array<'info' | 'warning' | 'critical'>;
            resourceSelectors: Array<Record<string, unknown>>;
            contactPoints: Array<Record<string, unknown>>;
            groupingKeys: string[];
            muteWindows: Array<Record<string, unknown>>;
            runtimeSilences: Array<Record<string, unknown>>;
            inhibitionRules: Array<Record<string, unknown>>;
            escalationStages: Array<Record<string, unknown>>;
            enabled: boolean;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete one notification routing policy. */
    'notification.routing.delete': {
        params: {organizationId?: string; policyId: number};
        result: {deleted: boolean};
    };
    /** Dry-run routing policies against alert labels, severity, and optional resource. */
    'notification.routing.evaluate': {
        params: {
            organizationId?: string;
            severity: 'info' | 'warning' | 'critical';
            labels: Record<string, string>;
            resource?: {type: string; id: string};
        };
        result: {
            matches: Array<{
                policyId: number;
                name: string;
                contactPoints: Array<Record<string, unknown>>;
                groupingKeys: string[];
                escalationStages: Array<Record<string, unknown>>;
            }>;
        };
    };
    /** List saved email templates for this organization. */
    'notification.emailtemplate.list': {
        params: {organizationId?: string; limit?: number; offset?: number};
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                description: string | null;
                subjectTemplate: string | null;
                htmlTemplate: string | null;
                textTemplate: string | null;
                attachments: Array<{
                    filename: string;
                    url?: string;
                    assetId?: number;
                    cid?: string;
                    contentType?: string;
                }>;
                createdAt: string;
                updatedAt: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return one saved email template. */
    'notification.emailtemplate.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            subjectTemplate: string | null;
            htmlTemplate: string | null;
            textTemplate: string | null;
            attachments: Array<{
                filename: string;
                url?: string;
                assetId?: number;
                cid?: string;
                contentType?: string;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Save a named email template (subject/html/text). Any email_smtp endpoint can reference it via config.emailTemplateId. */
    'notification.emailtemplate.create': {
        params: {
            organizationId?: string;
            name: string;
            description?: string;
            subjectTemplate?: string;
            htmlTemplate?: string;
            textTemplate?: string;
            attachments?: Array<{
                filename: string;
                url?: string;
                assetId?: number;
                cid?: string;
                contentType?: string;
            }>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            subjectTemplate: string | null;
            htmlTemplate: string | null;
            textTemplate: string | null;
            attachments: Array<{
                filename: string;
                url?: string;
                assetId?: number;
                cid?: string;
                contentType?: string;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Patch a saved email template. Pass null for any body field to clear it. */
    'notification.emailtemplate.update': {
        params: {
            organizationId?: string;
            id: number;
            name?: string;
            description?: string | null;
            subjectTemplate?: string | null;
            htmlTemplate?: string | null;
            textTemplate?: string | null;
            attachments?: Array<{
                filename: string;
                url?: string;
                assetId?: number;
                cid?: string;
                contentType?: string;
            }>;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            subjectTemplate: string | null;
            htmlTemplate: string | null;
            textTemplate: string | null;
            attachments: Array<{
                filename: string;
                url?: string;
                assetId?: number;
                cid?: string;
                contentType?: string;
            }>;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete a saved email template by id. */
    'notification.emailtemplate.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean};
    };
    /** List reusable multi-channel message templates in the caller organization. A rule or an endpoint can point at one. */
    'notification.template.list': {
        params: {organizationId?: string};
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                name: string;
                description: string | null;
                bodies: {
                    email?: {subject: string; html: string; text: string};
                    slack?: {blocks: string};
                    teams?: {card: string};
                };
                fallbackText: string;
                createdAt: string;
                updatedAt: string | null;
            }>;
        };
    };
    /** Fetch one message template by id. */
    'notification.template.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            bodies: {
                email?: {subject: string; html: string; text: string};
                slack?: {blocks: string};
                teams?: {card: string};
            };
            fallbackText: string;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Create a message template (per-channel bodies + required fallback text). Slack/Teams bodies must be valid JSON. Preview a body with Notification.RenderTemplate. */
    'notification.template.create': {
        params: {
            organizationId?: string;
            name: string;
            description?: string | null;
            bodies?: {
                email?: {subject: string; html: string; text: string};
                slack?: {blocks: string};
                teams?: {card: string};
            };
            fallbackText: string;
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            bodies: {
                email?: {subject: string; html: string; text: string};
                slack?: {blocks: string};
                teams?: {card: string};
            };
            fallbackText: string;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Update a message template. */
    'notification.template.update': {
        params: {
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                description?: string | null;
                bodies?: {
                    email?: {subject: string; html: string; text: string};
                    slack?: {blocks: string};
                    teams?: {card: string};
                };
                fallbackText?: string;
            };
        };
        result: {
            id: number;
            organizationId: string;
            name: string;
            description: string | null;
            bodies: {
                email?: {subject: string; html: string; text: string};
                slack?: {blocks: string};
                teams?: {card: string};
            };
            fallbackText: string;
            createdAt: string;
            updatedAt: string | null;
        };
    };
    /** Delete a message template. Blocked while any rule or endpoint still references it. */
    'notification.template.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean};
    };
    /** List uploaded email assets (binary images) for the caller org. Bytes are not returned — fetch via GET /api/notifications/email-assets/:id. */
    'notification.emailasset.list': {
        params: {organizationId?: string; limit?: number; offset?: number};
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                filename: string;
                contentType: string;
                sizeBytes: number;
                sha256: string;
                createdAt: string;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Mint a short-lived ticket for POST /api/notifications/email-assets. */
    'notification.emailasset.createuploadticket': {
        params: Record<string, never>;
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Return metadata for a single email asset by id. */
    'notification.emailasset.get': {
        params: {organizationId?: string; id: number};
        result: {
            id: number;
            organizationId: string;
            filename: string;
            contentType: string;
            sizeBytes: number;
            sha256: string;
            createdAt: string;
        };
    };
    /** Delete an email asset. Templates / endpoints still referencing the assetId will fail to send; audit before deleting. */
    'notification.emailasset.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean};
    };
    /** Begin in-app OAuth2 consent for an email_smtp endpoint. Returns an authUrl the UI opens in a popup; the provider redirects to /api/oauth/callback/email which stores the refresh token on the endpoint. */
    'notification.oauth.start': {
        params: {
            organizationId?: string;
            channelId: number;
            provider: 'oauth2_google' | 'oauth2_microsoft';
            tenant?: string;
        };
        result: {authUrl: string; state: string; expiresAt: string};
    };
    /** Return the notification namespace contract (methods, schemas, permissions, errors). */
    'notification.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** notification_policy.GetPolicy — current notification policy. */
    'notification_policy.getpolicy': {
        params: {orgId: string};
        result: Record<string, unknown>;
    };
    /** notification_policy.SetPolicy — toggle "notify user on password change". */
    'notification_policy.setpolicy': {
        params: {orgId: string; passwordChange?: boolean};
        result: {ok: boolean};
    };
    /** notification_policy.Reset — drop org override. */
    'notification_policy.reset': {
        params: {orgId: string};
        result: {ok: boolean};
    };
    /** Return the notification_policy namespace contract (methods, schemas, permissions, errors). */
    'notification_policy.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Object.GetConfig — id, name, meta, owner, access. */
    'object.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Object.GetStatus — value, source, last_update_ts. */
    'object.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Object.SetConfig — patch object metadata (subject to access flags). */
    'object.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Object.Set — write the typed value (caller must match the object type). */
    'object.set': {
        params: {shellyID: string; id: number; value: unknown};
        result: null;
    };
    /** Return the object namespace contract (methods, schemas, permissions, errors). */
    'object.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Return the caller's organization profile. */
    'organization.getprofile': {
        params: Record<string, never>;
        result: {
            id: string;
            name: string | null;
            displayName: string | null;
            timezoneDefault: string | null;
            localeDefault: string | null;
            currencyDefault: string | null;
            unitSystemDefault: 'metric' | 'imperial' | null;
            brandInitials: string | null;
            brandColor: string | null;
            metadata: Record<string, unknown>;
        };
    };
    /** Partial-update the caller organization profile. Null field = clear. */
    'organization.setprofile': {
        params: {
            patch: {
                displayName?: string | null;
                timezoneDefault?: string | null;
                localeDefault?: string | null;
                currencyDefault?: string | null;
                unitSystemDefault?: 'metric' | 'imperial' | null;
                brandInitials?: string | null;
                brandColor?: string | null;
                metadata?: Record<string, unknown>;
            };
        };
        result: {
            id: string;
            name: string | null;
            displayName: string | null;
            timezoneDefault: string | null;
            localeDefault: string | null;
            currencyDefault: string | null;
            unitSystemDefault: 'metric' | 'imperial' | null;
            brandInitials: string | null;
            brandColor: string | null;
            metadata: Record<string, unknown>;
        };
    };
    /** Return the caller organization's default timezone + locale. */
    'organization.getdefaults': {
        params: Record<string, never>;
        result: {timezoneDefault: string | null; localeDefault: string | null};
    };
    /** Single source of truth for frontend form construction — location kinds, group types, membership modes, subject-type enums, phase-1 capabilities, and legacy-transition flags. */
    'organization.getscopemodel': {
        params: Record<string, never>;
        result: {
            version: 1;
            locationKinds: Array<{
                key:
                    | 'continent'
                    | 'country'
                    | 'region'
                    | 'county'
                    | 'city'
                    | 'neighborhood'
                    | 'campus'
                    | 'site'
                    | 'building'
                    | 'office'
                    | 'floor'
                    | 'area'
                    | 'room'
                    | 'zone';
                label: string;
                sortRank: number;
                allowRoot: boolean;
            }>;
            groupTypes: Array<{
                key: 'standard' | 'operational' | 'critical' | 'custom';
                label: string;
                severityFloorDefault: 'info' | 'warning' | 'critical' | null;
                retentionDaysDefault: number | null;
                auditRetentionDaysDefault: number | null;
            }>;
            membershipModes: Array<{
                key: 'manual';
                label: string;
                enabled: boolean;
            }>;
            groupMemberTypes: Array<'device' | 'entity' | 'location'>;
            tagAssignmentTypes: Array<
                | 'location'
                | 'group'
                | 'device'
                | 'entity'
                | 'alert_rule'
                | 'destination_group'
                | 'channel'
                | 'script'
            >;
            locationAssignmentTypes: Array<'device' | 'entity' | 'group'>;
            capabilities: {
                customLocationKinds: boolean;
                dynamicGroups: boolean;
                nestedGroups: boolean;
                entityLocationOverride: boolean;
            };
            legacyTransition: {
                canonicalPhysicalScope: string;
                canonicalDashboardLocationParam: string;
                deprecatedDashboardLocationParams: string[];
                rootGroupImportMode: string;
            };
        };
    };
    /** Return the organization namespace contract (methods, schemas, permissions, errors). */
    'organization.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** OTA.Update — start url-based firmware update. */
    'ota.update': {
        params: {shellyID: string; url: string};
        result: Record<string, unknown>;
    };
    /** OTA.Start — begin a chunked firmware upload of `size` bytes. */
    'ota.start': {params: {shellyID: string; size: number}; result: null};
    /** OTA.Write — write a base64 chunk at offset. */
    'ota.write': {
        params: {shellyID: string; offset: number; data: string};
        result: Record<string, unknown>;
    };
    /** OTA.Data — append the next sequential base64 chunk. */
    'ota.data': {
        params: {shellyID: string; data: string};
        result: Record<string, unknown>;
    };
    /** OTA.Commit — finalize the chunked upload and reboot. */
    'ota.commit': {params: {shellyID: string}; result: Record<string, unknown>};
    /** OTA.Abort — cancel an active chunked upload. */
    'ota.abort': {params: {shellyID: string}; result: null};
    /** OTA.Revert — roll back to the previous firmware image. */
    'ota.revert': {params: {shellyID: string}; result: Record<string, unknown>};
    /** Return the ota namespace contract (methods, schemas, permissions, errors). */
    'ota.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** permission.GetRoles — return Zitadel built-in role keys held by a user. */
    'permission.getroles': {
        params: {userId: string};
        result: Record<string, unknown>;
    };
    /** permission.GrantRoles — grant one or more Zitadel built-in roles to a user. */
    'permission.grantroles': {
        params: {
            userId: string;
            roles: Array<
                | 'admin'
                | 'manager'
                | 'editor'
                | 'installer'
                | 'operator'
                | 'automation_admin'
                | 'auditor'
                | 'viewer'
            >;
        };
        result: {success: boolean};
    };
    /** permission.RevokeRoles — remove one or more Zitadel built-in roles from a user. Deletes the project authorization entirely when no roles remain. */
    'permission.revokeroles': {
        params: {
            userId: string;
            roles: Array<
                | 'admin'
                | 'manager'
                | 'editor'
                | 'installer'
                | 'operator'
                | 'automation_admin'
                | 'auditor'
                | 'viewer'
            >;
        };
        result: {success: boolean};
    };
    /** permission.ListAdministrators — list users with administrator role on the resolved organization. */
    'permission.listadministrators': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** permission.GetIdentityPolicies — read Zitadel identity (login/lockout/password) policies. */
    'permission.getidentitypolicies': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Return the permission namespace contract (methods, schemas, permissions, errors). */
    'permission.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'persona.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** List personas (system + custom). */
    'persona.list': {
        params: {includeSystem?: boolean};
        result: Record<string, unknown>;
    };
    /** Fetch a persona by id. */
    'persona.get': {params: {id: string}; result: Record<string, unknown>};
    /** Create a custom persona. */
    'persona.create': {
        params: {
            key: string;
            name: string;
            description?: string;
            statements: Array<{
                actions: string[];
                not_actions?: string[];
                resource_types: string[];
                not_resource_types?: string[];
                effect: 'Allow' | 'Deny';
                condition?: {
                    mfa?: {required?: boolean};
                    ip?: {cidrs?: string[]};
                    time?: {window?: {start: string; end: string}};
                };
            }>;
        };
        result: Record<string, unknown>;
    };
    /** Update a custom persona. */
    'persona.update': {
        params: {
            id: string;
            name?: string;
            description?: string | null;
            statements?: Array<{
                actions: string[];
                not_actions?: string[];
                resource_types: string[];
                not_resource_types?: string[];
                effect: 'Allow' | 'Deny';
                condition?: {
                    mfa?: {required?: boolean};
                    ip?: {cidrs?: string[]};
                    time?: {window?: {start: string; end: string}};
                };
            }>;
        };
        result: Record<string, unknown>;
    };
    /** Delete a custom persona (refuses if assignments reference). */
    'persona.delete': {params: {id: string}; result: Record<string, unknown>};
    /** Pill.SetConfig (not publicly documented). */
    'pill.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Pill.GetConfig — mode + per-pin mode settings. */
    'pill.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Pill.GetStatus — empty per spec; reserved for fw extensions. */
    'pill.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the pill namespace contract (methods, schemas, permissions, errors). */
    'pill.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List registered plugins with metadata + config (redacted for non-admins). */
    'plugin.list': {
        params: Record<string, unknown>;
        result: {
            items: Array<{
                name: string;
                version?: string;
                description?: string;
                config?: Record<string, unknown> | null;
                [key: string]: unknown;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Upload a base64-encoded plugin zip (max 50 MB decoded). */
    'plugin.upload': {params: {data: string}; result: null};
    /** Remove an installed plugin by name (symlink-safe path validation). */
    'plugin.remove': {params: {name: string}; result: Record<string, unknown>};
    /** Return the plugin namespace contract (methods, schemas, permissions, errors). */
    'plugin.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** PM1.SetConfig — name / reverse / alarms. */
    'pm1.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** PM1.GetConfig. */
    'pm1.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** PM1.GetStatus — {voltage, current, apower, freq, aenergy, ret_aenergy, errors, flags}. */
    'pm1.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** PM1.ResetCounters — clear energy counters; optional `type` array to scope. */
    'pm1.resetcounters': {
        params: {shellyID: string; id: number; type?: string[]};
        result: Record<string, unknown>;
    };
    /** Return the pm1 namespace contract (methods, schemas, permissions, errors). */
    'pm1.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Read per-type policy defaults (current DB value + env default + source + audit fields). */
    'policy.getdefaults': {
        params: {organizationId?: string};
        result: {
            items: Array<{
                groupType: 'standard' | 'operational' | 'critical' | 'custom';
                severityFloor: {
                    current: 'info' | 'warning' | 'critical' | null;
                    envDefault: 'info' | 'warning' | 'critical' | null;
                    source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                    lastUpdatedAt: string;
                    lastUpdatedBy: string | null;
                };
                retentionDays: {
                    current: number | null;
                    envDefault: number | null;
                    source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                    lastUpdatedAt: string;
                    lastUpdatedBy: string | null;
                };
                auditRetentionDays: {
                    current: number | null;
                    envDefault: number | null;
                    source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                    lastUpdatedAt: string;
                    lastUpdatedBy: string | null;
                };
            }>;
            envFallback: {
                retentionFallbackDays: number;
                auditRetentionFallbackDays: number;
                sweepIntervalMinutes: number;
            };
        };
    };
    /** provider-support-only partial update of one groupType row. null clears (falls through to env); omitted = no change. Optional ifUnchangedSince for optimistic concurrency (409 PolicyDefaultsStaleUpdate on conflict). */
    'policy.updatedefaults': {
        params: {
            organizationId?: string;
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            severityFloor?: 'info' | 'warning' | 'critical' | null;
            retentionDays?: number | null;
            auditRetentionDays?: number | null;
            ifUnchangedSince?: string;
        };
        result: {
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            severityFloor: {
                current: 'info' | 'warning' | 'critical' | null;
                envDefault: 'info' | 'warning' | 'critical' | null;
                source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                lastUpdatedAt: string;
                lastUpdatedBy: string | null;
            };
            retentionDays: {
                current: number | null;
                envDefault: number | null;
                source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                lastUpdatedAt: string;
                lastUpdatedBy: string | null;
            };
            auditRetentionDays: {
                current: number | null;
                envDefault: number | null;
                source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                lastUpdatedAt: string;
                lastUpdatedBy: string | null;
            };
        };
    };
    /** provider-support-only. Rewrites one or more fields of a groupType with the current env value; logged as source=env-reset. Empty env value clears the DB row. */
    'policy.resetdefault': {
        params: {
            organizationId?: string;
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            fields: Array<
                'severityFloor' | 'retentionDays' | 'auditRetentionDays'
            >;
        };
        result: {
            groupType: 'standard' | 'operational' | 'critical' | 'custom';
            severityFloor: {
                current: 'info' | 'warning' | 'critical' | null;
                envDefault: 'info' | 'warning' | 'critical' | null;
                source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                lastUpdatedAt: string;
                lastUpdatedBy: string | null;
            };
            retentionDays: {
                current: number | null;
                envDefault: number | null;
                source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                lastUpdatedAt: string;
                lastUpdatedBy: string | null;
            };
            auditRetentionDays: {
                current: number | null;
                envDefault: number | null;
                source: 'env-seed' | 'admin' | 'env-reset' | 'unset';
                lastUpdatedAt: string;
                lastUpdatedBy: string | null;
            };
        };
    };
    /** Return the policy namespace contract (methods, schemas, permissions, errors). */
    'policy.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Subscribe to the live tracking stream for a presence sensor. */
    'presence.livetrack': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Apply a partial presence config update. */
    'presence.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Enable or disable the presence sensor. */
    'presence.setsensor': {
        params: {shellyID: string; enable: boolean};
        result: Record<string, unknown>;
    };
    /** Add a presence detection zone. */
    'presence.addzone': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Remove a detection zone by id. */
    'presence.deletezone': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Apply a partial zone config update. */
    'presence.zone.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Start tilt calibration for the mmWave sensor. */
    'presence.tiltcalibrate': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Presence.GetConfig — current sensor configuration. */
    'presence.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Presence.GetStatus — runtime state including live tracking flag. */
    'presence.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the presence namespace contract (methods, schemas, permissions, errors). */
    'presence.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** PresenceZone.SetConfig — name / enable / color / area (zone polygon). */
    'presencezone.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** PresenceZone.GetConfig. */
    'presencezone.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** PresenceZone.GetStatus — {id, state, num_objects}. */
    'presencezone.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the presencezone namespace contract (methods, schemas, permissions, errors). */
    'presencezone.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Privacy.GetPolicy — current legal-link policy. */
    'privacy.getpolicy': {
        params: {orgId: string};
        result: Record<string, unknown>;
    };
    /** Privacy.SetPolicy — ToS / privacy / support / help links. */
    'privacy.setpolicy': {
        params: {
            orgId: string;
            tosLink?: string;
            privacyLink?: string;
            helpLink?: string;
            supportEmail?: string;
            docsLink?: string;
            customLink?: string;
            customLinkText?: string;
        };
        result: {ok: boolean};
    };
    /** Privacy.Reset — drop org override. */
    'privacy.reset': {params: {orgId: string}; result: {ok: boolean}};
    /** Return the privacy namespace contract (methods, schemas, permissions, errors). */
    'privacy.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Unified report endpoint — one front door for reports and data exports. Returns a jobId immediately (async); poll Report.GetReport for status + the owner-bound download URL. Two `kind`s: `energy` (the energy report — cost, tariff, CO2 and per-source sections; from, to, granularity incl. 15-minute, scope, tariff, currency, main_meter_ids, dashboardId; format html | csv) and `interval` (interval data / "load profile" — per-device readings of one or more metrics at a chosen granularity: metrics, from, to, granularity, scope/devices, per_device; streamed CSV) and `environment` (the environmental report — comfort, air quality, light, weather, per-sensor breakdown, threshold breaches from the device_sensor rollup; from, to, granularity, scope, source; format html | csv). Use Energy.Query for live on-screen charts; use this for files to download. */
    'report.generate': {
        params: {
            kind: 'energy' | 'interval' | 'energy_dump' | 'environment';
            format?: 'csv' | 'html';
            [key: string]: unknown;
        };
        result: {jobId: string; status: 'pending'};
    };
    /** Fetch a report started by Report.Generate. Owner-checked: a caller only sees their own jobs. Returns status (pending | ready | failed); when ready, downloadUrl/htmlUrl keep backwards compatibility and artifacts carries the dataCsvGz/summaryHtml files served from /api/exports/download (authenticated GET, streamed). Records expire after configured report retention. */
    'report.getreport': {
        params: {jobId: string};
        result: {
            jobId: string;
            status: 'pending' | 'ready' | 'failed' | 'cancelled';
            downloadUrl?: string | null;
            htmlUrl?: string | null;
            artifacts?: null | {dataCsvGz?: string; summaryHtml?: string};
            manifest?: null | {
                dataCsvGz?: string;
                summaryHtml?: string;
                expiresAt: string;
                bytes: number;
            };
            progress?: null | {
                estimatedRows?: number;
                rowsWritten?: number;
                bytesWritten?: number;
                currentPhase?: string;
                percent?: number;
            };
            expiresAt?: string | null;
            bytes?: number | null;
            error?: string | null;
        };
    };
    /** Cancel a pending/running report job owned by the caller. Ready and failed jobs are returned unchanged. */
    'report.cancel': {
        params: {jobId: string};
        result: {
            jobId: string;
            status: 'pending' | 'ready' | 'failed' | 'cancelled';
        };
    };
    /** Suggest the single best hour-to-hour load shift for the given device scope + window, scored against grid carbon intensity. Returns null when no useful shift can be proposed. */
    'report.suggesttimeshift': {
        params: {
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            devices?: string[];
            from: string;
            to: string;
            dashboardId?: number;
            maxShiftableKWh?: number;
        };
        result: {
            plan: null | {
                fromHour: number;
                toHour: number;
                shiftedKWh: number;
                avoidedKgCO2: number;
                worstGPerKWh: number;
                bestGPerKWh: number;
            };
        };
    };
    /** Wipe every stored report instance and the on-disk CSV files. Instance-wide provider support recovery only. */
    'report.purgereports': {
        params: Record<string, unknown>;
        result: {success: true; deletedFiles: number; deletedDb: boolean};
    };
    /** Return the report namespace contract (methods, schemas, permissions, errors). */
    'report.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Save a named report template. */
    'reporttemplate.create': {
        params: {
            name: string;
            description?: string | null;
            kind: 'energy' | 'interval' | 'environment';
            params: Record<string, unknown>;
            sectionsEnabled?: Array<
                'demand' | 'solar' | 'battery' | 'ev' | 'tenant'
            > | null;
        };
        result: {
            id: string;
            name: string;
            description?: string | null;
            kind: string;
            params: Record<string, unknown>;
            sectionsEnabled?: unknown[] | null;
            createdBy?: string | null;
            createdAt: string;
            updatedAt?: string | null;
            [key: string]: unknown;
        };
    };
    /** List the caller org's report templates. */
    'reporttemplate.list': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Fetch a single report template. */
    'reporttemplate.get': {
        params: {id: string};
        result: {
            id: string;
            name: string;
            description?: string | null;
            kind: string;
            params: Record<string, unknown>;
            sectionsEnabled?: unknown[] | null;
            createdBy?: string | null;
            createdAt: string;
            updatedAt?: string | null;
            [key: string]: unknown;
        };
    };
    /** Patch a report template (name/description/params/sections). */
    'reporttemplate.update': {
        params: {
            id: string;
            name?: string;
            description?: string | null;
            params?: Record<string, unknown>;
            sectionsEnabled?: Array<
                'demand' | 'solar' | 'battery' | 'ev' | 'tenant'
            > | null;
        };
        result: {
            id: string;
            name: string;
            description?: string | null;
            kind: string;
            params: Record<string, unknown>;
            sectionsEnabled?: unknown[] | null;
            createdBy?: string | null;
            createdAt: string;
            updatedAt?: string | null;
            [key: string]: unknown;
        };
    };
    /** Delete a report template. */
    'reporttemplate.delete': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** Run a template's saved report via report.Generate; returns a jobId. */
    'reporttemplate.run': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** Return the reporttemplate namespace contract (methods, schemas, permissions, errors). */
    'reporttemplate.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Restrictions.Get — current instance restrictions. */
    'restrictions.get': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Restrictions.Set — disallow public org registration / cap allowed UI languages. */
    'restrictions.set': {
        params: {
            disallowPublicOrgRegistration?: boolean;
            allowedLanguages?: string[];
        };
        result: {ok: boolean};
    };
    /** Return the restrictions namespace contract (methods, schemas, permissions, errors). */
    'restrictions.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** RGB.Set — rgb/brightness/transition/state. */
    'rgb.set': {
        params: {
            shellyID: string;
            id: number;
            on?: boolean;
            brightness?: number;
            rgb?: number[];
            transition?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** RGB.Toggle. */
    'rgb.toggle': {params: {shellyID: string; id: number}; result: unknown};
    /** RGB.SetConfig. */
    'rgb.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** RGB.GetConfig. */
    'rgb.getconfig': {params: {shellyID: string; id: number}; result: unknown};
    /** RGB.GetStatus. */
    'rgb.getstatus': {params: {shellyID: string; id: number}; result: unknown};
    /** RGB.DimUp — optional fade_rate [1,5]. */
    'rgb.dimup': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** RGB.DimDown — optional fade_rate [1,5]. */
    'rgb.dimdown': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** RGB.DimStop. */
    'rgb.dimstop': {params: {shellyID: string; id: number}; result: unknown};
    /** Return the rgb namespace contract (methods, schemas, permissions, errors). */
    'rgb.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** RGBCCT.Set — rgb/white/ct/brightness/transition/state. */
    'rgbcct.set': {
        params: {
            shellyID: string;
            id: number;
            on?: boolean;
            brightness?: number;
            rgb?: number[];
            white?: number;
            ct?: number;
            transition?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** RGBCCT.Toggle. */
    'rgbcct.toggle': {params: {shellyID: string; id: number}; result: unknown};
    /** RGBCCT.SetConfig. */
    'rgbcct.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** RGBCCT.GetConfig. */
    'rgbcct.getconfig': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** RGBCCT.GetStatus. */
    'rgbcct.getstatus': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** RGBCCT.DimUp. */
    'rgbcct.dimup': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** RGBCCT.DimDown. */
    'rgbcct.dimdown': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** RGBCCT.DimStop. */
    'rgbcct.dimstop': {params: {shellyID: string; id: number}; result: unknown};
    /** Return the rgbcct namespace contract (methods, schemas, permissions, errors). */
    'rgbcct.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** RGBW.Set — rgb/white/brightness/transition/state. */
    'rgbw.set': {
        params: {
            shellyID: string;
            id: number;
            on?: boolean;
            brightness?: number;
            rgb?: number[];
            white?: number;
            transition?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** RGBW.Toggle. */
    'rgbw.toggle': {params: {shellyID: string; id: number}; result: unknown};
    /** RGBW.SetConfig. */
    'rgbw.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** RGBW.GetConfig. */
    'rgbw.getconfig': {params: {shellyID: string; id: number}; result: unknown};
    /** RGBW.GetStatus. */
    'rgbw.getstatus': {params: {shellyID: string; id: number}; result: unknown};
    /** RGBW.DimUp — optional fade_rate [1,5]. */
    'rgbw.dimup': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** RGBW.DimDown — optional fade_rate [1,5]. */
    'rgbw.dimdown': {
        params: {shellyID: string; id: number; fade_rate?: number};
        result: unknown;
    };
    /** RGBW.DimStop. */
    'rgbw.dimstop': {params: {shellyID: string; id: number}; result: unknown};
    /** Return the rgbw namespace contract (methods, schemas, permissions, errors). */
    'rgbw.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List cron-style schedules stored on the target device. */
    'schedule.list': {
        params: {shellyID: string};
        result: {
            items: Array<{
                id: number;
                enable: boolean;
                timespec: string;
                calls: Array<{
                    method: string;
                    params?: Record<string, unknown>;
                }>;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Add a new schedule job; returns the device-assigned id. */
    'schedule.create': {
        params: {
            shellyID: string;
            enable?: boolean;
            timespec: string;
            calls: Array<{method: string; params?: Record<string, unknown>}>;
        };
        result: {id: number};
    };
    /** Partial-update an existing schedule job by id. */
    'schedule.update': {
        params: {
            shellyID: string;
            id: number;
            enable?: boolean;
            timespec?: string;
            calls?: Array<{method: string; params?: Record<string, unknown>}>;
        };
        result: {success: true};
    };
    /** Remove a schedule job by id. */
    'schedule.delete': {
        params: {shellyID: string; id: number};
        result: {success: true};
    };
    /** Wipe every schedule job on the target device. */
    'schedule.deleteall': {params: {shellyID: string}; result: {success: true}};
    /** Return the schedule namespace contract (methods, schemas, permissions, errors). */
    'schedule.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Script.List — all scripts on the device. */
    'script.list': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Script.Create — allocate a script slot. Returns {id}. */
    'script.create': {
        params: {shellyID: string; name?: string};
        result: Record<string, unknown>;
    };
    /** Script.Delete. */
    'script.delete': {params: {shellyID: string; id: number}; result: null};
    /** Script.GetConfig. */
    'script.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Script.SetConfig — name / enable. */
    'script.setconfig': {
        params: {
            shellyID: string;
            id: number;
            config: {name?: string; enable?: boolean};
        };
        result: Record<string, unknown>;
    };
    /** Script.GetStatus — running state, mem usage, errors. */
    'script.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Script.GetCode — returns {data, left}. Page via offset + len. */
    'script.getcode': {
        params: {shellyID: string; id: number; offset?: number; len?: number};
        result: Record<string, unknown>;
    };
    /** Script.PutCode — write script source. append:false truncates first. */
    'script.putcode': {
        params: {
            shellyID: string;
            id: number;
            code: string;
            offset?: number;
            append?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** Script.Start — begin execution. Returns {was_running}. */
    'script.start': {
        params: {shellyID: string; id: number};
        result: {was_running: boolean};
    };
    /** Script.Stop — halt execution. Returns {was_running}. */
    'script.stop': {
        params: {shellyID: string; id: number};
        result: {was_running: boolean};
    };
    /** Script.Eval — evaluate code in the context of a running script. Returns {result}. */
    'script.eval': {
        params: {shellyID: string; id: number; code: string};
        result: {result: string};
    };
    /** Return the script namespace contract (methods, schemas, permissions, errors). */
    'script.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Upload or delete the device user CA via Shelly.PutUserCA. */
    'security.putuserca': {
        params: {shellyID: string; data?: string | null; append: boolean};
        result: {length?: number};
    };
    /** Upload or delete the device TLS client certificate via Shelly.PutTLSClientCert. */
    'security.puttlsclientcert': {
        params: {shellyID: string; data?: string | null; append: boolean};
        result: {length?: number};
    };
    /** Upload or delete the device TLS client key via Shelly.PutTLSClientKey. */
    'security.puttlsclientkey': {
        params: {shellyID: string; data?: string | null; append: boolean};
        result: {length?: number};
    };
    /** Upload or delete the device HTTP server certificate via Shelly.PutHTTPServerCert. */
    'security.puthttpservercert': {
        params: {shellyID: string; data?: string | null; append: boolean};
        result: {length?: number};
    };
    /** Upload or delete the device HTTP server private key via Shelly.PutHTTPServerKey. */
    'security.puthttpserverkey': {
        params: {shellyID: string; data?: string | null; append: boolean};
        result: {length?: number};
    };
    /** Upload or delete the device HTTP server CA bundle via Shelly.PutHTTPServerCABundle. */
    'security.puthttpservercabundle': {
        params: {shellyID: string; data?: string | null; append: boolean};
        result: {length?: number};
    };
    /** Return the security namespace contract (methods, schemas, permissions, errors). */
    'security.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Numeric sensor history from device_sensor.numeric_15min (the forever 15-minute rollup), re-bucketed per channel to sample-weighted avg + true min/max, with reading counts. The numeric twin of Sensor.Events. Group / location / tag / devices / fleet scope selected by params (scope XOR devices). kinds fan out one DB call each; source narrows to one reading source (omit for all). Omit limit for the full set (up to the server row ceiling); set limit to paginate. total is a lower bound — has_more is authoritative. */
    'sensor.query': {
        params: {
            from: string;
            to: string;
            kinds: string[];
            source?: 'internal' | 'builtin' | 'addon' | 'blu' | 'weather';
            scope?: {groupId?: number; locationId?: number; tagId?: number};
            devices?: string[];
            bucket?:
                | '1 minute'
                | '5 minutes'
                | '15 minutes'
                | '30 minutes'
                | '1 hour'
                | '6 hours'
                | '12 hours'
                | '1 day'
                | '1 week'
                | '1 month';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                bucket: string;
                device: number;
                shellyID: string | null;
                kind: string;
                source: string;
                channel: number | null;
                sampleCount: number;
                value: number;
                min: number | null;
                max: number | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
            meta: {
                from: string;
                to: string;
                bucket: string;
                executionMs: number;
            };
        };
    };
    /** Discrete event history from device_sensor.events (append-only: binary sensors record on state change, buttons record every push). devices is a required shellyID allowlist — no group/location/tag/fleet scope yet. kind narrows to one event kind; omit for all kinds. */
    'sensor.events': {
        params: {
            from: string;
            to: string;
            devices: string[];
            kind?: string;
            limit?: number;
        };
        result: {
            items: Array<{
                ts: string;
                device: number;
                shellyID: string | null;
                source: string;
                kind: string;
                channel: number | null;
                state: number;
            }>;
        };
    };
    /** Return the sensor namespace contract (methods, schemas, permissions, errors). */
    'sensor.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Serial.SetConfig — port mode + serial params + Modbus RTU server config. */
    'serial.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Serial.GetConfig — {mode, serial, mb_server}. */
    'serial.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the serial namespace contract (methods, schemas, permissions, errors). */
    'serial.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Create or update functional relationship links from one source to one or more targets. */
    'serves.set': {
        params: {
            source: {kind: 'device' | 'group'; id: string};
            targets: Array<{
                kind: 'device' | 'group' | 'location';
                id: string;
                weight?: number | null;
            }>;
            relation?:
                | 'serves:serves'
                | 'serves:powers'
                | 'serves:cools'
                | 'serves:heats'
                | 'serves:measures';
        };
        result: {
            items?: Array<{
                id: number;
                source: {kind: 'device' | 'group'; id: string};
                target: {kind: 'device' | 'group' | 'location'; id: string};
                relation:
                    | 'serves:serves'
                    | 'serves:powers'
                    | 'serves:cools'
                    | 'serves:heats'
                    | 'serves:measures';
                weight: number | null;
                createdAt: string;
                updatedAt: string;
            }>;
        };
    };
    /** Remove one link, all links for one target, or all links for a source. */
    'serves.unset': {
        params: {
            source: {kind: 'device' | 'group'; id: string};
            target?: {kind: 'device' | 'group' | 'location'; id: string};
            relation?:
                | 'serves:serves'
                | 'serves:powers'
                | 'serves:cools'
                | 'serves:heats'
                | 'serves:measures';
        };
        result: Record<string, unknown>;
    };
    /** List links by source or by target. */
    'serves.list': {
        params: {
            source?: {kind: 'device' | 'group'; id: string};
            target?: {kind: 'device' | 'group' | 'location'; id: string};
        };
        result: {
            items?: Array<{
                id: number;
                source: {kind: 'device' | 'group'; id: string};
                target: {kind: 'device' | 'group' | 'location'; id: string};
                relation:
                    | 'serves:serves'
                    | 'serves:powers'
                    | 'serves:cools'
                    | 'serves:heats'
                    | 'serves:measures';
                weight: number | null;
                createdAt: string;
                updatedAt: string;
            }>;
        };
    };
    /** Get one source-target relationship link. */
    'serves.get': {
        params: {
            source: {kind: 'device' | 'group'; id: string};
            target: {kind: 'device' | 'group' | 'location'; id: string};
            relation?:
                | 'serves:serves'
                | 'serves:powers'
                | 'serves:cools'
                | 'serves:heats'
                | 'serves:measures';
        };
        result: {
            id: number;
            source: {kind: 'device' | 'group'; id: string};
            target: {kind: 'device' | 'group' | 'location'; id: string};
            relation:
                | 'serves:serves'
                | 'serves:powers'
                | 'serves:cools'
                | 'serves:heats'
                | 'serves:measures';
            weight: number | null;
            createdAt: string;
            updatedAt: string;
        };
    };
    /** Return the serves namespace contract (methods, schemas, permissions, errors). */
    'serves.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Service.GetInfo — type/version/build/etag and ui metadata. */
    'service.getinfo': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Service.GetConfig. */
    'service.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Service.GetStatus — runtime state and stats. */
    'service.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Service.GetResources — virtual-component bindings (vc map). */
    'service.getresources': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Service.ListConfigOptions — config keys and option/range metadata. */
    'service.listconfigoptions': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Service.SetConfig — service component runtime config. */
    'service.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Service.ResetCounters — clear runtime counters. */
    'service.resetcounters': {
        params: {shellyID: string; id: number};
        result: null;
    };
    /** Return the service namespace contract (methods, schemas, permissions, errors). */
    'service.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Shelly.Reboot — no documented response (device reboots). */
    'shelly.reboot': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.FactoryReset. */
    'shelly.factoryreset': {params: {shellyID: string}; result: null};
    /** Shelly.CheckForUpdate — empty object when no update available. */
    'shelly.checkforupdate': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.Update — exactly one of stage or url. Stage names device-owned. */
    'shelly.update': {params: unknown; result: null};
    /** Shelly.SetProfile — names from Shelly.ListProfiles. Device reboots after. */
    'shelly.setprofile': {
        params: {shellyID: string; name: string};
        result: {profile_was: string};
    };
    /** Shelly.ListProfiles. */
    'shelly.listprofiles': {
        params: {shellyID: string};
        result: {profiles: Record<string, unknown>};
    };
    /** Shelly.GetDeviceInfo — device identity + fw version. ident:true for extended. */
    'shelly.getdeviceinfo': {
        params: {shellyID: string; ident?: boolean};
        result: Record<string, unknown>;
    };
    /** Shelly.GetStatus — full live device status snapshot. */
    'shelly.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.GetConfig — full live device config snapshot. */
    'shelly.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.GetComponents — paginated component list with optional config/status. */
    'shelly.getcomponents': {
        params: {
            shellyID: string;
            offset?: number;
            include?: string[];
            dynamic_only?: boolean;
            keys?: string[];
        };
        result: Record<string, unknown>;
    };
    /** Shelly.ListMethods — RPC methods available on the device (ACL/auth filtered). */
    'shelly.listmethods': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.DetectLocation — auto-detect tz/location from IP. */
    'shelly.detectlocation': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.ListTimezones — TZ database the device knows about. */
    'shelly.listtimezones': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Shelly.ResetWiFiConfig — wipe Wi-Fi config; device drops back to AP mode. */
    'shelly.resetwificonfig': {params: {shellyID: string}; result: null};
    /** Shelly.SetAuth — change device password. Pass ha1=null with user and realm to disable auth. */
    'shelly.setauth': {
        params: {
            shellyID: string;
            user: string | null;
            realm: string | null;
            ha1: string | null;
        };
        result: null;
    };
    /** Shelly.ResetAuthCode — regenerate the device pairing code (Wall Display). */
    'shelly.resetauthcode': {
        params: {shellyID: string};
        result: {code_generated?: boolean};
    };
    /** Return the shelly namespace contract (methods, schemas, permissions, errors). */
    'shelly.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Smoke.SetConfig — alarm config (mute, thresholds, name). */
    'smoke.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Smoke.GetConfig. */
    'smoke.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Smoke.GetStatus — alarm + mute state. */
    'smoke.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Smoke.Mute — silence the alarm. */
    'smoke.mute': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the smoke namespace contract (methods, schemas, permissions, errors). */
    'smoke.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Upsert a value under a registry key. */
    'storage.setitem': {
        params: {registry?: string; key: string; value: unknown};
        result: Record<string, unknown>;
    };
    /** Read a value by key. */
    'storage.getitem': {
        params: {registry?: string; key: string};
        result: Record<string, unknown>;
    };
    /** Delete a value by key. */
    'storage.removeitem': {
        params: {registry?: string; key: string};
        result: Record<string, unknown>;
    };
    /** List readable keys in a registry. */
    'storage.keys': {params: {registry?: string}; result: string[]};
    /** Raw (key → value) dict — kept for legacy registry callers. New callers should prefer `storage.list`. */
    'storage.getall': {
        params: {registry?: string};
        result: Record<string, unknown>;
    };
    /** Every (key, value) pair in the standard list envelope. */
    'storage.list': {
        params: {registry?: string};
        result: {
            items: Array<{key: string; value: unknown}>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return the storage namespace contract (methods, schemas, permissions, errors). */
    'storage.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Switch.Set — set output on/off (+ optional toggle_after). */
    'switch.set': {
        params: {
            shellyID: string;
            id: number;
            on: boolean;
            toggle_after?: number;
            [key: string]: unknown;
        };
        result: unknown;
    };
    /** Switch.Toggle. */
    'switch.toggle': {params: {shellyID: string; id: number}; result: unknown};
    /** Switch.SetConfig — partial config patch. */
    'switch.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: unknown;
    };
    /** Switch.ResetCounters — clear energy/counters. */
    'switch.resetcounters': {
        params: {shellyID: string; id: number; types?: string[]};
        result: unknown;
    };
    /** Switch.GetConfig — fetch persisted config for one channel. */
    'switch.getconfig': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Switch.GetStatus — runtime state for one channel. */
    'switch.getstatus': {
        params: {shellyID: string; id: number};
        result: unknown;
    };
    /** Return the switch namespace contract (methods, schemas, permissions, errors). */
    'switch.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Sys.SetConfig — device system config (location, debug, factory_reset_from_switch, ...). */
    'sys.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Sys.GetConfig — current system configuration. */
    'sys.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Sys.GetStatus — uptime, available_updates, time, mac, restart_required. */
    'sys.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Sys.SetTime — set time and/or timezone (at least one required). */
    'sys.settime': {params: unknown; result: Record<string, unknown>};
    /** Sys.GetInternalTemperatures — board sensors (sht3x, thermal-cpufreq-*). */
    'sys.getinternaltemperatures': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Sys.ListDebugComponents — debug categories that can be toggled. */
    'sys.listdebugcomponents': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Sys.DownloadSettings — full settings backup blob. */
    'sys.downloadsettings': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Sys.RestoreSettings — restore from a saved settings blob (filename required). */
    'sys.restoresettings': {
        params: {shellyID: string; filename: string; etag?: string};
        result: Record<string, unknown>;
    };
    /** Sys.SetDebugConfig — toggle per-component debug logging. */
    'sys.setdebugconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Sys.RestartApplication — soft-restart the firmware app (response includes restarting_after seconds). */
    'sys.restartapplication': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the sys namespace contract (methods, schemas, permissions, errors). */
    'sys.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Compatibility runtime variables for clients that have not moved to System.Bootstrap. */
    'system.getvariables': {
        params: Record<string, never>;
        result: {
            'login-strategy': 'local' | 'zitadel-introspection';
            'dev-mode': boolean;
        };
    };
    /** Submit frontend interaction counters for observability. */
    'system.submittelemetry': {
        params: {
            counts?: Record<string, number>;
            clicks?: number;
            wsTelemetry?: {
                patchBufferMaxDepth?: number;
                droppedFrameCount?: number;
                rafFrameTimeMaxMs?: number;
            };
        };
        result: null;
    };
    /** Subscribe the current websocket to runtime events. Per-event options.events[name] may include a paths: string[] of dot-path declarations (e.g. ["switch:0.output","sys.unixtime"]). When paths is present the server only fires when one of those fields actually changed, and only those fields are sent. Omit paths to receive today’s full payload (back-compat). */
    'system.subscribe': {
        params: {
            events: string[];
            options?: Record<string, unknown>;
            connectionId?: string;
            lastSeenStreamId?: string;
        };
        result: {ids: number[]};
    };
    /** Remove websocket event subscriptions by id. */
    'system.unsubscribe': {params: {ids: number[]}; result: null};
    /** Return backend-owned runtime facts for frontend startup. */
    'system.bootstrap': {
        params: Record<string, never>;
        result: {
            version: 1;
            organization: {
                id: string;
                name: string | null;
                displayName: string | null;
                timezoneDefault: string | null;
                localeDefault: string | null;
                currencyDefault: string | null;
                unitSystemDefault: 'metric' | 'imperial' | null;
                brandInitials: string | null;
                brandColor: string | null;
                metadata: Record<string, unknown>;
            } | null;
            user: {
                username: string | null;
                roles: Array<
                    | 'admin'
                    | 'manager'
                    | 'editor'
                    | 'installer'
                    | 'operator'
                    | 'automation_admin'
                    | 'auditor'
                    | 'viewer'
                    | 'none'
                >;
                group: string;
                canWrite: boolean;
                isAdmin: boolean;
                isViewer: boolean;
                effectiveShape: {
                    statements: Array<{
                        actions: string[];
                        notActions?: string[];
                        resourceTypes: string[];
                        notResourceTypes?: string[];
                        scope: {
                            all?: boolean;
                            device_ids?: string[];
                            location_ids?: number[];
                            device_group_ids?: number[];
                            device_tags?: string[];
                            dashboard_ids?: number[];
                            plugin_keys?: string[];
                            waiting_room_ids?: string[];
                            configuration_keys?: string[];
                            report_ids?: number[];
                            organization_ids?: string[];
                            alert_ids?: string[];
                            notification_ids?: string[];
                            integration_keys?: string[];
                            automation_ids?: string[];
                        };
                        effect: 'Allow' | 'Deny';
                        condition?: {
                            mfa?: {required?: boolean};
                            ip?: {cidrs?: string[]};
                            time?: {window?: {start: string; end: string}};
                        };
                        source?:
                            | 'built-in-jwt'
                            | 'group-assignment'
                            | 'user-assignment';
                        persona?: string;
                        assignmentId?: string;
                        assignmentExpiresAt?: number;
                        subjectType?: 'user' | 'user_group';
                        subjectId?: string;
                        grantorId?: string;
                    }>;
                } | null;
            };
            runtime: {
                backendVersion: string;
                apiContractVersion: string;
                authMode: 'dev' | 'zitadel';
                deploymentMode: 'oss' | 'shared_saas' | 'dedicated_saas';
                safeMode: boolean;
                frontendArtifact: {
                    id: string;
                    version: string;
                    uiContractVersion: string;
                };
                addons: {grafana: boolean; nodeRed: boolean};
            };
            features: {components: Record<string, boolean>};
        };
    };
    /** Return aggregate runtime contract discovery across public namespaces. */
    'system.describe': {
        params: Record<string, never>;
        result: {
            namespace: 'system';
            methods: Record<string, unknown>;
            components: Record<string, unknown>;
            entityCapabilities: Record<
                string,
                {
                    shellyComponent: string | null;
                    actions: Array<{action: string; rpc: string}>;
                }
            >;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Return rich instance health and authz runtime status. */
    'system.health.getfull': {
        params: Record<string, never>;
        result: {
            online: boolean;
            version: string;
            obsLevel: number;
            authz: Record<string, unknown>;
            commit?: string;
            metrics?: Record<string, unknown>;
            [key: string]: unknown;
        };
    };
    /** Return the current in-memory debug report. */
    'system.health.getdebugreport': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Return Redis stream and ingest overflow health. */
    'system.health.getstreams': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Return recent in-memory runtime metric history. */
    'system.health.gethistory': {
        params: Record<string, never>;
        result: Record<string, unknown>;
    };
    /** Return the auto-derived module topology for the monitoring diagram. */
    'system.gettopology': {
        params: Record<string, never>;
        result: {
            schemaVersion: number;
            generatedAt: number;
            thresholds: Record<string, {warn: number; crit: number}>;
            nodes: Array<{
                id: string;
                label: string;
                role: string;
                cluster: string | null;
                zone: string;
                kind: string;
                status: string;
                stats: Record<string, unknown>;
                route: string | null;
                description: string | null;
                virtual: boolean;
                noisy: boolean;
                order: number;
                owner: string | null;
                criticality: string;
                stale: boolean;
                participatesIn: string[];
                dataClasses: string[];
                externalSystem: string | null;
                collapseByDefault: boolean;
            }>;
            edges: Array<{
                id: string;
                from: string;
                to: string;
                direction: string;
                kind: string;
                throughput: number;
                counterName: string | null;
                latencyMetric: string | null;
                errorMetric: string | null;
                throughputMetric: string | null;
                status: string;
                criticality: string;
                declared: boolean;
                observed: boolean;
                stale: boolean;
                lastSeenAt: number | null;
                description: string | null;
                participatesIn: string[];
            }>;
            zones: Array<{
                id: string;
                label: string;
                description: string;
                order: number;
                collapseByDefault: boolean;
            }>;
            flows: Array<{
                id: string;
                label: string;
                description: string;
                category: string;
                orderedNodeIds: string[];
                expectedEdgeIds: string[];
            }>;
            clusters: Array<{id: string; label: string}>;
        };
    };
    /** Return slow RPC calls (above P95 + 100ms) in the requested time window. */
    'system.getslowrpcs': {
        params: {windowSec?: number; limit?: number};
        result: {
            entries: Array<{
                method: string;
                ms: number;
                ts: number;
                sender: string | null;
                senderType: 'user' | 'service_user' | 'system';
                organizationId: string | null;
                p95Ms: number;
            }>;
        };
    };
    /** Return slow device builds (probe + compose) with their per-stage breakdown in the requested window. */
    'system.getslowbuilds': {
        params: {windowSec?: number; limit?: number};
        result: {
            entries: Array<{
                shellyID: string;
                totalMs: number;
                componentPages: number;
                ts: number;
                stages: Array<{name: string; ms: number}>;
            }>;
        };
    };
    /** Return slow device commands (FM→device RPCs) with method and round-trip ms in the requested window. */
    'system.getslowdevicecommands': {
        params: {windowSec?: number; limit?: number};
        result: {
            entries: Array<{
                label: string;
                method: string;
                ms: number;
                outcome: 'ok' | 'error' | 'timeout' | 'unsupported';
                ts: number;
            }>;
        };
    };
    /** Return browser WS clients that hit send backpressure (paused or dropped) in the requested window. */
    'system.getslowclients': {
        params: {windowSec?: number; limit?: number};
        result: {
            entries: Array<{
                clientId: string;
                bufferedBytes: number;
                action: 'paused' | 'dropped';
                ts: number;
            }>;
        };
    };
    /** Return per-module stats samples within the requested time window. */
    'system.getmodulehistory': {
        params: {name: string; windowSec?: number};
        result: {samples: Array<{ts: number; stats: Record<string, unknown>}>};
    };
    /** Return active WebSocket connection summaries. */
    'system.listconnections': {
        params: Record<string, never>;
        result: {
            connections: Array<{
                connectionId: string;
                user: string | null;
                organizationId: string | null;
                connectedAt: number;
                ageSec: number;
            }>;
        };
    };
    /** Return recent events and metadata for a single WebSocket connection. */
    'system.getconnectioninspector': {
        params: {connectionId: string};
        result: {
            connectionId: string;
            user: string | null;
            organizationId: string | null;
            connectedAt: number;
            ageSec: number;
            recentEvents: Array<{
                kind: 'rpc' | 'event' | 'patch';
                method: string;
                ts: number;
                ms: number | null;
            }>;
        };
    };
    /** Return notable edge throughput + node status changes over the requested window. */
    'system.gettopologydiff': {
        params: {windowMin?: number};
        result: {
            schemaVersion: number;
            windowMin: number;
            changedEdges: Array<{
                id: string;
                previousThroughput: number;
                currentThroughput: number;
                pctChange: number;
            }>;
            changedNodes: Array<{
                id: string;
                statusBefore: string;
                statusAfter: string;
            }>;
            nodeMembershipChanges: Array<{
                id: string;
                change: string;
                status: string;
            }>;
            edgeMembershipChanges: Array<{
                id: string;
                change: string;
                from: string;
                to: string;
            }>;
        };
    };
    /** Return whether diagnostic DB writes are disabled. */
    'system.dbwrites.get': {
        params: Record<string, never>;
        result: {dbWritesDisabled: boolean};
    };
    /** Set the instance-wide diagnostic DB write toggle. */
    'system.dbwrites.set': {
        params: {disabled: boolean};
        result: {dbWritesDisabled: boolean};
    };
    /** Set runtime observability level. */
    'system.observability.set': {
        params: {level?: number; enabled?: boolean};
        result: {observability: boolean; level: number};
    };
    /** Reset runtime observability timings and counters. */
    'system.observability.reset': {
        params: Record<string, never>;
        result: {reset: boolean};
    };
    /** Return runtime log levels for known categories. */
    'system.log.listlevels': {
        params: Record<string, never>;
        result: {levels: Record<string, string>};
    };
    /** Set the runtime log level for one category. */
    'system.log.setlevel': {
        params: {category: string; level: string};
        result: {category: string; level: string};
    };
    /** Create a tag. Key auto-derived from name (slugified + uniquified) when omitted. */
    'tag.create': {
        params: {
            organizationId?: string;
            key?: string;
            name: string;
            description?: string | null;
            color?: string | null;
            icon?: string | null;
            metadata?: Record<string, unknown>;
            imageAssetId?: string | null;
        };
        result: {
            id: number;
            organizationId: string;
            key: string;
            name: string;
            description: string | null;
            color: string | null;
            icon: string | null;
            metadata: Record<string, unknown>;
            imageAssetId: string | null;
            createdAt: string;
            updatedAt: string | null;
            counts?: Record<string, unknown>;
        };
    };
    /** Partial-update a tag. Key is immutable in phase 1. */
    'tag.update': {
        params: {
            organizationId?: string;
            id: number;
            patch: {
                name?: string;
                description?: string | null;
                color?: string | null;
                icon?: string | null;
                metadata?: Record<string, unknown>;
                imageAssetId?: string | null;
            };
        };
        result: {
            id: number;
            organizationId: string;
            key: string;
            name: string;
            description: string | null;
            color: string | null;
            icon: string | null;
            metadata: Record<string, unknown>;
            imageAssetId: string | null;
            createdAt: string;
            updatedAt: string | null;
            counts?: Record<string, unknown>;
        };
    };
    /** Delete a tag. Assignment rows cascade-delete with the tag. */
    'tag.delete': {
        params: {organizationId?: string; id: number};
        result: {deleted: boolean; id: number};
    };
    /** Fetch one tag by id. */
    'tag.get': {
        params: {organizationId?: string; id: number; includeSummary?: boolean};
        result: {
            id: number;
            organizationId: string;
            key: string;
            name: string;
            description: string | null;
            color: string | null;
            icon: string | null;
            metadata: Record<string, unknown>;
            imageAssetId: string | null;
            createdAt: string;
            updatedAt: string | null;
            counts?: Record<string, unknown>;
        };
    };
    /** List tags with query/key filters and sort options. */
    'tag.list': {
        params: {
            organizationId?: string;
            query?: string;
            key?: string;
            includeSummary?: boolean;
            limit?: number;
            offset?: number;
            sortBy?: 'key' | 'name' | 'createdAt' | 'updatedAt';
            sortDir?: 'asc' | 'desc';
        };
        result: {
            items: Array<{
                id: number;
                organizationId: string;
                key: string;
                name: string;
                description: string | null;
                color: string | null;
                icon: string | null;
                metadata: Record<string, unknown>;
                imageAssetId: string | null;
                createdAt: string;
                updatedAt: string | null;
                counts?: Record<string, unknown>;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Batch-assign subjects to a tag. Idempotent: already-assigned rows are skipped. */
    'tag.assign': {
        params: {
            organizationId?: string;
            id: number;
            subjects: Array<{
                subjectType:
                    | 'location'
                    | 'group'
                    | 'device'
                    | 'entity'
                    | 'alert_rule'
                    | 'destination_group'
                    | 'channel'
                    | 'script';
                subjectId: string;
            }>;
        };
        result: {
            id: number;
            assigned: Array<{
                subjectType:
                    | 'location'
                    | 'group'
                    | 'device'
                    | 'entity'
                    | 'alert_rule'
                    | 'destination_group'
                    | 'channel'
                    | 'script';
                subjectId: string;
            }>;
        };
    };
    /** Batch-remove subject assignments. Missing rows are silently skipped. */
    'tag.unassign': {
        params: {
            organizationId?: string;
            id: number;
            subjects: Array<{
                subjectType:
                    | 'location'
                    | 'group'
                    | 'device'
                    | 'entity'
                    | 'alert_rule'
                    | 'destination_group'
                    | 'channel'
                    | 'script';
                subjectId: string;
            }>;
        };
        result: {
            id: number;
            unassigned: Array<{
                subjectType:
                    | 'location'
                    | 'group'
                    | 'device'
                    | 'entity'
                    | 'alert_rule'
                    | 'destination_group'
                    | 'channel'
                    | 'script';
                subjectId: string;
            }>;
        };
    };
    /** List assignments for a tag with optional subject-type filter. */
    'tag.listassignments': {
        params: {
            organizationId?: string;
            id: number;
            subjectType?:
                | 'location'
                | 'group'
                | 'device'
                | 'entity'
                | 'alert_rule'
                | 'destination_group'
                | 'channel'
                | 'script';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                subjectType:
                    | 'location'
                    | 'group'
                    | 'device'
                    | 'entity'
                    | 'alert_rule'
                    | 'destination_group'
                    | 'channel'
                    | 'script';
                subjectId: string;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Tag IDs currently attached to one subject. */
    'tag.listforsubject': {
        params: {
            subjectType:
                | 'location'
                | 'group'
                | 'device'
                | 'entity'
                | 'alert_rule'
                | 'destination_group'
                | 'channel'
                | 'script';
            subjectId: string;
        };
        result: {tagIds: number[]};
    };
    /** Return the tag namespace contract (methods, schemas, permissions, errors). */
    'tag.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** List all tariffs in the caller org (header rows only). */
    'tariff.list': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Fetch one tariff with nested seasons and windows. */
    'tariff.get': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Create a new tariff in the caller org. */
    'tariff.add': {
        params: {
            name: string;
            currency: string;
            timezone: string;
            billingDay: number;
            kind: 'single' | 'day_night' | 'tou' | 'live';
            standingCharge: number;
            standingChargePeriod: 'day' | 'month';
            vatPct?: number | null;
            demandRate?: number | null;
            seasons: Array<{
                startMonthDay: string;
                endMonthDay: string;
                windows: Array<{
                    daysMask: number;
                    startTime: string;
                    endTime: string;
                    price: number;
                }>;
            }>;
        };
        result: Record<string, unknown>;
    };
    /** Replace a tariff definition including its seasons and windows. */
    'tariff.update': {
        params: {
            name: string;
            currency: string;
            timezone: string;
            billingDay: number;
            kind: 'single' | 'day_night' | 'tou' | 'live';
            standingCharge: number;
            standingChargePeriod: 'day' | 'month';
            vatPct?: number | null;
            demandRate?: number | null;
            seasons: Array<{
                startMonthDay: string;
                endMonthDay: string;
                windows: Array<{
                    daysMask: number;
                    startTime: string;
                    endTime: string;
                    price: number;
                }>;
            }>;
        };
        result: Record<string, unknown>;
    };
    /** Delete a tariff by id within the caller org. */
    'tariff.delete': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Attach or remove a tariff assignment for a metering point. */
    'tariff.assign': {
        params: {
            tariffId: number;
            scopeLevel: 'dashboard' | 'device' | 'channel';
            dashboardId?: number | null;
            deviceExternalId?: string | null;
            channel?: number | null;
        };
        result: Record<string, unknown>;
    };
    /** Configure a live tariff source. mode=push returns a one-time token for the price-push URL. */
    'tariff.setlivesource': {
        params: {
            tariffId: number;
            mode: 'push' | 'pull';
            provider?: string;
            providerConfig?: Record<string, unknown>;
        };
        result: Record<string, unknown>;
    };
    /** Return the tariff namespace contract (methods, schemas, permissions, errors). */
    'tariff.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Temperature.SetConfig — name / report_thr_C / offset_C. */
    'temperature.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Temperature.GetConfig. */
    'temperature.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Temperature.GetStatus — {id, tC, tF, errors?}. */
    'temperature.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Return the temperature namespace contract (methods, schemas, permissions, errors). */
    'temperature.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Thermostat.GetConfig. */
    'thermostat.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.GetStatus. */
    'thermostat.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.IncreaseTargetTemperature — defaults to one step. */
    'thermostat.increasetargettemperature': {
        params: {shellyID: string; id: number; delta?: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.DecreaseTargetTemperature — defaults to one step. */
    'thermostat.decreasetargettemperature': {
        params: {shellyID: string; id: number; delta?: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.Create. */
    'thermostat.create': {
        params: {shellyID: string; config?: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Thermostat.Delete. */
    'thermostat.delete': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.SetConfig. */
    'thermostat.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.SetConfig. */
    'thermostat.schedule.setconfig': {
        params: {shellyID: string; id: number; enable: boolean};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.ListProfiles. */
    'thermostat.schedule.listprofiles': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.AddProfile. */
    'thermostat.schedule.addprofile': {
        params: {shellyID: string; id: number; name: string};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.ListRules. */
    'thermostat.schedule.listrules': {
        params: {shellyID: string; id: number; profile_id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.AddRule. */
    'thermostat.schedule.addrule': {
        params: {
            shellyID: string;
            id: number;
            profile_id: number;
            [key: string]: unknown;
        };
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.DeleteRule. */
    'thermostat.schedule.deleterule': {
        params: {shellyID: string; id: number; ruleId: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.CreateProfile. */
    'thermostat.schedule.createprofile': {
        params: {shellyID: string; id: number; name: string};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.RenameProfile. */
    'thermostat.schedule.renameprofile': {
        params: {
            shellyID: string;
            id: number;
            profile_id: number;
            name: string;
        };
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.DeleteProfile. */
    'thermostat.schedule.deleteprofile': {
        params: {shellyID: string; id: number; profile_id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.CreateRule. */
    'thermostat.schedule.createrule': {
        params: {
            shellyID: string;
            id: number;
            profile_id: number;
            hour: number;
            minute: number;
            target_C: number;
            enable?: boolean;
            days?: number[];
        };
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.UpdateRule — patch any subset of timing/target/days/enable. */
    'thermostat.schedule.updaterule': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.ChangeRule. */
    'thermostat.schedule.changerule': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Thermostat.Schedule.DeleteAllRules — clear every rule on a profile. */
    'thermostat.schedule.deleteallrules': {
        params: {shellyID: string; id: number; profile_id: number};
        result: Record<string, unknown>;
    };
    /** Thermostat.Debug_SetSensorTemperature — debug override of measured temperature. */
    'thermostat.debug_setsensortemperature': {
        params: {shellyID: string; id: number; t_C: number};
        result: Record<string, unknown>;
    };
    /** Return the thermostat namespace contract (methods, schemas, permissions, errors). */
    'thermostat.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** BluTrv.GetConfig. */
    'trv.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BluTrv.GetStatus. */
    'trv.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BluTrv.GetRemoteConfig. */
    'trv.getremoteconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BluTrv.GetRemoteStatus. */
    'trv.getremotestatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BluTrv.GetRemoteDeviceInfo. */
    'trv.getremotedeviceinfo': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** BluTrv.SetConfig. */
    'trv.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** BluTrv.CheckForUpdates. */
    'trv.checkforupdates': {
        params: {shellyID: string; id: number};
        result: {fw_id?: string};
    };
    /** BluTrv.UpdateFirmware. */
    'trv.updatefirmware': {
        params: {
            shellyID: string;
            id: number;
            bootloader?: boolean;
            url?: string;
        };
        result: null;
    };
    /** BluTrv.Delete. */
    'trv.delete': {params: {shellyID: string; id: number}; result: null};
    /** BluTrv.Call — tunneled RPC to TRV. */
    'trv.call': {
        params: {
            shellyID: string;
            id: number;
            method: string;
            params?: Record<string, unknown>;
        };
        result: Record<string, unknown>;
    };
    /** Trv.GetConfig via BluTrv.Call. */
    'trv.getremotetrvconfig': {
        params: {shellyID: string; id: number; thermostatId?: number};
        result: Record<string, unknown>;
    };
    /** Trv.GetStatus via BluTrv.Call. */
    'trv.getremotetrvstatus': {
        params: {shellyID: string; id: number; thermostatId?: number};
        result: Record<string, unknown>;
    };
    /** Trv.SetTarget via BluTrv.Call — set target temperature. */
    'trv.settarget': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            target_C: number;
        };
        result: null;
    };
    /** Trv.Calibrate via BluTrv.Call. */
    'trv.calibrate': {
        params: {shellyID: string; id: number; thermostatId?: number};
        result: null;
    };
    /** Trv.SetBoost via BluTrv.Call — start boost mode. */
    'trv.setboost': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            duration?: number;
        };
        result: null;
    };
    /** Trv.ClearBoost via BluTrv.Call. */
    'trv.clearboost': {
        params: {shellyID: string; id: number; thermostatId?: number};
        result: null;
    };
    /** Trv.SetOverride via BluTrv.Call — temporary target with duration. */
    'trv.setoverride': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            target_C: number;
            duration: number;
        };
        result: null;
    };
    /** Trv.ClearOverride via BluTrv.Call. */
    'trv.clearoverride': {
        params: {shellyID: string; id: number; thermostatId?: number};
        result: null;
    };
    /** Trv.SetExternalTemperature via BluTrv.Call — omit t_C to revert to internal sensor. */
    'trv.setexternaltemperature': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            t_C?: number;
        };
        result: null;
    };
    /** Trv.SetPosition via BluTrv.Call — direct valve position 0-100%. */
    'trv.setposition': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            pos: number;
        };
        result: null;
    };
    /** Trv.SetFlag via BluTrv.Call. */
    'trv.setflag': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            flag:
                | 'floor_heating'
                | 'accel'
                | 'auto_calibrate'
                | 'anticlog'
                | 'power_save'
                | 'silent_mode';
        };
        result: null;
    };
    /** Trv.ClearFlag via BluTrv.Call. */
    'trv.clearflag': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            flag:
                | 'floor_heating'
                | 'accel'
                | 'auto_calibrate'
                | 'anticlog'
                | 'power_save'
                | 'silent_mode';
        };
        result: null;
    };
    /** Trv.ShowMessage via BluTrv.Call — display ≤10 char message. */
    'trv.showmessage': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            message: string;
        };
        result: null;
    };
    /** Trv.PairingComplete via BluTrv.Call. */
    'trv.pairingcomplete': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            success: boolean;
        };
        result: null;
    };
    /** Trv.ListScheduleRules via BluTrv.Call. */
    'trv.schedule.list': {
        params: {shellyID: string; id: number; thermostatId?: number};
        result: {rules: unknown[]};
    };
    /** Trv.AddScheduleRule via BluTrv.Call. */
    'trv.schedule.add': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            hour: number;
            minute: number;
            days?: number[];
            target_C: number;
            enable?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** Trv.UpdateScheduleRule via BluTrv.Call. */
    'trv.schedule.update': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Trv.RemoveScheduleRule via BluTrv.Call. */
    'trv.schedule.remove': {
        params: {
            shellyID: string;
            id: number;
            thermostatId?: number;
            ruleId: number;
        };
        result: Record<string, unknown>;
    };
    /** Return the trv namespace contract (methods, schemas, permissions, errors). */
    'trv.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Ui.GetConfig on Wall Display firmware. */
    'ui.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Ui.GetStatus on Wall Display firmware. */
    'ui.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Ui.ListAvailable — supported lock_types/media_control_types/priority_elements. */
    'ui.listavailable': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Plug LED UI config via the device plug UI namespace. */
    'ui.plug.setconfig': {
        params: {
            shellyID: string;
            component: 'POWERSTRIP_UI' | 'PLUGS_UI' | 'PLUGUK_UI' | 'PLUGPM_UI';
            config: Record<string, unknown>;
        };
        result: {restart_required: boolean};
    };
    /** Ui.SetConfig on Wall Display firmware. */
    'ui.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Ui.Screen.Set on Wall Display firmware. */
    'ui.screen.set': {
        params: {shellyID: string; on: string};
        result: Record<string, unknown>;
    };
    /** Ui.Swipe on Wall Display firmware. */
    'ui.swipe': {
        params: {shellyID: string; direction: string};
        result: Record<string, unknown>;
    };
    /** Ui.Tap on Wall Display firmware. */
    'ui.tap': {params: {shellyID: string}; result: Record<string, unknown>};
    /** Return the ui namespace contract (methods, schemas, permissions, errors). */
    'ui.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Toggle the allowDebugUser config flag. */
    'user.setallowdebug': {
        params: {enabled: boolean};
        result: {allowDebugUser: boolean};
    };
    /** Authenticate for Alexa OAuth2 — username must match caller. */
    'user.authenticatealexa': {
        params: {username: string; endpoint: string};
        result: {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };
    };
    /** Refresh the Alexa access token. */
    'user.refreshalexa': {
        params: {refresh_token: string};
        result: {access_token: string};
    };
    /** Login with username + password (dev-mode / non-Zitadel). */
    'user.authenticate': {
        params: {username: string; password: string};
        result: {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };
    };
    /** Swap the WS bearer after an OIDC silent renew. Pinned to the same user + tenant. */
    'user.rotatetoken': {params: {access_token: string}; result: {ok: boolean}};
    /** Refresh the access token. */
    'user.refresh': {
        params: {refresh_token: string};
        result: {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };
    };
    /** Return the current user profile + permissions. */
    'user.getme': {
        params: Record<string, unknown>;
        result: {
            roles: string[];
            group: string | null;
            canWrite: boolean;
            isAdmin: boolean;
            isPlatformAdmin: boolean;
            isViewer: boolean;
            effectiveShape: Record<string, unknown>;
            uiCapabilities: Record<string, unknown>;
        };
    };
    /** Mint a short-lived ticket for POST /media/uploadProfilePic. */
    'user.profilepicture.createuploadticket': {
        params: {username: string};
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Mint a short-lived profile picture URL. */
    'user.profilepicture.geturl': {
        params: {username: string};
        result: {url: string};
    };
    /** Delete the user's uploaded profile picture. Subsequent GetUrl calls fall back to the default avatar. */
    'user.profilepicture.remove': {
        params: {username: string};
        result: {removed: boolean};
    };
    /** Report whether Zitadel integration is configured. */
    'user.zitadelavailable': {
        params: Record<string, unknown>;
        result: {available: boolean};
    };
    /** List users known to Zitadel for this organization. */
    'user.listzitadelusers': {
        params: Record<string, unknown>;
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return the resolved effective shape from the new authz resolver — built-in roles + group + direct assignments unioned, with provenance. */
    'user.geteffectivepermissionsv2': {
        params: {userId: string};
        result: {
            userId: string;
            tenantId: string;
            shape: Record<string, unknown>;
            provenance: Record<string, unknown>;
            hasCredentialBoundary: boolean;
            noAccessReason: string | null;
        };
    };
    /** Simulate an authz decision for a user via the new resolver. Returns decision + matchedBy provenance. */
    'user.simulatev2': {
        params: {
            userId: string;
            action: string;
            resourceType: string;
            resourceId?: string | number;
            builtInRoles?: string[];
        };
        result: Record<string, unknown>;
    };
    /** Attach a custom FM persona to a user with scope. */
    'user.attachcustompersona': {
        params: {
            userId: string;
            personaId: string;
            scope: Record<string, unknown>;
            reason?: string | null;
            comment?: string | null;
            expiresAt?: string | null;
        };
        result: {success: boolean; assignmentId: string};
    };
    /** Provision a Zitadel user. */
    'user.createzitadeluser': {
        params: Record<string, unknown>;
        result: {userId: string};
    };
    /** Update a Zitadel user. */
    'user.updatezitadeluser': {
        params: Record<string, unknown>;
        result: {success: boolean};
    };
    /** Trigger a Zitadel password-reset email for the user. */
    'user.sendpasswordreset': {
        params: {username: string};
        result: {success: boolean};
    };
    /** Deactivate a user in Zitadel. */
    'user.deactivateuser': {
        params: {username: string};
        result: {success: boolean};
    };
    /** Reactivate a previously deactivated Zitadel user. */
    'user.reactivateuser': {
        params: {username: string};
        result: {success: boolean};
    };
    /** Hard-delete a Zitadel user. Irreversible; audit_log retains the historical record. Use DeactivateUser for soft delete. */
    'user.deletezitadeluser': {
        params: {username: string};
        result: {success: boolean};
    };
    /** List Zitadel service users (machine accounts). Tenant-scoped admins see own org; global provider support sees all. */
    'user.listserviceusers': {
        params: Record<string, unknown>;
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Create a Zitadel service user. Role is optional; users without a role or FM assignment have no FM access. */
    'user.createserviceuser': {
        params: {
            userName: string;
            name: string;
            description?: string;
            role?:
                | 'admin'
                | 'manager'
                | 'editor'
                | 'installer'
                | 'operator'
                | 'automation_admin'
                | 'auditor'
                | 'viewer';
            groupIds?: string[];
            assignments?: Array<{
                personaId: string;
                scope: {
                    all?: boolean;
                    device_ids?: string[];
                    location_ids?: number[];
                    device_group_ids?: number[];
                    device_tags?: string[];
                    dashboard_ids?: number[];
                    plugin_keys?: string[];
                    waiting_room_ids?: string[];
                    configuration_keys?: string[];
                    report_ids?: number[];
                    organization_ids?: string[];
                    alert_ids?: string[];
                    notification_ids?: string[];
                    integration_keys?: string[];
                    automation_ids?: string[];
                    actions?: string[];
                };
                reason?: string | null;
                comment?: string | null;
                expiresAt?: string | null;
            }>;
        };
        result: {
            userId: string;
            userName: string;
            role: string | null;
            principal: Record<string, unknown>;
            accessPreview: Record<string, unknown>;
        };
    };
    /** Hard-delete a Zitadel service user. Irreversible; tenant gate ensures only the home-org admin can delete. */
    'user.deleteserviceuser': {
        params: {username: string};
        result: {success: boolean};
    };
    /** Create a Personal Access Token for a user/service user. */
    'user.createpat': {
        params: {userId: string; expirationDays?: number};
        result: {tokenId: string; token: string; expirationDate: string | null};
    };
    /** List Personal Access Tokens for a user. */
    'user.listpats': {
        params: {userId: string};
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Revoke a Personal Access Token. */
    'user.revokepat': {
        params: {userId: string; tokenId: string};
        result: {success: boolean};
    };
    /** Mint an FM-issued scoped PAT. boundaryScope narrows the user effective shape at the auth gate; can only subtract, never escalate. */
    'user.createscopedpat': {
        params: {
            userId: string;
            boundaryScope: {
                all?: boolean;
                device_ids?: string[];
                location_ids?: number[];
                device_group_ids?: number[];
                device_tags?: string[];
                dashboard_ids?: number[];
                plugin_keys?: string[];
                waiting_room_ids?: string[];
                configuration_keys?: string[];
                report_ids?: number[];
                organization_ids?: string[];
                alert_ids?: string[];
                notification_ids?: string[];
                integration_keys?: string[];
                automation_ids?: string[];
                actions?: string[];
            };
            purpose: string;
            audience?: string[];
            expirationDays?: number;
        };
        result: {tokenId: string; token: string; expirationDate: string | null};
    };
    /** List FM-issued scoped PATs. Filter by userId when supplied; otherwise lists every scoped PAT in the caller tenant. */
    'user.listscopedpats': {
        params: {userId?: string};
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Preview the effective access produced by applying a proposed FM scoped PAT boundary to the target principal. */
    'user.previewscopedpat': {
        params: {
            userId: string;
            boundaryScope: {
                all?: boolean;
                device_ids?: string[];
                location_ids?: number[];
                device_group_ids?: number[];
                device_tags?: string[];
                dashboard_ids?: number[];
                plugin_keys?: string[];
                waiting_room_ids?: string[];
                configuration_keys?: string[];
                report_ids?: number[];
                organization_ids?: string[];
                alert_ids?: string[];
                notification_ids?: string[];
                integration_keys?: string[];
                automation_ids?: string[];
                actions?: string[];
            };
        };
        result: {
            usable: boolean;
            effectiveStatementCount: number;
            noAccessReason: string | null;
            effectiveShape: Record<string, unknown>;
        };
    };
    /** Revoke an FM-issued scoped PAT (soft delete). */
    'user.revokescopedpat': {
        params: {tokenId: string};
        result: {success: boolean};
    };
    /** Bulk-revoke every active FM-issued scoped PAT for a user. Off-boarding helper. */
    'user.revokealluserpats': {
        params: {userId: string};
        result: {revokedCount: number};
    };
    /** Atomic rotate of an FM-issued scoped PAT: revoke the old + mint a new one carrying the same boundary/audience/purpose, in one transaction. Returns the new token once. */
    'user.rotatescopedpat': {
        params: {tokenId: string; expirationDays?: number};
        result: {tokenId: string; token: string; expirationDate: string | null};
    };
    /** Return the user namespace contract (methods, schemas, permissions, errors). */
    'user.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Component metadata. */
    'user_group.describe': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** List user groups in current tenant. */
    'user_group.list': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Fetch a user group by id. */
    'user_group.get': {params: {id: string}; result: Record<string, unknown>};
    /** Create a new user group. */
    'user_group.create': {
        params: {
            name: string;
            description?: string;
            parentGroupId?: string | null;
        };
        result: Record<string, unknown>;
    };
    /** Update user group metadata. */
    'user_group.update': {
        params: {
            id: string;
            name?: string;
            description?: string | null;
            parentGroupId?: string | null;
        };
        result: Record<string, unknown>;
    };
    /** Delete user group (cascades memberships, refuses if assignments reference). */
    'user_group.delete': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** List user IDs that belong to this user group. */
    'user_group.listmembers': {
        params: {id: string};
        result: Record<string, unknown>;
    };
    /** Add users to user group. Idempotent. */
    'user_group.addmembers': {
        params: {id: string; userIds: string[]};
        result: Record<string, unknown>;
    };
    /** Remove users from user group. Idempotent. */
    'user_group.removemembers': {
        params: {id: string; userIds: string[]};
        result: Record<string, unknown>;
    };
    /** List every action variable in the standard list envelope. */
    'variables.list': {
        params: Record<string, unknown>;
        result: {
            items: Array<{key: string; value: string}>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Return one action variable by key, or null if absent. */
    'variables.get': {
        params: {key: string};
        result: {key: string; value: string | null};
    };
    /** Upsert an action variable. Idempotent per (key). */
    'variables.set': {
        params: {key: string; value: string};
        result: {key: string; value: string};
    };
    /** Remove an action variable by key. */
    'variables.delete': {params: {key: string}; result: {deleted: boolean}};
    /** Return the variables namespace contract (methods, schemas, permissions, errors). */
    'variables.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** {component}.Set for Boolean / Number / Enum / Text virtual components. */
    'virtual.componentset': {
        params: {
            shellyID: string;
            component: 'Boolean' | 'Number' | 'Enum' | 'Text';
            id: number;
            value: unknown;
        };
        result: null;
    };
    /** Virtual.Add — creates component at id 200-299. */
    'virtual.add': {
        params: {
            shellyID: string;
            type: 'boolean' | 'text' | 'number' | 'enum' | 'group' | 'button';
            config?: Record<string, unknown>;
        };
        result: {id?: number};
    };
    /** Virtual.Delete. */
    'virtual.delete': {params: {shellyID: string; key: string}; result: null};
    /** Virtual.Trigger — fire a Button virtual component. */
    'virtual.trigger': {
        params: {
            shellyID: string;
            id: number;
            event?: 'single_push' | 'double_push' | 'triple_push' | 'long_push';
        };
        result: null;
    };
    /** Boolean.Set — write a virtual boolean. */
    'virtual.boolean.set': {
        params: {shellyID: string; id: number; value: boolean};
        result: null;
    };
    /** Boolean.GetConfig — {id, name, persisted, default_value, meta}. */
    'virtual.boolean.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Boolean.GetStatus — {value, source, last_update_ts}. */
    'virtual.boolean.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Boolean.SetConfig. */
    'virtual.boolean.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Number.Set — write a virtual number. */
    'virtual.number.set': {
        params: {shellyID: string; id: number; value: number};
        result: null;
    };
    /** Number.GetConfig. */
    'virtual.number.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Number.GetStatus. */
    'virtual.number.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Number.SetConfig. */
    'virtual.number.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Text.Set — write a virtual text value. */
    'virtual.text.set': {
        params: {shellyID: string; id: number; value: string};
        result: null;
    };
    /** Text.GetConfig. */
    'virtual.text.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Text.GetStatus. */
    'virtual.text.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Text.SetConfig. */
    'virtual.text.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Enum.Set — write a virtual enum value (must be a valid option or null). */
    'virtual.enum.set': {
        params: {shellyID: string; id: number; value: string | null};
        result: null;
    };
    /** Enum.GetConfig — {id, name, default_value, options[], ...}. */
    'virtual.enum.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Enum.GetStatus. */
    'virtual.enum.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Enum.SetConfig. */
    'virtual.enum.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Group.Set — write a virtual group (array of component keys). */
    'virtual.group.set': {
        params: {shellyID: string; id: number; value: string[]};
        result: null;
    };
    /** Group.GetConfig. */
    'virtual.group.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Group.GetStatus. */
    'virtual.group.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Group.SetConfig. */
    'virtual.group.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Return the virtual namespace contract (methods, schemas, permissions, errors). */
    'virtual.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** virtual_meta.Set — upsert decoration for a virtual component. */
    'virtual_meta.set': {
        params: {
            shellyID: string;
            componentKey: string;
            glyph?: string;
            color?: string;
            gradient?: {
                angle?: number;
                stops: Array<{color: string; offset: number}>;
            };
            promoted?: boolean;
            imagePath?: string;
            measurement?: {
                logicalNode?:
                    | 'MMXU'
                    | 'MMTR'
                    | 'MMXN'
                    | 'MMDC'
                    | 'MSQI'
                    | 'MHAI';
                dataObject?: string;
                phase?: 'A' | 'B' | 'C' | 'N' | 'total';
                accumulation?: 'instant' | 'cumulative' | 'delta';
                unit?: string;
                direction?: 'import' | 'export' | 'net';
            };
        };
        result: Record<string, unknown>;
    };
    /** virtual_meta.Clear — clear specific decoration fields. */
    'virtual_meta.clear': {
        params: {
            shellyID: string;
            componentKey: string;
            clearGlyph?: boolean;
            clearColor?: boolean;
            clearGradient?: boolean;
            clearMeasurement?: boolean;
            clearPromoted?: boolean;
            clearImage?: boolean;
        };
        result: Record<string, unknown>;
    };
    /** virtual_meta.Delete — drop the decoration row entirely. */
    'virtual_meta.delete': {
        params: {shellyID: string; componentKey: string};
        result: Record<string, never>;
    };
    /** virtual_meta.Fetch — all decoration rows for a host device. */
    'virtual_meta.fetch': {
        params: {shellyID: string};
        result: {items: Array<Record<string, unknown>>};
    };
    /** Return the virtual_meta namespace contract (methods, schemas, permissions, errors). */
    'virtual_meta.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** virtualdevice.Create — create extracted/composed/connector device identity. */
    'virtualdevice.create': {
        params: {
            organizationId?: string;
            kind: 'extracted' | 'composed' | 'connector';
            name: string;
            typeKey: string;
            categoryKey?: string;
            profileId?: string;
            imageAssetId?: string | null;
            locationId?: number;
            groupIds?: number[];
            tagIds?: number[];
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
            bindings?: Array<{
                roleKey: string;
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
            }>;
        };
        result: {
            deviceListId: number;
            externalId: string;
            organizationId: string;
            kind: 'extracted' | 'composed' | 'connector';
            name: string;
            typeKey: string;
            categoryKey?: string | null;
            profileId?: string | null;
            imageAssetId?: string | null;
            locationId: number | null;
            groupIds: number[];
            tagIds: number[];
            enabled: boolean;
            revision: number;
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
        };
    };
    /** virtualdevice.Get — fetch one virtual/custom device. */
    'virtualdevice.get': {
        params: {externalId: string};
        result: {
            deviceListId: number;
            externalId: string;
            organizationId: string;
            kind: 'extracted' | 'composed' | 'connector';
            name: string;
            typeKey: string;
            categoryKey?: string | null;
            profileId?: string | null;
            imageAssetId?: string | null;
            locationId: number | null;
            groupIds: number[];
            tagIds: number[];
            enabled: boolean;
            revision: number;
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
        };
    };
    /** virtualdevice.List — list virtual/custom devices. */
    'virtualdevice.list': {
        params: {
            organizationId?: string;
            query?: string;
            kind?: 'extracted' | 'composed' | 'connector';
            typeKey?: string;
            categoryKey?: string;
            limit?: number;
            offset?: number;
            sortBy?: 'name' | 'kind' | 'typeKey' | 'categoryKey' | 'createdAt';
            sortDir?: 'asc' | 'desc';
        };
        result: {
            items: Array<{
                deviceListId: number;
                externalId: string;
                organizationId: string;
                kind: 'extracted' | 'composed' | 'connector';
                name: string;
                typeKey: string;
                categoryKey?: string | null;
                profileId?: string | null;
                imageAssetId?: string | null;
                locationId: number | null;
                groupIds: number[];
                tagIds: number[];
                enabled: boolean;
                revision: number;
                visual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                    cardProfile?:
                        | 'meter'
                        | 'climate'
                        | 'safety'
                        | 'actuator'
                        | 'custom';
                    summaryRoles?: string[];
                    detailSections?: string[];
                };
                metadata?: Record<string, unknown>;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** virtualdevice.Update — update metadata with revision check. */
    'virtualdevice.update': {
        params: {
            externalId: string;
            expectedRevision: number;
            name?: string;
            typeKey?: string;
            categoryKey?: string;
            imageAssetId?: string | null;
            locationId?: number | null;
            groupIds?: number[];
            tagIds?: number[];
            enabled?: boolean;
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
        };
        result: {
            deviceListId: number;
            externalId: string;
            organizationId: string;
            kind: 'extracted' | 'composed' | 'connector';
            name: string;
            typeKey: string;
            categoryKey?: string | null;
            profileId?: string | null;
            imageAssetId?: string | null;
            locationId: number | null;
            groupIds: number[];
            tagIds: number[];
            enabled: boolean;
            revision: number;
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
        };
    };
    /** virtualdevice.Delete — tombstone or purge virtual identity. */
    'virtualdevice.delete': {
        params: {
            externalId: string;
            expectedRevision: number;
            retention?: 'tombstone' | 'purge';
        };
        result: {externalId: string; deleted: boolean};
    };
    /** virtualdevice.Extraction.Preview — preview host dynamic group/service extraction. */
    'virtualdevice.extraction.preview': {
        params: {
            organizationId?: string;
            hostExternalId: string;
            sourceKey: string;
        };
        result: {
            hostDeviceListId: number;
            hostExternalId: string;
            sourceKey: string;
            sourceType: 'virtual_group' | 'service';
            name: string;
            typeKey: string;
            categoryKey?: string | null;
            roles: Array<{
                roleKey: string;
                label: string;
                componentKey: string;
                componentType: string;
                writable?: boolean;
                valueType?: 'boolean' | 'number' | 'string' | 'event' | 'json';
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            }>;
            bindings: Array<{
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            }>;
            hiddenSourceComponentKeys: string[];
            alreadyExtracted: boolean;
            extractedExternalId: string | null;
            sourceSnapshot: {
                hostExternalId: string;
                hostDeviceListId: number;
                sourceKey: string;
                sourceType: 'virtual_group' | 'service';
                members: Array<{
                    roleKey: string;
                    componentKey: string;
                    componentType: string;
                    valueType:
                        | 'boolean'
                        | 'number'
                        | 'string'
                        | 'event'
                        | 'json';
                    writable: boolean;
                    required: boolean;
                    unit: string | null;
                    label: string | null;
                }>;
                capturedAt: string;
            };
        };
    };
    /** virtualdevice.Extraction.Create — atomically create an extracted device with initial source bindings. */
    'virtualdevice.extraction.create': {
        params: {
            organizationId?: string;
            hostExternalId: string;
            sourceKey: string;
            name?: string;
            typeKey?: string;
            categoryKey?: string;
            profileId?: string;
            imageAssetId?: string | null;
            locationId?: number;
            groupIds?: number[];
            tagIds?: number[];
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
        };
        result: {
            deviceListId: number;
            externalId: string;
            organizationId: string;
            kind: 'extracted' | 'composed' | 'connector';
            name: string;
            typeKey: string;
            categoryKey?: string | null;
            profileId?: string | null;
            imageAssetId?: string | null;
            locationId: number | null;
            groupIds: number[];
            tagIds: number[];
            enabled: boolean;
            revision: number;
            visual?: {
                icon?: string;
                accent?: string;
                imageModel?: string;
                cardProfile?:
                    | 'meter'
                    | 'climate'
                    | 'safety'
                    | 'actuator'
                    | 'custom';
                summaryRoles?: string[];
                detailSections?: string[];
            };
            metadata?: Record<string, unknown>;
        };
    };
    /** virtualdevice.Extraction.ReplacementPreview — score a candidate (host, sourceKey) against an existing extracted device. */
    'virtualdevice.extraction.replacementpreview': {
        params: {
            externalId: string;
            newHostExternalId: string;
            newSourceKey: string;
        };
        result: {
            compatible: boolean;
            score: number;
            roleMatches: Array<{
                roleKey: string;
                fromComponentKey: string;
                toComponentKey: string;
                componentType: string;
                valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
            }>;
            roleMissing: string[];
            roleExtra: string[];
            warnings: string[];
        };
    };
    /** virtualdevice.Profile.List — list reusable profiles. */
    'virtualdevice.profile.list': {
        params: {
            organizationId?: string;
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                id: string;
                organizationId: string | null;
                key: string;
                name: string;
                version: number;
                roles: Array<{
                    roleKey: string;
                    label: string;
                    valueType:
                        | 'boolean'
                        | 'number'
                        | 'string'
                        | 'event'
                        | 'json';
                    unit?: string;
                    writable?: boolean;
                    required?: boolean;
                    historyMode:
                        | 'linked'
                        | 'materialized'
                        | 'derived'
                        | 'live_only';
                    visual?: {
                        displayName?: string;
                        icon?: string;
                        slot?:
                            | 'primary'
                            | 'secondary'
                            | 'control'
                            | 'diagnostic'
                            | 'hidden';
                        chart?:
                            | 'line'
                            | 'area'
                            | 'bar'
                            | 'step'
                            | 'state'
                            | 'none';
                        format?: Record<string, unknown>;
                        alertDefaults?: Record<string, unknown>;
                    };
                    metadata?: Record<string, unknown>;
                }>;
                metadata: {
                    categoryKey?: string;
                    defaultVisual?: {
                        icon?: string;
                        accent?: string;
                        imageModel?: string;
                    };
                };
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** virtualdevice.Profile.Create — create profile. */
    'virtualdevice.profile.create': {
        params: {
            organizationId?: string;
            key: string;
            name: string;
            version?: number;
            roles: Array<{
                roleKey: string;
                label: string;
                valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
                unit?: string;
                writable?: boolean;
                required?: boolean;
                historyMode:
                    | 'linked'
                    | 'materialized'
                    | 'derived'
                    | 'live_only';
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
                metadata?: Record<string, unknown>;
            }>;
            metadata?: {
                categoryKey?: string;
                defaultVisual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                };
            };
        };
        result: {
            id: string;
            organizationId: string | null;
            key: string;
            name: string;
            version: number;
            roles: Array<{
                roleKey: string;
                label: string;
                valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
                unit?: string;
                writable?: boolean;
                required?: boolean;
                historyMode:
                    | 'linked'
                    | 'materialized'
                    | 'derived'
                    | 'live_only';
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
                metadata?: Record<string, unknown>;
            }>;
            metadata: {
                categoryKey?: string;
                defaultVisual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                };
            };
        };
    };
    /** virtualdevice.Profile.Update — patch a per-org profile (name + metadata). System profiles are read-only. */
    'virtualdevice.profile.update': {
        params: {
            organizationId?: string;
            profileId: string;
            name?: string;
            metadata?: {
                categoryKey?: string;
                defaultVisual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                };
            };
        };
        result: {
            id: string;
            organizationId: string | null;
            key: string;
            name: string;
            version: number;
            roles: Array<{
                roleKey: string;
                label: string;
                valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
                unit?: string;
                writable?: boolean;
                required?: boolean;
                historyMode:
                    | 'linked'
                    | 'materialized'
                    | 'derived'
                    | 'live_only';
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
                metadata?: Record<string, unknown>;
            }>;
            metadata: {
                categoryKey?: string;
                defaultVisual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                };
            };
        };
    };
    /** virtualdevice.Profile.Validate — validate profile shape. */
    'virtualdevice.profile.validate': {
        params: {
            roles: Array<{
                roleKey: string;
                label: string;
                valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
                unit?: string;
                writable?: boolean;
                required?: boolean;
                historyMode:
                    | 'linked'
                    | 'materialized'
                    | 'derived'
                    | 'live_only';
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
                metadata?: Record<string, unknown>;
            }>;
        };
        result: {valid: boolean; errors: Array<Record<string, unknown>>};
    };
    /** virtualdevice.Profile.MatchSources — score candidate source components against a profile. */
    'virtualdevice.profile.matchsources': {
        params: {
            organizationId?: string;
            profileId?: string;
            profileKey?: string;
            profileVersion?: number;
            deviceExternalId?: string;
            sourceDeviceExternalIds?: string[];
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            profile: {id: string; key: string; name: string; version: number};
            slots: Array<{
                roleKey: string;
                label: string;
                valueType: 'boolean' | 'number' | 'string' | 'event' | 'json';
                unit?: string | null;
                writable?: boolean;
                required: boolean;
                matches: Array<{
                    deviceExternalId: string;
                    deviceName: string;
                    componentKey: string;
                    componentType: string;
                    label?: string | null;
                    score: number;
                    reasons: string[];
                }>;
            }>;
            fillFromDevice: Array<{
                deviceExternalId: string;
                matchedRequired: number;
                totalRequired: number;
                assignments: Array<{roleKey: string; componentKey: string}>;
            }>;
        };
    };
    /** virtualdevice.Profile.SuggestFromDevice — rank profiles likely to fit a given device. */
    'virtualdevice.profile.suggestfromdevice': {
        params: {
            organizationId?: string;
            deviceExternalId: string;
            limit?: number;
        };
        result: {
            device: {
                externalId: string;
                kind: 'physical' | 'bluetooth';
                modelHint: string | null;
            };
            candidates: Array<{
                profile: {
                    id: string;
                    key: string;
                    name: string;
                    version: number;
                };
                confidence: number;
                coverage: number;
                matchedRequired: number;
                totalRequired: number;
                reasons: string[];
                roleFitness: Array<{
                    roleKey: string;
                    required: boolean;
                    matched: boolean;
                    bestComponentKey: string | null;
                    bestScore: number;
                }>;
            }>;
        };
    };
    /** virtualdevice.Binding.List — list role source bindings. */
    'virtualdevice.binding.list': {
        params: {externalId: string};
        result: {
            items: Array<{
                id: string;
                roleKey: string;
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                mode: 'linked' | 'materialized' | 'derived' | 'live_only';
                active: boolean;
                effectiveFrom?: string | null;
                effectiveTo?: string | null;
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
                createdAt: string;
            }>;
        };
    };
    /** virtualdevice.Binding.ListSources — list backend-filtered source component candidates. */
    'virtualdevice.binding.listsources': {
        params: {
            organizationId?: string;
            externalId?: string;
            query?: string;
            componentType?: string;
            roleKey?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                deviceExternalId: string;
                deviceName: string;
                componentKey: string;
                componentType: string;
                dynamicCategory: 'Virtual' | 'BTHome' | 'LNM' | null;
                label?: string | null;
                valueType?: 'boolean' | 'number' | 'string' | 'event' | 'json';
                writable: boolean;
                connector?: {protocol: string; pointId: string | null};
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** virtualdevice.Binding.ValidateDraft — validate a composed-device binding set without writing. */
    'virtualdevice.binding.validatedraft': {
        params: {
            externalId: string;
            bindings: Array<{
                roleKey: string;
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
            }>;
        };
        result: {valid: boolean; errors: Array<Record<string, unknown>>};
    };
    /** virtualdevice.Draft.Preview — render a composed-device preview from draft identity and bindings. */
    'virtualdevice.draft.preview': {
        params: {
            device: {
                organizationId?: string;
                kind: 'extracted' | 'composed' | 'connector';
                name: string;
                typeKey: string;
                categoryKey?: string;
                profileId?: string;
                imageAssetId?: string | null;
                locationId?: number;
                groupIds?: number[];
                tagIds?: number[];
                visual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                    cardProfile?:
                        | 'meter'
                        | 'climate'
                        | 'safety'
                        | 'actuator'
                        | 'custom';
                    summaryRoles?: string[];
                    detailSections?: string[];
                };
                metadata?: Record<string, unknown>;
                bindings?: Array<{
                    roleKey: string;
                    source: {
                        deviceExternalId: string;
                        componentKey: string;
                        dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                    };
                    visual?: {
                        displayName?: string;
                        icon?: string;
                        slot?:
                            | 'primary'
                            | 'secondary'
                            | 'control'
                            | 'diagnostic'
                            | 'hidden';
                        chart?:
                            | 'line'
                            | 'area'
                            | 'bar'
                            | 'step'
                            | 'state'
                            | 'none';
                        format?: Record<string, unknown>;
                        alertDefaults?: Record<string, unknown>;
                    };
                }>;
            };
            bindings: Array<{
                roleKey: string;
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
            }>;
        };
        result: {
            device: {
                deviceListId: number;
                externalId: string;
                organizationId: string;
                kind: 'extracted' | 'composed' | 'connector';
                name: string;
                typeKey: string;
                categoryKey?: string | null;
                profileId?: string | null;
                imageAssetId?: string | null;
                locationId: number | null;
                groupIds: number[];
                tagIds: number[];
                enabled: boolean;
                revision: number;
                visual?: {
                    icon?: string;
                    accent?: string;
                    imageModel?: string;
                    cardProfile?:
                        | 'meter'
                        | 'climate'
                        | 'safety'
                        | 'actuator'
                        | 'custom';
                    summaryRoles?: string[];
                    detailSections?: string[];
                };
                metadata?: Record<string, unknown>;
            };
            bindings: Array<{
                id: string;
                roleKey: string;
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                mode: 'linked' | 'materialized' | 'derived' | 'live_only';
                active: boolean;
                effectiveFrom?: string | null;
                effectiveTo?: string | null;
                visual?: {
                    displayName?: string;
                    icon?: string;
                    slot?:
                        | 'primary'
                        | 'secondary'
                        | 'control'
                        | 'diagnostic'
                        | 'hidden';
                    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                    format?: Record<string, unknown>;
                    alertDefaults?: Record<string, unknown>;
                };
                createdAt: string;
            }>;
            validation: {
                valid: boolean;
                errors: Array<Record<string, unknown>>;
            };
        };
    };
    /** virtualdevice.Binding.Create — create one role source binding when no active binding exists. */
    'virtualdevice.binding.create': {
        params: {
            externalId: string;
            roleKey: string;
            source: {
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            };
            expectedRevision: number;
            effectiveFrom?: string;
            visual?: {
                displayName?: string;
                icon?: string;
                slot?:
                    | 'primary'
                    | 'secondary'
                    | 'control'
                    | 'diagnostic'
                    | 'hidden';
                chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                format?: Record<string, unknown>;
                alertDefaults?: Record<string, unknown>;
            };
            reason?: string;
        };
        result: {
            id: string;
            roleKey: string;
            source: {
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            };
            mode: 'linked' | 'materialized' | 'derived' | 'live_only';
            active: boolean;
            effectiveFrom?: string | null;
            effectiveTo?: string | null;
            visual?: {
                displayName?: string;
                icon?: string;
                slot?:
                    | 'primary'
                    | 'secondary'
                    | 'control'
                    | 'diagnostic'
                    | 'hidden';
                chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                format?: Record<string, unknown>;
                alertDefaults?: Record<string, unknown>;
            };
            createdAt: string;
        };
    };
    /** virtualdevice.Binding.Replace — atomically replace one active role source. */
    'virtualdevice.binding.replace': {
        params: {
            externalId: string;
            roleKey: string;
            source: {
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            };
            expectedRevision: number;
            idempotencyKey: string;
            effectiveFrom?: string;
            visual?: {
                displayName?: string;
                icon?: string;
                slot?:
                    | 'primary'
                    | 'secondary'
                    | 'control'
                    | 'diagnostic'
                    | 'hidden';
                chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                format?: Record<string, unknown>;
                alertDefaults?: Record<string, unknown>;
            };
            reason?: string;
        };
        result: {
            id: string;
            roleKey: string;
            source: {
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            };
            mode: 'linked' | 'materialized' | 'derived' | 'live_only';
            active: boolean;
            effectiveFrom?: string | null;
            effectiveTo?: string | null;
            visual?: {
                displayName?: string;
                icon?: string;
                slot?:
                    | 'primary'
                    | 'secondary'
                    | 'control'
                    | 'diagnostic'
                    | 'hidden';
                chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                format?: Record<string, unknown>;
                alertDefaults?: Record<string, unknown>;
            };
            createdAt: string;
        };
    };
    /** virtualdevice.Binding.Retire — stop one active role source. */
    'virtualdevice.binding.retire': {
        params: {
            externalId: string;
            bindingId: string;
            expectedRevision: number;
            effectiveTo?: string;
            reason?: string;
        };
        result: {
            id: string;
            roleKey: string;
            source: {
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            };
            mode: 'linked' | 'materialized' | 'derived' | 'live_only';
            active: boolean;
            effectiveFrom?: string | null;
            effectiveTo?: string | null;
            visual?: {
                displayName?: string;
                icon?: string;
                slot?:
                    | 'primary'
                    | 'secondary'
                    | 'control'
                    | 'diagnostic'
                    | 'hidden';
                chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
                format?: Record<string, unknown>;
                alertDefaults?: Record<string, unknown>;
            };
            createdAt: string;
        };
    };
    /** virtualdevice.Command.Invoke — execute a writable virtual role action on its active physical source. */
    'virtualdevice.command.invoke': {
        params: {
            externalId: string;
            roleKey: string;
            action: string;
            params?: Record<string, unknown>;
        };
        result: {
            externalId: string;
            roleKey: string;
            bindingId: string;
            source: {
                deviceExternalId: string;
                componentKey: string;
                dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
            };
            action: string;
            method: string;
            result:
                | Record<string, unknown>
                | unknown[]
                | string
                | number
                | boolean
                | null;
        };
    };
    /** virtualdevice.History.ReadRole — read a stitched role time series across binding replacements. */
    'virtualdevice.history.readrole': {
        params: {
            externalId: string;
            roleKey: string;
            field: string;
            from: string;
            to: string;
            limit?: number;
        };
        result: {
            items: Array<{
                ts: string;
                value: number | string | null;
                prevValue: number | string | null;
                bindingId: string;
                roleKey: string;
                mode: 'linked' | 'materialized' | 'derived' | 'live_only';
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
            }>;
            provenance: Array<{
                bindingId: string;
                roleKey: string;
                mode: 'linked' | 'materialized' | 'derived' | 'live_only';
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                effectiveFrom: string;
                effectiveTo: string | null;
                segmentFrom: string;
                segmentTo: string;
            }>;
        };
    };
    /** virtualdevice.History.ReadProvenance — explain which source produced a virtual role window. */
    'virtualdevice.history.readprovenance': {
        params: {
            externalId: string;
            roleKey: string;
            from: string;
            to: string;
            limit?: number;
        };
        result: {
            segments: Array<{
                bindingId: string;
                roleKey: string;
                mode: 'linked' | 'materialized' | 'derived' | 'live_only';
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                effectiveFrom: string;
                effectiveTo: string | null;
                segmentFrom: string;
                segmentTo: string;
            }>;
            samples: Array<{
                ts: string;
                bindingId: string;
                roleKey: string;
                source: {
                    deviceExternalId: string;
                    componentKey: string;
                    dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                };
                sourceTs: string;
            }>;
        };
    };
    /** virtualdevice.History.Backfill — materialize linked source history onto a virtual role idempotently. */
    'virtualdevice.history.backfill': {
        params: {
            externalId: string;
            roleKey: string;
            field: string;
            from: string;
            to: string;
            limit?: number;
        };
        result: {
            externalId: string;
            roleKey: string;
            field: string;
            insertedRows: number;
            scannedRows: number;
        };
    };
    /** virtualdevice.Binding.ReplacementReport — list source replacement events for a virtual device. */
    'virtualdevice.binding.replacementreport': {
        params: {
            externalId: string;
            roleKey?: string;
            from?: string;
            to?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** virtualdevice.Manifest.Validate — validate a virtual-device bundle without reading target state. */
    'virtualdevice.manifest.validate': {
        params: {
            manifest: {
                apiVersion: string;
                kind: 'VirtualDeviceBundle';
                spec: {
                    profiles?: Array<{
                        key: string;
                        name: string;
                        version?: number;
                        roles: Array<{
                            roleKey: string;
                            label: string;
                            valueType:
                                | 'boolean'
                                | 'number'
                                | 'string'
                                | 'event'
                                | 'json';
                            unit?: string;
                            writable?: boolean;
                            required?: boolean;
                            historyMode:
                                | 'linked'
                                | 'materialized'
                                | 'derived'
                                | 'live_only';
                            visual?: {
                                displayName?: string;
                                icon?: string;
                                slot?:
                                    | 'primary'
                                    | 'secondary'
                                    | 'control'
                                    | 'diagnostic'
                                    | 'hidden';
                                chart?:
                                    | 'line'
                                    | 'area'
                                    | 'bar'
                                    | 'step'
                                    | 'state'
                                    | 'none';
                                format?: Record<string, unknown>;
                                alertDefaults?: Record<string, unknown>;
                            };
                            metadata?: Record<string, unknown>;
                        }>;
                        metadata?: {
                            categoryKey?: string;
                            defaultVisual?: {
                                icon?: string;
                                accent?: string;
                                imageModel?: string;
                            };
                        };
                    }>;
                    devices?: Array<{
                        externalId: string;
                        kind: 'extracted' | 'composed' | 'connector';
                        name: string;
                        typeKey: string;
                        categoryKey?: string;
                        profileKey?: string;
                        profileVersion?: number;
                        imageAssetId?: string;
                        locationId?: number | null;
                        groupIds?: number[];
                        tagIds?: number[];
                        enabled?: boolean;
                        visual?: {
                            icon?: string;
                            accent?: string;
                            imageModel?: string;
                            cardProfile?:
                                | 'meter'
                                | 'climate'
                                | 'safety'
                                | 'actuator'
                                | 'custom';
                            summaryRoles?: string[];
                            detailSections?: string[];
                        };
                        metadata?: Record<string, unknown>;
                    }>;
                    bindings?: Array<{
                        externalId: string;
                        roleKey: string;
                        source: {
                            deviceExternalId: string;
                            componentKey: string;
                            dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                        };
                        mode?:
                            | 'linked'
                            | 'materialized'
                            | 'derived'
                            | 'live_only';
                        effectiveFrom?: string;
                        reason?: string;
                    }>;
                    alertReferences?: Array<{
                        id: number;
                        name: string;
                        kind: string;
                        [key: string]: unknown;
                    }>;
                    remap?: {
                        devices?: Record<string, string>;
                        sources?: Record<string, string>;
                        profiles?: Record<string, string>;
                    };
                };
            };
        };
        result: {
            valid: boolean;
            changes: Array<Record<string, unknown>>;
            errors: Array<Record<string, unknown>>;
            remaps: Array<Record<string, unknown>>;
        };
    };
    /** virtualdevice.Manifest.Export — export virtual profiles, devices, bindings, visuals, and alert references. */
    'virtualdevice.manifest.export': {
        params: {organizationId?: string; externalIds?: string[]};
        result: {
            apiVersion: string;
            kind: 'VirtualDeviceBundle';
            spec: {
                profiles?: Array<{
                    key: string;
                    name: string;
                    version?: number;
                    roles: Array<{
                        roleKey: string;
                        label: string;
                        valueType:
                            | 'boolean'
                            | 'number'
                            | 'string'
                            | 'event'
                            | 'json';
                        unit?: string;
                        writable?: boolean;
                        required?: boolean;
                        historyMode:
                            | 'linked'
                            | 'materialized'
                            | 'derived'
                            | 'live_only';
                        visual?: {
                            displayName?: string;
                            icon?: string;
                            slot?:
                                | 'primary'
                                | 'secondary'
                                | 'control'
                                | 'diagnostic'
                                | 'hidden';
                            chart?:
                                | 'line'
                                | 'area'
                                | 'bar'
                                | 'step'
                                | 'state'
                                | 'none';
                            format?: Record<string, unknown>;
                            alertDefaults?: Record<string, unknown>;
                        };
                        metadata?: Record<string, unknown>;
                    }>;
                    metadata?: {
                        categoryKey?: string;
                        defaultVisual?: {
                            icon?: string;
                            accent?: string;
                            imageModel?: string;
                        };
                    };
                }>;
                devices?: Array<{
                    externalId: string;
                    kind: 'extracted' | 'composed' | 'connector';
                    name: string;
                    typeKey: string;
                    categoryKey?: string;
                    profileKey?: string;
                    profileVersion?: number;
                    imageAssetId?: string;
                    locationId?: number | null;
                    groupIds?: number[];
                    tagIds?: number[];
                    enabled?: boolean;
                    visual?: {
                        icon?: string;
                        accent?: string;
                        imageModel?: string;
                        cardProfile?:
                            | 'meter'
                            | 'climate'
                            | 'safety'
                            | 'actuator'
                            | 'custom';
                        summaryRoles?: string[];
                        detailSections?: string[];
                    };
                    metadata?: Record<string, unknown>;
                }>;
                bindings?: Array<{
                    externalId: string;
                    roleKey: string;
                    source: {
                        deviceExternalId: string;
                        componentKey: string;
                        dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                    };
                    mode?: 'linked' | 'materialized' | 'derived' | 'live_only';
                    effectiveFrom?: string;
                    reason?: string;
                }>;
                alertReferences?: Array<{
                    id: number;
                    name: string;
                    kind: string;
                    [key: string]: unknown;
                }>;
                remap?: {
                    devices?: Record<string, string>;
                    sources?: Record<string, string>;
                    profiles?: Record<string, string>;
                };
            };
        };
    };
    /** virtualdevice.Manifest.Plan — dry-run a bundle import with conflict and remap checks. */
    'virtualdevice.manifest.plan': {
        params: {
            manifest: {
                apiVersion: string;
                kind: 'VirtualDeviceBundle';
                spec: {
                    profiles?: Array<{
                        key: string;
                        name: string;
                        version?: number;
                        roles: Array<{
                            roleKey: string;
                            label: string;
                            valueType:
                                | 'boolean'
                                | 'number'
                                | 'string'
                                | 'event'
                                | 'json';
                            unit?: string;
                            writable?: boolean;
                            required?: boolean;
                            historyMode:
                                | 'linked'
                                | 'materialized'
                                | 'derived'
                                | 'live_only';
                            visual?: {
                                displayName?: string;
                                icon?: string;
                                slot?:
                                    | 'primary'
                                    | 'secondary'
                                    | 'control'
                                    | 'diagnostic'
                                    | 'hidden';
                                chart?:
                                    | 'line'
                                    | 'area'
                                    | 'bar'
                                    | 'step'
                                    | 'state'
                                    | 'none';
                                format?: Record<string, unknown>;
                                alertDefaults?: Record<string, unknown>;
                            };
                            metadata?: Record<string, unknown>;
                        }>;
                        metadata?: {
                            categoryKey?: string;
                            defaultVisual?: {
                                icon?: string;
                                accent?: string;
                                imageModel?: string;
                            };
                        };
                    }>;
                    devices?: Array<{
                        externalId: string;
                        kind: 'extracted' | 'composed' | 'connector';
                        name: string;
                        typeKey: string;
                        categoryKey?: string;
                        profileKey?: string;
                        profileVersion?: number;
                        imageAssetId?: string;
                        locationId?: number | null;
                        groupIds?: number[];
                        tagIds?: number[];
                        enabled?: boolean;
                        visual?: {
                            icon?: string;
                            accent?: string;
                            imageModel?: string;
                            cardProfile?:
                                | 'meter'
                                | 'climate'
                                | 'safety'
                                | 'actuator'
                                | 'custom';
                            summaryRoles?: string[];
                            detailSections?: string[];
                        };
                        metadata?: Record<string, unknown>;
                    }>;
                    bindings?: Array<{
                        externalId: string;
                        roleKey: string;
                        source: {
                            deviceExternalId: string;
                            componentKey: string;
                            dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                        };
                        mode?:
                            | 'linked'
                            | 'materialized'
                            | 'derived'
                            | 'live_only';
                        effectiveFrom?: string;
                        reason?: string;
                    }>;
                    alertReferences?: Array<{
                        id: number;
                        name: string;
                        kind: string;
                        [key: string]: unknown;
                    }>;
                    remap?: {
                        devices?: Record<string, string>;
                        sources?: Record<string, string>;
                        profiles?: Record<string, string>;
                    };
                };
            };
        };
        result: {
            valid: boolean;
            changes: Array<Record<string, unknown>>;
            errors: Array<Record<string, unknown>>;
            remaps: Array<Record<string, unknown>>;
        };
    };
    /** virtualdevice.Manifest.Apply — apply a valid bundle through normal validation, idempotency, and audit paths. */
    'virtualdevice.manifest.apply': {
        params: {
            manifest: {
                apiVersion: string;
                kind: 'VirtualDeviceBundle';
                spec: {
                    profiles?: Array<{
                        key: string;
                        name: string;
                        version?: number;
                        roles: Array<{
                            roleKey: string;
                            label: string;
                            valueType:
                                | 'boolean'
                                | 'number'
                                | 'string'
                                | 'event'
                                | 'json';
                            unit?: string;
                            writable?: boolean;
                            required?: boolean;
                            historyMode:
                                | 'linked'
                                | 'materialized'
                                | 'derived'
                                | 'live_only';
                            visual?: {
                                displayName?: string;
                                icon?: string;
                                slot?:
                                    | 'primary'
                                    | 'secondary'
                                    | 'control'
                                    | 'diagnostic'
                                    | 'hidden';
                                chart?:
                                    | 'line'
                                    | 'area'
                                    | 'bar'
                                    | 'step'
                                    | 'state'
                                    | 'none';
                                format?: Record<string, unknown>;
                                alertDefaults?: Record<string, unknown>;
                            };
                            metadata?: Record<string, unknown>;
                        }>;
                        metadata?: {
                            categoryKey?: string;
                            defaultVisual?: {
                                icon?: string;
                                accent?: string;
                                imageModel?: string;
                            };
                        };
                    }>;
                    devices?: Array<{
                        externalId: string;
                        kind: 'extracted' | 'composed' | 'connector';
                        name: string;
                        typeKey: string;
                        categoryKey?: string;
                        profileKey?: string;
                        profileVersion?: number;
                        imageAssetId?: string;
                        locationId?: number | null;
                        groupIds?: number[];
                        tagIds?: number[];
                        enabled?: boolean;
                        visual?: {
                            icon?: string;
                            accent?: string;
                            imageModel?: string;
                            cardProfile?:
                                | 'meter'
                                | 'climate'
                                | 'safety'
                                | 'actuator'
                                | 'custom';
                            summaryRoles?: string[];
                            detailSections?: string[];
                        };
                        metadata?: Record<string, unknown>;
                    }>;
                    bindings?: Array<{
                        externalId: string;
                        roleKey: string;
                        source: {
                            deviceExternalId: string;
                            componentKey: string;
                            dynamicCategory?: 'Virtual' | 'BTHome' | 'LNM';
                        };
                        mode?:
                            | 'linked'
                            | 'materialized'
                            | 'derived'
                            | 'live_only';
                        effectiveFrom?: string;
                        reason?: string;
                    }>;
                    alertReferences?: Array<{
                        id: number;
                        name: string;
                        kind: string;
                        [key: string]: unknown;
                    }>;
                    remap?: {
                        devices?: Record<string, string>;
                        sources?: Record<string, string>;
                        profiles?: Record<string, string>;
                    };
                };
            };
        };
        result: {
            applied: boolean;
            plan: {
                valid: boolean;
                changes: Array<Record<string, unknown>>;
                errors: Array<Record<string, unknown>>;
                remaps: Array<Record<string, unknown>>;
            };
            outcomes: Array<{
                resourceType: 'profile' | 'device' | 'binding';
                ref: string;
                outcome: 'create' | 'update' | 'skip' | 'fail';
                reason?: string;
            }>;
        };
    };
    /** virtualdevice.Bluetooth.Candidate.List — list BTHome gateway children that can be promoted. */
    'virtualdevice.bluetooth.candidate.list': {
        params: {
            organizationId?: string;
            gatewayExternalId?: string;
            query?: string;
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                gatewayDeviceListId: number;
                gatewayExternalId: string;
                componentKey: string;
                stableId: string;
                bleAddress: string;
                name: string | null;
                productName: string | null;
                modelId: string | null;
                capability:
                    | 'telemetry_only'
                    | 'event_only'
                    | 'controllable'
                    | 'unknown';
                components: Array<{
                    componentKey: string;
                    kind: 'device' | 'sensor' | 'control' | 'trv';
                    role:
                        | 'identity'
                        | 'telemetry'
                        | 'event_control'
                        | 'writable_control';
                    objectId?: number | null;
                    index?: number | null;
                    name?: string | null;
                    canWrite: boolean;
                }>;
                alreadyPromoted: boolean;
                bluetoothExternalId: string | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** virtualdevice.Bluetooth.PromoteFromGateway — create or update a first-class Bluetooth child device from bthomedevice:N. */
    'virtualdevice.bluetooth.promotefromgateway': {
        params: {
            organizationId?: string;
            gatewayExternalId: string;
            componentKey: string;
            makePrimary?: boolean;
        };
        result: {
            deviceListId: number;
            externalId: string;
            stableId: string;
            bleAddress?: string | null;
            productName?: string | null;
            modelId?: string | null;
            imageAssetId?: string | null;
            capability:
                | 'telemetry_only'
                | 'event_only'
                | 'controllable'
                | 'unknown';
            keyRefSet: boolean;
            components: Array<{
                componentKey: string;
                kind: 'device' | 'sensor' | 'control' | 'trv';
                role:
                    | 'identity'
                    | 'telemetry'
                    | 'event_control'
                    | 'writable_control';
                objectId?: number | null;
                index?: number | null;
                name?: string | null;
                canWrite: boolean;
            }>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            primaryTransport?: {
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                assistantDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                serialPortRef?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            } | null;
        };
    };
    /** virtualdevice.Bluetooth.List — list Bluetooth child devices. */
    'virtualdevice.bluetooth.list': {
        params: {
            organizationId?: string;
            query?: string;
            capability?:
                | 'telemetry_only'
                | 'event_only'
                | 'controllable'
                | 'unknown';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<{
                deviceListId: number;
                externalId: string;
                stableId: string;
                bleAddress?: string | null;
                productName?: string | null;
                modelId?: string | null;
                imageAssetId?: string | null;
                capability:
                    | 'telemetry_only'
                    | 'event_only'
                    | 'controllable'
                    | 'unknown';
                keyRefSet: boolean;
                components: Array<{
                    componentKey: string;
                    kind: 'device' | 'sensor' | 'control' | 'trv';
                    role:
                        | 'identity'
                        | 'telemetry'
                        | 'event_control'
                        | 'writable_control';
                    objectId?: number | null;
                    index?: number | null;
                    name?: string | null;
                    canWrite: boolean;
                }>;
                visual: {icon?: string; accent?: string; imageModel?: string};
                primaryTransport?: {
                    id: string;
                    mode:
                        | 'bthome_gateway'
                        | 'blu_assistant_ws'
                        | 'blu_assistant_serial'
                        | 'host_bluetooth';
                    canWrite: boolean;
                    enabled: boolean;
                    shellyDeviceExternalId?: string | null;
                    assistantDeviceExternalId?: string | null;
                    hostAdapterId?: string | null;
                    serialPortRef?: string | null;
                    lastSeenAt?: string | null;
                    lastRssi?: number | null;
                } | null;
            }>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** virtualdevice.Bluetooth.Get — fetch one Bluetooth child device. */
    'virtualdevice.bluetooth.get': {
        params: {externalId: string};
        result: {
            deviceListId: number;
            externalId: string;
            stableId: string;
            bleAddress?: string | null;
            productName?: string | null;
            modelId?: string | null;
            imageAssetId?: string | null;
            capability:
                | 'telemetry_only'
                | 'event_only'
                | 'controllable'
                | 'unknown';
            keyRefSet: boolean;
            components: Array<{
                componentKey: string;
                kind: 'device' | 'sensor' | 'control' | 'trv';
                role:
                    | 'identity'
                    | 'telemetry'
                    | 'event_control'
                    | 'writable_control';
                objectId?: number | null;
                index?: number | null;
                name?: string | null;
                canWrite: boolean;
            }>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            primaryTransport?: {
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                assistantDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                serialPortRef?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            } | null;
        };
    };
    /** virtualdevice.Bluetooth.Delete — tombstone or purge a Bluetooth child device, optionally unpairing it from its gateway first. */
    'virtualdevice.bluetooth.delete': {
        params: {
            externalId: string;
            retention?: 'tombstone' | 'purge';
            unpairFromGateway?: boolean;
            ignoreGatewayErrors?: boolean;
        };
        result: {externalId: string; deleted: boolean};
    };
    /** virtualdevice.Bluetooth.Transport.List — list transports for one Bluetooth child device. */
    'virtualdevice.bluetooth.transport.list': {
        params: {externalId: string};
        result: {
            items: Array<{
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                primary: boolean;
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                assistantDeviceExternalId?: string | null;
                serialPortRef?: string | null;
                keyDistributedAt?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            }>;
        };
    };
    /** virtualdevice.Bluetooth.Transport.SetPrimary — manually choose the primary Bluetooth transport. */
    'virtualdevice.bluetooth.transport.setprimary': {
        params: {externalId: string; transportId: string};
        result: {
            items: Array<{
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                primary: boolean;
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                assistantDeviceExternalId?: string | null;
                serialPortRef?: string | null;
                keyDistributedAt?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            }>;
        };
    };
    /** virtualdevice.Bluetooth.Key.SetRef — attach an audited secret reference for a Bluetooth device bindkey. */
    'virtualdevice.bluetooth.key.setref': {
        params: {externalId: string; keyRef: string; reason?: string};
        result: {
            deviceListId: number;
            externalId: string;
            stableId: string;
            bleAddress?: string | null;
            productName?: string | null;
            modelId?: string | null;
            imageAssetId?: string | null;
            capability:
                | 'telemetry_only'
                | 'event_only'
                | 'controllable'
                | 'unknown';
            keyRefSet: boolean;
            components: Array<{
                componentKey: string;
                kind: 'device' | 'sensor' | 'control' | 'trv';
                role:
                    | 'identity'
                    | 'telemetry'
                    | 'event_control'
                    | 'writable_control';
                objectId?: number | null;
                index?: number | null;
                name?: string | null;
                canWrite: boolean;
            }>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            primaryTransport?: {
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                assistantDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                serialPortRef?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            } | null;
        };
    };
    /** virtualdevice.Bluetooth.Key.Clear — clear the audited Bluetooth bindkey reference. */
    'virtualdevice.bluetooth.key.clear': {
        params: {externalId: string; reason?: string};
        result: {
            deviceListId: number;
            externalId: string;
            stableId: string;
            bleAddress?: string | null;
            productName?: string | null;
            modelId?: string | null;
            imageAssetId?: string | null;
            capability:
                | 'telemetry_only'
                | 'event_only'
                | 'controllable'
                | 'unknown';
            keyRefSet: boolean;
            components: Array<{
                componentKey: string;
                kind: 'device' | 'sensor' | 'control' | 'trv';
                role:
                    | 'identity'
                    | 'telemetry'
                    | 'event_control'
                    | 'writable_control';
                objectId?: number | null;
                index?: number | null;
                name?: string | null;
                canWrite: boolean;
            }>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            primaryTransport?: {
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                assistantDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                serialPortRef?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            } | null;
        };
    };
    /** virtualdevice.Image.CreateUploadTicket — issue a visual-asset upload ticket scoped to one virtual device. */
    'virtualdevice.image.createuploadticket': {
        params: {externalId: string};
        result: {uploadTicket: string; expiresAt: string};
    };
    /** virtualdevice.Bluetooth.Update — set visual decoration on a BLU device. */
    'virtualdevice.bluetooth.update': {
        params: {
            externalId: string;
            imageAssetId?: string | null;
            visual?: {icon?: string; accent?: string; imageModel?: string};
        };
        result: {
            deviceListId: number;
            externalId: string;
            stableId: string;
            bleAddress?: string | null;
            productName?: string | null;
            modelId?: string | null;
            imageAssetId?: string | null;
            capability:
                | 'telemetry_only'
                | 'event_only'
                | 'controllable'
                | 'unknown';
            keyRefSet: boolean;
            components: Array<{
                componentKey: string;
                kind: 'device' | 'sensor' | 'control' | 'trv';
                role:
                    | 'identity'
                    | 'telemetry'
                    | 'event_control'
                    | 'writable_control';
                objectId?: number | null;
                index?: number | null;
                name?: string | null;
                canWrite: boolean;
            }>;
            visual: {icon?: string; accent?: string; imageModel?: string};
            primaryTransport?: {
                id: string;
                mode:
                    | 'bthome_gateway'
                    | 'blu_assistant_ws'
                    | 'blu_assistant_serial'
                    | 'host_bluetooth';
                canWrite: boolean;
                enabled: boolean;
                shellyDeviceExternalId?: string | null;
                assistantDeviceExternalId?: string | null;
                hostAdapterId?: string | null;
                serialPortRef?: string | null;
                lastSeenAt?: string | null;
                lastRssi?: number | null;
            } | null;
        };
    };
    /** virtualdevice.Bluetooth.Image.CreateUploadTicket — issue a visual-asset upload ticket scoped to one Bluetooth child device. */
    'virtualdevice.bluetooth.image.createuploadticket': {
        params: {externalId: string};
        result: {uploadTicket: string; expiresAt: string};
    };
    /** Return the virtualdevice namespace contract (methods, schemas, permissions, errors). */
    'virtualdevice.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Voltmeter.SetConfig — name / report_thr / range / xvoltage transform. */
    'voltmeter.setconfig': {
        params: {shellyID: string; id: number; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** Voltmeter.GetConfig. */
    'voltmeter.getconfig': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Voltmeter.GetStatus — {id, voltage, xvoltage, errors?}. */
    'voltmeter.getstatus': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Voltmeter.CheckExpression — evaluate JS xvoltage expression against inputs. */
    'voltmeter.checkexpression': {
        params: {shellyID: string; expr: string; inputs: Array<number | null>};
        result: Record<string, unknown>;
    };
    /** Return the voltmeter namespace contract (methods, schemas, permissions, errors). */
    'voltmeter.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Raw map keyed by internal id — kept for legacy callers. */
    'waitingroom.getpending': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Raw denied-devices map — kept for legacy callers. */
    'waitingroom.getdenied': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Lightweight waiting-room counters for badges and launch sync. */
    'waitingroom.getcounts': {
        params: {
            state?: 'open' | 'approved' | 'rejected' | 'expired';
            source?: 'legacy' | 'device_ingress';
            observedTransport?:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            securityModel?: 'certificate' | 'direct_token' | 'connector';
            riskLevel?: 'strong' | 'compatible' | 'legacy';
            limit?: number;
            offset?: number;
        };
        result: {pendingCount: number};
    };
    /** Canonical waiting-room list across legacy and device-ingress rows. */
    'waitingroom.list': {
        params: {
            state?: 'open' | 'approved' | 'rejected' | 'expired';
            source?: 'legacy' | 'device_ingress';
            observedTransport?:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            securityModel?: 'certificate' | 'direct_token' | 'connector';
            riskLevel?: 'strong' | 'compatible' | 'legacy';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Get one canonical waiting-room entry by entryId. */
    'waitingroom.get': {
        params: {entryId: string};
        result: Record<string, unknown>;
    };
    /** Probe one live waiting-room device when a socket exists. */
    'waitingroom.probe': {
        params: {entryId: string};
        result: Record<string, unknown>;
    };
    /** Denied devices in the standard list envelope. */
    'waitingroom.listdenied': {
        params: {
            state?: 'open' | 'approved' | 'rejected' | 'expired';
            source?: 'legacy' | 'device_ingress';
            observedTransport?:
                | 'wss'
                | 'ws'
                | 'modbus_tcp'
                | 'ble'
                | 'cloud_api'
                | 'connector_internal';
            securityModel?: 'certificate' | 'direct_token' | 'connector';
            riskLevel?: 'strong' | 'compatible' | 'legacy';
            limit?: number;
            offset?: number;
        };
        result: {
            items: Array<Record<string, unknown>>;
            total: number;
            limit: number;
            offset: number;
            has_more: boolean;
        };
    };
    /** Accept pending devices by numeric waiting-room id. */
    'waitingroom.acceptpendingbyid': {
        params: {ids: number[]; groupId?: number};
        result: {
            success: Array<number | string>;
            error: Array<number | string>;
            acceptedIds: number[];
            acceptedExternalIds: string[];
            pendingCount: number;
        };
    };
    /** Accept pending devices by Shelly external id. */
    'waitingroom.acceptpendingbyexternalid': {
        params: {externalIds: string[]; groupId?: number};
        result: {
            success: Array<number | string>;
            error: Array<number | string>;
            acceptedIds: number[];
            acceptedExternalIds: string[];
            pendingCount: number;
        };
    };
    /** Canonical approve by entryId. Legacy entries use shellyID; device-ingress entries use deviceIngress:<uuid>. */
    'waitingroom.approve': {
        params: {
            entryId: string;
            action?:
                | 'bind_existing_device'
                | 'create_new_device'
                | 'bind_connector';
            deviceId?: string;
            profileId?:
                | 'wall-display-local-ws'
                | 'shelly-pro-em-wss-token'
                | 'shelly-pro-em-wss-certificate'
                | 'modbus-tcp-connector';
            groupId?: number;
        };
        result: Record<string, unknown>;
    };
    /** Start a background bulk accept by external id. Returns a jobId; poll AcceptBulkStatus for progress. */
    'waitingroom.acceptbulkstart': {
        params: {externalIds: string[]; groupId?: number};
        result: {jobId: string; total: number};
    };
    /** Start a background bulk accept of every open pending device for the org — no id list needed. Returns a jobId; poll AcceptBulkStatus. */
    'waitingroom.acceptallstart': {
        params: {groupId?: number};
        result: {jobId: string; total: number};
    };
    /** Progress of a bulk accept job: total, processed, accepted, failed ids, state. */
    'waitingroom.acceptbulkstatus': {
        params: {jobId: string};
        result: {
            jobId: string;
            total: number;
            processed: number;
            accepted: number;
            failed: string[];
            state: 'running' | 'done' | 'canceled' | 'error';
            startedAt: number;
            updatedAt: number;
        };
    };
    /** Request cancellation of a running bulk accept job; processed chunks stay accepted. */
    'waitingroom.acceptbulkcancel': {
        params: {jobId: string};
        result: {canceled: boolean};
    };
    /** Reject pending devices by numeric id (polite close — reversible). */
    'waitingroom.rejectpending': {
        params: {shellyIDs: string[]};
        result: Record<string, unknown>;
    };
    /** Canonical reject by entryId. Legacy entries use shellyID; device-ingress entries use deviceIngress:<uuid>. */
    'waitingroom.reject': {
        params: {
            entryId: string;
            reasonCode?:
                | 'token_expired'
                | 'pending_token_not_finalized'
                | 'certificate_expired'
                | 'certificate_not_yet_valid'
                | 'wrong_transport'
                | 'legacy_ws_disabled'
                | 'connection_cap_reached'
                | 'rate_limit_exceeded'
                | 'identity_disabled'
                | 'device_not_bound'
                | 'token_revoked'
                | 'certificate_revoked'
                | 'certificate_cross_org'
                | 'device_id_mismatch'
                | 'blocked_ip'
                | 'operator_quarantine'
                | 'credential_replay_suspected'
                | 'unknown_security_model'
                | 'malformed_handshake';
            detail?: string;
        };
        result: Record<string, unknown>;
    };
    /** Destructive: rewrite device WS config + reboot. Recovery requires factory-reset on the device. Reserved for adversarial / hammering cases. */
    'waitingroom.quarantine': {
        params: {shellyIDs: string[]};
        result: Record<string, unknown>;
    };
    /** Return the waitingroom namespace contract (methods, schemas, permissions, errors). */
    'waitingroom.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Returns the listener status (currently empty). */
    'web.getstatus': {
        params: Record<string, unknown>;
        result: Record<string, unknown>;
    };
    /** Returns the persisted HTTP/HTTPS listener configuration. */
    'web.getconfig': {
        params: Record<string, unknown>;
        result: {
            host?: string;
            port?: number;
            port_ssl?: number;
            https_crt?: string;
            https_key?: string;
            jwt_token?: string;
        };
    };
    /** Patch HTTP/HTTPS listener configuration. Partial: send only the keys you want to change. After merging with existing config, the result must satisfy: (1) at least one of port / port_ssl > -1, (2) https_crt + https_key non-empty when port_ssl > -1, (3) jwt_token non-empty. */
    'web.setconfig': {
        params: {
            config: {
                host?: string;
                port?: number;
                port_ssl?: number;
                https_crt?: string;
                https_key?: string;
                jwt_token?: string;
            };
        };
        result: Record<string, unknown>;
    };
    /** Return the web namespace contract (methods, schemas, permissions, errors). */
    'web.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Webhook.List — all webhooks on the device. */
    'webhook.list': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Webhook.ListSupported — event types this fw supports (deprecated as of fw 2.0; use ListAllSupported). */
    'webhook.listsupported': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Webhook.ListAllSupported — paginated event types (fw 2.0+). */
    'webhook.listallsupported': {
        params: {shellyID: string; offset?: number};
        result: Record<string, unknown>;
    };
    /** Webhook.Create — register an outbound HTTP hook. Limits: 20/device (10 battery), 5 urls/hook, 300 chars/url. */
    'webhook.create': {
        params: {
            shellyID: string;
            cid: number;
            event: string;
            urls: string[];
            enable?: boolean;
            name?: string;
            ssl_ca?: string | null;
            active_between?: string[];
            condition?: string;
            repeat_period?: number;
        };
        result: Record<string, unknown>;
    };
    /** Webhook.Update — patch an existing hook by id. */
    'webhook.update': {
        params: {
            shellyID: string;
            id: number;
            cid?: number;
            event?: string;
            urls?: string[];
            enable?: boolean;
            name?: string;
            ssl_ca?: string | null;
            active_between?: string[];
            condition?: string;
            repeat_period?: number;
        };
        result: Record<string, unknown>;
    };
    /** Webhook.Delete — remove one hook by id. */
    'webhook.delete': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Webhook.DeleteAll — wipe all hooks. */
    'webhook.deleteall': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the webhook namespace contract (methods, schemas, permissions, errors). */
    'webhook.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Wifi.SetConfig — full WiFi config (sta / sta1 backup / ap rescue / roam). Device validates per device class. */
    'wifi.setconfig': {
        params: {
            shellyID: string;
            config: {
                sta?: {
                    ssid?: string | null;
                    pass?: string | null;
                    enable?: boolean;
                    is_open?: boolean;
                    ipv4mode?: string;
                    ip?: string | null;
                    netmask?: string | null;
                    gw?: string | null;
                    nameserver?: string | null;
                };
                sta1?: {
                    ssid?: string | null;
                    pass?: string | null;
                    enable?: boolean;
                    is_open?: boolean;
                    ipv4mode?: string;
                    ip?: string | null;
                    netmask?: string | null;
                    gw?: string | null;
                    nameserver?: string | null;
                };
                ap?: {
                    ssid?: string;
                    pass?: string | null;
                    is_open?: boolean;
                    enable?: boolean;
                    range_extender?: {enable: boolean};
                };
                roam?: {rssi_thr?: number; interval?: number};
            };
        };
        result: {restart_required: boolean};
    };
    /** Wifi.GetConfig — current WiFi configuration. */
    'wifi.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Wifi.GetStatus — link state, ssid, ip, rssi. */
    'wifi.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Wifi.Scan — list visible nearby APs. */
    'wifi.scan': {params: {shellyID: string}; result: Record<string, unknown>};
    /** Wifi.ListAPClients — DHCP leases when AP rescue mode is active. */
    'wifi.listapclients': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Wifi.SavedNetworks.List — saved AP credentials with current flag. */
    'wifi.savednetworks.list': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Wifi.SavedNetworks.Delete — remove a saved AP by id (active network is rejected). */
    'wifi.savednetworks.delete': {
        params: {shellyID: string; id: number};
        result: Record<string, unknown>;
    };
    /** Wifi.SpeedTest — measure download bandwidth (returns size, duration, bandwidth). */
    'wifi.speedtest': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the wifi namespace contract (methods, schemas, permissions, errors). */
    'wifi.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** WS.SetConfig — device outbound WebSocket client config. */
    'ws.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: {restart_required: boolean};
    };
    /** WS.GetConfig — current outbound-WS configuration. */
    'ws.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** WS.GetStatus — outbound-WS connectivity state. */
    'ws.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the ws namespace contract (methods, schemas, permissions, errors). */
    'ws.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** XMOD.ApplyProductJWS — apply a signed product config token (-107 if final flag prevents reapply). */
    'xmod.applyproductjws': {
        params: {shellyID: string; jws: string};
        result: null;
    };
    /** XMOD.GetProductJWS — return the applied JWS token (-114 if none applied). */
    'xmod.getproductjws': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** XMOD.GetInfo — parsed JWT with product config (aud, iat, jti, v, p, n, m, url, f, xmod). */
    'xmod.getinfo': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Return the xmod namespace contract (methods, schemas, permissions, errors). */
    'xmod.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
    /** Zigbee bridge status. */
    'zigbee.getstatus': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Zigbee bridge config. */
    'zigbee.getconfig': {
        params: {shellyID: string};
        result: Record<string, unknown>;
    };
    /** Zigbee bridge SetConfig — opaque pass-through. */
    'zigbee.setconfig': {
        params: {shellyID: string; config: Record<string, unknown>};
        result: Record<string, unknown>;
    };
    /** Return the zigbee namespace contract (methods, schemas, permissions, errors). */
    'zigbee.describe': {
        params: Record<string, unknown>;
        result: {
            namespace: string;
            methods: Record<string, unknown>;
            limits?: Record<string, unknown>;
            tags?: string[];
            errors?: unknown[];
        };
    };
}

export type HostMethod = keyof HostContract;

export type HostParams<M extends HostMethod> = HostContract[M]['params'];

export type HostResult<M extends HostMethod> = HostContract[M]['result'];

export interface HostNamespaceGuide {
    kind: 'device' | 'fleet-manager';
    purpose: string;
    useInstead?: string;
}

export const HOST_NAMESPACE_GUIDE: Record<string, HostNamespaceGuide> = {
    device: {
        kind: 'fleet-manager',
        purpose:
            'Individual Shelly devices: inventory, status, config, direct RPC.',
        useInstead:
            'For a single capability channel use `entity`; for composites use `virtualdevice`.'
    },
    entity: {
        kind: 'fleet-manager',
        purpose:
            'Capability channels of a device (switch/light/sensor) for per-channel actions.',
        useInstead: 'For whole-device operations use `device`.'
    },
    virtualdevice: {
        kind: 'fleet-manager',
        purpose:
            'Composite devices built from signals of one or more real devices.'
    },
    group: {
        kind: 'fleet-manager',
        purpose:
            'Logical grouping of devices for bulk actions and access control.',
        useInstead:
            'For physical places (site/building/floor/room) use `location`; for freeform labels use `tag`.'
    },
    location: {
        kind: 'fleet-manager',
        purpose:
            'Physical hierarchy (site > building > floor > room) with geo and assignments.',
        useInstead:
            'For logical/access grouping use `group`; for freeform labels use `tag`.'
    },
    tag: {
        kind: 'fleet-manager',
        purpose: 'Freeform key/value labels on devices and other subjects.',
        useInstead:
            'For structured grouping use `group`; for physical places use `location`.'
    },
    fleet: {
        kind: 'fleet-manager',
        purpose: 'Fleet-wide metrics and operations across a scope.'
    },
    fleetMap: {
        kind: 'fleet-manager',
        purpose: 'Map-dashboard snapshots: energy/signal/alerts per location.'
    },
    fleetSummary: {
        kind: 'fleet-manager',
        purpose: 'Org-wide live load and energy totals for summary tiles.'
    },
    dashboard: {
        kind: 'fleet-manager',
        purpose: 'User dashboards: cards, items, layout, ordering.'
    },
    alert: {
        kind: 'fleet-manager',
        purpose: 'Alert rules and alert instances (ack/silence/resolve).'
    },
    notification: {
        kind: 'fleet-manager',
        purpose:
            'Notification inbox, destinations/channels, and delivery history.'
    },
    notification_policy: {
        kind: 'fleet-manager',
        purpose: 'Routing and suppression policies for notifications.'
    },
    channel: {
        kind: 'fleet-manager',
        purpose: 'Outbound endpoints (webhook/email/slack/teams/telegram).'
    },
    report: {
        kind: 'fleet-manager',
        purpose: 'Generated reports (energy, dumps) and downloads.'
    },
    energy: {
        kind: 'fleet-manager',
        purpose: 'Energy queries, summaries, and classification.'
    },
    analytics: {
        kind: 'fleet-manager',
        purpose: 'Ad-hoc analytics such as brush-to-compare attribution.'
    },
    waitingroom: {
        kind: 'fleet-manager',
        purpose: 'Devices awaiting admission: approve/deny/quarantine.',
        useInstead: 'To actively find devices on the LAN use `discovery`.'
    },
    discovery: {
        kind: 'fleet-manager',
        purpose: 'Active onboarding: scan the LAN and admit a device.',
        useInstead: 'For devices that connected on their own use `waitingroom`.'
    },
    firmware: {
        kind: 'fleet-manager',
        purpose: 'Firmware update jobs and auto-update modes.'
    },
    backup: {
        kind: 'fleet-manager',
        purpose: 'Device config backup and restore jobs.'
    },
    user: {
        kind: 'fleet-manager',
        purpose: 'User accounts, profiles, and personal access tokens.',
        useInstead:
            'For groups of users use `user_group`; for roles use `persona`.'
    },
    user_group: {
        kind: 'fleet-manager',
        purpose: 'Groups of users (people, not devices).',
        useInstead: 'For grouping devices use `group`.'
    },
    persona: {
        kind: 'fleet-manager',
        purpose: 'Permission roles (personas).'
    },
    permission: {
        kind: 'fleet-manager',
        purpose: 'Role listings and permission grants.'
    },
    assignment: {
        kind: 'fleet-manager',
        purpose: 'Assign subjects to personas.'
    },
    organization: {
        kind: 'fleet-manager',
        purpose: 'Organization (tenant) profile and metadata.'
    }
} as const;
