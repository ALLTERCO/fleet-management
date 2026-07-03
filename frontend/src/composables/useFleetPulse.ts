import type {AlertInstance} from '@api/alert';
import type {Location as ApiLocation} from '@api/location';
import {computed} from 'vue';
import type {LocationHealth} from '@/composables/useLocationStatus';
import {useLocationStatus} from '@/composables/useLocationStatus';
import {sumDevicePower} from '@/helpers/locationRollups';
import {useAlertsStore} from '@/stores/alerts';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';

export interface FleetPulse {
    sitesOnline: number;
    sitesTotal: number;
    devicesOnline: number;
    devicesTotal: number;
    alertCount: number;
    /** Live aggregated load in kW across every device reporting apower. */
    loadKW: number;
}

const SITE_KINDS = new Set(['site', 'building']);
const OPEN_ALERT_STATES = new Set(['active', 'acknowledged', 'cleared_unack']);

interface SiteTotals {
    online: number;
    total: number;
}

function isSiteLike(location: ApiLocation): boolean {
    return SITE_KINDS.has(location.kind);
}

function siteHealth(
    location: ApiLocation,
    health: Map<number, LocationHealth>
): LocationHealth | undefined {
    return health.get(location.id);
}

function countSiteTotals(
    locations: ApiLocation[],
    health: Map<number, LocationHealth>
): SiteTotals {
    let online = 0;
    let total = 0;
    for (const location of locations) {
        if (!isSiteLike(location)) continue;
        total++;
        if (siteHealth(location, health)?.status === 'on') online++;
    }
    return {online, total};
}

function countOpenAlerts(instances: AlertInstance[]): number {
    let count = 0;
    for (const instance of instances) {
        if (OPEN_ALERT_STATES.has(instance.state)) count++;
    }
    return count;
}

export const __testing = {
    isSiteLike,
    countSiteTotals,
    countOpenAlerts
};

export function useFleetPulse() {
    const locationsStore = useLocationsStore();
    const devicesStore = useDevicesStore();
    const alertsStore = useAlertsStore();
    const {health} = useLocationStatus();

    const pulse = computed<FleetPulse>(() => {
        const sites = countSiteTotals(
            Object.values(locationsStore.locations) as ApiLocation[],
            health.value
        );
        const deviceIds = Object.keys(devicesStore.devices);
        const watts = sumDevicePower(deviceIds, devicesStore.devices) ?? 0;
        return {
            sitesOnline: sites.online,
            sitesTotal: sites.total,
            devicesOnline: devicesStore.onlineCount,
            devicesTotal: deviceIds.length,
            alertCount: countOpenAlerts(Object.values(alertsStore.instances)),
            loadKW: watts / 1000
        };
    });

    return {pulse};
}
