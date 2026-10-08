// @template-contract — the whole type surface a template may import.
// Every name is re-exported from where Fleet Manager already defines it, so a
// template compiles against the host's real shapes, one definition stays the
// only definition, and no template reaches into FM internals to get a type.

export type {
    CustomNavItem,
    DashboardBlock,
    KpiSource,
    KpiWidget,
    ThemeTokens,
    Vocabulary
} from '../shell/customizationSchema';
export type {
    HostAlert,
    HostLocation
} from '../shell/template-host/core/data-contract';
export type {
    FleetPermissionOperation as HostPermissionOperation,
    // The shape `usePermissions()` resolves to: the host names it Fleet, a
    // template reads it as Host.
    FleetPermissions as HostPermissions,
    FleetUser as HostUser,
    HostDevice,
    HostDeviceLogo,
    HostError,
    HostLoadState
} from '../shell/template-host/core/types';
export type {HostGroup} from '../shell/template-host/groups';
export type {HostAction, HostResource} from '../shell/template-host/types';
