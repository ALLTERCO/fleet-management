import {alerts} from './alerts';
import {api} from './api';
import {audit, authzAudit} from './audit';
import {backups} from './backups';
import {bluetoothDevices} from './bluetoothDevices';
import {channels} from './channels';
import {configurations} from './configurations';
import {auth} from './currentUser';
import {dashboards} from './dashboards';
import {devices} from './devices';
import {metrics} from './energy';
import {entities} from './entities';
import {firmware} from './firmware';
import {groups} from './groups';
import {locations} from './locations';
import {navigation} from './navigation';
import {notificationPolicies, notifications} from './notifications';
import {permissions} from './permissions';
import {relationships} from './relationships';
import {energyReports, reports} from './reports';
import {settings} from './settings';
import {tags} from './tags';
import {userGroups, users} from './users';
import {virtualDevices} from './virtualDevices';
import {waitingRoom} from './waiting-room';

export {useAlerts, useSupervisedAlerts} from './alerts';
export {api, call, listAll, toRpcMethod} from './api';
export {signOut, useCurrentUser} from './currentUser';
// Route via the local template-host wrapper, not the raw shell impl, so
// templates that follow @template-contract get a `Readonly<Ref<…>>` and
// can read `customization.value.title` etc. The raw shell impl returns
// a plain frozen object — bypassing it crashes every template's first
// render with "Cannot read properties of undefined (reading 'title')".
export {useCustomization} from './customization';
export {
    useDeviceActions,
    useDeviceCapabilities,
    useDevices,
    useDevicesForGroup
} from './devices';
export {createHostDomain} from './domain';
export {
    type LiveMetric,
    type LiveMetricOptions,
    type MetricHistory,
    type MetricHistoryOptions,
    useLiveMetric,
    useMetric,
    useMetricHistory
} from './energy';
export {useGroup, useGroupActions, useGroups} from './groups';
export {useLocations} from './locations';
export {useNavLabels, useNavOrder} from './navigation';
export {usePermissions} from './permissions';
export {
    useCustomNavItems,
    useDashboardBlocks,
    useHiddenSections,
    useKpiOverrides,
    usePortalAlerts,
    usePortalCustomNavItems,
    usePortalDashboardBlocks,
    usePortalGroups,
    usePortalHiddenSections,
    usePortalKpis,
    usePortalNavLabels,
    usePortalNavOrder,
    usePortalVocabulary,
    useVocabulary
} from './portalProject';
export {useTemplateRpc} from './rpc';
export {useThemeTokens} from './theme';
export type {
    HostContract,
    HostMethod,
    HostNamespaceGuide,
    HostParams,
    HostResult
} from './typed';
export {callMethod, HOST_NAMESPACE_GUIDE} from './typed';
export {
    HOST_ESCAPE_HATCHES,
    HOST_METHOD_METADATA,
    type HostEscapeHatch,
    type HostMethodMetadata
} from './generated/method-metadata';
export type {
    HostAction,
    HostAsyncState,
    HostDevice,
    HostError,
    HostLoadState,
    HostPagedEnvelope,
    HostResource
} from './types';
export {
    alerts,
    audit,
    auth,
    authzAudit,
    backups,
    bluetoothDevices,
    channels,
    configurations,
    dashboards,
    devices,
    energyReports,
    entities,
    firmware,
    groups,
    locations,
    metrics,
    navigation,
    notificationPolicies,
    notifications,
    permissions,
    relationships,
    reports,
    settings,
    tags,
    userGroups,
    users,
    virtualDevices,
    waitingRoom
};

export const host = {
    alerts,
    api,
    audit,
    authzAudit,
    auth,
    backups,
    bluetoothDevices,
    channels,
    configurations,
    dashboards,
    devices,
    energyReports,
    entities,
    firmware,
    groups,
    locations,
    metrics,
    navigation,
    notifications,
    notificationPolicies,
    permissions,
    relationships,
    reports,
    settings,
    tags,
    userGroups,
    users,
    virtualDevices,
    waitingRoom
};
