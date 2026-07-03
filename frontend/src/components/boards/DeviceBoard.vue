<template>
    <EmDeviceOptionsModal
        v-if="device"
        :visible="showOptionsModal"
        :model-value="selectedEMDevices"
        :default-device="defaultEmDevice"
        @update:selected="handleOptionsSave"
        @close="showOptionsModal = false"
    />
    <DeviceWebGuiModal
        :visible="showWebGuiModal"
        :shelly-i-d="shellyID"
        @close="showWebGuiModal = false"
    />
    <VirtualDeviceDecorationModal
        v-if="device && decorationModalVisible"
        :visible="decorationModalVisible"
        :device="device"
        @close="decorationModalVisible = false"
    />
    <AssetPickerModal
        v-if="physicalImagePickerVisible"
        :visible="physicalImagePickerVisible"
        :initial-selected-asset-id="physicalAssetId"
        :initial-selected-icon="physicalIcon"
        :show-accent="false"
        default-context="device"
        @close="physicalImagePickerVisible = false"
        @select-asset="onPhysicalImagePicked"
        @select-icon="onPhysicalIconPicked"
        @clear="onPhysicalImageCleared"
    />
    <ExtractGroupModal
        v-if="extractGroupModalVisible && extractGroupSourceKey"
        :visible="extractGroupModalVisible"
        :host-external-id="shellyID"
        :source-key="extractGroupSourceKey"
        @close="extractGroupModalVisible = false"
        @extracted="onGroupExtracted"
    />
    <VirtualEditModal
        v-if="virtualEditKey"
        :visible="true"
        :shelly-i-d="shellyID"
        :component-key="virtualEditKey"
        @close="virtualEditKey = null"
        @deleted="virtualEditKey = null"
    />

    <BoardTabs
        v-if="device"
        v-bind="$attrs"
        :tabs="tabs"
        drill-down
        @back="() => rightSideStore.clearInspector()"
    >
        <template #title>
            <span class="text-lg font-semibold line-clamp-2">{{
                getDeviceName(device.info, shellyID)
            }}</span>
        </template>
        <template #hero="{ setTab }">
            <div class="device-hero">
                <!-- Image with a hover-reveal edit icon (no separate button). -->
                <div class="device-hero__image">
                    <i
                        v-if="heroLogo.kind === 'icon'"
                        :class="['device-hero__glyph', heroLogo.faClass]"
                        :style="heroLogo.accent ? {color: `rgb(var(--accent-${heroLogo.accent}))`} : undefined"
                        :aria-label="device.info?.name || shellyID"
                    />
                    <img
                        v-else
                        :src="heroLogo.src"
                        alt="Shelly"
                        class="device-hero__img"
                        loading="lazy"
                        decoding="async"
                        @error="handleImgError"
                    />
                    <button
                        v-if="canEditImage"
                        type="button"
                        class="device-hero__image-edit"
                        :title="canCustomizeAppearance ? 'Customize appearance' : 'Change image'"
                        aria-label="Change image"
                        @click="openImageEditor"
                    >
                        <i class="fas fa-pen" />
                    </button>
                </div>

                <div class="device-hero__tags">
                    <!-- Online shows just a green dot + the IP(s) to save space. BLU
                         devices skip the dot — their live state (open/motion/temp/…)
                         already reads in the panel below, so a bare dot is noise. -->
                    <span v-if="device.loading" class="device-status-badge device-status-badge--loading">Connecting</span>
                    <span v-else-if="device.sleeping" class="device-status-badge device-status-badge--sleeping"><i class="fas fa-moon device-hero__moon" /> Sleeping</span>
                    <span v-else-if="!device.online" class="device-status-badge device-status-badge--offline">Offline</span>
                    <span v-else-if="!isBluetoothDevice" class="device-hero__dot" title="Online" aria-label="Online" />

                    <span v-if="device.online && deviceIps" class="device-hero__ip">{{ deviceIps }}</span>

                    <span
                        v-if="!device.loading && (!device.online || device.sleeping) && lastSeenText !== 'unknown'"
                        class="device-hero__last-seen"
                    >
                        Last seen {{ lastSeenText }}
                    </span>

                    <span v-if="batteryPercent != null" class="device-hero__battery"
                        :class="[
                            batteryPercent <= 25 && 'device-hero__battery--red',
                            batteryPercent > 25 && batteryPercent <= 50 && 'device-hero__battery--orange',
                        ]">
                        <i :class="batteryPercent <= 10 ? 'fas fa-battery-empty' : batteryPercent <= 25 ? 'fas fa-battery-quarter' : batteryPercent <= 50 ? 'fas fa-battery-half' : batteryPercent <= 75 ? 'fas fa-battery-three-quarters' : 'fas fa-battery-full'"></i>
                        {{ batteryPercent }}%
                    </span>
                    <span v-if="device?.info?.ver" class="device-hero__firmware">v{{ device.info.ver }}</span>
                </div>

                <!-- Info is the default body; these buttons drill into the
                     other views (Open Web UI is a modal). -->
                <div class="device-hero__actions">
                    <button
                        v-if="canExecute && showsPhysicalPanels && !isBluetoothDevice"
                        type="button"
                        class="device-hero__btn"
                        @click="showWebGuiModal = true"
                    >
                        <i class="fas fa-arrow-up-right-from-square" /> Open Web UI
                    </button>
                    <button
                        type="button"
                        class="device-hero__btn"
                        @click="setTab('relationships')"
                    >
                        <i class="fas fa-diagram-project" /> Relationships
                    </button>
                    <button
                        type="button"
                        class="device-hero__btn"
                        @click="setTab('settings')"
                    >
                        <i class="fas fa-gear" /> Settings
                    </button>
                </div>
            </div>
        </template>
        <template #info>
        <div v-if="isDiscovered(device.shellyID)">
            <Notification>
                This device has been discovered in your local network.
            </Notification>
            <Notification type="warning">
                Discovered devices do not update their state proactively.
            </Notification>
            <BasicBlock title="Connect device to Fleet Manager">
                <div class="space-y-2">
                    <Input v-model="wsAddress" :disabled="!canExecute" />
                    <span class="text-xs">
                        You can edit the default address in
                        <RouterLink to="/settings" class="underline"
                            >settings</RouterLink
                        >
                    </span>
                    <Button type="blue" :disabled="!canExecute" @click="connectToWs"
                        >Submit</Button
                    >
                </div>
            </BasicBlock>
        </div>

        <div v-if="device.loading" class="device-loading-state">
            <Spinner />
            <span>Connecting to device…</span>
        </div>

        <template v-if="!device.loading">
            <!-- Device profile switching -->
            <div v-if="profileOptions && device.online && canExecute && showsPhysicalPanels" class="device-section">
                <span class="device-section__label">Device Profile</span>
                <div class="profile-picker">
                    <select
                        class="profile-picker__select"
                        :value="deviceProfile"
                        :disabled="profileChanging"
                        @change="(e: Event) => changeProfile((e.target as HTMLSelectElement).value)"
                    >
                        <option v-for="opt in profileOptions" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                        </option>
                    </select>
                    <div class="profile-picker__warning">
                        <i class="fas fa-triangle-exclamation" /> Changing profile reboots the device
                    </div>
                    <div v-if="profileChanging" class="profile-picker__status">
                        <Spinner /> Applying...
                    </div>
                    <div v-if="profileError" class="profile-picker__error">
                        <i class="fas fa-triangle-exclamation" /> {{ profileError }}
                    </div>
                </div>
            </div>

            <!-- BLU Assistant main control: scan + GATT connections -->
            <div v-if="isBluAssistantCapable && device.online && canExecute" class="device-section">
                <span class="device-section__label">BLU Assistant</span>
                <BluAssistPanel :shelly-i-d="shellyID" />
            </div>

            <!-- Wall Display mode switching -->
            <div v-if="isWallDisplay && device.online && canExecute && showsPhysicalPanels" class="device-section">
                <span class="device-section__label">Operating Mode</span>
                <div class="profile-picker">
                    <select
                        class="profile-picker__select"
                        :value="wallDisplayMode"
                        :disabled="wallDisplayModeChanging"
                        @change="(e: Event) => changeWallDisplayMode((e.target as HTMLSelectElement).value)"
                    >
                        <option value="relay">Relay</option>
                        <option value="thermostat">Thermostat</option>
                    </select>
                    <div class="profile-picker__warning">
                        <i class="fas fa-triangle-exclamation" /> Changing mode reboots the device
                    </div>
                    <div v-if="wallDisplayModeChanging" class="profile-picker__status">
                        <Spinner /> Applying...
                    </div>
                </div>
            </div>

            <div v-if="isPillDevice && device.online && canExecute" class="device-section">
                <span class="device-section__label">Peripheral mode</span>
                <div class="profile-picker">
                    <select
                        class="profile-picker__select"
                        :value="pillMode"
                        :disabled="pillModeChanging || pillPinChanging"
                        @change="(e: Event) => changePillMode((e.target as HTMLSelectElement).value)"
                    >
                        <option
                            v-for="opt in pillModeOptions"
                            :key="opt.value"
                            :value="opt.value"
                        >
                            {{ opt.label }}
                        </option>
                    </select>
                    <div v-if="pillModeChanging" class="profile-picker__status">
                        <Spinner /> Applying...
                    </div>
                    <div v-if="pillModeError" class="profile-picker__error">
                        <i class="fas fa-triangle-exclamation" /> {{ pillModeError }}
                    </div>
                </div>

                <div class="pill-pins">
                    <div
                        v-for="pin in PILL_PIN_FIELDS"
                        :key="pin.key"
                        class="pill-pins__row"
                    >
                        <span class="pill-pins__label">{{ pin.label }}</span>
                        <select
                            class="profile-picker__select"
                            :value="pillPins[pin.key]"
                            :disabled="pillModeChanging || pillPinChanging || pillPins[pin.key] === 'reserved'"
                            :title="pillPins[pin.key] === 'reserved' ? 'Reserved by current peripheral mode' : undefined"
                            @change="(e: Event) => changePillPin(pin.key, (e.target as HTMLSelectElement).value)"
                        >
                            <option
                                v-for="opt in PILL_PIN_OPTIONS"
                                :key="opt.value"
                                :value="opt.value"
                                :disabled="opt.disabled"
                            >
                                {{ opt.label }}
                            </option>
                        </select>
                    </div>
                    <div v-if="pillPinChanging" class="profile-picker__status">
                        <Spinner /> Applying...
                    </div>
                    <div v-if="pillPinError" class="profile-picker__error">
                        <i class="fas fa-triangle-exclamation" /> {{ pillPinError }}
                    </div>
                </div>
            </div>

            <ConnectedComponentsSection
                v-if="sortedEntities.length || isVirtualDevice || isBluetoothDevice"
                :shelly-i-d="shellyID"
                :title="componentSectionTitle"
                :entities="ungroupedEntities"
                :groups="sensorGroups"
                :device-online="device.online"
                :device-sleeping="device.sleeping"
                :relationship-context="isVirtualDevice || isBluetoothDevice"
                class="device-section"
            >
                <template #entity="{ entity }">
                    <div
                        v-if="entity.type === 'em'"
                        class="em-entity-clickable"
                        role="button"
                        tabindex="0"
                        :aria-label="`Open ${entity.name || 'EM'} settings`"
                        @click="entityClicked(entity)"
                        @keydown.enter.prevent="entityClicked(entity)"
                        @keydown.space.prevent="entityClicked(entity)"
                    >
                        <EntityEM :entity="entity as em_entity" />
                    </div>
                    <EntityWidget
                        v-else
                        vertical
                        class="w-full"
                        :entity="entity"
                        @click="entityClicked(entity)"
                    />
                </template>

                <template #group="{ group }">
                    <div class="ble-group">
                        <div class="ble-group__header" @click="toggleSensorGroup(group.key)">
                            <i :class="group.icon" class="ble-group__icon" />
                            <div class="ble-group__info">
                                <span class="ble-group__name">{{ group.name }}</span>
                                <span v-if="group.modelId" class="ble-group__model">{{ group.modelId }}</span>
                            </div>
                            <button v-if="group.type === 'ble'" type="button" class="ble-group__detail-btn" @click.stop="openSensorGroupDetail(group)" title="Open detail">
                                <i class="fas fa-arrow-up-right-from-square" />
                            </button>
                            <button
                                v-if="
                                    group.type === 'virtual' &&
                                    group.sourceComponentKey &&
                                    canExecute
                                "
                                type="button"
                                class="ble-group__detail-btn"
                                title="Edit name, icon and color"
                                @click.stop="onEditVirtualGroup(group)"
                            >
                                <i class="fas fa-pen" /> Edit
                            </button>
                            <button
                                v-if="
                                    group.type === 'virtual' &&
                                    group.sourceComponentKey &&
                                    canExecute
                                "
                                type="button"
                                class="ble-group__detail-btn"
                                title="Extract this group as its own device"
                                @click.stop="onExtractGroup(group)"
                            >
                                <i class="fas fa-up-right-from-square" /> Extract
                            </button>
                            <i class="fas ble-group__chevron" :class="sensorGroupOpen.has(group.key) ? 'fa-chevron-up' : 'fa-chevron-down'" />
                        </div>
                        <div v-if="sensorGroupOpen.has(group.key)" class="ble-group__sensors">
                            <!-- Button events from bthomedevice status -->
                            <div
                                v-if="getDeviceLastEvent(group) && getDeviceControls(group).length === 0"
                                class="ble-group__sensor"
                            >
                                <span class="ble-group__sensor-type">
                                    {{ getDeviceLastEventLabel(group) }}
                                </span>
                                <span class="ble-group__sensor-value" style="color: var(--color-warning-text)">
                                    {{ getDeviceLastEvent(group) }}
                                </span>
                            </div>
                            <div
                                v-if="getDeviceActiveChannelLabel(group)"
                                class="ble-group__sensor"
                            >
                                <span class="ble-group__sensor-type">
                                    Active Channel
                                </span>
                                <span class="ble-group__sensor-value">
                                    {{ getDeviceActiveChannelLabel(group) }}
                                </span>
                            </div>
                            <div
                                v-for="control of getDeviceControls(group)"
                                :key="`${group.key}-${control.objId}-${control.idx}`"
                                class="ble-group__sensor"
                            >
                                <span class="ble-group__sensor-type">
                                    {{ control.label }}
                                </span>
                                <span
                                    class="ble-group__sensor-value"
                                    :style="
                                        control.active
                                            ? 'color: var(--color-warning-text)'
                                            : ''
                                    "
                                >
                                    {{ control.status }}
                                </span>
                            </div>
                            <!-- Child sensors -->
                            <div
                                v-for="sensor of group.sensors"
                                :key="sensor.id"
                                class="ble-group__sensor"
                                @click="entityClicked(sensor)"
                            >
                                <span class="ble-group__sensor-type">{{ getSensorTypeName(sensor) }}</span>
                                <span class="ble-group__sensor-value">
                                    {{ getSensorDisplay(sensor) }}
                                </span>
                            </div>
                        </div>
                    </div>
                </template>
            </ConnectedComponentsSection>

        </template>
        </template>
        <template #settings="{ setTab }">
            <div v-if="isVirtualDevice" class="debug-tab">
                <div class="debug-tab__section">
                    <span class="debug-tab__section-label">
                        <i class="fas fa-layer-group" /> Virtual Device
                    </span>
                    <div class="debug-tab__group">
                        <Collapse title="Name">
                            <Input
                                v-model="deviceNameField"
                                label="Device name"
                                :disabled="!canExecute"
                            />
                            <Button
                                type="blue"
                                class="mt-2"
                                :disabled="!canExecute"
                                @click="saveDeviceName"
                                >Save</Button
                            >
                        </Collapse>

                        <Collapse title="Appearance">
                            <div class="virtual-settings-row">
                                <span>Picture or icon</span>
                                <Button
                                    type="blue-hollow"
                                    size="sm"
                                    :disabled="!canExecute"
                                    @click="openImageEditor"
                                >
                                    Change
                                </Button>
                            </div>
                        </Collapse>

                        <Collapse title="Built from">
                            <div class="virtual-settings-row">
                                <span>Source devices and component bindings</span>
                                <Button
                                    type="blue-hollow"
                                    size="sm"
                                    @click="setTab('relationships')"
                                >
                                    View relationships
                                </Button>
                            </div>
                        </Collapse>

                        <Collapse v-if="hasVirtualComponents" title="Components">
                            <VirtualComponentManager :shelly-i-d="shellyID" />
                        </Collapse>
                    </div>
                </div>

                <div class="debug-tab__section">
                    <span class="debug-tab__section-label">
                        <i class="fas fa-screwdriver-wrench" /> Advanced
                    </span>
                    <div class="debug-tab__group">
                        <Collapse title="Raw data">
                            <JSONViewer
                                :data="{
                                    info: device.info,
                                    status: device.status,
                                    settings: device.settings
                                }"
                            />
                        </Collapse>
                    </div>
                </div>
            </div>
            <div v-else class="debug-tab">
                <!-- Device -->
                <div class="debug-tab__section">
                    <span class="debug-tab__section-label">
                        <i class="fas fa-sliders" /> Device
                    </span>
                    <div class="debug-tab__group">
                        <Collapse title="Device name">
                            <Input
                                v-model="deviceNameField"
                                label="Device name"
                                :disabled="!canExecute"
                            />
                            <Button
                                type="blue"
                                class="mt-2"
                                :disabled="!canExecute"
                                @click="saveDeviceName"
                                >Submit</Button
                            >
                        </Collapse>

                        <Collapse title="Energy assignment">
                            <DeviceEnergySettings
                                :shelly-i-d="shellyID"
                                :device-name="deviceEnergyName"
                            />
                        </Collapse>

                        <Collapse title="Access control">
                            <Notification type="warning">
                                Unchecking this will <b>disconnect</b> the device from
                                this instance and add it to the deny list.
                            </Notification>
                            <Checkbox v-model="accessControlChecked">
                                Allow this device to connect to Fleet Manager
                            </Checkbox>
                            <Button type="blue" @click="accessControlSaveClicked">Save</Button>
                        </Collapse>
                    </div>
                </div>

                <!-- Connectivity & Peripherals -->
                <div v-if="device.online && canExecute" class="debug-tab__section">
                    <span class="debug-tab__section-label">
                        <i class="fas fa-plug" /> Connectivity
                    </span>
                    <div class="debug-tab__group">
                        <template
                            v-for="(entry, key) in DEVICE_CONFIG_REGISTRY"
                            :key="key"
                        >
                            <Collapse
                                v-if="deviceShows(device, entry)"
                                :title="entry.title"
                            >
                                <component
                                    :is="entry.panel"
                                    :shelly-i-d="shellyID"
                                />
                            </Collapse>
                        </template>

                        <Collapse v-if="isAddonCapable && !isPillDevice" title="Add-on">
                            <AddonConfig :shelly-i-d="shellyID" />
                        </Collapse>

                        <Collapse v-if="hasVirtualComponents" title="Virtual Components">
                            <VirtualComponentManager :shelly-i-d="shellyID" />
                        </Collapse>

                        <Collapse v-if="hasBtHome" title="BLE Devices">
                            <BtHomeConfig :shelly-i-d="shellyID" />
                        </Collapse>

                        <Collapse v-if="hasLedConfig" title="LED Settings">
                            <DeviceLedConfig :shelly-i-d="shellyID" :can-execute="canExecute" />
                        </Collapse>
                    </div>
                </div>

                <!-- Raw Data -->
                <div class="debug-tab__section">
                    <span class="debug-tab__section-label">
                        <i class="fas fa-code" /> Raw Data
                    </span>
                    <div class="debug-tab__group">
                        <Collapse title="Info">
                            <JSONViewer :data="device.info" />
                        </Collapse>

                        <Collapse title="Status">
                            <JSONViewer :data="device.status" />
                        </Collapse>

                        <Collapse title="Settings">
                            <JSONViewer :data="device.settings" />
                        </Collapse>
                    </div>
                </div>
            </div>
        </template>
        <template #relationships>
            <DeviceRelationshipsPanel :shelly-i-d="shellyID" />
        </template>
    </BoardTabs>
    <div v-else class="pt-8 text-center">
        <span>Device {{ shellyID }} not found</span>
    </div>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import {computed, onMounted, onUnmounted, ref, toRefs, watch} from 'vue';
import type {VisualAsset} from '@/api/assetRpc';
import BluAssistPanel from '@/components/core/BluAssistPanel.vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import ExtractGroupModal from '@/components/devices/add/ExtractGroupModal.vue';
import ConnectedComponentsSection from '@/components/devices/ConnectedComponentsSection.vue';
import DeviceEnergySettings from '@/components/devices/DeviceEnergySettings.vue';
import DeviceRelationshipsPanel from '@/components/devices/DeviceRelationshipsPanel.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import DeviceWebGuiModal from '@/components/modals/DeviceWebGuiModal.vue';
import EmDeviceOptionsModal from '@/components/modals/EmDeviceOptionsModal.vue';
import VirtualDeviceDecorationModal from '@/components/modals/VirtualDeviceDecorationModal.vue';
import VirtualEditModal from '@/components/modals/VirtualEditModal.vue';
import {useDeviceKind} from '@/composables/useDeviceKind';
import {pillModeLabel, usePillModes} from '@/composables/usePillModes';
import {getBThomeBinaryLabels} from '@/config/bthome';
import {DEVICE_CONFIG_REGISTRY, deviceShows} from '@/config/device-config-registry';
import {
    formatBTHomeChannelLabel,
    formatBTHomeEventName,
    getBTHomeEventSourceLabel,
    isBTHomeControlSensor
} from '@/helpers/bthome-controls';
import {EntityBoard} from '@/helpers/components';
import {deviceSupports, 
    getDeviceName,
    getLevelIndicator,
    getLogo,
    handleDeviceImgError,
    isDiscovered} from '@/helpers/device';
import {resolveAssetSrc, resolveDeviceLogo} from '@/helpers/deviceLogo';
import {toastRpcError} from '@/helpers/domainErrors';
import {
    entityNumericProp,
    entityStringListProp,
    entityStringProp
} from '@/helpers/entityProps';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {defaultWs} from '@/helpers/ui';
import {devices as hostDevices} from '@/shell/template-host';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import {debugWarn} from '@/tools/debug';
import * as ws from '@/tools/websocket';
import {type bthomedevice_entity, em_entity, type entity_t} from '@/types';
import AddonConfig from '../core/AddonConfig.vue';
import BasicBlock from '../core/BasicBlock.vue';
import BtHomeConfig from '../core/BtHomeConfig.vue';
import Button from '../core/Button.vue';
import Checkbox from '../core/Checkbox.vue';
import Collapse from '../core/Collapse.vue';
import DeviceLedConfig from '../core/DeviceLedConfig.vue';
import Input from '../core/Input.vue';
import EntityEM from '../core/Meters/EntityEM.vue';
import Notification from '../core/Notification.vue';
import Spinner from '../core/Spinner.vue';
import VirtualComponentManager from '../core/VirtualComponentManager.vue';
import EntityWidget from '../widgets/EntityWidget.vue';
import BoardTabs from './BoardTabs.vue';

type props_t = {shellyID: string};

// Multi-root template (modals + board) can't auto-inherit the inspector's
// class — forward it to <BoardTabs> via v-bind="$attrs" instead.
defineOptions({inheritAttrs: false});

const props = defineProps<props_t>();
const {shellyID} = toRefs(props);

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const toastStore = useToastStore();
const rightSideStore = useRightSideMenuStore();
const authStore = useAuthStore();

// Check if user can execute commands on this device
const canExecute = computed(() => authStore.canExecuteDevice(shellyID.value));

const device = computed(() => deviceStore.devices[shellyID.value]);
const {
    isVirtual: isVirtualDevice,
    isBluetooth: isBluetoothDevice,
    showsPhysicalPanels
} = useDeviceKind(shellyID);

const batteryPercent = computed(() => {
    const level = getLevelIndicator(device.value);
    return level.type === 'battery' ? level.value : null;
});

// Both IPs when present (eth / wifi), so the tags row can show reachability.
const deviceIps = computed(() => {
    const status = device.value?.status as Record<string, unknown> | undefined;
    const eth = (status?.eth as {ip?: string} | undefined)?.ip;
    const wifi = (status?.wifi as {sta_ip?: string} | undefined)?.sta_ip;
    return [eth, wifi].filter(Boolean).join(' / ');
});

const lastSeenText = computed(() => {
    const s = device.value?.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return 'unknown';
    const diffS = Math.floor(Date.now() / 1000 - ts);
    if (diffS < 60) return 'just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return `${Math.floor(diffS / 86400)}d ago`;
});

const deviceNameField = ref(device.value?.info?.name || device.value?.info?.id);
const deviceEnergyName = computed(
    () => getDeviceName(device.value?.info, shellyID.value) || shellyID.value
);
const wsAddress = ref(defaultWs.value);

const accessControlChecked = ref(true);
const tabs = ref([
    {name: 'relationships', icon: 'fas fa-diagram-project'},
    {name: 'settings', icon: 'fas fa-gear'}
]);

interface EmDevice {
    shellyID: string;
    name: string;
    pictureUrl: string;
}

const defaultEmDevice = computed<EmDevice>(() => ({
    shellyID: device.value?.shellyID || shellyID.value,
    name: getDeviceName(device.value?.info, shellyID.value) || shellyID.value,
    pictureUrl: getLogo(device.value)
}));

const showOptionsModal = ref(false);
const showWebGuiModal = ref(false);
const extractGroupModalVisible = ref(false);
const extractGroupSourceKey = ref<string | null>(null);

function onExtractGroup(group: SensorGroup): void {
    if (!group.sourceComponentKey) return;
    extractGroupSourceKey.value = group.sourceComponentKey;
    extractGroupModalVisible.value = true;
}

const virtualEditKey = ref<string | null>(null);
function onEditVirtualGroup(group: SensorGroup): void {
    if (!group.sourceComponentKey) return;
    virtualEditKey.value = group.sourceComponentKey;
}

function onGroupExtracted(externalId: string): void {
    toastStore.success(`Extracted as ${externalId}`);
    extractGroupModalVisible.value = false;
    extractGroupSourceKey.value = null;
}
const decorationModalVisible = ref<boolean>(false);
const physicalImagePickerVisible = ref<boolean>(false);
const selectedEMDevices = ref<EmDevice[]>([]);

// Virtual + BLU devices carry decoration state; Shelly devices use the
// device-type CDN logo and don't open this modal.
const canCustomizeAppearance = computed<boolean>(() => {
    const source = (device.value as {source?: string} | undefined)?.source;
    return source === 'virtual' || source === 'bluetooth';
});

// Physical-device override lives in device.list, not in the WS device
// snapshot, so fetch + cache it locally.
const physicalAssetId = ref<string | null>(null);
const physicalIcon = ref<string | null>(null);
// Image is editable for virtual/BLU (appearance) or physical devices.
const canEditImage = computed(
    () =>
        canCustomizeAppearance.value ||
        (canExecute.value && showsPhysicalPanels.value && !isBluetoothDevice.value)
);

function openImageEditor() {
    if (canCustomizeAppearance.value) decorationModalVisible.value = true;
    else physicalImagePickerVisible.value = true;
}

async function loadPhysicalAssetId(): Promise<void> {
    if (canCustomizeAppearance.value) return;
    try {
        const result = await hostDevices.getImage({
            shellyID: shellyID.value
        });
        physicalAssetId.value = result.imageAssetId;
        physicalIcon.value = result.icon;
    } catch {
        physicalAssetId.value = null;
        physicalIcon.value = null;
    }
}

async function onPhysicalImagePicked(asset: VisualAsset): Promise<void> {
    await applyPhysicalOverride({imageAssetId: asset.id, icon: null});
}

async function onPhysicalIconPicked(decoration: {icon: string}): Promise<void> {
    await applyPhysicalOverride({imageAssetId: null, icon: decoration.icon});
}

async function onPhysicalImageCleared(): Promise<void> {
    await applyPhysicalOverride({imageAssetId: null, icon: null});
}

async function applyPhysicalOverride(override: {
    imageAssetId: string | null;
    icon: string | null;
}): Promise<void> {
    try {
        const result = await hostDevices.setImage({
            shellyID: shellyID.value,
            imageAssetId: override.imageAssetId,
            icon: override.icon
        });
        physicalAssetId.value = result.imageAssetId;
        physicalIcon.value = result.icon;
        toastStore.success(
            result.imageAssetId || result.icon
                ? 'Appearance updated'
                : 'Override cleared'
        );
    } catch (err) {
        toastRpcError(toastStore, err, 'Failed to update appearance');
    }
}

// Hero logo: physical override wins over the device-type CDN logo.
const heroLogo = computed(() => {
    if (physicalAssetId.value) {
        return {kind: 'image' as const, src: resolveAssetSrc(physicalAssetId.value)};
    }
    if (physicalIcon.value) {
        return {kind: 'icon' as const, faClass: physicalIcon.value, accent: null};
    }
    return device.value
        ? resolveDeviceLogo(device.value as never)
        : ({kind: 'image' as const, src: getLogo(device.value)} as const);
});

const entities = computed(() => {
    const entities: Record<string, entity_t> = {};
    for (const eid of device.value?.entities ?? [])
        if (entityStore.entities[eid]) {
            entities[eid] = entityStore.entities[eid];
        }
    return entities;
});

const sortedEntities = computed(() =>
    Object.values(entities.value).sort((a, b) =>
        a.type === 'em' ? -1 : b.type === 'em' ? 1 : 0
    )
);

const componentSectionTitle = computed(() =>
    isVirtualDevice.value || isBluetoothDevice.value
        ? 'Connected components'
        : 'Entities'
);

// Sensor groups: BLE groups from bthomedevice entities, addon groups computed,
// virtual groups from group:N entities.
interface SensorGroup {
    key: string;
    type: 'ble' | 'addon' | 'virtual';
    icon: string;
    name: string;
    productName: string;
    modelId: string;
    sensors: entity_t[];
    /** bthomedevice entity (BLE groups only) — for reading device status */
    deviceEntity?: bthomedevice_entity;
    /** For 'virtual' groups: the Shelly component key (e.g. "group:200") used to extract this group as a standalone device. */
    sourceComponentKey?: string;
}

const sensorGroups = computed((): SensorGroup[] => {
    const groups: SensorGroup[] = [];

    // BLE groups: driven by bthomedevice entities (backend decides the groups)
    for (const e of sortedEntities.value) {
        if (e.type !== 'bthomedevice') continue;
        const props = e.properties as bthomedevice_entity['properties'];
        const childIds = props.childSensorIds ?? [];
        const children = childIds
            .map((id) => entityStore.entities[id])
            .filter((c): c is entity_t => c != null)
            .filter(
                (child) => !isBTHomeControlSensor(child.properties?.objName)
            );
        groups.push({
            key: props?.addr ?? e.id,
            type: 'ble',
            icon: 'fab fa-bluetooth-b',
            name: e.name || props?.productName || 'BLE Device',
            productName: props?.productName ?? '',
            modelId: props?.modelId ?? '',
            sensors: children,
            deviceEntity: e as bthomedevice_entity
        });
    }

    // Addon groups: computed (no backend entity for addon module)
    const addonSensors: entity_t[] = [];
    for (const e of sortedEntities.value) {
        if (entityStringProp(e, 'sensorSource') === 'addon') {
            addonSensors.push(e);
        }
    }
    if (addonSensors.length) {
        groups.push({
            key: 'addon',
            type: 'addon',
            icon: 'fas fa-puzzle-piece',
            name: 'Add-on Sensors',
            productName:
                device.value?.settings?.sys?.device?.addon_type ??
                'Sensor Add-on',
            modelId: '',
            sensors: addonSensors
        });
    }

    // Virtual groups: device-side `group:N` entities listing virtual-component
    // members (e.g. Pill scripts publishing 9 numbers as one Marstek battery).
    for (const e of sortedEntities.value) {
        if (e.type !== 'group') continue;
        const members = entityStringListProp(e, 'members');
        const children = members
            .map((key) => {
                // members are component keys ('number:220'); resolve to entity ids.
                const [type, idStr] = key.split(':');
                const id = Number(idStr);
                if (!type || Number.isNaN(id)) return undefined;
                return sortedEntities.value.find(
                    (m) => m.type === type && entityNumericProp(m, 'id') === id
                );
            })
            .filter((m): m is entity_t => m != null);
        if (children.length === 0) continue;
        const groupComponentId = entityNumericProp(e, 'id');
        groups.push({
            key: e.id,
            type: 'virtual',
            icon: 'fas fa-object-group',
            name: e.name || 'Group',
            productName: '',
            modelId: '',
            sensors: children,
            sourceComponentKey:
                groupComponentId != null
                    ? `group:${groupComponentId}`
                    : undefined
        });
    }

    return groups;
});

// BLE group collapse state — open by default
const sensorGroupOpen = ref(new Set<string>());
// Initialize all groups as open
watch(
    sensorGroups,
    (groups) => {
        for (const g of groups) sensorGroupOpen.value.add(g.key);
    },
    {immediate: true}
);

function toggleSensorGroup(addr: string) {
    if (sensorGroupOpen.value.has(addr)) {
        sensorGroupOpen.value.delete(addr);
    } else {
        sensorGroupOpen.value.add(addr);
    }
}

// Entities that are NOT in any sensor group
const ungroupedEntities = computed(() => {
    const groupedIds = new Set(
        sensorGroups.value.flatMap((g) => g.sensors.map((s) => s.id))
    );
    return sortedEntities.value.filter((e) => {
        // Hide bthomedevice entities — rendered as group cards, not individual entities
        if (e.type === 'bthomedevice') return false;
        // Hide virtual group entities — they become sensor-group headers
        if (e.type === 'group') return false;
        // Hide child sensors / members that belong to a group
        if (groupedIds.has(e.id)) return false;
        // Hide bthomesensors with a parent device (even if not in childSensorIds — safety)
        if (e.type === 'bthomesensor' && entityStringProp(e, 'parentDeviceKey'))
            return false;
        return true;
    });
});

function getGroupDeviceStatus(group: SensorGroup): Record<string, any> | null {
    const deviceEntity = group.deviceEntity;
    if (!deviceEntity || deviceEntity.type !== 'bthomedevice') return null;
    return (
        device.value?.status?.[`bthomedevice:${deviceEntity.properties.id}`] ??
        null
    );
}

function getDeviceActiveChannelLabel(group: SensorGroup): string | null {
    const status = getGroupDeviceStatus(group);
    if (
        typeof status?.overview?.activeChannelLabel === 'string' &&
        status.overview.activeChannelLabel.trim()
    ) {
        return status.overview.activeChannelLabel;
    }

    return typeof status?.channel === 'number'
        ? formatBTHomeChannelLabel(status.channel)
        : null;
}

function getDeviceLastEvent(group: SensorGroup): string | null {
    const evt = getGroupDeviceStatus(group)?.last_event;
    if (typeof evt === 'string' && evt.trim()) {
        return formatBTHomeEventName(evt);
    }
    if (evt != null) {
        return String(evt);
    }
    return null;
}

function getDeviceLastEventIdx(group: SensorGroup): number | null {
    const idx = getGroupDeviceStatus(group)?.last_event_idx;
    return typeof idx === 'number' && idx >= 0 ? idx : null;
}

function getDeviceLastEventLabel(group: SensorGroup): string {
    const status = getGroupDeviceStatus(group);
    return getBTHomeEventSourceLabel({
        event:
            typeof status?.last_event === 'string' ? status.last_event : null,
        idx: getDeviceLastEventIdx(group),
        controls:
            group.deviceEntity?.type === 'bthomedevice'
                ? group.deviceEntity.properties.controls
                : []
    });
}

function getDeviceControls(group: SensorGroup) {
    // Backend overview.controls[] already carries {active, status} — computed
    // server-side against the 4s runtime event window. Just read it.
    const status = getGroupDeviceStatus(group);
    const overviewControls = status?.overview?.controls;
    if (Array.isArray(overviewControls) && overviewControls.length) {
        return overviewControls;
    }
    // Fallback when status hasn't loaded yet: show raw control list as inactive.
    const controls =
        group.deviceEntity?.type === 'bthomedevice'
            ? group.deviceEntity.properties.controls
            : [];
    return controls.map((c) => ({
        ...c,
        active: false,
        status: 'Ready'
    }));
}

const VIRTUAL_VALUE_TYPES = new Set([
    'number',
    'boolean',
    'text',
    'enum',
    'button'
]);

function getSensorTypeName(entity: entity_t): string {
    if (entity.type === 'bthomesensor') {
        const objName = entityStringProp(entity, 'objName') ?? '';
        return (
            objName.charAt(0).toUpperCase() +
                objName.slice(1).replace(/_/g, ' ') || 'Sensor'
        );
    }
    // Virtual members carry a user-set name on the entity itself.
    if (VIRTUAL_VALUE_TYPES.has(entity.type) && entity.name) {
        return entity.name;
    }
    // Addon: use entity type as label
    return entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
}

function formatBTHomeBinaryValue(objName: string, value: boolean): string {
    const labels = getBThomeBinaryLabels(objName);
    const label = value ? labels.on : labels.off;
    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function getSensorDisplay(entity: entity_t): string {
    // BLE sensors
    if (entity.type === 'bthomesensor') {
        const id = entityNumericProp(entity, 'id');
        const status =
            id === undefined
                ? undefined
                : device.value?.status?.[`bthomesensor:${id}`];
        if (!status) return '—';
        const objName = entityStringProp(entity, 'objName') ?? '';
        if (objName === 'button' || objName === 'dimmer') {
            const event = status.last_event ?? status.value;
            if (event == null) return 'No events';
            if (typeof event === 'string') return formatBTHomeEventName(event);
            if (typeof event === 'number') return `Event ${event}`;
            return String(event);
        }
        if (status.value == null) return '—';
        const unit = entity.properties.unit ?? '';
        const val = status.value;
        if (typeof val === 'number')
            return objName === 'channel'
                ? formatBTHomeChannelLabel(val)
                : unit
                  ? `${Number.isInteger(val) ? val : val.toFixed(1)} ${unit}`
                  : String(val);
        if (typeof val === 'boolean')
            return formatBTHomeBinaryValue(objName, val);
        return String(val);
    }

    // Virtual components (group members): single `value` field on the status.
    if (VIRTUAL_VALUE_TYPES.has(entity.type)) {
        const status =
            device.value?.status?.[`${entity.type}:${entity.properties.id}`];
        if (!status || status.value == null) return '—';
        const val = status.value;
        const unit = entity.properties.unit ?? '';
        if (typeof val === 'number')
            return unit
                ? `${Number.isInteger(val) ? val : val.toFixed(2)} ${unit}`
                : String(val);
        if (typeof val === 'boolean') return val ? 'On' : 'Off';
        return String(val);
    }

    // Addon sensors (temperature, humidity — standard component status)
    const statusKey = `${entity.type}:${entity.properties.id}`;
    const status = device.value?.status?.[statusKey];
    if (!status) return '—';
    if (entity.type === 'temperature') {
        return status.tC != null ? `${status.tC.toFixed(1)} °C` : '—';
    }
    if (entity.type === 'humidity') {
        return status.rh != null ? `${status.rh.toFixed(1)} %` : '—';
    }
    return '—';
}

const isPillDevice = computed(() => {
    const app = device.value?.info?.app;
    return app === 'Pill' || app === 'ThePill';
});

// Virtual component management — user can add/delete virtual components
const hasVirtualComponents = computed(
    () => !!device.value?.capabilities?.virtualComponents
);

// BTHome support — device has bthome component
const hasBtHome = computed(() => {
    const settings = device.value?.settings;
    return settings && 'bthome' in settings;
});

// LED config — Plugs, PowerStrip have device-specific UI component
const LED_UI_KEYS = ['powerstrip_ui', 'plugs_ui', 'pluguk_ui', 'plugpm_ui'];
const hasLedConfig = computed(() => {
    const settings = device.value?.settings;
    if (!settings) return false;
    return LED_UI_KEYS.some((k) => k in settings);
});

// Addon-capable devices always have addon_type key in sys.device config
// (value is null when unconfigured, string when set).
// Devices without addon slot (Plugs, WallDisplay, Gateway) omit the key entirely.
const isAddonCapable = computed(() => {
    const sysDevice = device.value?.settings?.sys?.device;
    return sysDevice != null && 'addon_type' in sysDevice;
});

// --- Device profile switching ---
const deviceProfile = computed(
    () => device.value?.info?.profile as string | undefined
);
const profileChanging = ref(false);
const profileError = ref<string | null>(null);
const profileList = ref<{value: string; label: string}[] | null>(null);

// Fetch available profiles dynamically from device via Shelly.ListProfiles
const profileOptions = computed(() => profileList.value);

async function loadProfiles() {
    if (!deviceProfile.value || !device.value?.online) return;
    try {
        const resp = await ws.sendRPC('FLEET_MANAGER', 'Shelly.ListProfiles', {
            shellyID: shellyID.value
        });
        if (resp?.profiles && typeof resp.profiles === 'object') {
            profileList.value = Object.keys(resp.profiles).map((name) => ({
                value: name,
                label:
                    name.charAt(0).toUpperCase() +
                    name.slice(1).replace(/_/g, ' ')
            }));
        }
    } catch (error) {
        debugWarn('Device profile list unavailable', {
            shellyID: shellyID.value,
            error
        });
    }
}

async function changeProfile(newProfile: string) {
    if (newProfile === deviceProfile.value || profileChanging.value) return;
    profileChanging.value = true;
    profileError.value = null;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.SetProfile', {
            shellyID: shellyID.value,
            name: newProfile
        });
        toastStore.success(
            `Profile changed to "${newProfile}". Device may reboot to apply changes.`
        );
    } catch (e: any) {
        profileError.value = e.message || 'Failed to change profile';
    }
    profileChanging.value = false;
}

// Wall Display mode (relay vs thermostat)
const isBluAssistantCapable = computed(() =>
    deviceSupports(device.value as never, 'GATTC.Scan')
);

const isWallDisplay = computed(() => {
    const app = device.value?.info?.app;
    return app === 'WallDisplay' || app === 'WallDisplayV2';
});

const wallDisplayMode = computed(() => {
    const status = device.value?.status;
    if (!status) return 'relay';
    // If thermostat:0 exists in status, we're in thermostat mode
    return status['thermostat:0'] ? 'thermostat' : 'relay';
});

const wallDisplayModeChanging = ref(false);

async function changeWallDisplayMode(newMode: string) {
    if (newMode === wallDisplayMode.value || wallDisplayModeChanging.value)
        return;
    wallDisplayModeChanging.value = true;
    try {
        if (newMode === 'thermostat') {
            await ws.sendRPC('FLEET_MANAGER', 'Thermostat.Create', {
                shellyID: shellyID.value,
                config: {}
            });
            toastStore.success('Thermostat created. Device is rebooting...');
        } else {
            await ws.sendRPC('FLEET_MANAGER', 'Thermostat.Delete', {
                shellyID: shellyID.value,
                id: 0
            });
            toastStore.success('Thermostat removed. Device is rebooting...');
        }
    } catch (e: any) {
        toastStore.error(e.message || 'Failed to change mode');
    }
    wallDisplayModeChanging.value = false;
}

const pillMode = computed<string>(
    () => (device.value?.settings?.pill?.mode as string) ?? 'onewire'
);

// usePillModes' internal `watch` eagerly evaluates its source getters at
// setup, so `pillMode` must be initialized before this call (TDZ otherwise).
// `enabled` gate keeps non-Pill devices from issuing Shelly.GetComponents.
const {modes: pillModes} = usePillModes(
    () => shellyID.value,
    () => device.value?.info?.ver,
    () => pillMode.value,
    () => isPillDevice.value
);
const pillModeOptions = computed(() =>
    pillModes.value.map((m) => ({value: m, label: pillModeLabel(m)}))
);
const PILL_PIN_OPTIONS: Array<{
    value: string;
    label: string;
    disabled?: boolean;
}> = [
    {value: 'none', label: 'None'},
    {value: 'digital_in', label: 'Digital input'},
    {value: 'digital_out', label: 'Digital output'},
    {value: 'reserved', label: 'Reserved (locked by mode)', disabled: true}
];
const PILL_PIN_FIELDS = [
    {key: 'pin0_mode' as const, label: 'Pin 0'},
    {key: 'pin1_mode' as const, label: 'Pin 1'},
    {key: 'pin2_mode' as const, label: 'Pin 2'}
] as const;
const pillPins = computed(() => {
    const cfg = device.value?.settings?.pill ?? {};
    return {
        pin0_mode: (cfg.pin0_mode as string) ?? 'none',
        pin1_mode: (cfg.pin1_mode as string) ?? 'none',
        pin2_mode: (cfg.pin2_mode as string) ?? 'none'
    };
});
const pillModeChanging = ref(false);
const pillPinChanging = ref(false);
const pillModeError = ref<string | null>(null);
const pillPinError = ref<string | null>(null);

async function changePillMode(newMode: string) {
    if (
        newMode === pillMode.value ||
        pillModeChanging.value ||
        pillPinChanging.value
    )
        return;
    pillModeChanging.value = true;
    pillModeError.value = null;
    try {
        const config: Record<string, string> = {mode: newMode};
        const resp = await ws.sendRPC<{restart_required?: boolean}>(
            'FLEET_MANAGER',
            'Pill.SetConfig',
            {shellyID: shellyID.value, config}
        );
        if (resp?.restart_required) {
            toastStore.warning(
                `Pill mode set to ${newMode} — device reboot required to apply`
            );
        } else {
            // Mode change may have spawned/removed components; pull fresh state.
            await loadFullDeviceForBoard(shellyID.value);
            toastStore.success(`Pill mode set to ${newMode}`);
        }
    } catch (e: unknown) {
        pillModeError.value = rpcErrorMessage(e, 'Failed to change mode');
    } finally {
        pillModeChanging.value = false;
    }
}

async function changePillPin(
    pinKey: 'pin0_mode' | 'pin1_mode' | 'pin2_mode',
    newPinMode: string
) {
    if (
        newPinMode === pillPins.value[pinKey] ||
        pillPinChanging.value ||
        pillModeChanging.value
    )
        return;
    pillPinChanging.value = true;
    pillPinError.value = null;
    try {
        const resp = await ws.sendRPC<{restart_required?: boolean}>(
            'FLEET_MANAGER',
            'Pill.SetConfig',
            {
                shellyID: shellyID.value,
                config: {[pinKey]: newPinMode}
            }
        );
        if (resp?.restart_required) {
            toastStore.warning(
                `${pinKey} set to ${newPinMode} — device reboot required to apply`
            );
        } else {
            toastStore.success(`${pinKey} set to ${newPinMode}`);
        }
    } catch (e: unknown) {
        pillPinError.value = rpcErrorMessage(e, 'Failed to change pin mode');
    } finally {
        pillPinChanging.value = false;
    }
}

// Check if this is a Cury device
const isCuryDevice = computed(() => {
    const app = device.value?.info?.app;
    return app === 'Cury';
});

function handleOptionsSave(selected: EmDevice[]) {
    selectedEMDevices.value = selected;
    toastStore.success(`Saved ${selected.length} EM device(s)`);
}

async function saveDeviceName() {
    if (!canExecute.value) {
        toastStore.error(
            'You do not have permission to execute commands on this device'
        );
        return;
    }
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Sys.SetConfig', {
            shellyID: shellyID.value,
            config: {device: {name: deviceNameField.value}}
        });
        toastStore.success(`Changed device name to '${deviceNameField.value}'`);
    } catch {
        toastStore.error(
            `Failed to change device name to '${deviceNameField.value}'`
        );
    }
}

async function connectToWs() {
    if (!canExecute.value) {
        toastStore.error(
            'You do not have permission to execute commands on this device'
        );
        return;
    }
    try {
        const wsResp = await ws.sendRPC<{restart_required?: boolean}>(
            'FLEET_MANAGER',
            'Network.OutboundWebsocket.SetConfig',
            {
                shellyID: shellyID.value,
                config: {
                    enable: true,
                    server: wsAddress.value
                }
            }
        );
        if (!wsResp?.restart_required) {
            return;
        }
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {
            shellyID: shellyID.value
        });
        toastStore.success('Saved websocket config');
    } catch (error) {
        toastRpcError(toastStore, error, 'Failed to save websocket config.');
    }
}

function entityClicked(entity: entity_t) {
    rightSideStore.showInspector(EntityBoard, {entity, fromDevice: true});
}

async function openSensorGroupDetail(group: SensorGroup) {
    const {default: BleDeviceBoard} = await import('./BleDeviceBoard.vue');
    rightSideStore.showInspector(BleDeviceBoard, {
        shellyID: shellyID.value,
        addr: group.key,
        displayName: group.name,
        productName: group.productName,
        modelId: group.modelId,
        sensorIds: group.sensors.map((s) => s.id),
        deviceEntity: group.deviceEntity ?? null
    });
}

async function accessControlSaveClicked() {
    if (accessControlChecked.value) return;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
            shellyIDs: [shellyID.value]
        });
    } catch (error) {
        toastStore.error(
            error instanceof Error ? error.message : String(error)
        );
    }
}
function handleImgError(e: Event) {
    handleDeviceImgError(e, device.value?.info?.model);
}

// Hold the active subscription handle so rapid A→B→C switches can
// dispose only the previous one; a stale clear can no longer wipe C.
let activeSub: ws.TemporarySubscription | null = null;

watch(shellyID, async (newID) => {
    const prev = activeSub;
    activeSub = null;
    if (prev) await prev.unsubscribe();
    activeSub = await ws.addTemporarySubscription([newID]);
    deviceNameField.value = getDeviceName(device.value?.info, newID) || newID;
    loadFullDeviceForBoard(newID);
});

watch(
    device,
    (newDevice) => {
        if (!newDevice) {
            showOptionsModal.value = false;
            showWebGuiModal.value = false;
            return;
        }
        deviceNameField.value =
            newDevice.info?.name || newDevice.info?.id || newDevice.shellyID;
    },
    {immediate: true}
);

// Reload profiles when device reconnects (profile may have changed)
watch(deviceProfile, () => {
    profileChanging.value = false;
    loadProfiles();
});

onMounted(async () => {
    activeSub = await ws.addTemporarySubscription([shellyID.value]);
    // Initial list load uses toListJSON() which strips settings; fetch
    // the full device so config tabs have what they need.
    void loadFullDeviceForBoard(shellyID.value, {loadProfilesAfter: true});
    void loadPhysicalAssetId();
});

watch(shellyID, () => {
    physicalAssetId.value = null;
    void loadPhysicalAssetId();
});

async function loadFullDeviceForBoard(
    targetShellyID: string,
    options: {loadProfilesAfter?: boolean} = {}
): Promise<void> {
    try {
        const fullDevice = await ws.sendRPC('FLEET_MANAGER', 'device.Get', {
            shellyID: targetShellyID
        });
        if (fullDevice) deviceStore.handleNewDevice(fullDevice as never);
        if (options.loadProfilesAfter) loadProfiles();
    } catch (error) {
        debugWarn('Device board full-device load failed', {
            shellyID: targetShellyID,
            error
        });
    }
}

onUnmounted(() => {
    void activeSub?.unsubscribe();
    activeSub = null;
});
</script>

<style scoped>
/* ── Device hero card ── */
.device-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3) var(--space-3);
}
.device-hero__image {
    position: relative;
    display: inline-flex;
    border-radius: var(--radius-lg);
}
/* Edit affordance reveals on hover/focus over the image — no separate button. */
.device-hero__image-edit {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    width: var(--space-7);
    height: var(--space-7);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-default),
                background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.device-hero__image:hover .device-hero__image-edit,
.device-hero__image-edit:focus-visible {
    opacity: 1;
}
.device-hero__image-edit:hover {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
}
.device-hero__img {
    width: 140px;
    height: 140px;
    border-radius: var(--radius-lg);
    object-fit: contain;
}

/* FA glyph used in place of __img when a virtual device picks an icon. */
.device-hero__glyph {
    width: 140px;
    height: 140px;
    border-radius: var(--radius-lg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-display);
    color: var(--color-text-secondary);
    background-color: var(--color-surface-2);
}

/* Tags row: status + firmware */
.device-hero__tags {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.device-hero__firmware {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-family: monospace;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background-color: color-mix(in srgb, var(--color-text-tertiary) 10%, transparent);
}
.device-hero__battery {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    color: var(--color-status-on);
    background-color: color-mix(in srgb, var(--color-status-on) 10%, transparent);
}
.device-hero__battery--orange {
    color: var(--color-status-warn);
    background-color: color-mix(in srgb, var(--color-status-warn) 12%, transparent);
}
.device-hero__battery--red {
    color: var(--color-status-off);
    background-color: color-mix(in srgb, var(--color-status-off) 12%, transparent);
}

/* Status badge */
.device-status-badge {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
}
.device-status-badge--online {
    color: var(--color-success-text);
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
}
.device-status-badge--offline {
    color: var(--color-danger-text);
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
}
.device-status-badge--loading {
    color: var(--color-warning-text);
    background-color: color-mix(in srgb, var(--color-warning) 15%, transparent);
}
.device-status-badge--sleeping {
    color: var(--a-action);
    background-color: color-mix(in srgb, var(--a-action) 15%, transparent);
}
.device-hero__last-seen {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
/* Online = a green dot only (saves space); the IP chip carries the detail. */
.device-hero__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-status-on);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-status-on) 22%, transparent);
}
.device-hero__ip {
    font-size: var(--type-body);
    font-family: monospace;
    color: var(--color-text-secondary);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background-color: color-mix(in srgb, var(--color-text-tertiary) 10%, transparent);
}
.device-hero__moon {
    color: color-mix(in srgb, var(--color-accent) 90%, transparent);
    margin-right: var(--space-1);
}

/* ── Bottom row: meta cards + action button ── */
/* Two actions below the tags row: Open GUI + Settings. */
.device-hero__actions {
    display: flex;
    gap: var(--space-2);
    width: 100%;
}
.device-hero__btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    border: none;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.device-hero__btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

/* ── Loading state ── */
.device-loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) 0;
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}

/* ── Section headers ── */
.device-section {
    padding: var(--space-3) var(--space-3) 0;
}
.device-section__label {
    display: block;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: none;
    letter-spacing: var(--tracking-wide);
    margin-bottom: var(--space-2);
}

/* ── Debug tab ── */
.debug-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.debug-tab__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.debug-tab__section-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: none;
    letter-spacing: var(--tracking-wide);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--color-border-subtle);
}
.debug-tab__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

/* Pill pin selectors (under digital_io mode) */
.pill-pins {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-subtle);
}
.pill-pins__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.pill-pins__label {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    min-width: var(--space-12);
}

/* Profile picker */
.profile-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.profile-picker__select {
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    cursor: pointer;
    width: 100%;
}
.profile-picker__warning {
    font-size: var(--type-body);
    color: var(--color-warning-text);
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.profile-picker__status {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}
.profile-picker__error {
    font-size: var(--type-body);
    color: var(--color-danger-text);
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.virtual-settings-row {
    display: flex;
    min-height: var(--touch-target-min);
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--space-3);
    color: var(--color-text-secondary);
}

.virtual-settings-row span {
    min-width: 0;
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
}

/* BLE sensor group */
.ble-group {
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-default);
    overflow: hidden;
}
.ble-group__header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-default);
    cursor: pointer;
    user-select: none;
}
.ble-group__header:hover {
    background: var(--color-surface-2);
}
.ble-group__detail-btn {
    background: none; border: none; color: var(--color-text-disabled);
    font-size: var(--type-body); cursor: pointer; padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
}
.ble-group__detail-btn:hover { color: var(--color-primary); background: var(--color-primary-subtle); }
.ble-group__chevron {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.ble-group__icon {
    font-size: var(--type-subheading);
    color: var(--color-text-tertiary);
}
.ble-group__icon.fa-bluetooth-b {
    color: var(--color-ble);
}
.ble-group__icon.fa-puzzle-piece {
    color: var(--color-warning-text);
}
.ble-group__info {
    display: flex;
    flex-direction: column;
}
.ble-group__name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.ble-group__model {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.ble-group__sensors {
    display: flex;
    flex-direction: column;
}
.ble-group__sensor {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    transition: background-color var(--duration-quick) var(--ease-default);
}
.ble-group__sensor:hover {
    background: var(--color-surface-1);
}
.ble-group__sensor + .ble-group__sensor {
    border-top: 1px solid var(--color-border-subtle);
}
.ble-group__sensor-type {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: capitalize;
}
.ble-group__sensor-value {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}
.em-entity-clickable {
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background-color var(--duration-quick) var(--ease-default);
}
.em-entity-clickable:hover {
    background: var(--color-surface-1);
}
.em-entity-clickable:focus-visible {
    outline: var(--focus-ring-width) solid var(--color-border-focus);
    outline-offset: var(--focus-ring-offset);
}
</style>
