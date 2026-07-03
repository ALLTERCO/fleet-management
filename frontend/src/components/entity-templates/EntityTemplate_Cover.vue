<template>
    <div class="et">
        <!-- Hero: dominant power reading (only on metering covers) -->
        <header v-if="metrics.length > 0" class="et__hero">
            <div class="et__hero-value">{{ metrics[0].value }}</div>
            <div class="et__hero-label">{{ metrics[0].label }}</div>
        </header>

        <!-- Primary affordance: current state + Open / Stop / Close cluster -->
        <div class="et__primary et__primary--readonly et-cover__primary">
            <span class="et__primary-text">
                <span class="et__primary-state">{{ stateLabel }}</span>
                <span v-if="status?.source" class="et__primary-source">via {{ formatSource(status.source) }}</span>
            </span>
            <div v-if="canExecute" class="et-cover__cluster" aria-label="Cover controls">
                <button type="button" class="et-cover__btn" :aria-label="`Open ${stateLabel}`" @click="emit('open')">
                    <i class="fas fa-arrow-up" />
                </button>
                <button type="button" class="et-cover__btn" aria-label="Stop" @click="emit('stop')">
                    <i class="fas fa-stop" />
                </button>
                <button type="button" class="et-cover__btn" :aria-label="`Close ${stateLabel}`" @click="emit('close')">
                    <i class="fas fa-arrow-down" />
                </button>
            </div>
        </div>

        <!-- Banners (errors + transient target-position-while-moving) -->
        <div v-if="status?.errors?.length" class="et__banner et__banner--danger" role="alert">
            <i class="fas fa-triangle-exclamation" />
            <span class="et__banner-list">
                <span v-for="err in status.errors" :key="err">{{ err }}</span>
            </span>
        </div>
        <div v-if="status?.target_pos != null" class="et__banner et__banner--info">
            <i class="fas fa-arrow-right-long" />
            <span>Moving to {{ status.target_pos }}%</span>
        </div>

        <!-- Position slider (delegates to canonical CoverPosition component) -->
        <CoverPosition
            v-if="canExecute && status"
            :position="status?.current_pos ?? 0"
            :calibrated="status?.pos_control ?? false"
            :favorites="favorites ?? []"
            @change="(v: number) => emit('setPosition', v)"
        />

        <!-- Tilt / Slat (venetian blinds) -->
        <div v-if="hasTilt" class="et__slider-row">
            <div class="et__slider-head">
                <span class="et__slider-label"><i class="fas fa-bars-staggered" /> Tilt</span>
                <span class="et__slider-value">{{ tiltPos }}%</span>
            </div>
            <HorizontalSlider
                v-if="canExecute"
                :value="tiltPos"
                :saved="{'Closed': 0, '25%': 25, '50%': 50, '75%': 75, 'Open': 100}"
                @change="(v: number) => emit('setTilt', v)"
            >
                <template #title>Tilt ({{ tiltPos }}%)</template>
            </HorizontalSlider>
        </div>

        <!-- Calibration: warning + start / recalibrate -->
        <div v-if="canExecute && props.shellyID && status?.pos_control === false" class="et-cover__calibration">
            <div class="et__banner et__banner--warning">
                <i class="fas fa-triangle-exclamation" />
                <span>Not calibrated — position control unavailable</span>
            </div>
            <button
                type="button"
                class="et__chip et__chip--primary et-cover__calibrate"
                :disabled="isCalibrating || status?.state === 'calibrating'"
                @click="calibrate"
            >
                <i :class="isCalibrating ? 'fas fa-spinner fa-spin' : 'fas fa-ruler-combined'" />
                <span v-if="isCalibrating">Calibrating — cover is moving…</span>
                <span v-else>Start calibration</span>
            </button>
            <div v-if="isCalibrating" class="et__banner et__banner--info">
                <i class="fas fa-info-circle" />
                <span>The cover will open and close several times. Do not interrupt.</span>
            </div>
        </div>
        <div v-else-if="canExecute && props.shellyID && status?.pos_control === true" class="et-cover__calibration">
            <button
                type="button"
                class="et__chip et-cover__calibrate"
                :disabled="isCalibrating || status?.state === 'calibrating'"
                @click="calibrate"
            >
                <i :class="isCalibrating ? 'fas fa-spinner fa-spin' : 'fas fa-ruler-combined'" />
                <span v-if="isCalibrating">Calibrating — cover is moving…</span>
                <span v-else>Recalibrate</span>
            </button>
            <div v-if="isCalibrating" class="et__banner et__banner--info">
                <i class="fas fa-info-circle" />
                <span>The cover will open and close several times. Do not interrupt.</span>
            </div>
        </div>

        <!-- KPI strip (secondary power metrics) -->
        <ul v-if="metrics.length > 1" class="et__kpis">
            <li v-for="m in metrics.slice(1)" :key="m.label" class="et__kpi">
                <span class="et__kpi-value">{{ m.value }}</span>
                <span class="et__kpi-label">{{ m.label }}</span>
            </li>
        </ul>

        <!-- Energy / direction summary -->
        <section v-if="totalEnergy !== null || lastDirection" class="et__panel">
            <div v-if="totalEnergy !== null" class="et__panel-row">
                <span>Total energy</span>
                <span class="et__panel-value">{{ totalEnergy }} <small>kWh</small></span>
            </div>
            <div v-if="lastDirection" class="et__panel-row">
                <span>Last direction</span>
                <span class="et__panel-value">{{ lastDirection }}</span>
            </div>
            <div v-if="status?.aenergy?.by_minute?.length" class="et__panel-row">
                <span>Last 3 minutes</span>
                <span class="et__panel-value">{{ status.aenergy.by_minute.join(' / ') }} <small>mWh</small></span>
            </div>
        </section>

        <!-- Quick chip actions: timed open / close + reset counters -->
        <div v-if="canExecute" class="et__chip-row">
            <input
                v-model.number="durationSec"
                type="number"
                class="et__num"
                min="0.1"
                max="300"
                step="0.5"
                placeholder="sec"
                aria-label="Timed move seconds"
            />
            <button
                type="button"
                class="et__chip"
                :disabled="!durationSec"
                @click="openWithDuration"
            >
                <i class="fas fa-arrow-up" />
                <span>Open {{ durationSec || '…' }}s</span>
            </button>
            <button
                type="button"
                class="et__chip"
                :disabled="!durationSec"
                @click="closeWithDuration"
            >
                <i class="fas fa-arrow-down" />
                <span>Close {{ durationSec || '…' }}s</span>
            </button>
            <button
                v-if="props.shellyID && totalEnergy !== null"
                type="button"
                class="et__chip"
                @click="resetCounters"
            >
                <i class="fas fa-rotate-left" />
                <span>Reset counters</span>
            </button>
        </div>

        <!-- Configure: all settings, collapsed by default -->
        <details v-if="canExecute && settings && props.shellyID" class="et__configure">
            <summary class="et__configure-summary">
                <span><i class="fas fa-gear" /> Configure</span>
                <i class="fas fa-chevron-down et__configure-chevron" />
            </summary>

            <div class="et__configure-body">
                <!-- Cover settings: name / initial / invert -->
                <section class="et__group">
                    <header class="et__section-head">
                        <span class="et__section-title">Cover</span>
                    </header>
                    <div class="et__form">
                        <label v-if="settings.name != null" class="et__form-row">
                            <span class="et__form-label">Name</span>
                            <input
                                type="text"
                                class="et__text"
                                :value="settings.name"
                                placeholder="Cover name"
                                @change="(e: Event) => setConfig({name: (e.target as HTMLInputElement).value})"
                            />
                        </label>
                        <label v-if="settings.initial_state != null" class="et__form-row">
                            <span class="et__form-label">Initial state on power-on</span>
                            <select
                                class="et__select"
                                :value="settings.initial_state"
                                @change="(e: Event) => setConfig({initial_state: (e.target as HTMLSelectElement).value})"
                            >
                                <option value="open">Open</option>
                                <option value="closed">Closed</option>
                                <option value="stopped">Stopped</option>
                            </select>
                        </label>
                        <div v-if="settings.invert_directions !== undefined" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Reverse directions</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.invert_directions && 'et__switch--on'"
                                :aria-pressed="!!settings.invert_directions"
                                @click="confirmInvertDirections"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                    </div>
                </section>

                <!-- Movement time limits -->
                <section v-if="settings.maxtime_open != null || settings.maxtime_close != null" class="et__group">
                    <header class="et__section-head">
                        <span class="et__section-title">Movement time limits</span>
                    </header>
                    <div class="et__form">
                        <div v-if="settings.maxtime_open != null" class="et__limit-row">
                            <span class="et__form-label">Max open time</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.maxtime_open"
                                min="0"
                                step="0.5"
                                @change="(e: Event) => setConfig({maxtime_open: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">sec</span>
                        </div>
                        <div v-if="settings.maxtime_close != null" class="et__limit-row">
                            <span class="et__form-label">Max close time</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.maxtime_close"
                                min="0"
                                step="0.5"
                                @change="(e: Event) => setConfig({maxtime_close: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">sec</span>
                        </div>
                    </div>
                </section>

                <!-- Motor / idle -->
                <section v-if="settings.motor" class="et__group">
                    <header class="et__section-head">
                        <span class="et__section-title">Motor / idle</span>
                    </header>
                    <div class="et__form">
                        <div v-if="settings.motor.idle_power_thr != null" class="et__limit-row">
                            <span class="et__form-label">Idle power threshold</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.motor.idle_power_thr"
                                min="0"
                                step="1"
                                @change="(e: Event) => setConfig({motor: {idle_power_thr: Number((e.target as HTMLInputElement).value)}})"
                            />
                            <span class="et__unit">W</span>
                        </div>
                        <div v-if="settings.motor.idle_confirm_period != null" class="et__limit-row">
                            <span class="et__form-label">Idle confirm period</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.motor.idle_confirm_period"
                                min="0"
                                step="0.25"
                                @change="(e: Event) => setConfig({motor: {idle_confirm_period: Number((e.target as HTMLInputElement).value)}})"
                            />
                            <span class="et__unit">sec</span>
                        </div>
                    </div>
                </section>

                <!-- Input -->
                <section
                    v-if="settings.in_mode != null || settings.swap_inputs !== undefined || settings.in_locked != null || settings.maintenance_mode != null"
                    class="et__group"
                >
                    <header class="et__section-head">
                        <span class="et__section-title">Input</span>
                    </header>
                    <div class="et__form">
                        <label v-if="settings.in_mode != null" class="et__form-row">
                            <span class="et__form-label">Input mode</span>
                            <select
                                class="et__select"
                                :value="settings.in_mode"
                                @change="(e: Event) => setConfig({in_mode: (e.target as HTMLSelectElement).value})"
                            >
                                <option value="dual">Dual (open/close)</option>
                                <option value="single">Single button</option>
                                <option value="detached">Detached</option>
                            </select>
                        </label>
                        <div v-if="settings.swap_inputs !== undefined" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Swap inputs</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.swap_inputs && 'et__switch--on'"
                                :aria-pressed="!!settings.swap_inputs"
                                @click="setConfig({swap_inputs: !settings.swap_inputs})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <div v-if="settings.in_locked != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Lock input</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.in_locked && 'et__switch--on'"
                                :aria-pressed="!!settings.in_locked"
                                @click="setConfig({in_locked: !settings.in_locked})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <div v-if="settings.maintenance_mode != null" class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Maintenance mode</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.maintenance_mode && 'et__switch--on'"
                                :aria-pressed="!!settings.maintenance_mode"
                                @click="setConfig({maintenance_mode: !settings.maintenance_mode})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                    </div>
                </section>

                <!-- Slat / tilt config -->
                <section v-if="settings.slat" class="et__group">
                    <header class="et__section-head">
                        <span class="et__section-title">Slat / tilt</span>
                    </header>
                    <div class="et__form">
                        <div class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Enable</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.slat.enable && 'et__switch--on'"
                                :aria-pressed="!!settings.slat.enable"
                                @click="setConfig({slat: {enable: !settings.slat.enable}})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <template v-if="settings.slat.enable">
                            <div v-if="settings.slat.open_time != null" class="et__limit-row">
                                <span class="et__form-label">Open time</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.slat.open_time"
                                    min="0"
                                    step="0.1"
                                    @change="(e: Event) => setConfig({slat: {open_time: Number((e.target as HTMLInputElement).value)}})"
                                />
                                <span class="et__unit">sec</span>
                            </div>
                            <div v-if="settings.slat.close_time != null" class="et__limit-row">
                                <span class="et__form-label">Close time</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.slat.close_time"
                                    min="0"
                                    step="0.1"
                                    @change="(e: Event) => setConfig({slat: {close_time: Number((e.target as HTMLInputElement).value)}})"
                                />
                                <span class="et__unit">sec</span>
                            </div>
                            <div v-if="settings.slat.step != null" class="et__limit-row">
                                <span class="et__form-label">Step size</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.slat.step"
                                    min="1"
                                    max="100"
                                    @change="(e: Event) => setConfig({slat: {step: Number((e.target as HTMLInputElement).value)}})"
                                />
                                <span class="et__unit">%</span>
                            </div>
                            <div v-if="settings.slat.retain_pos != null" class="et__form-row et__form-row--inline">
                                <span class="et__form-label">Retain position</span>
                                <button
                                    type="button"
                                    class="et__switch"
                                    :class="settings.slat.retain_pos && 'et__switch--on'"
                                    :aria-pressed="!!settings.slat.retain_pos"
                                    @click="setConfig({slat: {retain_pos: !settings.slat.retain_pos}})"
                                ><span class="et__switch-thumb" /></button>
                            </div>
                            <div v-if="settings.slat.precise_ctl != null" class="et__form-row et__form-row--inline">
                                <span class="et__form-label">Precise control</span>
                                <button
                                    type="button"
                                    class="et__switch"
                                    :class="settings.slat.precise_ctl && 'et__switch--on'"
                                    :aria-pressed="!!settings.slat.precise_ctl"
                                    @click="setConfig({slat: {precise_ctl: !settings.slat.precise_ctl}})"
                                ><span class="et__switch-thumb" /></button>
                            </div>
                        </template>
                    </div>
                </section>

                <!-- Safety switch -->
                <section v-if="settings.safety_switch" class="et__group">
                    <header class="et__section-head">
                        <span class="et__section-title">Safety switch</span>
                    </header>
                    <div class="et__form">
                        <div class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Enable</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.safety_switch.enable && 'et__switch--on'"
                                :aria-pressed="!!settings.safety_switch.enable"
                                @click="setConfig({safety_switch: {enable: !settings.safety_switch.enable}})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <template v-if="settings.safety_switch.enable">
                            <label v-if="settings.safety_switch.direction != null" class="et__form-row">
                                <span class="et__form-label">Direction</span>
                                <select
                                    class="et__select"
                                    :value="settings.safety_switch.direction"
                                    @change="(e: Event) => setConfig({safety_switch: {direction: (e.target as HTMLSelectElement).value}})"
                                >
                                    <option value="open">Open</option>
                                    <option value="close">Close</option>
                                    <option value="both">Both</option>
                                </select>
                            </label>
                            <label v-if="settings.safety_switch.action != null" class="et__form-row">
                                <span class="et__form-label">Action</span>
                                <select
                                    class="et__select"
                                    :value="settings.safety_switch.action"
                                    @change="(e: Event) => setConfig({safety_switch: {action: (e.target as HTMLSelectElement).value}})"
                                >
                                    <option value="stop">Stop</option>
                                    <option value="reverse">Reverse</option>
                                    <option value="pause">Pause</option>
                                </select>
                            </label>
                            <label v-if="settings.safety_switch.allowed_move !== undefined" class="et__form-row">
                                <span class="et__form-label">Allowed move</span>
                                <select
                                    class="et__select"
                                    :value="settings.safety_switch.allowed_move ?? 'none'"
                                    @change="(e: Event) => setConfig({safety_switch: {allowed_move: (e.target as HTMLSelectElement).value === 'none' ? null : (e.target as HTMLSelectElement).value}})"
                                >
                                    <option value="reverse">Reverse</option>
                                    <option value="none">None</option>
                                </select>
                            </label>
                        </template>
                    </div>
                </section>

                <!-- Obstruction detection -->
                <section v-if="settings.obstruction_detection" class="et__group">
                    <header class="et__section-head">
                        <span class="et__section-title">Obstruction detection</span>
                    </header>
                    <div class="et__form">
                        <div class="et__form-row et__form-row--inline">
                            <span class="et__form-label">Enable</span>
                            <button
                                type="button"
                                class="et__switch"
                                :class="settings.obstruction_detection.enable && 'et__switch--on'"
                                :aria-pressed="!!settings.obstruction_detection.enable"
                                @click="setConfig({obstruction_detection: {enable: !settings.obstruction_detection.enable}})"
                            ><span class="et__switch-thumb" /></button>
                        </div>
                        <template v-if="settings.obstruction_detection.enable">
                            <label v-if="settings.obstruction_detection.direction != null" class="et__form-row">
                                <span class="et__form-label">Direction</span>
                                <select
                                    class="et__select"
                                    :value="settings.obstruction_detection.direction"
                                    @change="(e: Event) => setConfig({obstruction_detection: {direction: (e.target as HTMLSelectElement).value}})"
                                >
                                    <option value="open">Open</option>
                                    <option value="close">Close</option>
                                    <option value="both">Both</option>
                                </select>
                            </label>
                            <label v-if="settings.obstruction_detection.action != null" class="et__form-row">
                                <span class="et__form-label">Action</span>
                                <select
                                    class="et__select"
                                    :value="settings.obstruction_detection.action"
                                    @change="(e: Event) => setConfig({obstruction_detection: {action: (e.target as HTMLSelectElement).value}})"
                                >
                                    <option value="stop">Stop</option>
                                    <option value="reverse">Reverse</option>
                                </select>
                            </label>
                            <div v-if="settings.obstruction_detection.power_thr != null" class="et__limit-row">
                                <span class="et__form-label">Power threshold</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.obstruction_detection.power_thr"
                                    min="0"
                                    @change="(e: Event) => setConfig({obstruction_detection: {power_thr: Number((e.target as HTMLInputElement).value)}})"
                                />
                                <span class="et__unit">W</span>
                            </div>
                            <div v-if="settings.obstruction_detection.holdoff != null" class="et__limit-row">
                                <span class="et__form-label">Holdoff</span>
                                <input
                                    type="number"
                                    class="et__num"
                                    :value="settings.obstruction_detection.holdoff"
                                    min="0"
                                    step="0.5"
                                    @change="(e: Event) => setConfig({obstruction_detection: {holdoff: Number((e.target as HTMLInputElement).value)}})"
                                />
                                <span class="et__unit">sec</span>
                            </div>
                        </template>
                    </div>
                </section>

                <!-- Protections -->
                <section
                    v-if="settings.power_limit != null || settings.current_limit != null || settings.voltage_limit != null"
                    class="et__group"
                >
                    <header class="et__section-head">
                        <span class="et__section-title">Protections</span>
                    </header>
                    <div class="et__form">
                        <div v-if="settings.power_limit != null" class="et__limit-row">
                            <span class="et__form-label">Power max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.power_limit"
                                min="0"
                                @change="(e: Event) => setConfig({power_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">W</span>
                        </div>
                        <div v-if="settings.current_limit != null" class="et__limit-row">
                            <span class="et__form-label">Current max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.current_limit"
                                min="0"
                                step="0.1"
                                @change="(e: Event) => setConfig({current_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">A</span>
                        </div>
                        <div v-if="settings.voltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage max</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.voltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({voltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">V</span>
                        </div>
                        <div v-if="settings.undervoltage_limit != null" class="et__limit-row">
                            <span class="et__form-label">Voltage min</span>
                            <input
                                type="number"
                                class="et__num"
                                :value="settings.undervoltage_limit"
                                min="0"
                                @change="(e: Event) => setConfig({undervoltage_limit: Number((e.target as HTMLInputElement).value)})"
                            />
                            <span class="et__unit">V</span>
                        </div>
                    </div>
                </section>
            </div>
        </details>

        <!-- Read-only summary when execute permission is missing -->
        <section v-if="!canExecute && settings" class="et__readonly">
            <h4 class="et__section-title"><i class="fas fa-info-circle" /> Device Config</h4>
            <dl class="et__kv">
                <div v-if="settings.name" class="et__kv-row"><dt>Name</dt><dd>{{ settings.name }}</dd></div>
                <div v-if="settings.initial_state != null" class="et__kv-row"><dt>Initial state</dt><dd>{{ settings.initial_state.replace(/_/g, ' ') }}</dd></div>
                <div v-if="settings.invert_directions !== undefined" class="et__kv-row"><dt>Reverse directions</dt><dd>{{ settings.invert_directions ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.in_mode != null" class="et__kv-row"><dt>Input mode</dt><dd>{{ settings.in_mode }}</dd></div>
                <div v-if="settings.in_locked != null" class="et__kv-row"><dt>Input locked</dt><dd>{{ settings.in_locked ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.swap_inputs != null" class="et__kv-row"><dt>Swap inputs</dt><dd>{{ settings.swap_inputs ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.maintenance_mode != null" class="et__kv-row"><dt>Maintenance</dt><dd>{{ settings.maintenance_mode ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.maxtime_open != null" class="et__kv-row"><dt>Max open time</dt><dd>{{ settings.maxtime_open }}s</dd></div>
                <div v-if="settings.maxtime_close != null" class="et__kv-row"><dt>Max close time</dt><dd>{{ settings.maxtime_close }}s</dd></div>
                <div v-if="settings.motor?.idle_power_thr != null" class="et__kv-row"><dt>Idle threshold</dt><dd>{{ settings.motor.idle_power_thr }} W</dd></div>
                <div v-if="settings.slat?.enable != null" class="et__kv-row"><dt>Slat control</dt><dd>{{ settings.slat.enable ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.safety_switch?.enable != null" class="et__kv-row"><dt>Safety switch</dt><dd>{{ settings.safety_switch.enable ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.obstruction_detection?.enable != null" class="et__kv-row"><dt>Obstruction detect</dt><dd>{{ settings.obstruction_detection.enable ? 'Yes' : 'No' }}</dd></div>
                <div v-if="settings.power_limit != null" class="et__kv-row"><dt>Power max</dt><dd>{{ settings.power_limit }} W</dd></div>
                <div v-if="settings.current_limit != null" class="et__kv-row"><dt>Current max</dt><dd>{{ settings.current_limit }} A</dd></div>
                <div v-if="settings.voltage_limit != null" class="et__kv-row"><dt>Voltage max</dt><dd>{{ settings.voltage_limit }} V</dd></div>
                <div v-if="settings.undervoltage_limit != null" class="et__kv-row"><dt>Voltage min</dt><dd>{{ settings.undervoltage_limit }} V</dd></div>
            </dl>
        </section>

        <!-- Read-only tilt value -->
        <div v-if="hasTilt && !canExecute" class="et__panel">
            <div class="et__panel-row">
                <span>Tilt</span>
                <span class="et__panel-value">{{ tiltPos }}%</span>
            </div>
        </div>

        <!-- Config-call failure -->
        <div v-if="configError" class="et__error" role="alert">
            <i class="fas fa-triangle-exclamation" /> {{ configError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import CoverPosition from '@/components/core/Cover/CoverPosition.vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';
import {useDeviceCalibration} from '@/composables/useDeviceCalibration';
import {useResetCounters} from '@/composables/useResetCounters';
import {buildPowerMetrics, formatKwh} from '@/helpers/powerMetrics';
import {formatSource} from '@/helpers/sourceLabels';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    favorites?: number[];
    canExecute: boolean;
    shellyID?: string;
    entityId?: string;
}>();

const emit = defineEmits<{
    open: [];
    openDuration: [duration: number];
    stop: [];
    close: [];
    closeDuration: [duration: number];
    setPosition: [pos: number];
    setTilt: [slat_pos: number];
}>();

const configError = ref<string | null>(null);

// Covers are slower than lights — 180s safety timeout for calibration.
const {isCalibrating, calibrationProgress, calibrate, finishCalibration} =
    useDeviceCalibration({
        entityId: () => props.entityId,
        timeoutMs: 180_000,
        configError
    });

const {resetCounters} = useResetCounters({
    entityId: () => props.entityId,
    configError
});

const durationSec = ref<number | null>(null);
function openWithDuration() {
    if (durationSec.value && durationSec.value > 0) {
        emit('openDuration', durationSec.value);
    }
}
function closeWithDuration() {
    if (durationSec.value && durationSec.value > 0) {
        emit('closeDuration', durationSec.value);
    }
}

// Cover calibration completes when state leaves 'calibrating' OR pos_control
// flips to true. Errors of the form 'cal_abort:*' indicate failure.
watch(
    () => props.status?.state,
    (newState, oldState) => {
        if (newState === 'calibrating') {
            isCalibrating.value = true;
            configError.value = null;
        } else if (oldState === 'calibrating' && isCalibrating.value) {
            finishCalibration();
        }
    }
);

watch(
    () => props.status?.errors,
    (errors) => {
        if (!errors?.length || !isCalibrating.value) return;
        const calErrors = (errors as string[]).filter((e: string) =>
            e.startsWith('cal_abort:')
        );
        if (calErrors.length) {
            configError.value = `Calibration failed: ${calErrors.join(', ')}`;
            finishCalibration();
        }
    },
    {deep: true}
);

watch(
    () => props.status?.pos_control,
    (val) => {
        if (val === true && isCalibrating.value) finishCalibration();
    }
);

const stateLabel = computed(() => {
    const state = props.status?.state;
    if (!state) return 'Unknown';
    return String(state).charAt(0).toUpperCase() + String(state).slice(1);
});

const metrics = computed(() => buildPowerMetrics(props.status));
const totalEnergy = computed(() => formatKwh(props.status?.aenergy?.total));

const lastDirection = computed(() => {
    const d = props.status?.last_direction;
    if (!d) return null;
    return String(d).charAt(0).toUpperCase() + String(d).slice(1);
});

// Tilt support (venetian blinds with slat enabled)
const hasTilt = computed(
    () =>
        props.status?.slat_pos != null || props.settings?.slat?.enable === true
);
const tiltPos = computed(() => props.status?.slat_pos ?? 0);

function confirmInvertDirections() {
    const msg =
        'Reversing motor direction will reboot the device. Position will be lost but calibration is preserved. Continue?';
    if (window.confirm(msg)) {
        setConfig({invert_directions: !props.settings?.invert_directions});
    }
}

async function setConfig(config: Record<string, any>) {
    configError.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'Cover.SetConfig', {
            shellyID: props.shellyID,
            id: props.status?.id ?? 0,
            config
        });
    } catch (e: any) {
        configError.value = e.message || 'Failed to set config';
    }
}
</script>

<style src="./entityTemplate.css"></style>

<style scoped>
/* Cover-specific overrides: 3-button cluster + calibration layout */
.et-cover__primary {
    cursor: default;
}
.et-cover__cluster {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}
.et-cover__btn {
    appearance: none;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--motion-state), color var(--motion-state), border-color var(--motion-state);
}
.et-cover__btn:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-3));
    color: var(--color-text-primary);
    border-color: rgba(var(--color-primary-rgb), 0.42);
}
.et-cover__btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 var(--focus-ring-width) var(--focus-ring-color);
}
.et-cover__calibration {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-cover__calibrate {
    width: 100%;
    justify-content: center;
}
</style>
