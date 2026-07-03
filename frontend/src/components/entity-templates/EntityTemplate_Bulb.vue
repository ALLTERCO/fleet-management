<template>
    <div class="et">
        <!-- Hero: dominant power reading (only on PM-capable bulbs) -->
        <header v-if="status?.apower !== undefined" class="et__hero">
            <div class="et__hero-value">{{ status.apower.toFixed(1) }} W</div>
            <div class="et__hero-label">Power</div>
        </header>

        <!-- Primary affordance -->
        <button
            type="button"
            class="et__primary"
            :class="{
                'et__primary--on': isOn,
                'et__primary--readonly': !canExecute
            }"
            :disabled="!canExecute"
            :aria-pressed="isOn"
            @click="canExecute && emit('toggle')"
        >
            <span class="et__primary-text">
                <span class="et__primary-state">{{ isOn ? 'On' : 'Off' }}</span>
                <span v-if="status?.source" class="et__primary-source">via {{ formatSource(status.source) }}</span>
            </span>
            <span class="et__primary-icon" aria-hidden="true">
                <i class="fas fa-power-off" />
            </span>
        </button>

        <!-- Banners: errors + active timer + active transition -->
        <div v-if="status?.errors?.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in status.errors" :key="err">{{ err }}</span>
            </span>
        </div>
        <div v-if="status?.timer_started_at != null && status?.timer_duration != null" class="et__banner et__banner--warning">
            <i class="fas fa-hourglass-half" />
            <span>Auto-toggle in {{ formatDuration(status.timer_duration) }}</span>
        </div>
        <div v-if="status?.transition" class="et__banner et__banner--info">
            <i class="fas fa-arrow-right-long" />
            <span>Transition → {{ status.transition.target?.brightness }}% ({{ status.transition.duration }}s)</span>
        </div>

        <!-- Mode tabs (RGBCCT — switch between White and Color) -->
        <div v-if="hasMode" class="et-bulb__tabs" role="tablist">
            <button
                type="button"
                class="et-bulb__tab"
                :class="status?.mode === 'cct' && 'et-bulb__tab--on'"
                :disabled="!canExecute"
                role="tab"
                :aria-selected="status?.mode === 'cct'"
                @click="emit('setMode', 'cct')"
            >
                <i class="fas fa-temperature-half" /> White
            </button>
            <button
                type="button"
                class="et-bulb__tab"
                :class="status?.mode === 'rgb' && 'et-bulb__tab--on'"
                :disabled="!canExecute"
                role="tab"
                :aria-selected="status?.mode === 'rgb'"
                @click="emit('setMode', 'rgb')"
            >
                <i class="fas fa-palette" /> Color
            </button>
        </div>

        <!-- Brightness slider -->
        <div v-if="status?.brightness !== undefined" class="et__slider-row" :class="!isOn && 'et-bulb__dimmed'">
            <div class="et__slider-head">
                <span class="et__slider-label">Brightness</span>
                <span class="et__slider-value">{{ status?.brightness ?? 0 }}%</span>
            </div>
            <HorizontalSlider
                :value="status?.brightness ?? 0"
                :saved="{ '0%': 0, '25%': 25, '50%': 50, '75%': 75, '100%': 100 }"
                :disabled="!canExecute"
                @change="(v: number) => emit('setBrightness', v)"
            >
                <template #title>Brightness ({{ status?.brightness ?? 0 }}%)</template>
            </HorizontalSlider>
        </div>

        <!-- Color temperature slider (CCT, RGBCCT in cct mode) -->
        <div
            v-if="status?.ct !== undefined && (!hasMode || status?.mode === 'cct')"
            class="et__slider-row"
            :class="!isOn && 'et-bulb__dimmed'"
        >
            <div class="et__slider-head">
                <span class="et__slider-label">Color temperature</span>
                <span class="et__slider-value">{{ status?.ct ?? 4000 }}K</span>
            </div>
            <HorizontalSlider
                :value="status?.ct ?? 4000"
                :min="ctRange.min"
                :max="ctRange.max"
                :saved="ctPresets"
                :disabled="!canExecute"
                @change="(v: number) => emit('setCt', v)"
            >
                <template #title>Color Temp ({{ status?.ct ?? 4000 }}K)</template>
            </HorizontalSlider>
        </div>

        <!-- Color wheel (RGB, RGBW, RGBCCT in rgb mode) -->
        <div
            v-if="status?.rgb !== undefined && (!hasMode || status?.mode === 'rgb')"
            class="et-bulb__wheel-wrap"
            :class="!isOn && 'et-bulb__dimmed'"
        >
            <ColorWheel
                :rgb="status?.rgb ?? [255, 255, 255]"
                @change="(rgb: [number, number, number]) => emit('setRgb', rgb)"
            />
        </div>

        <!-- White channel slider (RGBW, RGBCCT in rgb mode) -->
        <div
            v-if="status?.white !== undefined && (!hasMode || status?.mode === 'rgb')"
            class="et__slider-row"
            :class="!isOn && 'et-bulb__dimmed'"
        >
            <div class="et__slider-head">
                <span class="et__slider-label">White</span>
                <span class="et__slider-value">{{ status?.white ?? 0 }}</span>
            </div>
            <HorizontalSlider
                :value="status?.white ?? 0"
                :min="0"
                :max="255"
                :disabled="!canExecute"
                @change="(v: number) => emit('setWhite', v)"
            >
                <template #title>White ({{ status?.white ?? 0 }})</template>
            </HorizontalSlider>
        </div>

        <!-- KPI strip (secondary power telemetry) -->
        <ul v-if="status?.voltage != null || status?.current != null || status?.aenergy?.total != null" class="et__kpis">
            <li v-if="status?.voltage != null" class="et__kpi">
                <span class="et__kpi-value">{{ status.voltage.toFixed(0) }} V</span>
                <span class="et__kpi-label">Voltage</span>
            </li>
            <li v-if="status?.current != null" class="et__kpi">
                <span class="et__kpi-value">{{ formatCurrent(status.current) }} A</span>
                <span class="et__kpi-label">Current</span>
            </li>
            <li v-if="status?.aenergy?.total != null" class="et__kpi">
                <span class="et__kpi-value">{{ (status.aenergy.total / 1000).toFixed(2) }} kWh</span>
                <span class="et__kpi-label">Energy</span>
            </li>
        </ul>

        <!-- Last-3-min energy detail -->
        <section v-if="status?.aenergy?.by_minute?.length" class="et__panel">
            <div class="et__panel-row">
                <span>Last 3 minutes</span>
                <span class="et__panel-value">{{ status.aenergy.by_minute.join(' / ') }} <small>mWh</small></span>
            </div>
        </section>

        <!-- Quick action: toggle-after timer -->
        <div v-if="canExecute" class="et__chip-row">
            <input
                v-model.number="toggleAfterSec"
                type="number"
                class="et__num"
                min="1"
                placeholder="sec"
                aria-label="Toggle-after seconds"
            />
            <button
                type="button"
                class="et__chip et__chip--primary"
                :disabled="!toggleAfterSec"
                @click="doToggleAfter"
            >
                <i class="fas fa-clock" />
                <span>{{ isOn ? 'Off' : 'On' }} in {{ toggleAfterSec || '…' }}s</span>
            </button>
        </div>

        <!-- Device PCB temperature -->
        <div v-if="status?.temperature?.tC != null" class="et__banner" :class="status.temperature.tC > 80 ? 'et__banner--warning' : 'et__banner--info'">
            <i class="fas fa-microchip" />
            <span>Internal {{ status.temperature.tC }}°C</span>
            <span v-if="status.temperature.tC > 80" class="et-bulb__hot">
                <i class="fas fa-triangle-exclamation" /> Hot
            </span>
        </div>

        <!-- Night mode (prominent panel) -->
        <section v-if="nightMode" class="et__panel">
            <div class="et__panel-row">
                <span><i class="fas fa-moon" /> Night mode</span>
                <button
                    v-if="canExecute && props.shellyID"
                    type="button"
                    class="et__switch"
                    :class="nightMode.enable && 'et__switch--on'"
                    :aria-pressed="!!nightMode.enable"
                    @click="setConfig({night_mode: {enable: !nightMode.enable}})"
                ><span class="et__switch-thumb" /></button>
                <span v-else class="et__panel-value">{{ nightMode.enable ? 'On' : 'Off' }}</span>
            </div>
            <template v-if="nightMode.enable && canExecute && props.shellyID">
                <label v-if="nightMode.mode != null" class="et__form-row">
                    <span class="et__form-label">Night type</span>
                    <select
                        class="et__select"
                        :value="nightMode.mode"
                        @change="(e: Event) => setConfig({night_mode: {mode: (e.target as HTMLSelectElement).value}})"
                    >
                        <option value="cct">White</option>
                        <option value="rgb">Color</option>
                    </select>
                </label>
                <HorizontalSlider
                    :value="nightMode.brightness ?? 10"
                    :min="1"
                    :max="100"
                    @change="(v: number) => setConfig({night_mode: {brightness: v}})"
                >
                    <template #title>Brightness {{ nightMode.brightness ?? 10 }}%</template>
                </HorizontalSlider>
                <HorizontalSlider
                    v-if="nightMode.ct != null"
                    :value="nightMode.ct"
                    :min="ctRange.min"
                    :max="ctRange.max"
                    @change="(v: number) => setConfig({night_mode: {ct: v}})"
                >
                    <template #title>Color temp {{ nightMode.ct }}K</template>
                </HorizontalSlider>
                <HorizontalSlider
                    v-if="nightMode.white != null"
                    :value="nightMode.white"
                    :min="0"
                    :max="255"
                    @change="(v: number) => setConfig({night_mode: {white: v}})"
                >
                    <template #title>White level {{ nightMode.white }}</template>
                </HorizontalSlider>
                <div v-if="nightMode.active_between != null" class="et-bulb__time-row">
                    <span class="et__form-label">Active between</span>
                    <div class="et-bulb__time-inputs">
                        <input
                            type="time"
                            class="et__text et-bulb__time-input"
                            :value="nightMode.active_between?.[0] ?? '22:00'"
                            @change="(e: Event) => setNightTime(0, (e.target as HTMLInputElement).value)"
                        />
                        <span class="et__form-label">–</span>
                        <input
                            type="time"
                            class="et__text et-bulb__time-input"
                            :value="nightMode.active_between?.[1] ?? '06:00'"
                            @change="(e: Event) => setNightTime(1, (e.target as HTMLInputElement).value)"
                        />
                    </div>
                </div>
            </template>
            <template v-else-if="nightMode.enable">
                <div class="et__panel-row">
                    <span>Brightness {{ nightMode.brightness }}%</span>
                    <span class="et__panel-value">
                        <template v-if="nightMode.ct">{{ nightMode.ct }}K </template>
                        <template v-if="nightMode.white != null">White {{ nightMode.white }} </template>
                        <template v-if="nightMode.active_between?.length">{{ nightMode.active_between.join(' – ') }}</template>
                    </span>
                </div>
            </template>
        </section>

        <!-- Configure: all settings (kept accordion-driven inside) -->
        <details v-if="hasConfigurableSettings" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-gear" /> Configure</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <!-- General settings -->
                <section v-if="settings?.name != null || settings?.initial_state || settings?.in_mode" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('settings')"
                        @click="toggleSection('settings')"
                        @keydown="onSectionKey($event, 'settings')"
                    >
                        <span class="et__section-title">General</span>
                        <i class="fas et__chevron" :class="collapsed.has('settings') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('settings')" class="et__form">
                        <label v-if="settings?.name != null" class="et__form-row">
                            <span class="et__form-label">Name</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="text"
                                class="et__text"
                                :value="settings.name"
                                placeholder="Name"
                                @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                            />
                            <span v-else class="et__panel-value">{{ settings.name }}</span>
                        </label>
                        <label v-if="settings?.in_mode" class="et__form-row">
                            <span class="et__form-label">Input mode</span>
                            <select
                                v-if="canExecute && props.shellyID"
                                class="et__select"
                                :value="settings.in_mode"
                                @change="(e: Event) => setConfig({in_mode: (e.target as HTMLSelectElement).value})"
                            >
                                <option value="follow">Follow</option>
                                <option value="flip">Flip</option>
                                <option value="activate">Activate</option>
                                <option value="detached">Detached</option>
                                <option value="dim">Dim</option>
                            </select>
                            <span v-else class="et__panel-value">{{ settings.in_mode }}</span>
                        </label>
                        <label v-if="settings?.initial_state" class="et__form-row">
                            <span class="et__form-label">Initial state</span>
                            <select
                                v-if="canExecute && props.shellyID"
                                class="et__select"
                                :value="settings.initial_state"
                                @change="(e: Event) => setConfig({initial_state: (e.target as HTMLSelectElement).value})"
                            >
                                <option value="on">On</option>
                                <option value="off">Off</option>
                                <option value="restore_last">Restore last</option>
                            </select>
                            <span v-else class="et__panel-value">{{ settings.initial_state.replace(/_/g, ' ') }}</span>
                        </label>
                    </div>
                </section>

                <!-- Brightness behavior -->
                <section
                    v-if="settings?.min_brightness_on_toggle != null || settings?.transition_duration != null || settings?.fade_rate != null || settings?.button_fade_rate != null || settings?.range_map?.length === 2 || settings?.button_presets?.button_doublepush?.brightness != null || settings?.button_presets?.button_doublepush?.ct != null"
                    class="et__group"
                >
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('brightness')"
                        @click="toggleSection('brightness')"
                        @keydown="onSectionKey($event, 'brightness')"
                    >
                        <span class="et__section-title">Brightness behavior</span>
                        <i class="fas et__chevron" :class="collapsed.has('brightness') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('brightness')" class="et__form">
                        <div v-if="settings?.min_brightness_on_toggle != null" class="et__form-row">
                            <span class="et__form-label">Min brightness on toggle</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.min_brightness_on_toggle"
                                :min="1"
                                :max="100"
                                @change="(v: number) => setConfig({min_brightness_on_toggle: v})"
                            >
                                <template #title>{{ settings.min_brightness_on_toggle }}%</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.min_brightness_on_toggle }}%</span>
                        </div>
                        <div v-if="settings?.range_map?.length === 2" class="et__form-row">
                            <span class="et__form-label">Brightness range</span>
                            <div v-if="canExecute && props.shellyID" class="et-bulb__range-row">
                                <span class="et__form-label">Min</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.range_map[0]"
                                    min="0"
                                    max="100"
                                    @change="(e: Event) => setConfig({range_map: [Number((e.target as HTMLInputElement).value), settings!.range_map[1]]})"
                                />
                                <span class="et__unit">%</span>
                                <span class="et__form-label">Max</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.range_map[1]"
                                    min="0"
                                    max="100"
                                    @change="(e: Event) => setConfig({range_map: [settings!.range_map[0], Number((e.target as HTMLInputElement).value)]})"
                                />
                                <span class="et__unit">%</span>
                            </div>
                            <span v-else class="et__panel-value">{{ settings.range_map[0] }}% – {{ settings.range_map[1] }}%</span>
                        </div>
                        <div v-if="settings?.transition_duration != null" class="et__form-row">
                            <span class="et__form-label">Fade duration</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.transition_duration"
                                :min="0"
                                :max="10"
                                @change="(v: number) => setConfig({transition_duration: v})"
                            >
                                <template #title>{{ settings.transition_duration }}s</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.transition_duration }}s</span>
                        </div>
                        <div v-if="settings?.fade_rate != null" class="et__form-row">
                            <span class="et__form-label">Fade rate</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.fade_rate"
                                :min="1"
                                :max="5"
                                @change="(v: number) => setConfig({fade_rate: v})"
                            >
                                <template #title>{{ settings.fade_rate }}</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.fade_rate }}</span>
                        </div>
                        <div v-if="settings?.button_fade_rate != null" class="et__form-row">
                            <span class="et__form-label">Button fade rate</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.button_fade_rate"
                                :min="1"
                                :max="5"
                                @change="(v: number) => setConfig({button_fade_rate: v})"
                            >
                                <template #title>{{ settings.button_fade_rate }}</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.button_fade_rate }}</span>
                        </div>
                        <div v-if="settings?.button_presets?.button_doublepush?.brightness != null" class="et__form-row">
                            <span class="et__form-label">Double-push brightness</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.button_presets.button_doublepush.brightness"
                                :min="0"
                                :max="100"
                                @change="(v: number) => setConfig({button_presets: {button_doublepush: {brightness: v}}})"
                            >
                                <template #title>{{ settings.button_presets.button_doublepush.brightness }}%</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.button_presets.button_doublepush.brightness }}%</span>
                        </div>
                        <div v-if="settings?.button_presets?.button_doublepush?.ct != null" class="et__form-row">
                            <span class="et__form-label">Double-push color temp</span>
                            <HorizontalSlider
                                v-if="canExecute && props.shellyID"
                                :value="settings.button_presets.button_doublepush.ct"
                                :min="ctRange.min"
                                :max="ctRange.max"
                                @change="(v: number) => setConfig({button_presets: {button_doublepush: {ct: v}}})"
                            >
                                <template #title>{{ settings.button_presets.button_doublepush.ct }}K</template>
                            </HorizontalSlider>
                            <span v-else class="et__panel-value">{{ settings.button_presets.button_doublepush.ct }}K</span>
                        </div>
                    </div>
                </section>

                <!-- Color temperature range -->
                <section v-if="settings?.ct_range?.length === 2" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('ctrange')"
                        @click="toggleSection('ctrange')"
                        @keydown="onSectionKey($event, 'ctrange')"
                    >
                        <span class="et__section-title">Color temp range</span>
                        <i class="fas et__chevron" :class="collapsed.has('ctrange') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('ctrange')" class="et__form">
                        <div v-if="canExecute && props.shellyID" class="et-bulb__range-row">
                            <span class="et__form-label">Min</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.ct_range[0]"
                                min="1000"
                                max="10000"
                                @change="(e: Event) => setConfig({ct_range: [Number((e.target as HTMLInputElement).value), settings!.ct_range[1]]})"
                            />
                            <span class="et__unit">K</span>
                            <span class="et__form-label">Max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.ct_range[1]"
                                min="1000"
                                max="10000"
                                @change="(e: Event) => setConfig({ct_range: [settings!.ct_range[0], Number((e.target as HTMLInputElement).value)]})"
                            />
                            <span class="et__unit">K</span>
                        </div>
                        <span v-else class="et__panel-value">{{ settings.ct_range[0] }}K – {{ settings.ct_range[1] }}K</span>
                    </div>
                </section>

                <!-- Timers -->
                <section v-if="settings?.auto_on !== undefined || settings?.auto_off !== undefined" class="et__group">
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('timers')"
                        @click="toggleSection('timers')"
                        @keydown="onSectionKey($event, 'timers')"
                    >
                        <span class="et__section-title">Timers</span>
                        <i class="fas et__chevron" :class="collapsed.has('timers') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('timers')" class="et__form">
                        <div v-if="settings?.auto_on !== undefined" class="et__timer-row">
                            <button
                                v-if="canExecute && props.shellyID"
                                type="button"
                                class="et__pill"
                                :class="settings.auto_on && 'et__pill--on'"
                                @click="setConfig({auto_on: !settings.auto_on})"
                            >Auto on</button>
                            <span v-else class="et__form-label">Auto on: {{ settings.auto_on ? 'Yes' : 'No' }}</span>
                            <template v-if="settings.auto_on">
                                <input
                                    v-if="canExecute && props.shellyID"
                                    type="number"
                                    class="et__num"
                                    :value="settings.auto_on_delay ?? 0"
                                    min="0"
                                    step="1"
                                    @change="(e: Event) => setConfig({auto_on_delay: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">sec</span>
                            </template>
                        </div>
                        <div v-if="settings?.auto_off !== undefined" class="et__timer-row">
                            <button
                                v-if="canExecute && props.shellyID"
                                type="button"
                                class="et__pill"
                                :class="settings.auto_off && 'et__pill--on'"
                                @click="setConfig({auto_off: !settings.auto_off})"
                            >Auto off</button>
                            <span v-else class="et__form-label">Auto off: {{ settings.auto_off ? 'Yes' : 'No' }}</span>
                            <template v-if="settings.auto_off">
                                <input
                                    v-if="canExecute && props.shellyID"
                                    type="number"
                                    class="et__num"
                                    :value="settings.auto_off_delay ?? 0"
                                    min="0"
                                    step="1"
                                    @change="(e: Event) => setConfig({auto_off_delay: Number((e.target as HTMLInputElement).value)})"
                                />
                                <span class="et__unit">sec</span>
                            </template>
                        </div>
                    </div>
                </section>

                <!-- Protections (PM devices) -->
                <section
                    v-if="settings?.power_limit != null || settings?.current_limit != null || settings?.voltage_limit != null"
                    class="et__group"
                >
                    <header
                        class="et__section-head"
                        role="button"
                        tabindex="0"
                        :aria-expanded="!collapsed.has('protections')"
                        @click="toggleSection('protections')"
                        @keydown="onSectionKey($event, 'protections')"
                    >
                        <span class="et__section-title">Protections</span>
                        <i class="fas et__chevron" :class="collapsed.has('protections') ? 'fa-chevron-right' : 'fa-chevron-down'" />
                    </header>
                    <div v-if="!collapsed.has('protections')" class="et__form">
                        <div v-if="settings?.power_limit != null" class="et__limit-row">
                            <span class="et__form-label">Power max</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.power_limit"
                                min="0"
                                @change="(e: Event) => setConfig({power_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.power_limit }}</span>
                            <span class="et__unit">W</span>
                        </div>
                        <div v-if="settings?.current_limit != null" class="et__limit-row">
                            <span class="et__form-label">Current max</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.current_limit"
                                min="0"
                                step="0.1"
                                @change="(e: Event) => setConfig({current_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.current_limit }}</span>
                            <span class="et__unit">A</span>
                        </div>
                        <div v-if="settings?.voltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage max</span>
                            <input
                                v-if="canExecute && props.shellyID"
                                type="number"
                                class="et__num"
                                :value="settings.voltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({voltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span v-else class="et__panel-value">{{ settings.voltage_limit }}</span>
                            <span class="et__unit">V</span>
                        </div>
                    </div>
                </section>
            </div>
        </details>

        <!-- Inline config-error feedback -->
        <div v-if="configError" class="et__error" role="alert">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import ColorWheel from '@/components/core/ColorWheel.vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {useAccordion} from '@/composables/useAccordion';
import {useNightMode} from '@/composables/useNightMode';
import {useToggleAfter} from '@/composables/useToggleAfter';
import {formatDuration} from '@/helpers/formatDuration';
import {formatCurrent} from '@/helpers/powerMetrics';
import {formatSource} from '@/helpers/sourceLabels';
import {useLightControl} from './useLightControl';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
    rpcType?: string;
}>();

const emit = defineEmits<{
    toggle: [];
    setRgb: [[number, number, number]];
    setWhite: [number];
    setBrightness: [number];
    setCt: [number];
    setMode: [string];
    toggleAfter: [seconds: number];
}>();

const {isOn, configError, setConfig} = useLightControl(
    props,
    props.rpcType ?? 'RGBCCT'
);

const {toggleAfterSec, doToggleAfter} = useToggleAfter((sec) =>
    emit('toggleAfter', sec)
);

const hasMode = computed(() => props.status?.mode !== undefined);

const ctRange = computed(() => {
    const r = props.settings?.ct_range;
    return {
        min: r?.[0] ?? 2700,
        max: r?.[1] ?? 6500
    };
});
const ctPresets = computed(() => {
    const {min, max} = ctRange.value;
    return {Warm: min, '3500K': 3500, '4500K': 4500, Cool: max};
});

const {nightMode, setNightTime} = useNightMode(() => props.settings, setConfig);

const {collapsed, toggle: toggleSection, onKey: onSectionKey} = useAccordion();

const hasConfigurableSettings = computed(() => {
    const s = props.settings;
    if (!s) return false;
    return (
        s.name != null ||
        s.initial_state ||
        s.in_mode ||
        s.min_brightness_on_toggle != null ||
        s.transition_duration != null ||
        s.fade_rate != null ||
        s.button_fade_rate != null ||
        s.range_map?.length === 2 ||
        s.button_presets?.button_doublepush?.brightness != null ||
        s.button_presets?.button_doublepush?.ct != null ||
        s.ct_range?.length === 2 ||
        s.auto_on !== undefined ||
        s.auto_off !== undefined ||
        s.power_limit != null ||
        s.current_limit != null ||
        s.voltage_limit != null
    );
});
</script>

<style src="./entityTemplate.css"></style>

<style scoped>
/* Bulb-specific: mode tabs + dimmed-when-off, color wheel wrap, time inputs */
.et-bulb__tabs {
    display: flex;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    overflow: hidden;
    background-color: var(--color-surface-2);
}
.et-bulb__tab {
    appearance: none;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-tertiary);
    background-color: transparent;
    cursor: pointer;
    transition: background-color var(--motion-state), color var(--motion-state);
    border: none;
    min-height: var(--touch-target-min);
}
.et-bulb__tab:hover:not(:disabled) {
    color: var(--color-text-primary);
    background-color: var(--color-surface-3);
}
.et-bulb__tab:disabled {
    cursor: default;
}
.et-bulb__tab--on {
    color: var(--color-primary-text);
    background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
    font-weight: var(--font-semibold);
}
.et-bulb__dimmed {
    opacity: 0.45;
    transition: opacity var(--motion-state);
}
.et-bulb__dimmed:hover,
.et-bulb__dimmed:focus-within {
    opacity: 0.8;
}
.et-bulb__wheel-wrap {
    display: flex;
    justify-content: center;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.et-bulb__hot {
    margin-left: var(--space-2);
    color: var(--color-warning-text);
    font-weight: var(--font-semibold);
}
.et-bulb__time-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.et-bulb__time-inputs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.et-bulb__time-input {
    width: auto;
    min-width: 0;
}
.et-bulb__range-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
</style>
