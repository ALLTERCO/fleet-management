import {type Ref, ref, watch} from 'vue';
import * as ws from '@/tools/websocket';

interface MetricValues {
    total?: number;
    avg?: number;
    values?: {deviceId: number; value: number}[];
}

/**
 * Live aggregated metrics for a group, from the backend `fleet.GetMetrics`
 * (which reads FULL device status server-side) — the reliable source.
 *
 * The device store only holds the slim `device.list` payload (heavy status is
 * stripped), so summing `dev.status` client-side misses most devices' power.
 * The energy dashboards already use this RPC; the group preview should too.
 */
export function useGroupLiveMetrics(groupId: Ref<number | null | undefined>) {
    const totalPower = ref<number | null>(null); // live W across the group
    const avgTemperature = ref<number | null>(null);
    const avgHumidity = ref<number | null>(null);
    const loading = ref(false);

    function metricTotal(m: MetricValues | undefined): number | null {
        if (!m) return null;
        if (typeof m.total === 'number') return m.total;
        if (m.values) return m.values.reduce((a, v) => a + v.value, 0);
        return null;
    }

    async function refresh(): Promise<void> {
        const gid = groupId.value;
        if (gid == null) {
            totalPower.value = null;
            avgTemperature.value = null;
            avgHumidity.value = null;
            return;
        }
        loading.value = true;
        try {
            const res = await ws.sendRPC<{
                metrics: Record<string, MetricValues>;
            }>('FLEET_MANAGER', 'fleet.GetMetrics', {
                scope: {groupId: gid}
            });
            const m = res?.metrics ?? {};
            totalPower.value = metricTotal(m.power);
            avgTemperature.value =
                typeof m.temperature?.avg === 'number'
                    ? m.temperature.avg
                    : null;
            avgHumidity.value =
                typeof m.humidity?.avg === 'number' ? m.humidity.avg : null;
        } catch {
            totalPower.value = null;
            avgTemperature.value = null;
            avgHumidity.value = null;
        } finally {
            loading.value = false;
        }
    }

    watch(groupId, refresh, {immediate: true});
    return {totalPower, avgTemperature, avgHumidity, loading, refresh};
}
