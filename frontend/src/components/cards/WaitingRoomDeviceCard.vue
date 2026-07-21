<template>
    <DeviceTriageCard
        :title="info.title"
        :rows="rows"
        :image-key="imageRef.key"
        :image-local-fallback="imageRef.hasLocalFallback"
        :gen="info.gen"
        :sleeping="info.sleeping"
        :selected="selected"
        interactive
        @click="$emit('click')"
    >
        <template #footer>
            <Button
                v-if="showReject"
                type="red"
                size="xs"
                :disabled="!canReject || accepting"
                :title="!canReject ? noPermissionTitle : 'Reject device'"
                @click.stop="$emit('reject')"
            >
                Reject
            </Button>
            <Button
                type="green"
                size="xs"
                :loading="isAccepting"
                :disabled="!canAccept || accepting"
                :title="!canAccept ? noPermissionTitle : 'Accept device'"
                @click.stop="$emit('accept')"
            >
                Accept
            </Button>
        </template>
    </DeviceTriageCard>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount} from 'vue';
import DeviceTriageCard, {
    type TriageRow
} from '@/components/cards/DeviceTriageCard.vue';
import Button from '@/components/core/Button.vue';
import {useNowTicker} from '@/composables/useNowTicker';
import type {PendingDevice} from '@/composables/useWaitingRoomList';
import {formatMac, rssiTier} from '@/helpers/device';
import {formatRelative, formatTime} from '@/helpers/format';

const noPermissionTitle = 'You do not have permission to perform this action';

const props = defineProps<{
    device: PendingDevice;
    selected?: boolean;
    canAccept: boolean;
    canReject: boolean;
    accepting?: boolean;
    isAccepting?: boolean;
    showReject: boolean;
}>();

defineEmits<{click: []; accept: []; reject: []}>();

// XT1: CDN key is service type (jwt.xt1.svc0.type), not model SKU.
const imageRef = computed(() => {
    const sys = props.device.status?.sys as
        | {
              app?: string;
              device?: {model?: string; xt1SvcType?: string};
          }
        | undefined;
    const xt1SvcType = sys?.device?.xt1SvcType?.trim();
    if (xt1SvcType) return {key: xt1SvcType, hasLocalFallback: false};
    if (sys?.app === 'XT1') return {key: '', hasLocalFallback: false};
    // The backend enriches waiting-room records with sys.device.model.
    return {
        key: sys?.device?.model?.trim() ?? '',
        hasLocalFallback: true
    };
});

const info = computed(() => {
    const status = props.device.status ?? {};
    const wifi = status.wifi as
        | {sta_ip?: string; ssid?: string; rssi?: number}
        | undefined;
    const eth = status.eth as {ip?: string} | undefined;
    const sys = status.sys as
        | {
              mac?: string;
              ver?: string;
              gen?: number;
              app?: string;
              wakeup_period?: number;
              device?: {
                  name?: string;
                  profile?: string;
                  model?: string;
                  xt1SvcType?: string;
              };
          }
        | undefined;

    const deviceName = sys?.device?.name?.trim() ?? '';
    const appName = sys?.app?.trim() ?? '';
    const sku = sys?.device?.model?.trim() ?? '';

    return {
        title: deviceName || appName || sku || props.device.shellyID,
        gen: sys?.gen,
        ip: eth?.ip || wifi?.sta_ip || '',
        mac: formatMac(sys?.mac ?? ''),
        ssid: wifi?.ssid || '',
        rssi: typeof wifi?.rssi === 'number' ? wifi.rssi : null,
        firmware: sys?.ver ?? '',
        // Battery devices report a wake interval — flag them so operators know
        // the card won't refresh in real time.
        sleeping: (sys?.wakeup_period ?? 0) > 0
    };
});

// Shared 1Hz ticker — one interval app-wide, not per-card.
const {now, release} = useNowTicker();
onBeforeUnmount(release);

const rows = computed<TriageRow[]>(() => {
    const list: TriageRow[] = [
        {label: 'IP', value: info.value.ip || '—'},
        {label: 'MAC', value: info.value.mac || '—'}
    ];
    if (info.value.ssid) list.push({label: 'SSID', value: info.value.ssid});
    if (info.value.rssi != null) {
        list.push({
            label: 'Signal',
            value: `${info.value.rssi} dBm`,
            tone: rssiTier(info.value.rssi)
        });
    }
    list.push({label: 'Firmware', value: info.value.firmware || '—'});
    const t = props.device.touchedAt;
    list.push({
        label: 'Seen',
        value: formatRelative(t, now.value),
        title: formatTime(t)
    });
    return list;
});
</script>
