# Host SDK Index

Templates and alternate UIs use @host domains before raw RPC.

Entrypoint: `frontend/src/shell/template-host/index.ts`

Modules: 36

Generated contract methods: 1215

| Module | Path | Exports | Namespaces (kinds) | Contract | RPC bridge |
|---|---|---|---|---|---|
| `alerts` | `frontend/src/shell/template-host/alerts.ts` | alerts, useAlerts, useSupervisedAlerts | alert (fleet-manager) | no | yes |
| `api` | `frontend/src/shell/template-host/api.ts` | HostApiMethod, HostApiNode, api, call, listAll, toRpcMethod | none | no | yes |
| `audit` | `frontend/src/shell/template-host/audit.ts` | audit, authzAudit | audit, authz_audit (fleet-manager) | no | no |
| `auth` | `frontend/src/shell/template-host/auth.ts` | auth, useCurrentUser | none | no | no |
| `backups` | `frontend/src/shell/template-host/backups.ts` | backups | backup (fleet-manager) | no | no |
| `bluetoothDevices` | `frontend/src/shell/template-host/bluetoothDevices.ts` | BTHomeGateway, BluetoothCandidate, BluetoothDevice, BluetoothGetParams, BluetoothGetResult, BluetoothListParams, BluetoothListResult, BluetoothTransport, BluetoothTransportListParams, BluetoothTransportListResult, BluetoothTransportSetPrimaryParams, BluetoothTransportSetPrimaryResult, BluetoothUpdateParams, BluetoothUpdateResult, bluetoothDevices | bthome, virtualdevice (device, fleet-manager) | yes | yes |
| `channels` | `frontend/src/shell/template-host/channels.ts` | channels | channel (fleet-manager) | no | no |
| `configurations` | `frontend/src/shell/template-host/configurations.ts` | configurations | ble, cloud, device, eth, knx, modbus, mqtt, script, sys, web, wifi (device, fleet-manager) | no | no |
| `currentUser` | `frontend/src/shell/template-host/currentUser.ts` | auth, signOut, useCurrentUser | none | no | no |
| `customization` | `frontend/src/shell/template-host/customization.ts` | useCustomization, useCustomizationField | none | no | no |
| `dashboards` | `frontend/src/shell/template-host/dashboards.ts` | dashboards | dashboard (fleet-manager) | no | no |
| `deviceCapabilities` | `frontend/src/shell/template-host/deviceCapabilities.ts` | deriveDomainCapabilities | none | no | no |
| `deviceMapper` | `frontend/src/shell/template-host/deviceMapper.ts` | toHostDevice | none | no | no |
| `devices` | `frontend/src/shell/template-host/devices.ts` | devices, useDeviceActions, useDeviceCapabilities, useDevices, useDevicesForGroup | device (fleet-manager) | yes | yes |
| `domain` | `frontend/src/shell/template-host/domain.ts` | HostDomainApi, TypedHostDomainApi, createHostDomain | none | yes | no |
| `energy` | `frontend/src/shell/template-host/energy.ts` | LiveMetric, LiveMetricOptions, MetricHistory, MetricHistoryOptions, UseMetricHistoryOptions, UseMetricLiveOptions, metrics, useLiveMetric, useMetric, useMetricHistory | energy (fleet-manager) | no | yes |
| `entities` | `frontend/src/shell/template-host/entities.ts` | entities | entity (fleet-manager) | no | no |
| `firmware` | `frontend/src/shell/template-host/firmware.ts` | firmware | firmware (fleet-manager) | no | no |
| `groups` | `frontend/src/shell/template-host/groups.ts` | groups, useGroup, useGroupActions, useGroups | group (fleet-manager) | no | yes |
| `index` | `frontend/src/shell/template-host/index.ts` | HOST_ESCAPE_HATCHES, HOST_METHOD_METADATA, HOST_NAMESPACE_GUIDE, alerts, api, audit, auth, authzAudit, backups, bluetoothDevices, call, callMethod, channels, configurations, createHostDomain, dashboards, devices, energyReports, entities, firmware, groups, host, listAll, locations, metrics, navigation, notificationPolicies, notifications, permissions, relationships, reports, settings, signOut, tags, toRpcMethod, useAlerts, useCurrentUser, useCustomNavItems, useCustomization, useDashboardBlocks, useDeviceActions, useDeviceCapabilities, useDevices, useDevicesForGroup, useGroup, useGroupActions, useGroups, useHiddenSections, useKpiOverrides, useLiveMetric, useLocations, useMetric, useMetricHistory, useNavLabels, useNavOrder, usePermissions, usePortalAlerts, usePortalCustomNavItems, usePortalDashboardBlocks, usePortalGroups, usePortalHiddenSections, usePortalKpis, usePortalNavLabels, usePortalNavOrder, usePortalVocabulary, useSupervisedAlerts, useTemplateRpc, useThemeTokens, useVocabulary, userGroups, users, virtualDevices, waitingRoom | none | yes | yes |
| `locations` | `frontend/src/shell/template-host/locations.ts` | LocationCreateInput, LocationListParams, LocationUpdateInput, locations, useLocations | location (fleet-manager) | no | yes |
| `navigation` | `frontend/src/shell/template-host/navigation.ts` | navigation, useNavLabels, useNavOrder | none | no | no |
| `notifications` | `frontend/src/shell/template-host/notifications.ts` | notificationPolicies, notifications | notification, notification_policy (fleet-manager) | no | no |
| `permissions` | `frontend/src/shell/template-host/permissions.ts` | permissions, usePermissions | none | no | no |
| `portalProject` | `frontend/src/shell/template-host/portalProject.ts` | useCustomNavItems, useDashboardBlocks, useHiddenSections, useKpiOverrides, usePortalAlerts, usePortalCustomNavItems, usePortalDashboardBlocks, usePortalGroups, usePortalHiddenSections, usePortalKpis, usePortalNavLabels, usePortalNavOrder, usePortalVocabulary, useVocabulary | none | no | no |
| `relationships` | `frontend/src/shell/template-host/relationships.ts` | DeviceRelationshipsGetParams, DeviceRelationshipsGraph, DeviceRelationshipsQueryParams, DeviceRelationshipsQueryResult, relationships | device (fleet-manager) | yes | yes |
| `reports` | `frontend/src/shell/template-host/reports.ts` | energyReports, reports | energy, report (fleet-manager) | no | no |
| `rpc` | `frontend/src/shell/template-host/rpc.ts` | hostListAll, hostRpc, useTemplateRpc | none | no | yes |
| `settings` | `frontend/src/shell/template-host/settings.ts` | settings | branding, domain_policy, identity, login_text, message_text, privacy (fleet-manager) | no | no |
| `tags` | `frontend/src/shell/template-host/tags.ts` | tags | tag (fleet-manager) | no | no |
| `theme` | `frontend/src/shell/template-host/theme.ts` | useThemeTokens | none | no | no |
| `typed` | `frontend/src/shell/template-host/typed.ts` | HOST_NAMESPACE_GUIDE, callMethod | none | yes | yes |
| `types` | `frontend/src/shell/template-host/types.ts` | DeviceCapabilities, DeviceDoorCapability, DeviceEnergyCapability, DeviceMotionCapability, DeviceRelayCapability, DeviceTemperatureCapability, HostAction, HostAsyncState, HostDevice, HostError, HostLoadState, HostPagedEnvelope, HostResource | none | no | no |
| `users` | `frontend/src/shell/template-host/users.ts` | userGroups, users | user, user_group (fleet-manager) | no | no |
| `virtualDevices` | `frontend/src/shell/template-host/virtualDevices.ts` | BindingDraftItem, CreateVirtualDeviceRequest, DraftPreviewResponse, ExtractionPreview, HistoryMode, ProfileSuggestCandidate, RoleVisual, SourceComponentCandidate, SourceComponentRef, ValidationResult, VirtualDeviceDto, VirtualDeviceKind, VirtualDeviceMethod, VirtualDeviceParams, VirtualDeviceProfile, VirtualDeviceResult, VirtualDeviceVisual, virtualDevices | virtualdevice (fleet-manager) | yes | yes |
| `waiting-room` | `frontend/src/shell/template-host/waiting-room.ts` | waitingRoom | waitingroom (fleet-manager) | no | no |