import type {PulseStat} from '@/components/dashboard/map/MapPulseStrip.vue';
import type {FleetPulse} from '@/composables/useFleetPulse';

/** A site counts as healthy only when its rolled-up device health is `on`. */
export function mapPulseStats(pulse: FleetPulse): PulseStat[] {
    return [
        {
            id: 'sites',
            label: 'healthy sites',
            value: pulse.sitesOnline,
            total: pulse.sitesTotal,
            leading: 'live-dot'
        },
        {
            id: 'devices',
            label: 'devices',
            value: pulse.devicesOnline,
            total: pulse.devicesTotal,
            leading: 'icon',
            icon: 'fa-circle',
            iconColor: 'on'
        },
        {
            id: 'load',
            label: 'kW',
            value: pulse.loadKW,
            decimals: 1,
            leading: 'icon',
            icon: 'fa-bolt',
            iconColor: 'primary'
        },
        {
            id: 'alerts',
            label: 'alerts',
            value: pulse.alertCount,
            leading: 'icon',
            icon: 'fa-triangle-exclamation',
            tone: pulse.alertCount > 0 ? 'alert' : 'default'
        }
    ];
}
