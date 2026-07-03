<template>
    <div class="cfg-panel">
        <form v-if="config" @submit.prevent autocomplete="off">
            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Mode</strong>
                </div>
                <Dropdown
                    :default="modeLabel(local.mode)"
                    :options="MODE_LABELS"
                    @selected="(label: string) => {
                        local.mode = labelToMode(label);
                        markDirty();
                    }"
                />
            </div>

            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Baud rate</strong>
                </div>
                <input
                    v-model.number="local.baud"
                    type="number"
                    min="300"
                    step="1"
                    class="cfg-panel__input"
                    @input="markDirty"
                />
            </div>

            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Frame format</strong>
                </div>
                <input
                    v-model.trim="local.format"
                    type="text"
                    maxlength="3"
                    pattern="^[578][NEOneo][12]$"
                    class="cfg-panel__input"
                    @input="markDirty"
                />
            </div>

            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Half-duplex</strong>
                </div>
                <Checkbox v-model="local.hd" @update:model-value="markDirty" />
            </div>

            <div class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>Drive-enable active-low</strong>
                </div>
                <Checkbox v-model="local.de_al" @update:model-value="markDirty" />
            </div>

            <div v-if="local.mode === 'mb_server'" class="cfg-panel__row">
                <div class="cfg-panel__row-label">
                    <strong>RTU server address</strong>
                </div>
                <input
                    v-model.number="local.mb_server_addr"
                    type="number"
                    min="1"
                    max="247"
                    class="cfg-panel__input"
                    @input="markDirty"
                />
            </div>

            <div v-if="dirty" class="cfg-panel__footer">
                <Button type="blue" size="sm" :loading="saving" @click="save">
                    Save
                </Button>
            </div>
        </form>

        <div v-else class="cfg-panel__error">
            <p>Serial configuration not available on this device.</p>
            <Button type="blue-hollow" size="sm" @click="reload">Retry</Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {useDeviceConfigPanel} from '@/composables/useDeviceConfigPanel';
import Button from './Button.vue';
import Checkbox from './Checkbox.vue';
import Dropdown from './Dropdown.vue';

type SerialMode = 'disabled' | 'jsuart' | 'mb_server' | 'mb_client';

interface SerialLine {
    baud: number;
    format: string;
    hd: boolean;
    de_al: boolean;
}

interface SerialConfigRead {
    mode?: SerialMode;
    serial?: Partial<SerialLine>;
    mb_server?: {addr?: number};
}

interface SerialConfigUpdate {
    mode: SerialMode;
    serial: SerialLine;
    mb_server: {addr: number};
}

interface LocalForm {
    mode: SerialMode;
    baud: number;
    format: string;
    hd: boolean;
    de_al: boolean;
    mb_server_addr: number;
}

const MODE_TO_LABEL: Record<SerialMode, string> = {
    disabled: 'Disabled',
    jsuart: 'Scripts (UART)',
    mb_server: 'Modbus RTU server',
    mb_client: 'Modbus RTU client'
};
const MODE_LABELS = Object.values(MODE_TO_LABEL);
const LABEL_TO_MODE = Object.fromEntries(
    Object.entries(MODE_TO_LABEL).map(([k, v]) => [v, k as SerialMode])
) as Record<string, SerialMode>;

function modeLabel(mode: SerialMode): string {
    return MODE_TO_LABEL[mode] ?? mode;
}
function labelToMode(label: string): SerialMode {
    return LABEL_TO_MODE[label] ?? 'disabled';
}

const props = defineProps<{shellyID: string}>();

const {config, local, dirty, saving, markDirty, save, reload} =
    useDeviceConfigPanel<SerialConfigRead, LocalForm>({
        shellyID: () => props.shellyID,
        settingsKey: 'serial:0',
        method: 'Serial.SetConfig',
        extraParams: () => ({id: 0}),
        initialLocal: {
            mode: 'disabled',
            baud: 115200,
            format: '8N1',
            hd: false,
            de_al: false,
            mb_server_addr: 1
        },
        mapToLocal: (c) => ({
            mode: c.mode ?? 'disabled',
            baud: c.serial?.baud ?? 115200,
            format: c.serial?.format ?? '8N1',
            hd: c.serial?.hd ?? false,
            de_al: c.serial?.de_al ?? false,
            mb_server_addr: c.mb_server?.addr ?? 1
        }),
        mapToUpdate: (l): SerialConfigUpdate => ({
            mode: l.mode,
            serial: {
                baud: l.baud,
                format: l.format,
                hd: l.hd,
                de_al: l.de_al
            },
            mb_server: {addr: l.mb_server_addr}
        }),
        successToast: 'Serial configuration saved'
    });
</script>
