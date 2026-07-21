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
        :device-id="device?.id"
        :shelly-i-d="shellyID"
        @close="showWebGuiModal = false"
    />
    <DeviceEditModal
        v-if="device && deviceEditVisible"
        :visible="deviceEditVisible"
        :device="device"
        @close="deviceEditVisible = false"
        @saved="onDeviceEdited"
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
    <Modal
        :visible="settingsExitConfirmVisible"
        compact
        @close="cancelSettingsExit"
    >
        <template #title>Unsaved changes</template>
        <p class="settings-exit-copy">
            Your changes have not been saved. Discard them and leave settings?
        </p>
        <template #footer>
            <div class="settings-exit-actions">
                <Button type="blue-hollow" @click="cancelSettingsExit">
                    Keep editing
                </Button>
                <Button type="red" @click="discardSettingsAndExit">
                    Discard changes
                </Button>
            </div>
        </template>
    </Modal>
    <Modal
        :visible="denyAccessConfirmVisible"
        compact
        @close="denyAccessConfirmVisible = false"
    >
        <template #title>Deny device access</template>
        <p class="settings-exit-copy">
            Disconnect {{ deviceEnergyName }} and block future connections?
        </p>
        <template #footer>
            <div class="settings-exit-actions">
                <Button
                    type="blue-hollow"
                    @click="denyAccessConfirmVisible = false"
                >
                    Cancel
                </Button>
                <Button type="red" @click="denyDeviceAccess">
                    Disconnect and deny
                </Button>
            </div>
        </template>
    </Modal>
    <ConfirmationModal ref="maintenanceConfirm" />
    <DeviceDeleteModal
        :visible="showDeleteModal"
        :shelly-i-d="shellyID"
        :device-name="getDeviceName(device?.info, shellyID)"
        @close="showDeleteModal = false"
        @done="onDeviceRemoved"
    />
    <SetPasswordModal
        :visible="devicePasswordModalVisible"
        :preset-devices="[shellyID]"
        @close="devicePasswordModalVisible = false"
    />

    <BoardTabs
        v-if="device"
        v-bind="$attrs"
        :tabs="tabs"
        drill-down
        @back="() => rightSideStore.clearInspector()"
    >
        <template #hero="{ setTab }">
            <div class="device-hero">
                <!-- One identity line: image beside the name. -->
                <div class="device-hero__identity">
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
                            v-if="canEditDevice"
                            type="button"
                            class="device-hero__image-edit"
                            title="Edit device"
                            aria-label="Edit device"
                            @click="deviceEditVisible = true"
                        >
                            <i class="fas fa-pen" />
                        </button>
                    </div>
                    <div class="device-hero__copy">
                        <h3
                            class="device-hero__name"
                            :title="getDeviceName(device.info, shellyID)"
                        >
                            {{ getDeviceName(device.info, shellyID) }}
                        </h3>
                        <!-- Offline devices have no live IP worth showing. -->
                        <span
                            v-if="device.online && deviceIps"
                            class="device-hero__ip"
                            :title="deviceIps"
                        >{{ deviceIps }}</span>
                    </div>
                </div>

                <div class="device-hero__tags">
                    <!-- BLU devices online skip the chip — their live state
                         (open/motion/temp/…) already reads in the panel below. -->
                    <span
                        v-if="!isBluetoothDevice || !device.online"
                        class="device-status-badge"
                        :class="`device-status-badge--${heroStatus.tone}`"
                    >
                        <i
                            v-if="heroStatus.tone === 'sleeping'"
                            class="fas fa-moon"
                            aria-hidden="true"
                        />
                        <span
                            v-else
                            class="device-status-badge__dot"
                            aria-hidden="true"
                        />
                        {{ heroStatus.label }}
                    </span>

                    <!-- Live health facts while online: signal and uptime. -->
                    <span
                        v-if="device.online && heroSignal"
                        class="device-hero__signal"
                        :class="`device-hero__signal--${heroSignal.tier}`"
                        :title="heroSignal.title"
                    >
                        <i class="fas fa-wifi" aria-hidden="true" />
                        {{ heroSignal.rssi }} dBm
                    </span>
                    <span
                        v-if="device.online && heroUptime"
                        class="device-hero__uptime"
                        title="Uptime"
                    >
                        <i class="fas fa-clock" aria-hidden="true" />
                        Up {{ heroUptime }}
                    </span>

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
                    <!-- One chip, not two: the version, and where an update
                         would take it. Actionable — opens firmware settings. -->
                    <button
                        v-if="device?.info?.ver && heroFirmwareUpdate"
                        type="button"
                        class="device-hero__firmware"
                        :class="`device-hero__firmware--${heroFirmwareUpdate.stage}`"
                        :title="
                            heroFirmwareUpdate.stage === 'beta'
                                ? `Beta v${heroFirmwareUpdate.version} available`
                                : `Update to v${heroFirmwareUpdate.version}`
                        "
                        @click="openFirmwareSettings(setTab)"
                    >
                        <i class="fas fa-circle-up" aria-hidden="true" />
                        v{{ device.info.ver }} → v{{ heroFirmwareUpdate.version }}
                        <template v-if="heroFirmwareUpdate.stage === 'beta'">
                            beta
                        </template>
                    </button>
                    <span
                        v-else-if="device?.info?.ver"
                        class="device-hero__firmware"
                    >v{{ device.info.ver }}</span>
                </div>

                <!-- Info is the default body; these buttons drill into the
                     other views (Open Web UI is a modal). -->
                <div class="device-hero__actions">
                    <button
                        v-if="canExecute && showsPhysicalPanels && !isBluetoothDevice"
                        type="button"
                        class="device-hero__btn"
                        title="Opens the device's own web page. Works on your local network only."
                        @click="showWebGuiModal = true"
                    >
                        <i class="fas fa-arrow-up-right-from-square" /> Open Web UI
                    </button>
                    <button
                        type="button"
                        class="device-hero__btn"
                        @click="showRelationshipsModal = true"
                    >
                        <i class="fas fa-diagram-project" aria-hidden="true" /> Relationships
                    </button>
                    <button
                        ref="settingsTriggerRef"
                        type="button"
                        class="device-hero__btn"
                        @click="openSettings(setTab)"
                    >
                        <i class="fas fa-gear" aria-hidden="true" /> Settings
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
                    <Input v-model="wsAddress" :disabled="!canUpdateDevice" />
                    <span class="text-xs">
                        You can edit the default address in
                        <RouterLink to="/settings" class="underline"
                            >settings</RouterLink
                        >
                    </span>
                    <Button type="blue" :disabled="!canUpdateDevice" @click="connectToWs"
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
            <div v-if="profileOptions && device.online && canUpdateDevice && showsPhysicalPanels" class="device-section">
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
            <div v-if="isWallDisplay && device.online && canUpdateDevice && showsPhysicalPanels" class="device-section">
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

            <div v-if="isPillDevice && device.online && canUpdateDevice" class="device-section">
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
            <Modal
                :visible="true"
                wide
                tall
                full-screen-mobile
                @close="requestSettingsExit(() => closeSettings(setTab))"
            >
                <template #title>
                    <div class="device-settings-title">
                        <span>Settings</span>
                    </div>
                </template>
                <div
                    class="device-settings-modal"
                    :class="{'device-settings-modal--mobile-list': mobileSettingsListVisible}"
                >
                    <nav
                        ref="settingsNavRef"
                        class="device-settings-nav"
                        aria-label="Device settings sections"
                    >
                        <div class="device-settings-sidebar-device">
                            <div class="device-settings-preview">
                                <div
                                    class="device-settings-preview__media"
                                    :class="{'device-settings-preview__media--offline': !settingsLiveness.online}"
                                >
                                    <i
                                        v-if="heroLogo.kind === 'icon'"
                                        :class="['device-settings-preview__glyph', heroLogo.faClass]"
                                        :style="heroLogo.accent ? {color: `rgb(var(--accent-${heroLogo.accent}))`} : undefined"
                                        aria-hidden="true"
                                    />
                                    <img
                                        v-else
                                        :src="heroLogo.src"
                                        :alt="getDeviceName(device.info, shellyID)"
                                        @error="handleImgError"
                                    />
                                    <div class="device-settings-preview__indicator">
                                        <DeviceCardStatus :device="device" />
                                    </div>
                                </div>
                            </div>
                            <div class="device-settings-sidebar-device__copy">
                                <span class="device-settings-sidebar-device__name">
                                    <strong>{{ getDeviceName(device.info, shellyID) }}</strong>
                                </span>
                                <span>{{ settingsDeviceSubtitle }}</span>
                                <small>{{ deviceIps || shellyID }}</small>
                            </div>
                            <button
                                v-if="canEditDevice"
                                type="button"
                                class="device-settings-sidebar-device__edit"
                                title="Edit device"
                                aria-label="Edit device"
                                @click="deviceEditVisible = true"
                            >
                                <i class="fas fa-pen" aria-hidden="true" />
                            </button>
                        </div>
                        <div class="search-pill">
                            <i
                                class="fas fa-search search-pill__icon"
                                aria-hidden="true"
                            />
                            <input
                                v-model="settingsNavQuery"
                                type="search"
                                class="search-pill__input"
                                placeholder="Search settings"
                                aria-label="Search settings sections"
                            />
                        </div>
                        <div class="device-settings-nav__sections">
                            <p
                                v-if="settingsNavQuery && !filteredSettingsGroups.length"
                                class="device-settings-nav__no-match"
                            >
                                No sections match "{{ settingsNavQuery }}".
                            </p>
                            <div
                                v-for="group in filteredSettingsGroups"
                                :key="group.id"
                                class="device-settings-nav__group"
                            >
                                <button
                                    type="button"
                                    class="device-settings-nav__label"
                                    :aria-expanded="!isSettingsGroupCollapsed(group.id)"
                                    @click="toggleSettingsGroup(group.id)"
                                >
                                    <span>{{ group.label }}</span>
                                    <span
                                        v-if="isSettingsGroupCollapsed(group.id) && settingsGroupHasDirty(group.id)"
                                        class="device-settings-dirty-dot"
                                        role="img"
                                        aria-label="Unsaved changes"
                                        title="Unsaved changes"
                                    />
                                    <i
                                        class="fas fa-chevron-down device-settings-nav__group-chevron"
                                        :class="{'device-settings-nav__group-chevron--collapsed': isSettingsGroupCollapsed(group.id)}"
                                        aria-hidden="true"
                                    />
                                </button>
                                <button
                                    v-for="section in isSettingsGroupCollapsed(group.id) ? [] : group.items"
                                    :key="section.id"
                                    type="button"
                                    class="device-settings-nav__item"
                                    :class="{'device-settings-nav__item--active': activeSettingsSection === section.id}"
                                    :aria-current="activeSettingsSection === section.id ? 'page' : undefined"
                                    :data-settings-section="section.id"
                                    :title="section.description"
                                    @click="selectSettingsSection(section.id)"
                                    @keydown="onSettingsNavKeydown($event, section.id)"
                                >
                                    <i :class="section.icon" aria-hidden="true" />
                                    <span class="device-settings-nav__copy">
                                        <strong>{{ section.label }}</strong>
                                    </span>
                                    <span
                                        v-if="isSettingsSectionDirty(section.id)"
                                        class="device-settings-dirty-dot"
                                        role="img"
                                        aria-label="Unsaved changes"
                                        title="Unsaved changes"
                                    />
                                </button>
                            </div>
                        </div>
                    </nav>

                    <nav
                        class="device-settings-mobile-list"
                        aria-label="Device settings sections"
                    >
                        <div class="search-pill">
                            <i
                                class="fas fa-search search-pill__icon"
                                aria-hidden="true"
                            />
                            <input
                                v-model="settingsNavQuery"
                                type="search"
                                class="search-pill__input"
                                placeholder="Search settings"
                                aria-label="Search settings sections"
                            />
                        </div>
                        <p
                            v-if="settingsNavQuery && !filteredSettingsGroups.length"
                            class="device-settings-nav__no-match"
                        >
                            No sections match "{{ settingsNavQuery }}".
                        </p>
                        <div
                            v-for="group in filteredSettingsGroups"
                            :key="group.id"
                            class="device-settings-mobile-group"
                        >
                            <button
                                type="button"
                                class="device-settings-nav__label"
                                :aria-expanded="!isSettingsGroupCollapsed(group.id)"
                                @click="toggleSettingsGroup(group.id)"
                            >
                                <span>{{ group.label }}</span>
                                <span
                                    v-if="isSettingsGroupCollapsed(group.id) && settingsGroupHasDirty(group.id)"
                                    class="device-settings-dirty-dot"
                                    role="img"
                                    aria-label="Unsaved changes"
                                    title="Unsaved changes"
                                />
                                <i
                                    class="fas fa-chevron-down device-settings-nav__group-chevron"
                                    :class="{'device-settings-nav__group-chevron--collapsed': isSettingsGroupCollapsed(group.id)}"
                                    aria-hidden="true"
                                />
                            </button>
                            <button
                                v-for="section in isSettingsGroupCollapsed(group.id) ? [] : group.items"
                                :key="section.id"
                                type="button"
                                class="device-settings-mobile-item"
                                :title="section.description"
                                @click="selectSettingsSection(section.id)"
                            >
                                <i :class="section.icon" aria-hidden="true" />
                                <span>
                                    <strong>{{ section.label }}</strong>
                                </span>
                                <span
                                    v-if="isSettingsSectionDirty(section.id)"
                                    class="device-settings-dirty-dot"
                                    role="img"
                                    aria-label="Unsaved changes"
                                    title="Unsaved changes"
                                />
                                <i class="fas fa-chevron-right" aria-hidden="true" />
                            </button>
                        </div>
                    </nav>

                    <div ref="settingsContentRef" class="device-settings-content">
                        <header class="device-settings-workspace__header">
                            <div class="device-settings-workspace__intro">
                                <button
                                    type="button"
                                    class="device-settings-mobile-back"
                                    @click="showMobileSettingsList"
                                >
                                    <i class="fas fa-chevron-left" aria-hidden="true" />
                                    Sections
                                </button>
                                <div class="device-settings-workspace__heading">
                                    <h3>{{ activeSettingsItem.label }}</h3>
                                    <div class="device-settings-workspace__description">
                                        <p v-if="activeSettingsItem.description">{{ activeSettingsItem.description }}</p>
                                        <span
                                            v-if="activeSettingsStatus"
                                            class="device-settings-status-badge"
                                            :class="`device-settings-status-badge--${activeSettingsStatus.tone}`"
                                            role="status"
                                        >
                                            <span
                                                class="device-settings-status-badge__indicator"
                                                aria-hidden="true"
                                            />
                                            {{ activeSettingsStatus.label }}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </header>

                        <Notification v-if="!canUpdateDevice" type="info">
                            You have view-only access to device settings. Ask
                            an admin to make changes.
                        </Notification>

                        <div class="device-settings-workspace">
                            <section
                                v-show="activeSettingsSection === 'general'"
                                class="settings-surface settings-surface--panel"
                            >
                                <div class="settings-group">
                                    <dl class="spec">
                                        <div
                                            v-for="row in deviceAboutRows"
                                            :key="row.label"
                                            class="spec__row"
                                        >
                                            <dt class="spec__key">
                                                {{ row.label }}
                                            </dt>
                                            <dd
                                                class="spec__val"
                                                :class="[
                                                    row.mono && 'spec__val--mono',
                                                    row.tone && `spec__val--${row.tone}`
                                                ]"
                                            >
                                                <span>{{ row.value }}</span>
                                                <button
                                                    v-if="row.copy"
                                                    type="button"
                                                    class="settings-copy"
                                                    :aria-label="`Copy ${row.label}`"
                                                    :title="`Copy ${row.label}`"
                                                    @click="copyDeviceValue(row.copy, row.label)"
                                                >
                                                    <i class="fas fa-copy" aria-hidden="true" />
                                                </button>
                                            </dd>
                                        </div>
                                    </dl>
                                </div>
                                <div
                                    v-if="isPhysicalDevice || !isVirtualDevice"
                                    class="settings-group settings-actions"
                                >
                                    <div class="settings-actions__group">
                                        <Button
                                            v-if="isPhysicalDevice"
                                            type="blue-hollow"
                                            size="sm"
                                            :disabled="!canExecute || !device.online"
                                            :loading="maintenanceRebooting"
                                            @click="confirmMaintenanceReboot"
                                        >
                                            Reboot
                                        </Button>
                                        <Button
                                            v-if="isPhysicalDevice && firmwareHasUpdate"
                                            type="blue"
                                            size="sm"
                                            :disabled="!device.online || !canUpdateDevice"
                                            @click="confirmFirmwareUpdate('stable')"
                                        >
                                            Update
                                        </Button>
                                    </div>
                                    <div class="settings-actions__group">
                                        <Button
                                            v-if="isPhysicalDevice"
                                            type="red"
                                            size="sm"
                                            :disabled="!canExecute"
                                            @click="showDeleteModal = true"
                                        >
                                            Delete
                                        </Button>
                                        <Button
                                            v-if="!isVirtualDevice"
                                            type="red"
                                            size="sm"
                                            :disabled="!canManageDeviceAccess"
                                            @click="denyAccessConfirmVisible = true"
                                        >
                                            Deny access
                                        </Button>
                                        <Button
                                            v-if="isPhysicalDevice"
                                            type="red"
                                            size="sm"
                                            :disabled="!canExecute || !device.online"
                                            :loading="factoryResetting"
                                            @click="confirmFactoryReset"
                                        >
                                            Factory reset
                                        </Button>
                                    </div>
                                </div>
                            </section>

                            <section v-show="activeSettingsSection === 'appearance'" class="settings-surface">
                                <template v-if="hasApplicationSettings">
                                    <div class="settings-group">
                                        <div class="settings-group__heading">
                                            <i class="fas fa-bolt" aria-hidden="true" />
                                            <div>
                                                <h4>Energy calculation</h4>
                                                <p>Measurement points and consumption roles.</p>
                                            </div>
                                        </div>
                                        <DeviceEnergySettings
                                            :shelly-i-d="shellyID"
                                            :device-name="deviceEnergyName"
                                        />
                                    </div>
                                </template>
                            </section>

                            <section v-show="activeSettingsSection === 'relationships'" class="settings-surface">
                                <div class="settings-group">
                                    <div class="settings-form-row">
                                        <div>
                                            <strong>Source devices and bindings</strong>
                                            <span>Components that make up this virtual device.</span>
                                        </div>
                                        <Button
                                            type="blue-hollow"
                                            size="sm"
                                            @click="showRelationshipsModal = true"
                                        >
                                            View relationships
                                        </Button>
                                    </div>
                                </div>
                            </section>

                            <section
                                v-if="isPhysicalDevice"
                                v-show="activeSettingsSection === 'firmware'"
                                class="settings-surface"
                            >
                                <div class="settings-group">
                                    <div class="cfg-panel__row">
                                        <div class="cfg-panel__row-label">
                                            <strong>Update automatically</strong>
                                            <span>Adds a schedule that checks and installs the latest stable firmware.</span>
                                        </div>
                                        <CardToggle
                                            size="row"
                                            :is-on="!!firmwareAutoJob"
                                            :disabled="!device.online || !canUpdateDevice || firmwareAutoBusy"
                                            aria-label="Enable automatic updates"
                                            @toggle="toggleFirmwareAutoUpdate"
                                        />
                                    </div>
                                    <div v-if="firmwareAutoJob" class="cfg-panel__row">
                                        <div class="cfg-panel__row-label">
                                            <strong>Schedule</strong>
                                            <span class="settings-firmware__mono">{{ firmwareAutoJob.timespec }}</span>
                                        </div>
                                        <Button
                                            type="blue-hollow"
                                            size="sm"
                                            @click="selectSettingsSection('config:schedule')"
                                        >
                                            Edit in Schedules
                                        </Button>
                                    </div>
                                </div>
                                <div class="settings-group">
                                    <div class="settings-firmware">
                                        <i
                                            class="fas fa-microchip settings-firmware__chip"
                                            :class="{'settings-firmware__chip--update': firmwareHasUpdate}"
                                            aria-hidden="true"
                                        />
                                        <div class="settings-firmware__copy">
                                            <small>Installed version</small>
                                            <strong>{{ deviceFirmwareBuild }}</strong>
                                            <span
                                                v-if="firmwareHasUpdate"
                                                class="settings-update-chip"
                                            >
                                                <i class="fas fa-arrow-up" aria-hidden="true" />
                                                Update available: {{ firmwareStableVersion || firmwareUpdateVersion }}
                                            </span>
                                            <span
                                                v-else-if="firmwareCheckDone"
                                                class="settings-firmware__current"
                                            >
                                                <i class="fas fa-check" aria-hidden="true" />
                                                Up to date
                                            </span>
                                        </div>
                                        <div class="settings-firmware__actions">
                                            <Button
                                                v-if="firmwareHasUpdate"
                                                type="blue"
                                                size="sm"
                                                :disabled="!device.online || !canUpdateDevice"
                                                :loading="firmwareUpdating === 'stable'"
                                                @click="confirmFirmwareUpdate('stable')"
                                            >
                                                Update
                                            </Button>
                                            <Button
                                                type="blue-hollow"
                                                size="sm"
                                                :disabled="!device.online"
                                                :loading="firmwareChecking"
                                                @click="checkDeviceFirmware"
                                            >
                                                Check for updates
                                            </Button>
                                        </div>
                                    </div>
                                    <div
                                        v-if="firmwareBetaVersion"
                                        class="cfg-panel__row"
                                    >
                                        <div class="cfg-panel__row-label">
                                            <strong>Available beta version</strong>
                                            <span class="settings-firmware__mono">{{ firmwareBetaVersion }}</span>
                                        </div>
                                        <Button
                                            type="blue-hollow"
                                            size="sm"
                                            :disabled="!device.online || !canUpdateDevice"
                                            :loading="firmwareUpdating === 'beta'"
                                            @click="confirmFirmwareUpdate('beta')"
                                        >
                                            Install beta
                                        </Button>
                                    </div>
                                    <Notification v-if="firmwareCheckError" type="warning">
                                        {{ firmwareCheckError }}
                                    </Notification>
                                </div>
                            </section>

                            <section
                                v-if="isPhysicalDevice"
                                v-show="activeSettingsSection === 'devicepassword'"
                                class="settings-surface"
                            >
                                <div class="settings-form-row">
                                    <div>
                                        <strong>Password protection</strong>
                                        <span>{{ devicePasswordStatus }} The password protects the device's own web interface, not Fleet Manager.</span>
                                    </div>
                                    <Button
                                        type="blue"
                                        size="sm"
                                        :disabled="!canUpdateDevice || !device.online"
                                        @click="devicePasswordModalVisible = true"
                                    >
                                        Set password
                                    </Button>
                                </div>
                            </section>

                            <template
                                v-for="([key, entry]) in supportedRegistryEntries"
                                :key="key"
                            >
                                <div
                                    v-if="mountedSettingsSections.has(`config:${key}`) || activeSettingsSection === `config:${key}`"
                                    v-show="activeSettingsSection === `config:${key}`"
                                >
                                    <Notification v-if="!device.online" type="warning">
                                        This device is offline. Configuration controls will load when it reconnects.
                                    </Notification>
                                    <fieldset
                                        v-if="mountedSettingsSections.has(`config:${key}`)"
                                        class="settings-capability"
                                        :disabled="!device.online || !canUpdateDevice"
                                        :aria-disabled="!device.online || !canUpdateDevice"
                                    >
                                        <component
                                            :is="entry.panel"
                                            :shelly-i-d="shellyID"
                                            v-bind="entry.panelProps"
                                            @dirty-change="setSettingsSectionDirty(
                                                `config:${key}`,
                                                'panel-event',
                                                $event
                                            )"
                                        />
                                    </fieldset>
                                </div>
                            </template>

                            <div
                                v-if="(mountedSettingsSections.has('addon') || activeSettingsSection === 'addon') && isAddonCapable && !isPillDevice"
                                v-show="activeSettingsSection === 'addon'"
                            >
                                <Notification v-if="!device.online" type="warning">
                                    This device is offline. Configuration controls will load when it reconnects.
                                </Notification>
                                <fieldset
                                    v-if="mountedSettingsSections.has('addon')"
                                    class="settings-capability"
                                    :disabled="!device.online || !canUpdateDevice"
                                    :aria-disabled="!device.online || !canUpdateDevice"
                                >
                                    <AddonConfig :shelly-i-d="shellyID" />
                                </fieldset>
                            </div>
                            <div
                                v-if="(mountedSettingsSections.has('components') || activeSettingsSection === 'components') && hasVirtualComponents"
                                v-show="activeSettingsSection === 'components'"
                            >
                                <Notification
                                    v-if="!device.online && !isVirtualDevice"
                                    type="warning"
                                >
                                    This device is offline. Configuration controls will load when it reconnects.
                                </Notification>
                                <fieldset
                                    v-if="mountedSettingsSections.has('components')"
                                    class="settings-capability"
                                    :disabled="(!device.online && !isVirtualDevice) || !canUpdateDevice"
                                    :aria-disabled="(!device.online && !isVirtualDevice) || !canUpdateDevice"
                                >
                                    <VirtualComponentManager :shelly-i-d="shellyID" />
                                </fieldset>
                            </div>
                            <div
                                v-if="(mountedSettingsSections.has('bthome') || activeSettingsSection === 'bthome') && hasBtHome"
                                v-show="activeSettingsSection === 'bthome'"
                            >
                                <Notification v-if="!device.online" type="warning">
                                    This device is offline. Configuration controls will load when it reconnects.
                                </Notification>
                                <fieldset
                                    v-if="mountedSettingsSections.has('bthome')"
                                    class="settings-capability"
                                    :disabled="!device.online || !canUpdateDevice"
                                    :aria-disabled="!device.online || !canUpdateDevice"
                                >
                                    <BtHomeConfig :shelly-i-d="shellyID" />
                                </fieldset>
                            </div>
                            <div
                                v-if="(mountedSettingsSections.has('led') || activeSettingsSection === 'led') && hasLedConfig"
                                v-show="activeSettingsSection === 'led'"
                            >
                                <Notification v-if="!device.online" type="warning">
                                    This device is offline. Configuration controls will load when it reconnects.
                                </Notification>
                                <fieldset
                                    v-if="mountedSettingsSections.has('led')"
                                    class="settings-capability"
                                    :disabled="!device.online || !canUpdateDevice"
                                    :aria-disabled="!device.online || !canUpdateDevice"
                                >
                                    <DeviceLedConfig
                                        :shelly-i-d="shellyID"
                                        :can-execute="canUpdateDevice"
                                    />
                                </fieldset>
                            </div>

                            <section
                                v-show="activeSettingsSection === 'advanced'"
                                class="settings-surface"
                            >
                                <DeviceDiagnosticsPanel
                                    :shelly-i-d="shellyID"
                                    :information="device.info ?? {}"
                                    :status="device.status ?? {}"
                                    :configuration="device.settings ?? {}"
                                    :methods="device.methods ?? []"
                                    :online="device.online === true"
                                    :can-execute="canSendDiagnosticCommand"
                                    :can-backup="device.capabilities?.backup === true"
                                />
                            </section>
                        </div>
                    </div>
                </div>
            </Modal>
        </template>
    </BoardTabs>
    <div v-else class="pt-8 text-center">
        <span>Device {{ shellyID }} not found</span>
    </div>
    <!-- Relationships in its own workspace modal, like Settings. -->
    <Modal
        :visible="showRelationshipsModal"
        large
        tall
        @close="showRelationshipsModal = false"
    >
        <template #title>Relationships</template>
        <DeviceRelationshipsPanel
            v-if="showRelationshipsModal"
            :shelly-i-d="shellyID"
            class="device-relationships-modal"
        />
    </Modal>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    provide,
    ref,
    toRefs,
    watch
} from 'vue';
import {useRouter} from 'vue-router';
import CardToggle from '@/components/cards/CardToggle.vue';
import BluAssistPanel from '@/components/core/BluAssistPanel.vue';
import ExtractGroupModal from '@/components/devices/add/ExtractGroupModal.vue';
import ConnectedComponentsSection from '@/components/devices/ConnectedComponentsSection.vue';
import DeviceCardStatus from '@/components/devices/DeviceCardStatus.vue';
import DeviceDiagnosticsPanel from '@/components/devices/DeviceDiagnosticsPanel.vue';
import DeviceEnergySettings from '@/components/devices/DeviceEnergySettings.vue';
import DeviceRelationshipsPanel from '@/components/devices/DeviceRelationshipsPanel.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import DeviceDeleteModal from '@/components/modals/DeviceDeleteModal.vue';
import DeviceEditModal from '@/components/modals/DeviceEditModal.vue';
import DeviceWebGuiModal from '@/components/modals/DeviceWebGuiModal.vue';
import EmDeviceOptionsModal from '@/components/modals/EmDeviceOptionsModal.vue';
import Modal from '@/components/modals/Modal.vue';
import VirtualEditModal from '@/components/modals/VirtualEditModal.vue';
import SetPasswordModal from '@/components/pages/device-auth/SetPasswordModal.vue';
import {useDeviceKind} from '@/composables/useDeviceKind';
import {pillModeLabel, usePillModes} from '@/composables/usePillModes';
import {settingsDirtyTrackerKey} from '@/composables/useSettingsDirtyTracker';
import {getBThomeBinaryStateWords} from '@/config/bthome-presentation';
import {
    DEVICE_CONFIG_GROUPS,
    DEVICE_CONFIG_REGISTRY,
    type DeviceConfigGroupId,
    type DeviceConfigStatus,
    deviceShows
} from '@/config/device-config-registry';
import {
    formatBTHomeChannelLabel,
    formatBTHomeEventName,
    getBTHomeEventSourceLabel,
    isBTHomeControlSensor
} from '@/helpers/bthome-controls';
import {EntityBoard} from '@/helpers/components';
import {
    deviceSupports,
    getDeviceName,
    getLevelIndicator,
    getLogo,
    handleDeviceImgError,
    isDiscovered
} from '@/helpers/device';
import {resolveDeviceLiveness} from '@/helpers/deviceLiveness';
import {resolveAssetSrc, resolveDeviceLogo} from '@/helpers/deviceLogo';
import {toastRpcError} from '@/helpers/domainErrors';
import {
    entityNumericProp,
    entityStringListProp,
    entityStringProp
} from '@/helpers/entityProps';
import {formatDuration} from '@/helpers/format';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {defaultWs} from '@/helpers/ui';
import {
    devices as hostDevices,
    virtualDevices
} from '@/shell/template-host';
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
const router = useRouter();

const showDeleteModal = ref(false);
function onDeviceRemoved(): void {
    showDeleteModal.value = false;
    void router.push('/devices');
}
const authStore = useAuthStore();

const canExecute = computed(() => authStore.canExecuteDevice(shellyID.value));
const canUpdateDevice = computed(() =>
    authStore.canPerformComponent('devices', 'update', shellyID.value)
);
const canManageDeviceAccess = computed(
    () =>
        authStore.canPerformComponent('waiting_room', 'update') ||
        authStore.canPerformComponent('waiting_room', 'delete')
);

const device = computed(() => deviceStore.devices[shellyID.value]);
const deviceSource = computed(() => device.value?.source);
const {
    isVirtual: isVirtualDevice,
    isBluetooth: isBluetoothDevice,
    isPhysical: isPhysicalDevice,
    showsPhysicalPanels
} = useDeviceKind(shellyID, deviceSource);

const batteryPercent = computed(() => {
    const level = getLevelIndicator(device.value);
    return level.type === 'battery' ? level.value : null;
});
const settingsLiveness = computed(() => resolveDeviceLiveness(device.value));
const settingsConnectionStatus = computed(() => {
    if (device.value?.loading) {
        return {
            kind: 'loading',
            label: 'Connecting',
            icon: 'fas fa-spinner fa-spin'
        };
    }
    if (settingsLiveness.value.sleeping) {
        return {kind: 'sleeping', label: 'Sleeping', icon: 'fas fa-moon'};
    }
    if (!settingsLiveness.value.online) {
        return {kind: 'offline', label: 'Offline', icon: 'fas fa-circle'};
    }
    return {kind: 'online', label: 'Online', icon: 'fas fa-circle'};
});

// Both IPs when present (eth / wifi), so the tags row can show reachability.
const deviceIps = computed(() => {
    const status = device.value?.status as Record<string, unknown> | undefined;
    const eth = (status?.eth as {ip?: string} | undefined)?.ip;
    const wifi = (status?.wifi as {sta_ip?: string} | undefined)?.sta_ip;
    return [eth, wifi].filter(Boolean).join(' / ');
});

const lastSeenText = computed(() => {
    const reportMs = settingsLiveness.value.lastReportMs;
    if (reportMs === null) return 'unknown';
    const diffS = Math.max(0, Math.floor((Date.now() - reportMs) / 1000));
    if (diffS < 60) return 'just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return `${Math.floor(diffS / 86400)}d ago`;
});

// One pencil opens DeviceEditModal — name, picture, and icon in one place.
const deviceEditVisible = ref(false);
const canEditDevice = computed(() => canUpdateDevice.value && !!device.value);
const deviceEnergyName = computed(
    () => getDeviceName(device.value?.info, shellyID.value) || shellyID.value
);
const wsAddress = ref(defaultWs.value);

const tabs = ref([{name: 'settings', icon: 'fas fa-gear'}]);

const showRelationshipsModal = ref(false);

interface SettingsNavItem {
    id: string;
    label: string;
    description: string;
    icon: string;
}

interface SettingsNavGroup {
    id: string;
    label: string;
    items: SettingsNavItem[];
}

const activeSettingsSection = ref('general');
const mountedSettingsSections = ref(new Set(['general']));
const mobileSettingsListVisible = ref(true);
const settingsDirtySources = ref(new Map<string, Set<string>>());
const settingsExitConfirmVisible = ref(false);
const denyAccessConfirmVisible = ref(false);
let pendingSettingsExit: (() => void) | null = null;
const settingsTriggerRef = ref<HTMLButtonElement | null>(null);
const settingsContentRef = ref<HTMLElement | null>(null);
const settingsNavRef = ref<HTMLElement | null>(null);

const hasUnsavedSettings = computed(
    () => settingsDirtySources.value.size > 0
);

function setSettingsSectionDirty(
    sectionId: string,
    sourceId: string,
    dirty: boolean
): void {
    const next = new Map(settingsDirtySources.value);
    const sources = new Set(next.get(sectionId) ?? []);
    if (dirty) sources.add(sourceId);
    else sources.delete(sourceId);
    if (sources.size) next.set(sectionId, sources);
    else next.delete(sectionId);
    settingsDirtySources.value = next;
}

provide(settingsDirtyTrackerKey, {setDirty: setSettingsSectionDirty});

function isSettingsSectionDirty(sectionId: string): boolean {
    return settingsDirtySources.value.has(sectionId);
}

function selectSettingsSection(sectionId: string): void {
    activeSettingsSection.value = sectionId;
    mobileSettingsListVisible.value = false;
    void nextTick(() => {
        if (settingsContentRef.value) settingsContentRef.value.scrollTop = 0;
    });
}

// Roving arrow-key navigation across the sidebar sections (matches the
// tablist behavior of the Wi-Fi and Bluetooth panels).
function onSettingsNavKeydown(event: KeyboardEvent, sectionId: string): void {
    const order = filteredSettingsGroups.value.flatMap((group) =>
        group.items.map((item) => item.id)
    );
    const index = order.indexOf(sectionId);
    if (index === -1) return;
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (index + 1) % order.length;
    else if (event.key === 'ArrowUp') {
        next = (index - 1 + order.length) % order.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next === null) return;
    event.preventDefault();
    settingsNavRef.value
        ?.querySelector<HTMLButtonElement>(
            `[data-settings-section="${order[next]}"]`
        )
        ?.focus();
}

function showMobileSettingsList(): void {
    mobileSettingsListVisible.value = true;
}

function requestSettingsExit(action: () => void): void {
    if (!hasUnsavedSettings.value) {
        action();
        return;
    }
    pendingSettingsExit = action;
    settingsExitConfirmVisible.value = true;
}

function cancelSettingsExit(): void {
    settingsExitConfirmVisible.value = false;
    pendingSettingsExit = null;
}

function discardSettingsAndExit(): void {
    const action = pendingSettingsExit;
    pendingSettingsExit = null;
    settingsExitConfirmVisible.value = false;
    // Unmount every lazily mounted panel so discarded drafts are actually
    // dropped — clearing the dirty map alone would keep stale form state
    // alive if a future exit path stops unmounting the settings slot.
    mountedSettingsSections.value = new Set();
    settingsDirtySources.value = new Map();
    action?.();
}

// Every state gets the same chip. Online used to be a bare dot, which left
// the most common state as the only one carrying no word.
const heroStatus = computed<{tone: string; label: string}>(() => {
    if (device.value?.loading) return {tone: 'loading', label: 'Connecting'};
    if (device.value?.sleeping) return {tone: 'sleeping', label: 'Sleeping'};
    if (!device.value?.online) return {tone: 'offline', label: 'Offline'};
    return {tone: 'online', label: 'Online'};
});

// Same thresholds as the Details page signal tile.
const heroSignal = computed(() => {
    const wifi = device.value?.status?.wifi;
    if (typeof wifi?.rssi !== 'number') return null;
    const rssi = wifi.rssi;
    const tier = rssi >= -60 ? 'good' : rssi >= -75 ? 'ok' : 'warn';
    const quality = rssi >= -60 ? 'Strong' : rssi >= -75 ? 'Fair' : 'Weak';
    const ssid = wifi.ssid ? ` on ${wifi.ssid}` : '';
    return {rssi, tier, title: `${quality} Wi-Fi signal${ssid}`};
});

const heroUptime = computed(() => {
    const sys = (device.value?.status as {sys?: {uptime?: number}} | undefined)
        ?.sys;
    if (typeof sys?.uptime !== 'number') return null;
    return formatDuration(sys.uptime);
});

function openFirmwareSettings(setTab: (name: string) => void): void {
    openSettings(setTab);
    activeSettingsSection.value = 'firmware';
    mountedSettingsSections.value = new Set(['firmware']);
}

function openSettings(setTab: (name: string) => void): void {
    const settingsSection = firstSettingsSection();
    activeSettingsSection.value = settingsSection;
    mountedSettingsSections.value = new Set([settingsSection]);
    mobileSettingsListVisible.value = true;
    settingsDirtySources.value = new Map();
    settingsNavQuery.value = '';
    setTab('settings');
}

function closeSettings(setTab: (name: string) => void): void {
    setTab('info');
    void nextTick(() => settingsTriggerRef.value?.focus());
}

const settingsGroups = computed<SettingsNavGroup[]>(() => {
    const deviceItems: SettingsNavItem[] = [
        {
            id: 'general',
            label: 'Details',
            description: '',
            icon: 'fas fa-circle-info'
        }
    ];

    if (hasApplicationSettings.value) {
        deviceItems.push({
            id: 'appearance',
            label: 'Energy settings',
            description: 'Measurement points and consumption roles',
            icon: 'fas fa-bolt'
        });
    }

    if (isVirtualDevice.value) {
        deviceItems.push({
            id: 'relationships',
            label: 'Relationships',
            description: 'Inspect source devices and component bindings',
            icon: 'fas fa-diagram-project'
        });
    }

    const groups: SettingsNavGroup[] = deviceItems.length
        ? [{id: 'device', label: 'Device', items: deviceItems}]
        : [];

    if (!isVirtualDevice.value) {
        const registryItems = supportedRegistryEntries.value
            .map(([key, entry]) => ({
                id: `config:${key}`,
                label: entry.title,
                description: entry.description,
                icon: entry.icon,
                group: entry.group
            }));
        const extraItems = new Map<DeviceConfigGroupId, SettingsNavItem[]>();
        if (isAddonCapable.value && !isPillDevice.value) {
            extraItems.set('hardware', [
                {
                    id: 'addon',
                    label: 'Add-on peripherals',
                    description:
                        'Configure attached sensors and peripheral hardware',
                    icon: 'fas fa-puzzle-piece'
                }
            ]);
        }
        if (hasVirtualComponents.value) {
            extraItems.set('automation', [
                ...(extraItems.get('automation') ?? []),
                {
                    id: 'components',
                    label: 'Virtual components',
                    description: 'Create and manage virtual device components',
                    icon: 'fas fa-layer-group'
                }
            ]);
        }
        if (hasBtHome.value) {
            extraItems.set('bluetooth', [
                ...(extraItems.get('bluetooth') ?? []),
                {
                    id: 'bthome',
                    label: 'Assigned Bluetooth devices',
                    description: 'Shelly BLU sensors and remotes this device listens to',
                    icon: 'fab fa-bluetooth-b'
                }
            ]);
        }
        if (hasLedConfig.value) {
            extraItems.set('hardware', [
                ...(extraItems.get('hardware') ?? []),
                {
                    id: 'led',
                    label: 'Device LED',
                    description:
                        'Configure device indicator behavior and brightness',
                    icon: 'fas fa-lightbulb'
                }
            ]);
        }

        for (const group of DEVICE_CONFIG_GROUPS) {
            const items = [
                ...registryItems.filter((entry) => entry.group === group.id),
                ...(extraItems.get(group.id) ?? [])
            ];
            if (items.length) {
                groups.push({id: group.id, label: group.label, items});
            }
        }
    } else if (isVirtualDevice.value && hasVirtualComponents.value) {
        groups.push({
            id: 'automation',
            label: 'Automation',
            items: [
                {
                    id: 'components',
                    label: 'Virtual components',
                    description: 'Create and manage this device\'s components',
                    icon: 'fas fa-layer-group'
                }
            ]
        });
    }

    const diagnosticsItem: SettingsNavItem = {
        id: 'advanced',
        label: 'Diagnostics',
        description: 'Raw snapshots, tools and device command console',
        icon: 'fas fa-wave-square'
    };
    const systemGroup = groups.find((group) => group.id === 'system');
    if (systemGroup) systemGroup.items.push(diagnosticsItem);
    else groups.push({id: 'system', label: 'System', items: [diagnosticsItem]});

    if (!isVirtualDevice.value && isPhysicalDevice.value) {
        groups.push({
            id: 'maintenance',
            label: 'Maintenance',
            items: [
                {
                    id: 'firmware',
                    label: 'Firmware',
                    description: 'Installed version and available updates',
                    icon: 'fas fa-download'
                },
                {
                    id: 'devicepassword',
                    label: 'Device password',
                    description: 'Protect the device web interface',
                    icon: 'fas fa-key'
                }
            ]
        });
    }
    return groups;
});

const settingsItems = computed(() =>
    settingsGroups.value.flatMap((group) => group.items)
);
const settingsNavQuery = ref('');

// Folded nav groups — persisted per browser so rarely used groups stay put.
const SETTINGS_GROUPS_COLLAPSED_KEY = 'fm.device-settings.collapsed-groups';
function loadCollapsedSettingsGroups(): Set<string> {
    try {
        const raw = localStorage.getItem(SETTINGS_GROUPS_COLLAPSED_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return new Set(
            Array.isArray(parsed)
                ? parsed.filter((v): v is string => typeof v === 'string')
                : []
        );
    } catch {
        return new Set();
    }
}
const collapsedSettingsGroups = ref<Set<string>>(
    loadCollapsedSettingsGroups()
);
function isSettingsGroupCollapsed(id: string): boolean {
    // A search shows every match — folding only applies while browsing.
    if (settingsNavQuery.value.trim()) return false;
    return collapsedSettingsGroups.value.has(id);
}
function toggleSettingsGroup(id: string): void {
    const next = new Set(collapsedSettingsGroups.value);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    collapsedSettingsGroups.value = next;
    try {
        localStorage.setItem(
            SETTINGS_GROUPS_COLLAPSED_KEY,
            JSON.stringify([...next])
        );
    } catch {
        // Storage refused (private mode) — only the fold preference is lost.
    }
}
function settingsGroupHasDirty(id: string): boolean {
    const group = settingsGroups.value.find((g) => g.id === id);
    return group?.items.some((item) => isSettingsSectionDirty(item.id)) ?? false;
}
// Load the auto-update state the first time the firmware page opens.
watch(activeSettingsSection, (id) => {
    if (id === 'firmware' && firmwareAutoLoadedFor !== shellyID.value) {
        firmwareAutoLoadedFor = shellyID.value;
        void loadFirmwareAutoUpdate();
    }
});
// Selecting a section (search hit, deep link) unfolds its group so the
// active item is never hidden.
watch(activeSettingsSection, (id) => {
    const group = settingsGroups.value.find((g) =>
        g.items.some((item) => item.id === id)
    );
    if (group && collapsedSettingsGroups.value.has(group.id)) {
        toggleSettingsGroup(group.id);
    }
});

const filteredSettingsGroups = computed<SettingsNavGroup[]>(() => {
    const query = settingsNavQuery.value.trim().toLowerCase();
    if (!query) return settingsGroups.value;
    return settingsGroups.value
        .map((group) => ({
            ...group,
            items: group.items.filter(
                (item) =>
                    item.label.toLowerCase().includes(query) ||
                    item.description.toLowerCase().includes(query) ||
                    group.label.toLowerCase().includes(query)
            )
        }))
        .filter((group) => group.items.length > 0);
});
const defaultSettingsItem: SettingsNavItem = {
    id: 'general',
    label: 'Details',
    description: 'Identity, network and firmware information',
    icon: 'fas fa-circle-info'
};
const activeSettingsItem = computed(
    () =>
        settingsItems.value.find(
            (item) => item.id === activeSettingsSection.value
        ) ?? defaultSettingsItem
);
const activeSettingsStatus = computed(() => {
    if (!activeSettingsSection.value.startsWith('config:')) return null;
    const key = activeSettingsSection.value.slice('config:'.length);
    return DEVICE_CONFIG_REGISTRY[key]?.status?.(device.value ?? {}) ?? null;
});
const settingsDeviceSubtitle = computed(() => {
    const info = device.value?.info;
    const candidates = [info?.app, info?.model];
    const label = candidates.find(
        (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
    );
    return label ?? (isVirtualDevice.value ? 'Virtual device' : shellyID);
});
// Channel inventory comes from the components the device itself reports in
// status. Everything else there (scripts, matter, BTHome, *data mirrors, UI
// helpers) is not a channel and must not be counted.
const OUTPUT_COMPONENTS = ['switch', 'light', 'cover', 'rgb', 'rgbw', 'cct'];
const METER_COMPONENTS = ['em', 'em1', 'pm1'];

function componentIds(kinds: string[]): string[] {
    const status = device.value?.status ?? {};
    return Object.keys(status)
        .filter((key) => kinds.includes(key.split(':')[0]))
        .sort();
}

// Listing ids answers "which ones"; past a handful the count is the useful
// part and the ids would just bloat the row.
function channelSummary(ids: string[]): string | null {
    if (!ids.length) return null;
    if (ids.length > 4) return String(ids.length);
    return `${ids.length} (${ids.join(', ')})`;
}

// New firmware the device itself reports — surfaced here so nobody has to
// open the Firmware page to notice it.
const firmwareUpdateVersion = computed(() => {
    const sys = (
        device.value?.status as
            | {sys?: {available_updates?: {stable?: {version?: string}}}}
            | undefined
    )?.sys;
    return sys?.available_updates?.stable?.version ?? null;
});

interface DeviceAboutRow {
    label: string;
    value: string;
    mono?: boolean;
    copy?: string;
    tone?: 'on' | 'off' | 'warn';
}

// One table: the live facts an operator checks first, then the identity of
// the hardware. Same row shape throughout so the columns line up.
const deviceAboutRows = computed<DeviceAboutRow[]>(() => {
    const current = device.value;
    const info = current?.info;
    const wifi = current?.status?.wifi;
    const sys = (current?.status as {sys?: {uptime?: number}} | undefined)?.sys;
    const cloud = current?.status?.cloud as {connected?: boolean} | undefined;
    const connection = settingsConnectionStatus.value;
    const externalId = current?.shellyID ?? shellyID.value;
    const rssi = wifi?.rssi;
    const outputsSummary = channelSummary(componentIds(OUTPUT_COMPONENTS));
    const inputsSummary = channelSummary(componentIds(['input']));
    const metersSummary = channelSummary(componentIds(METER_COMPONENTS));
    const rows: Array<DeviceAboutRow | null> = [
        {
            label: 'Status',
            value: connection.label,
            tone:
                connection.kind === 'online'
                    ? 'on'
                    : connection.kind === 'offline'
                      ? 'off'
                      : 'warn'
        },
        settingsLiveness.value.online && typeof sys?.uptime === 'number'
            ? {label: 'Uptime', value: formatDuration(sys.uptime)}
            : lastSeenText.value !== 'unknown'
              ? {label: 'Last seen', value: lastSeenText.value}
              : null,
        typeof rssi === 'number'
            ? {
                  label: 'Signal',
                  value: `${rssi >= -60 ? 'Strong' : rssi >= -75 ? 'Fair' : 'Weak'} ${rssi} dBm`,
                  tone: rssi >= -60 ? 'on' : rssi >= -75 ? 'warn' : 'off'
              }
            : null,
        typeof wifi?.channel === 'number'
            ? {label: 'Wi-Fi channel', value: String(wifi.channel)}
            : null,
        deviceIps.value
            ? {
                  label: 'IP address',
                  value: deviceIps.value,
                  copy: deviceIps.value
              }
            : null,
        info?.mac
            ? {
                  label: 'MAC address',
                  value: String(info.mac),
                  mono: true,
                  copy: String(info.mac)
              }
            : null,
        wifi?.ssid ? {label: 'Network', value: wifi.ssid} : null,
        typeof cloud?.connected === 'boolean'
            ? {
                  label: 'Cloud',
                  value: cloud.connected ? 'Connected' : 'Not connected',
                  tone: cloud.connected ? 'on' : undefined
              }
            : null,
        info?.app ? {label: 'Type', value: info.app} : null,
        info?.model ? {label: 'Model', value: info.model} : null,
        typeof info?.gen === 'number'
            ? {label: 'Generation', value: `Gen ${info.gen}`}
            : null,
        outputsSummary ? {label: 'Outputs', value: outputsSummary} : null,
        inputsSummary ? {label: 'Inputs', value: inputsSummary} : null,
        metersSummary ? {label: 'Meters', value: metersSummary} : null,
        info?.ver ? {label: 'Firmware', value: info.ver} : null,
        current?.id != null
            ? {
                  label: 'ID',
                  value: String(current.id),
                  mono: true,
                  copy: String(current.id)
              }
            : null,
        {label: 'External ID', value: externalId, mono: true, copy: externalId},
        firmwareUpdateVersion.value
            ? {
                  label: 'Update available',
                  value: firmwareUpdateVersion.value,
                  tone: 'warn'
              }
            : null
    ];
    return rows.filter((row): row is DeviceAboutRow => row !== null);
});

async function copyDeviceValue(value: string, label: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(value);
        toastStore.success(`${label} copied`);
    } catch {
        toastStore.error('Could not copy to the clipboard');
    }
}
const supportedRegistryEntries = computed(() => {
    if (isVirtualDevice.value) return [];
    return Object.entries(DEVICE_CONFIG_REGISTRY).filter(([, entry]) =>
        deviceShows(device.value, entry)
    );
});
// Live status per nav section (Connected/Disconnected/Enabled dots) so
// unhealthy transports are visible before opening the section.
const settingsNavStatuses = computed(() => {
    const statuses: Record<string, DeviceConfigStatus> = {};
    if (!device.value) return statuses;
    for (const [key, entry] of supportedRegistryEntries.value) {
        const status = entry.status?.(device.value);
        if (status) statuses[`config:${key}`] = status;
    }
    return statuses;
});
function settingsSectionRequiresOnline(id: string): boolean {
    return (
        id.startsWith('config:') ||
        ['addon', 'bthome', 'led'].includes(id) ||
        (id === 'components' && !isVirtualDevice.value)
    );
}

function mountSettingsSection(id: string): void {
    if (settingsSectionRequiresOnline(id) && !device.value?.online) return;
    if (mountedSettingsSections.value.has(id)) return;
    mountedSettingsSections.value = new Set(mountedSettingsSections.value).add(id);
}

watch(activeSettingsSection, mountSettingsSection, {immediate: true});
watch(
    () => device.value?.online,
    (online) => {
        if (online) mountSettingsSection(activeSettingsSection.value);
    }
);

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
const selectedEMDevices = ref<EmDevice[]>([]);

// Physical-device override lives in device.list, not in the WS device
// snapshot, so fetch + cache it locally.
const physicalAssetId = ref<string | null>(null);
const physicalIcon = ref<string | null>(null);
const hasApplicationSettings = computed(
    () =>
        canUpdateDevice.value &&
        !isVirtualDevice.value &&
        !isBluetoothDevice.value
);
const canSendDiagnosticCommand = computed(
    () =>
        canExecute.value &&
        !isVirtualDevice.value &&
        !isBluetoothDevice.value
);

// DeviceEditModal saved name/appearance — pull the authoritative device
// snapshot and the physical override back into the board.
function onDeviceEdited(): void {
    deviceEditVisible.value = false;
    void loadPhysicalAssetId(shellyID.value, deviceGeneration);
    void loadFullDeviceForBoard(shellyID.value, deviceGeneration);
}

async function loadPhysicalAssetId(
    targetShellyID = shellyID.value,
    generation = deviceGeneration
): Promise<void> {
    const requestId = ++imageRequestSequence;
    const source = deviceStore.devices[targetShellyID]?.source;
    if (source === 'virtual' || source === 'bluetooth') return;
    try {
        const result = await hostDevices.getImage({
            shellyID: targetShellyID
        });
        if (!ownsImageRequest(targetShellyID, generation, requestId)) return;
        physicalAssetId.value = result.imageAssetId;
        physicalIcon.value = result.icon;
    } catch (error) {
        if (!ownsImageRequest(targetShellyID, generation, requestId)) return;
        physicalAssetId.value = null;
        physicalIcon.value = null;
        debugWarn('Device board image load failed', {
            shellyID: targetShellyID,
            error
        });
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

// Binary state words are presentation, keyed on the backend-sent objName.
function formatBTHomeBinaryValue(objName: string, value: boolean): string {
    const words = getBThomeBinaryStateWords(objName);
    return value ? words.on : words.off;
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

// Backend capability: device advertises Pill.SetConfig (pin-mode UI).
const isPillDevice = computed(
    () => !!device.value?.capabilities?.ui?.pillPinMode
);

// Virtual component management — user can add/delete virtual components
const hasVirtualComponents = computed(
    () => !!device.value?.capabilities?.virtualComponents
);

// BTHome support — device has bthome component
const hasBtHome = computed(() => {
    const settings = device.value?.settings;
    return settings && 'bthome' in settings;
});

// Backend capability: device reports a `*_ui` LED-settings component.
const hasLedConfig = computed(
    () => !!device.value?.capabilities?.ui?.ledSettings
);

// Addon-capable devices always have addon_type key in sys.device config
// (value is null when unconfigured, string when set).
// Devices without addon slot (Plugs, WallDisplay, Gateway) omit the key entirely.
const isAddonCapable = computed(() => {
    const sysDevice = device.value?.settings?.sys?.device;
    return sysDevice != null && 'addon_type' in sysDevice;
});

// settingsItems evaluates every capability used to build the navigation.
// Register this watcher only after those computeds have been initialized.
watch(settingsItems, (items) => {
    if (!items.some((section) => section.id === activeSettingsSection.value)) {
        const settingsSection = items[0]?.id ?? 'advanced';
        activeSettingsSection.value = settingsSection;
        mountedSettingsSections.value = new Set([settingsSection]);
    }
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

async function loadProfiles(
    targetShellyID = shellyID.value,
    generation = deviceGeneration
): Promise<void> {
    const requestId = ++profileRequestSequence;
    const targetDevice = deviceStore.devices[targetShellyID];
    if (!targetDevice?.info?.profile || !targetDevice.online) return;
    try {
        const resp = await ws.sendRPC('FLEET_MANAGER', 'Shelly.ListProfiles', {
            shellyID: targetShellyID
        });
        if (!ownsProfileRequest(targetShellyID, generation, requestId)) return;
        if (resp?.profiles && typeof resp.profiles === 'object') {
            profileList.value = Object.keys(resp.profiles).map((name) => ({
                value: name,
                label:
                    name.charAt(0).toUpperCase() +
                    name.slice(1).replace(/_/g, ' ')
            }));
        }
    } catch (error) {
        if (!ownsProfileRequest(targetShellyID, generation, requestId)) return;
        debugWarn('Device profile list unavailable', {
            shellyID: targetShellyID,
            error
        });
    }
}

async function changeProfile(newProfile: string) {
    if (
        !canUpdateDevice.value ||
        newProfile === deviceProfile.value ||
        profileChanging.value
    ) {
        return;
    }
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    profileChanging.value = true;
    profileError.value = null;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.SetProfile', {
            shellyID: targetShellyID,
            name: newProfile
        });
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.success(
            `Profile changed to "${newProfile}". Device may reboot to apply changes.`
        );
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        profileError.value = rpcErrorMessage(
            error,
            'Failed to change profile'
        );
    } finally {
        if (ownsDeviceGeneration(targetShellyID, generation)) {
            profileChanging.value = false;
        }
    }
}

// Wall Display mode (relay vs thermostat)
const isBluAssistantCapable = computed(() =>
    deviceSupports(device.value as never, 'GATTC.Scan')
);

// Backend capability: Wall Display supports the relay↔thermostat mode switch.
const isWallDisplay = computed(
    () => !!device.value?.capabilities?.ui?.wallDisplay
);

const wallDisplayMode = computed(() => {
    const status = device.value?.status;
    if (!status) return 'relay';
    // If thermostat:0 exists in status, we're in thermostat mode
    return status['thermostat:0'] ? 'thermostat' : 'relay';
});

const wallDisplayModeChanging = ref(false);

async function changeWallDisplayMode(newMode: string) {
    if (
        !canUpdateDevice.value ||
        newMode === wallDisplayMode.value ||
        wallDisplayModeChanging.value
    )
        return;
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    wallDisplayModeChanging.value = true;
    try {
        if (newMode === 'thermostat') {
            await ws.sendRPC('FLEET_MANAGER', 'Thermostat.Create', {
                shellyID: targetShellyID,
                config: {}
            });
            if (!ownsDeviceGeneration(targetShellyID, generation)) return;
            toastStore.success('Thermostat created. Device is rebooting...');
        } else {
            await ws.sendRPC('FLEET_MANAGER', 'Thermostat.Delete', {
                shellyID: targetShellyID,
                id: 0
            });
            if (!ownsDeviceGeneration(targetShellyID, generation)) return;
            toastStore.success('Thermostat removed. Device is rebooting...');
        }
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.error(rpcErrorMessage(error, 'Failed to change mode'));
    } finally {
        if (ownsDeviceGeneration(targetShellyID, generation)) {
            wallDisplayModeChanging.value = false;
        }
    }
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
        !canUpdateDevice.value ||
        newMode === pillMode.value ||
        pillModeChanging.value ||
        pillPinChanging.value
    )
        return;
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    pillModeChanging.value = true;
    pillModeError.value = null;
    try {
        const config: Record<string, string> = {mode: newMode};
        const resp = await ws.sendRPC<{restart_required?: boolean}>(
            'FLEET_MANAGER',
            'Pill.SetConfig',
            {shellyID: targetShellyID, config}
        );
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        if (resp?.restart_required) {
            toastStore.warning(
                `Pill mode set to ${newMode} — device reboot required to apply`
            );
        } else {
            // Mode change may have spawned/removed components; pull fresh state.
            await loadFullDeviceForBoard(targetShellyID, generation);
            if (!ownsDeviceGeneration(targetShellyID, generation)) return;
            toastStore.success(`Pill mode set to ${newMode}`);
        }
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        pillModeError.value = rpcErrorMessage(error, 'Failed to change mode');
    } finally {
        if (ownsDeviceGeneration(targetShellyID, generation)) {
            pillModeChanging.value = false;
        }
    }
}

async function changePillPin(
    pinKey: 'pin0_mode' | 'pin1_mode' | 'pin2_mode',
    newPinMode: string
) {
    if (
        !canUpdateDevice.value ||
        newPinMode === pillPins.value[pinKey] ||
        pillPinChanging.value ||
        pillModeChanging.value
    )
        return;
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    pillPinChanging.value = true;
    pillPinError.value = null;
    try {
        const resp = await ws.sendRPC<{restart_required?: boolean}>(
            'FLEET_MANAGER',
            'Pill.SetConfig',
            {
                shellyID: targetShellyID,
                config: {[pinKey]: newPinMode}
            }
        );
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        if (resp?.restart_required) {
            toastStore.warning(
                `${pinKey} set to ${newPinMode} — device reboot required to apply`
            );
        } else {
            toastStore.success(`${pinKey} set to ${newPinMode}`);
        }
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        pillPinError.value = rpcErrorMessage(
            error,
            'Failed to change pin mode'
        );
    } finally {
        if (ownsDeviceGeneration(targetShellyID, generation)) {
            pillPinChanging.value = false;
        }
    }
}

function handleOptionsSave(selected: EmDevice[]) {
    selectedEMDevices.value = selected;
    toastStore.success(`Saved ${selected.length} EM device(s)`);
}

async function connectToWs() {
    if (!canUpdateDevice.value) {
        toastStore.error(
            'You do not have permission to update this device'
        );
        return;
    }
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    const submittedWsAddress = wsAddress.value;
    try {
        const wsResp = await ws.sendRPC<{restart_required?: boolean}>(
            'FLEET_MANAGER',
            'WS.SetConfig',
            {
                shellyID: targetShellyID,
                config: {
                    enable: true,
                    server: submittedWsAddress
                }
            }
        );
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        if (!wsResp?.restart_required) {
            toastStore.success('Saved websocket config');
            return;
        }
        if (!canExecute.value) {
            toastStore.warning(
                'Saved websocket config. Execute permission is required to reboot the device.'
            );
            return;
        }
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {
            shellyID: targetShellyID
        });
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.success('Saved websocket config');
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
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

async function denyDeviceAccess() {
    if (!canManageDeviceAccess.value) return;
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    denyAccessConfirmVisible.value = false;
    try {
        const result = await ws.sendRPC<{
            success: string[];
            error: string[];
        }>('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
            shellyIDs: [targetShellyID]
        });
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        if (
            result.error.length > 0 ||
            !result.success.includes(targetShellyID)
        ) {
            throw new Error('Fleet Manager could not deny this device');
        }
        toastStore.success('Device disconnected and denied');
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.error(
            error instanceof Error ? error.message : String(error)
        );
    }
}

const maintenanceConfirm = ref<InstanceType<typeof ConfirmationModal> | null>(
    null
);
const maintenanceRebooting = ref(false);
const factoryResetting = ref(false);
const devicePasswordModalVisible = ref(false);
const devicePasswordStatus = computed(() =>
    device.value?.info?.auth_en === true
        ? 'A password is set.'
        : 'No password is set.'
);

function confirmMaintenanceReboot(): void {
    maintenanceConfirm.value?.storeAction(performMaintenanceReboot, {
        title: 'Reboot device?',
        message: 'The device will be unavailable briefly while it restarts.',
        confirmLabel: 'Reboot device'
    });
}

async function performMaintenanceReboot(): Promise<void> {
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    maintenanceRebooting.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.Reboot', {
            shellyID: targetShellyID
        });
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.info('Device rebooting');
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.error(rpcErrorMessage(error));
    } finally {
        maintenanceRebooting.value = false;
    }
}

function confirmFactoryReset(): void {
    maintenanceConfirm.value?.storeAction(performFactoryReset, {
        title: 'Factory reset device?',
        message:
            'All settings on the device are erased and it leaves Fleet Manager. This cannot be undone.',
        confirmLabel: 'Factory reset',
        secured: true
    });
}

const firmwareChecking = ref(false);
const firmwareCheckDone = ref(false);
const firmwareCheckError = ref<string | null>(null);
const firmwareStableVersion = ref<string | null>(null);
const firmwareBetaVersion = ref<string | null>(null);

// Update known either from an explicit check or from the device's own
// status report — one flag drives the page.
const firmwareHasUpdate = computed(() =>
    Boolean(firmwareStableVersion.value || firmwareUpdateVersion.value)
);
// Stable wins; a beta only surfaces when no stable update is waiting, and
// it is coloured differently so nobody installs one by accident.
const heroFirmwareUpdate = computed<{
    version: string;
    stage: 'stable' | 'beta';
} | null>(() => {
    const stable = firmwareStableVersion.value || firmwareUpdateVersion.value;
    if (stable) return {version: stable, stage: 'stable'};
    if (firmwareBetaVersion.value) {
        return {version: firmwareBetaVersion.value, stage: 'beta'};
    }
    return null;
});
// Full build id like the app shows (fw_id), version as fallback.
const deviceFirmwareBuild = computed(() => {
    const info = device.value?.info as
        | {fw_id?: string; ver?: string}
        | undefined;
    return info?.fw_id || info?.ver || 'Not reported';
});

// "Update automatically" is a device schedule calling Shelly.Update —
// exactly what the Shelly app creates.
interface FirmwareAutoJob {
    id: number;
    timespec: string;
    enable: boolean;
}
const FIRMWARE_AUTO_TIMESPEC = '0 0 3 * * *';
const firmwareAutoJob = ref<FirmwareAutoJob | null>(null);
const firmwareAutoBusy = ref(false);
let firmwareAutoLoadedFor = '';

async function loadFirmwareAutoUpdate(): Promise<void> {
    try {
        const res = await ws.sendRPC<{
            items?: Array<{
                id: number;
                timespec: string;
                enable: boolean;
                calls?: Array<{method?: string}>;
            }>;
        }>('FLEET_MANAGER', 'schedule.List', {shellyID: shellyID.value});
        const job = (res?.items ?? []).find((item) =>
            (item.calls ?? []).some(
                (call) =>
                    String(call.method ?? '').toLowerCase() === 'shelly.update'
            )
        );
        firmwareAutoJob.value = job
            ? {id: job.id, timespec: job.timespec, enable: job.enable}
            : null;
    } catch {
        // Schedules unsupported or device offline — the toggle just reads off.
        firmwareAutoJob.value = null;
    }
}

// Direct device update, same as the app: Shelly.Update on the chosen
// channel. The device restarts itself when it finishes.
const firmwareUpdating = ref<'stable' | 'beta' | null>(null);
function confirmFirmwareUpdate(stage: 'stable' | 'beta'): void {
    const version =
        stage === 'beta' ? firmwareBetaVersion.value : firmwareStableVersion.value;
    maintenanceConfirm.value?.storeAction(() => performFirmwareUpdate(stage), {
        title: stage === 'beta' ? 'Install beta firmware?' : 'Install update?',
        message:
            stage === 'beta'
                ? `The device installs beta ${version ?? ''} and restarts. Beta builds can be unstable.`
                : `The device installs ${version ?? 'the latest stable firmware'} and restarts.`,
        confirmLabel: 'Install'
    });
}
async function performFirmwareUpdate(stage: 'stable' | 'beta'): Promise<void> {
    firmwareUpdating.value = stage;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.Update', {
            shellyID: shellyID.value,
            stage
        });
        toastStore.success('Update started — the device restarts when done');
    } catch (err: unknown) {
        toastStore.error(rpcErrorMessage(err));
    } finally {
        firmwareUpdating.value = null;
    }
}

async function toggleFirmwareAutoUpdate(): Promise<void> {
    if (firmwareAutoBusy.value) return;
    firmwareAutoBusy.value = true;
    try {
        if (firmwareAutoJob.value) {
            await ws.sendRPC('FLEET_MANAGER', 'schedule.Delete', {
                shellyID: shellyID.value,
                id: firmwareAutoJob.value.id
            });
            toastStore.info('Automatic updates turned off');
        } else {
            await ws.sendRPC('FLEET_MANAGER', 'schedule.Create', {
                shellyID: shellyID.value,
                enable: true,
                timespec: FIRMWARE_AUTO_TIMESPEC,
                calls: [{method: 'Shelly.Update', params: {stage: 'stable'}}]
            });
            toastStore.success('Automatic updates on — checks daily at 03:00');
        }
        await loadFirmwareAutoUpdate();
    } catch (err: unknown) {
        toastStore.error(rpcErrorMessage(err));
    } finally {
        firmwareAutoBusy.value = false;
    }
}

function resetFirmwareCheck(): void {
    firmwareChecking.value = false;
    firmwareCheckDone.value = false;
    firmwareCheckError.value = null;
    firmwareStableVersion.value = null;
    firmwareBetaVersion.value = null;
}

interface FirmwareBulkItem {
    shellyID: string;
    status?: string;
    error?: string;
    stable?: {version?: string};
    beta?: {version?: string};
}

async function checkDeviceFirmware(): Promise<void> {
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    firmwareChecking.value = true;
    firmwareCheckError.value = null;
    try {
        const response = await ws.sendRPC<{items?: FirmwareBulkItem[]}>(
            'FLEET_MANAGER',
            'Firmware.CheckForUpdateBulk',
            {shellyIDs: [targetShellyID]}
        );
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        const item = response?.items?.find(
            (entry) => entry.shellyID === targetShellyID
        );
        if (!item || item.status !== 'checked') {
            firmwareCheckDone.value = false;
            firmwareCheckError.value =
                item?.status === 'offline'
                    ? 'The device is offline.'
                    : (item?.error ?? 'Firmware check failed');
            return;
        }
        firmwareStableVersion.value = item.stable?.version ?? null;
        firmwareBetaVersion.value = item.beta?.version ?? null;
        firmwareCheckDone.value = true;
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        firmwareCheckDone.value = false;
        firmwareCheckError.value = rpcErrorMessage(error);
    } finally {
        firmwareChecking.value = false;
    }
}

async function performFactoryReset(): Promise<void> {
    const targetShellyID = shellyID.value;
    const generation = deviceGeneration;
    factoryResetting.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'Shelly.FactoryReset', {
            shellyID: targetShellyID
        });
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.info('Factory reset started. The device will disconnect.');
    } catch (error) {
        if (!ownsDeviceGeneration(targetShellyID, generation)) return;
        toastStore.error(rpcErrorMessage(error));
    } finally {
        factoryResetting.value = false;
    }
}

function handleImgError(e: Event) {
    handleDeviceImgError(e, device.value?.info?.model);
}

let activeSub: ws.TemporarySubscription | null = null;
let deviceGeneration = 0;
let subscriptionRequestSequence = 0;
let fullDeviceRequestSequence = 0;
let profileRequestSequence = 0;
let imageRequestSequence = 0;
let boardMounted = false;
let boardUnmounted = false;

function ownsDeviceGeneration(
    targetShellyID: string,
    generation: number
): boolean {
    return (
        !boardUnmounted &&
        generation === deviceGeneration &&
        targetShellyID === shellyID.value
    );
}

function ownsProfileRequest(
    targetShellyID: string,
    generation: number,
    requestId: number
): boolean {
    return (
        requestId === profileRequestSequence &&
        ownsDeviceGeneration(targetShellyID, generation)
    );
}

function ownsImageRequest(
    targetShellyID: string,
    generation: number,
    requestId: number
): boolean {
    return (
        requestId === imageRequestSequence &&
        ownsDeviceGeneration(targetShellyID, generation)
    );
}

function firstSettingsSection(): string {
    return settingsGroups.value[0]?.items[0]?.id ?? 'advanced';
}

function resetDeviceLocalState(): void {
    wsAddress.value = defaultWs.value;

    const settingsSection = firstSettingsSection();
    activeSettingsSection.value = settingsSection;
    mountedSettingsSections.value = new Set([settingsSection]);
    mobileSettingsListVisible.value = true;
    settingsDirtySources.value = new Map();
    settingsNavQuery.value = '';
    settingsExitConfirmVisible.value = false;
    denyAccessConfirmVisible.value = false;
    pendingSettingsExit = null;
    devicePasswordModalVisible.value = false;
    resetFirmwareCheck();
    showOptionsModal.value = false;
    showWebGuiModal.value = false;
    extractGroupModalVisible.value = false;
    extractGroupSourceKey.value = null;
    virtualEditKey.value = null;
    deviceEditVisible.value = false;
    selectedEMDevices.value = [];

    physicalAssetId.value = null;
    physicalIcon.value = null;
    sensorGroupOpen.value = new Set();

    profileChanging.value = false;
    profileError.value = null;
    profileList.value = null;
    wallDisplayModeChanging.value = false;
    pillModeChanging.value = false;
    pillPinChanging.value = false;
    pillModeError.value = null;
    pillPinError.value = null;
}

async function unsubscribeSubscription(
    subscription: ws.TemporarySubscription
): Promise<void> {
    try {
        await subscription.unsubscribe();
    } catch (error) {
        debugWarn('Device board subscription cleanup failed', {error});
    }
}

function beginDeviceGeneration(): number {
    deviceGeneration += 1;
    subscriptionRequestSequence += 1;
    fullDeviceRequestSequence += 1;
    profileRequestSequence += 1;
    imageRequestSequence += 1;

    const previousSubscription = activeSub;
    activeSub = null;
    if (previousSubscription) {
        void unsubscribeSubscription(previousSubscription);
    }
    resetDeviceLocalState();
    return deviceGeneration;
}

async function replaceSubscription(
    targetShellyID: string,
    generation: number
): Promise<void> {
    const requestId = ++subscriptionRequestSequence;
    try {
        const subscription = await ws.addTemporarySubscription([targetShellyID]);
        if (
            requestId !== subscriptionRequestSequence ||
            !ownsDeviceGeneration(targetShellyID, generation)
        ) {
            await unsubscribeSubscription(subscription);
            return;
        }
        activeSub = subscription;
    } catch (error) {
        if (
            requestId !== subscriptionRequestSequence ||
            !ownsDeviceGeneration(targetShellyID, generation)
        ) {
            return;
        }
        debugWarn('Device board subscription failed', {
            shellyID: targetShellyID,
            error
        });
    }
}

function startDeviceWork(targetShellyID: string, generation: number): void {
    void replaceSubscription(targetShellyID, generation);
    void loadFullDeviceForBoard(targetShellyID, generation, {
        loadProfilesAfter: true
    });
    void loadPhysicalAssetId(targetShellyID, generation);
}

watch(
    device,
    (newDevice) => {
        if (!newDevice) {
            showOptionsModal.value = false;
            showWebGuiModal.value = false;
            return;
        }
    },
    {immediate: true}
);

watch(deviceProfile, () => {
    void loadProfiles(shellyID.value, deviceGeneration);
});

watch(shellyID, (newID) => {
    const generation = beginDeviceGeneration();
    if (boardMounted) startDeviceWork(newID, generation);
}, {immediate: true, flush: 'sync'});

onMounted(() => {
    boardMounted = true;
    startDeviceWork(shellyID.value, deviceGeneration);
});

async function loadFullDeviceForBoard(
    targetShellyID: string,
    generation = deviceGeneration,
    options: {loadProfilesAfter?: boolean} = {}
): Promise<void> {
    const requestId = ++fullDeviceRequestSequence;
    const snapshotGuard =
        deviceStore.captureDeviceSnapshotGuard(targetShellyID);
    try {
        const fullDevice = await ws.sendRPC('FLEET_MANAGER', 'device.Get', {
            shellyID: targetShellyID
        });
        if (
            requestId !== fullDeviceRequestSequence ||
            !ownsDeviceGeneration(targetShellyID, generation)
        ) {
            return;
        }
        if (fullDevice) {
            deviceStore.replaceDeviceSnapshot(fullDevice as never, snapshotGuard);
        }
        if (options.loadProfilesAfter) {
            void loadProfiles(targetShellyID, generation);
        }
    } catch (error) {
        if (
            requestId !== fullDeviceRequestSequence ||
            !ownsDeviceGeneration(targetShellyID, generation)
        ) {
            return;
        }
        debugWarn('Device board full-device load failed', {
            shellyID: targetShellyID,
            error
        });
    }
}

onUnmounted(() => {
    boardUnmounted = true;
    boardMounted = false;
    deviceGeneration += 1;
    subscriptionRequestSequence += 1;
    fullDeviceRequestSequence += 1;
    profileRequestSequence += 1;
    imageRequestSequence += 1;
    if (activeSub) void unsubscribeSubscription(activeSub);
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
    padding: var(--space-1) var(--space-2) var(--space-2);
}
/* Identity line: image left, name and IP beside it, name wraps not
   the row. Left-aligned so the name gets the remaining width. */
.device-hero__identity {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    width: 100%;
    min-width: 0;
}
.device-hero__copy {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    text-align: left;
}
.device-hero__name {
    margin: 0;
    min-width: 0;
    color: var(--color-text-primary);
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
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
/* Invisible hit-area extension — the 28px pencil answers a 44px tap. */
.device-hero__image-edit::after {
    content: "";
    position: absolute;
    inset: calc((var(--touch-target-min) - var(--space-7)) / -2);
    border-radius: var(--radius-full);
}
/* Touch has no hover — the affordance must simply be there. */
@media (hover: none) {
    .device-hero__image-edit {
        opacity: 1;
    }
}
.device-hero__img {
    width: 160px;
    height: 160px;
    border-radius: var(--radius-lg);
    object-fit: contain;
}

/* FA glyph used in place of __img when a virtual device picks an icon. */
.device-hero__glyph {
    width: 160px;
    height: 160px;
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
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-family: monospace;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background-color: color-mix(in srgb, var(--color-text-tertiary) 10%, transparent);
}
.device-hero__battery {
    font-size: var(--type-caption);
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
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
}
/* Dot inherits the chip's tone colour, so one rule covers every state. */
.device-status-badge__dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background: currentColor;
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
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
/* Online = a green dot only (saves space); the IP chip carries the detail. */
.device-hero__signal,
.device-hero__uptime {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background-color: color-mix(in srgb, var(--color-text-tertiary) 10%, transparent);
    font-variant-numeric: tabular-nums;
}
.device-hero__signal--good { color: var(--color-status-on); }
.device-hero__signal--ok   { color: var(--color-text-secondary); }
.device-hero__signal--warn { color: var(--color-status-warn); }
/* Same chip as the plain version, tinted and clickable when an update is
   waiting. Amber for stable matches the Details row; orange for beta is the
   hue the firmware pages already use. */
.device-hero__firmware--stable,
.device-hero__firmware--beta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.device-hero__firmware--stable {
    color: var(--color-warning-text);
    border: 1px solid rgba(var(--color-warning-rgb), 0.5);
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
}
.device-hero__firmware--stable:hover {
    background: color-mix(in srgb, var(--color-warning) 28%, transparent);
}
.device-hero__firmware--beta {
    color: var(--color-orange);
    border: 1px solid color-mix(in srgb, var(--color-orange) 50%, transparent);
    background: color-mix(in srgb, var(--color-orange) 15%, transparent);
}
.device-hero__firmware--beta:hover {
    background: color-mix(in srgb, var(--color-orange) 28%, transparent);
}
.device-hero__ip {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--type-body);
    font-family: monospace;
    color: var(--color-text-secondary);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    background-color: color-mix(in srgb, var(--color-text-tertiary) 10%, transparent);
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

/* Modal chrome title stays body-size — the panel heading below owns the
   single subheading slot per view. */
/* Inherits the modal-header default (--type-subheading) — no override. */
.device-settings-title {
    color: var(--color-text-primary);
}
.settings-exit-copy {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-normal);
}
.settings-exit-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-sm);
}
.device-settings-modal {
    display: grid;
    height: var(--device-settings-workspace-height);
    min-height: 0;
    /* Compact nav (~28%) + flexible content. The rem floor keeps
       single-line labels and the identity strip readable. */
    grid-template-columns: minmax(18rem, 28%) minmax(0, 1fr);
    gap: var(--gap-md);
    overflow: hidden;
}
.device-settings-nav {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-md);
    /* One rounded card, like the Shelly app — no floating divider. */
    padding: var(--gap-sm);
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    background: var(--color-surface-0);
    overflow: hidden;
}
.device-settings-nav__sections {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--gap-md);
    overflow-y: auto;
}
.device-settings-sidebar-device {
    position: relative;
    display: grid;
    grid-template-columns: var(--device-settings-preview-size) minmax(0, 1fr);
    align-items: center;
    gap: var(--gap-sm);
    padding-bottom: var(--gap-xs);
    border-bottom: var(--space-px) solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    transition: background var(--duration-fast) var(--ease-default);
}
.device-settings-sidebar-device:hover {
    background: var(--color-surface-2);
}
.device-settings-sidebar-device__copy {
    min-width: 0;
    padding-right: var(--gap-lg);
}
.device-settings-sidebar-device__edit {
    position: absolute;
    top: 0;
    right: 0;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: var(--space-px) solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition:
        opacity var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}
/* Hovering anywhere on the identity block reveals its one action. */
.device-settings-sidebar-device:hover .device-settings-sidebar-device__edit,
.device-settings-sidebar-device__edit:focus-visible {
    opacity: 1;
}
/* Touch has no hover — the affordance must simply be there. */
@media (hover: none) {
    .device-settings-sidebar-device__edit {
        opacity: 1;
    }
}
/* Invisible hit-area extension — the small pencil answers a 44px tap. */
.device-settings-sidebar-device__edit::after {
    content: "";
    position: absolute;
    inset: calc((var(--touch-target-min) - 28px) / -2);
    border-radius: var(--radius-full);
}
.device-settings-sidebar-device__edit:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-medium);
    background: var(--color-surface-2);
}
.device-settings-sidebar-device__name {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-width: 0;
}
.device-settings-sidebar-device__name strong {
    min-width: 0;
    flex: 0 1 auto;
}
.device-settings-workspace__actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
}
.device-settings-sidebar-device__copy span,
.device-settings-sidebar-device__copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.device-settings-sidebar-device__copy strong {
    display: block;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    white-space: normal;
    overflow-wrap: anywhere;
}
.device-settings-sidebar-device__copy span,
.device-settings-sidebar-device__copy small {
    margin-top: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.device-settings-nav__group {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
/* Hairline between groups — the eyebrow below marks the section start. */
.device-settings-nav__group + .device-settings-nav__group {
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--divider-hairline);
}
/* Group header — a caps eyebrow, and a real button: click folds the
   group away. */
.device-settings-nav__label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-height: var(--space-8);
    padding: var(--space-1) var(--gap-xs);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
    transition:
        background-color var(--motion-hover),
        color var(--motion-hover);
}
.device-settings-nav__label:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-secondary);
}
.device-settings-nav__group-chevron {
    margin-left: auto;
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-xs);
    transition: transform var(--duration-fast) var(--ease-default);
}
.device-settings-nav__group-chevron--collapsed {
    transform: rotate(-90deg);
}
.device-settings-nav__item {
    display: grid;
    min-height: var(--touch-target-min);
    grid-template-columns: var(--icon-size-xl) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    border-radius: var(--radius-lg);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    text-align: left;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}
.device-settings-nav__item:hover {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
}
.device-settings-nav__item--active {
    background: var(--color-primary-subtle);
    color: var(--color-text-primary);
}
/* The active item's inset bar hides the global focus box-shadow — give
   keyboard focus its own outline ring. */
.device-settings-nav__item:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: calc(-1 * var(--focus-ring-width));
}
.device-settings-nav__item > i:first-child {
    display: grid;
    width: var(--icon-size-xl);
    height: var(--icon-size-xl);
    place-items: center;
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-xs);
    text-align: center;
}
.device-settings-nav__item--active > i:first-child {
    border-color: rgba(var(--color-primary-rgb), 0.5);
    color: var(--color-primary-text);
}
.device-settings-nav__copy {
    min-width: 0;
}
.device-settings-nav__copy strong {
    display: block;
    /* Long names wrap to a second line — never cut off. */
    overflow-wrap: anywhere;
    color: inherit;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
/* The shared pill grows (flex: 1) for toolbar rows — inside this flex
   COLUMN that would stretch it vertically. And with no trailing buttons
   here, the reserved right padding is dead space. */
.device-settings-nav .search-pill,
.device-settings-mobile-list .search-pill {
    flex: none;
}
.device-settings-nav .search-pill__input,
.device-settings-mobile-list .search-pill__input {
    padding-right: var(--gap-md);
}
.device-settings-nav__no-match {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.device-settings-dirty-dot {
    width: var(--gap-xs);
    height: var(--gap-xs);
    flex: 0 0 var(--gap-xs);
    border-radius: var(--radius-sm);
    background: var(--color-warning-text);
}
.device-settings-mobile-list,
.device-settings-mobile-back {
    display: none;
}
.device-settings-content {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0 var(--gap-sm) var(--gap-md);
}
.device-settings-workspace__header {
    display: block;
    margin-bottom: var(--gap-sm);
    padding-bottom: var(--gap-sm);
    border-bottom: var(--space-px) solid var(--color-border-subtle);
}
.device-settings-workspace__intro {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: var(--gap-md);
}
.device-settings-workspace__heading {
    min-width: 0;
}
.device-settings-workspace__heading h3,
.device-settings-workspace__heading p {
    margin: 0;
}
.device-settings-workspace__heading h3 {
    color: var(--color-text-primary);
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
}
.device-settings-workspace__heading p {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.device-settings-workspace__description {
    display: flex;
    align-items: center;
    gap: var(--gap-xs) var(--gap-sm);
    margin-top: var(--gap-xs);
}
.device-settings-workspace__description p {
    min-width: 0;
}
.device-settings-status-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: 0 0 auto;
    margin-left: auto;
    padding: var(--space-2) var(--space-3);
    border: var(--space-px) solid currentColor;
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
}
.device-settings-status-badge--on {
    color: var(--color-status-on);
    background: color-mix(in srgb, var(--color-status-on) 10%, transparent);
}
.device-settings-status-badge--off {
    color: var(--color-status-off);
    background: color-mix(in srgb, var(--color-status-off) 10%, transparent);
}
.device-settings-status-badge--warn {
    color: var(--color-status-warn);
    background: color-mix(in srgb, var(--color-status-warn) 10%, transparent);
}
.device-settings-status-badge--neutral {
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
}
.device-settings-status-badge__indicator {
    width: var(--space-1);
    height: var(--space-1);
    flex: 0 0 var(--space-1);
    border-radius: var(--radius-full);
    background: currentColor;
}
.device-settings-preview {
    width: var(--device-settings-preview-size);
}
.device-settings-preview__media {
    position: relative;
    display: grid;
    width: var(--device-settings-preview-size);
    aspect-ratio: 1;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: transparent;
}
.device-settings-preview__media img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    transition:
        filter var(--duration-fast) var(--ease-default),
        opacity var(--duration-fast) var(--ease-default);
}
.device-settings-preview__glyph {
    color: var(--color-text-secondary);
    font-size: var(--icon-size-2xl);
}
.device-settings-preview__media--offline img,
.device-settings-preview__media--offline .device-settings-preview__glyph {
    opacity: var(--opacity-dim);
}
.device-settings-preview__indicator {
    position: absolute;
    top: var(--gap-sm);
    left: var(--gap-sm);
    z-index: var(--z-base);
}
.device-settings-workspace {
    min-width: 0;
}
.settings-surface {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-md);
}

.settings-surface--panel {
    background: var(--glass-2-bg);
    backdrop-filter: blur(var(--glass-2-blur));
    -webkit-backdrop-filter: blur(var(--glass-2-blur));
    border: var(--space-px) solid var(--glass-border);
    border-radius: var(--radius-xl);
    padding: var(--gap-md);
}
.settings-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--gap-md);
    align-items: center;
}
.settings-actions__group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
    align-items: center;
}
/* Rounded card containers — hairlines live inside cards, never in open
   space (the Shelly app's grouped-list language). :where() keeps the
   specificity flat so base rules below stay orderly. */
:where(.settings-surface) > :where(.settings-group, .settings-form-row) {
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-xl);
    padding: var(--gap-sm) var(--gap-md);
    background: var(--color-surface-0);
}
/* Quiet copy affordance — appears where a value is worth copying. */
.settings-copy {
    display: inline-grid;
    width: var(--icon-size-lg);
    height: var(--icon-size-lg);
    flex: none;
    place-items: center;
    border-radius: var(--radius-md);
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-xs);
    cursor: pointer;
    transition:
        color var(--motion-hover),
        background-color var(--motion-hover);
}
.settings-copy:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}
/* Firmware page — one row that answers "what version, am I current". */
.settings-firmware {
    display: flex;
    align-items: center;
    gap: var(--gap-md);
    padding: var(--gap-sm) 0;
}
.settings-firmware__chip {
    display: grid;
    width: var(--icon-size-xl);
    height: var(--icon-size-xl);
    flex: none;
    place-items: center;
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-xs);
}
.settings-firmware__chip--update {
    border-color: rgba(var(--color-warning-rgb), 0.5);
    color: var(--color-warning-text);
}
.settings-firmware__copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--gap-xs);
}
.settings-firmware__copy small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.settings-firmware__copy strong {
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.settings-firmware__current {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-success-text);
    font-size: var(--type-caption);
}
.settings-firmware__actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
}
.settings-firmware__beta {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.settings-firmware__mono {
    font-family: var(--font-mono, monospace);
}
.settings-update-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-top: var(--gap-xs);
    padding: var(--space-0-5) var(--space-2);
    border: var(--space-px) solid rgba(var(--color-warning-rgb), 0.4);
    border-radius: var(--radius-full);
    color: var(--color-warning-text);
    font-size: var(--type-caption);
}
.settings-information-item__value--mono span:first-child {
    font-family: var(--font-mono, monospace);
}
/* Spec table — two label/value pairs per line. `display: contents` on the
   row lets every dt/dd join the parent grid, so labels line up in columns. */
.spec {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
    margin: 0;
}
.spec__row {
    display: contents;
}
/* Column spacing is padding, not gap — a gap would cut the divider into
   segments; padding sits inside the box so the rule runs unbroken. */
.spec__key,
.spec__val {
    min-width: 0;
    padding: var(--gap-sm) 0;
    border-bottom: var(--space-px) solid var(--color-border-subtle);
}
/* Same size as the value — the column already says which is the label, so
   colour alone carries the difference. */
.spec__key {
    padding-right: var(--gap-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    white-space: nowrap;
}
.spec__val {
    padding-right: var(--gap-xl);
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
/* Inline flow, not flex — the copy glyph must stay glued to the end of the
   value even when the value wraps to a second line. */
.spec__val .settings-copy {
    margin-left: var(--gap-xs);
    vertical-align: middle;
}
.spec__val--mono span:first-child {
    font-family: var(--font-mono, monospace);
}
.spec__val--on {
    color: var(--color-status-on);
}
.spec__val--off {
    color: var(--color-status-off);
}
.spec__val--warn {
    color: var(--color-warning-text);
}
@media (max-width: 700px) {
    .spec {
        grid-template-columns: auto minmax(0, 1fr);
    }
}
.settings-group {
    min-width: 0;
}
.settings-group__heading {
    display: grid;
    grid-template-columns: var(--icon-size-xl) minmax(0, 1fr);
    align-items: start;
    gap: var(--gap-sm);
    margin-bottom: var(--gap-sm);
}
.settings-group__heading > i {
    display: grid;
    width: var(--icon-size-xl);
    height: var(--icon-size-xl);
    place-items: center;
    color: var(--color-text-secondary);
    font-size: var(--icon-size-sm);
}
/* Panel overrides sit after the base rules they override. */
.settings-surface--panel > .settings-group {
    border: none;
    border-radius: 0;
    border-top: var(--space-px) solid var(--color-border-subtle);
    background: transparent;
    padding: var(--gap-md) 0 0;
}
.settings-surface--panel .settings-group__heading {
    grid-template-columns: minmax(0, 1fr);
    margin-bottom: var(--gap-sm);
}
.settings-surface--panel .settings-group__heading > i {
    display: none;
}
.settings-group__heading h4,
.settings-group__heading p {
    margin: 0;
}
.settings-group__heading h4 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.settings-group__heading p {
    margin-top: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.settings-information-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--gap-lg);
    row-gap: var(--gap-sm);
    margin: 0;
    padding: 0;
}
.settings-information-item {
    display: flex;
    align-items: baseline;
    gap: var(--gap-sm);
    min-width: 0;
    padding: 0;
}
.settings-information-item dt,
.settings-information-item dd {
    margin: 0;
}
.settings-information-item dt {
    flex: none;
    width: 7rem;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.settings-information-item dd {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.settings-surface__heading h4,
.settings-surface__heading p {
    margin: 0;
}
.settings-surface__heading h4,
.settings-form-row strong {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.settings-surface__heading p,
.settings-form-row span {
    display: block;
    margin-top: var(--gap-xs);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.settings-form-row {
    display: flex;
    min-height: var(--touch-target-min);
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-md);
    padding: 0;
}
.settings-form-row > div {
    min-width: 0;
}
.settings-form-row--field {
    align-items: flex-end;
}
.settings-form-row--field > :first-child {
    flex: 1;
}
.settings-form-action {
    flex: 0 0 auto;
    white-space: nowrap;
}
/* Wins over the generic `.settings-form-row span` styling by specificity. */
.settings-form-row span.settings-saved-state {
    display: inline-flex;
    min-height: var(--touch-target-min);
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-success-text);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.settings-surface__actions {
    display: flex;
    justify-content: flex-end;
}
.settings-capability {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}
.settings-capability:disabled {
    opacity: var(--opacity-disabled);
}
@media (max-width: 767px) {
    .device-settings-modal {
        height: 100%;
        min-height: 0;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        overflow: hidden;
    }
    .device-settings-nav {
        display: none;
    }
    .device-settings-mobile-list {
        min-height: 0;
        flex-direction: column;
        gap: var(--gap-md);
        overflow-y: auto;
        padding-bottom: var(--gap-md);
    }
    .device-settings-modal--mobile-list .device-settings-mobile-list {
        display: flex;
    }
    .device-settings-modal--mobile-list .device-settings-content {
        display: none;
    }
    .device-settings-mobile-group {
        display: flex;
        flex-direction: column;
        gap: var(--gap-xs);
    }
    .device-settings-mobile-group .device-settings-nav__label {
        min-height: var(--touch-target-min);
    }
    .device-settings-mobile-item {
        display: grid;
        width: 100%;
        grid-template-columns: var(--icon-size-md) minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--gap-sm);
        min-height: var(--touch-target-min);
        padding: var(--gap-sm);
        border-bottom: var(--space-px) solid var(--color-border-subtle);
        color: var(--color-text-secondary);
        text-align: left;
    }
    .device-settings-mobile-item:hover {
        background: var(--state-hover-bg);
    }
    .device-settings-mobile-item:active {
        background: var(--state-active-bg);
    }
    .device-settings-mobile-item > i:first-child {
        width: var(--icon-size-md);
        color: var(--color-text-tertiary);
        text-align: center;
    }
    .device-settings-mobile-item > i:last-child {
        color: var(--color-text-quaternary);
        font-size: var(--icon-size-xs);
    }
    .device-settings-mobile-item strong {
        display: block;
        color: var(--color-text-primary);
        font-size: var(--type-body);
        font-weight: var(--font-semibold);
    }
    .device-settings-mobile-back {
        display: inline-flex;
        min-height: var(--touch-target-min);
        align-items: center;
        gap: var(--gap-xs);
        margin-bottom: var(--gap-sm);
        padding: 0 var(--gap-xs);
        border-radius: var(--radius-sm);
        color: var(--color-primary-text);
        font-size: var(--type-caption);
        font-weight: var(--font-semibold);
        transition: background-color var(--motion-hover);
    }
    .device-settings-mobile-back:hover {
        background: var(--state-hover-bg);
    }
    .device-settings-mobile-back:active {
        background: var(--state-active-bg);
    }
    .device-settings-content {
        min-height: 0;
        overflow-y: auto;
        padding: var(--gap-sm) 0 0;
    }
    .device-settings-workspace__header {
        gap: var(--gap-sm);
    }
    .settings-overview {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .settings-information-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    .settings-form-row,
    .settings-form-row--field {
        align-items: stretch;
        flex-direction: column;
    }
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
