<template>
    <div class="cfg-panel">
        <form
            v-if="config"
            class="cfg-panel__form"
            @submit.prevent
            autocomplete="off"
        >
            <section class="cfg-panel__section">
                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Destination address</strong>
                        <span>Where the device sends outbound UDP RPC, as host:port. Leave empty to disable.</span>
                    </div>
                    <input
                        v-model.trim="local.dstAddr"
                        type="text"
                        class="cfg-panel__input"
                        aria-label="UDP RPC destination address"
                        placeholder="192.168.1.10:9999"
                        @input="markDirty"
                    />
                </div>

                <div class="cfg-panel__row">
                    <div class="cfg-panel__row-label">
                        <strong>Listen port</strong>
                        <span>Inbound UDP RPC port. Leave empty to disable. Changing it needs a restart.</span>
                    </div>
                    <input
                        v-model.trim="local.listenPort"
                        type="text"
                        inputmode="numeric"
                        class="cfg-panel__input"
                        :class="{'cfg-panel__input--error': listenPortInvalid}"
                        aria-label="UDP RPC listen port"
                        :aria-invalid="listenPortInvalid ? 'true' : undefined"
                        placeholder="(disabled)"
                        @input="markDirty"
                    />
                </div>
                <p v-if="listenPortInvalid" class="cfg-panel__field-error">
                    Port must be a whole number from 1 to 65535
                </p>
            </section>

            <ConfigPanelFooter
                label="RPC over UDP"
                :dirty="dirty"
                :saving="saving"
                :restart-required="restartRequired"
                :rebooting="rebooting"
                :external-changed="externalConfigChanged"
                @save="saveValidated"
                @reboot="rebootDevice"
                @refresh="reload"
            />
        </form>

        <div v-else-if="refetching" class="cfg-panel__loading">
            Loading configuration…
        </div>
        <div v-else class="cfg-panel__error">
            <p>Failed to load UDP RPC configuration.</p>
            <Button type="blue-hollow" size="sm" :loading="refetching" @click="refetch">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import {useToastStore} from '@/stores/toast';
import Button from './Button.vue';
import ConfigPanelFooter from './ConfigPanelFooter.vue';

interface RpcUdpConfig {
    dst_addr?: string | null;
    listen_port?: number | null;
}

interface SysConfigRead {
    rpc_udp?: RpcUdpConfig;
}

interface LocalForm {
    dstAddr: string;
    listenPort: string;
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();

const {
    config,
    local,
    dirty,
    saving,
    restartRequired,
    rebooting,
    externalConfigChanged,
    markDirty,
    save,
    rebootDevice,
    refetch,
    refetching,
    reload
} = useDeviceConfigPanel<SysConfigRead, LocalForm>({
        shellyID: () => props.shellyID,
        settingsKey: 'sys',
        method: 'Sys.SetConfig',
        // Shares the sys namespace with the System page but is its own
        // nav section — dirty flags belong here, not on System.
        sectionId: 'config:rpcudp',
        initialLocal: {dstAddr: '', listenPort: ''},
        mapToLocal: (c) => ({
            dstAddr: c.rpc_udp?.dst_addr ?? '',
            listenPort:
                c.rpc_udp?.listen_port == null
                    ? ''
                    : String(c.rpc_udp.listen_port)
        }),
        mapToUpdate: (l) => ({
            rpc_udp: {
                dst_addr: l.dstAddr || null,
                listen_port: l.listenPort ? Number(l.listenPort) : null
            }
        }),
        successToast: 'UDP RPC configuration saved'
    });

const listenPortInvalid = computed(() => {
    if (!local.listenPort) return false;
    const port = Number(local.listenPort);
    return !Number.isInteger(port) || port < 1 || port > 65535;
});

function saveValidated(): void {
    if (listenPortInvalid.value) {
        toast.error('Listen port must be a whole number from 1 to 65535');
        return;
    }
    void save();
}
</script>
