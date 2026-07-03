import type {Component} from 'vue';
import EntityTemplate_BluGw from '@/components/entity-templates/EntityTemplate_BluGw.vue';
import EntityTemplate_BluTrv from '@/components/entity-templates/EntityTemplate_BluTrv.vue';
import EntityTemplate_Boolean from '@/components/entity-templates/EntityTemplate_Boolean.vue';
import EntityTemplate_BthomeSensor from '@/components/entity-templates/EntityTemplate_BthomeSensor.vue';
import EntityTemplate_Bulb from '@/components/entity-templates/EntityTemplate_Bulb.vue';
import EntityTemplate_Camera from '@/components/entity-templates/EntityTemplate_Camera.vue';
import EntityTemplate_CameraZone from '@/components/entity-templates/EntityTemplate_CameraZone.vue';
import EntityTemplate_Cover from '@/components/entity-templates/EntityTemplate_Cover.vue';
import EntityTemplate_Cury from '@/components/entity-templates/EntityTemplate_Cury.vue';
import EntityTemplate_DaliLight from '@/components/entity-templates/EntityTemplate_DaliLight.vue';
import EntityTemplate_EM from '@/components/entity-templates/EntityTemplate_EM.vue';
import EntityTemplate_Enum from '@/components/entity-templates/EntityTemplate_Enum.vue';
import EntityTemplate_Illuminance from '@/components/entity-templates/EntityTemplate_Illuminance.vue';
import EntityTemplate_Input from '@/components/entity-templates/EntityTemplate_Input.vue';
import EntityTemplate_LedStrip from '@/components/entity-templates/EntityTemplate_LedStrip.vue';
import EntityTemplate_Light from '@/components/entity-templates/EntityTemplate_Light.vue';
import EntityTemplate_Matter from '@/components/entity-templates/EntityTemplate_Matter.vue';
import EntityTemplate_Media from '@/components/entity-templates/EntityTemplate_Media.vue';
import EntityTemplate_Meter from '@/components/entity-templates/EntityTemplate_Meter.vue';
import EntityTemplate_Number from '@/components/entity-templates/EntityTemplate_Number.vue';
import EntityTemplate_Presence from '@/components/entity-templates/EntityTemplate_Presence.vue';
import EntityTemplate_PresenceZone from '@/components/entity-templates/EntityTemplate_PresenceZone.vue';
import EntityTemplate_Schedule from '@/components/entity-templates/EntityTemplate_Schedule.vue';
import EntityTemplate_Sensor from '@/components/entity-templates/EntityTemplate_Sensor.vue';
import EntityTemplate_Service from '@/components/entity-templates/EntityTemplate_Service.vue';
import EntityTemplate_Switch from '@/components/entity-templates/EntityTemplate_Switch.vue';
import EntityTemplate_Text from '@/components/entity-templates/EntityTemplate_Text.vue';
import EntityTemplate_Thermostat from '@/components/entity-templates/EntityTemplate_Thermostat.vue';
import EntityTemplate_Ui from '@/components/entity-templates/EntityTemplate_Ui.vue';
import EntityTemplate_VirtualButton from '@/components/entity-templates/EntityTemplate_VirtualButton.vue';
import BTHomeDeviceEntityView from '@/components/pages/devices/BTHomeDeviceEntityView.vue';
import {getBThomeIcon} from '@/config/bthome';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityActionCall {
    kind: 'entityAction';
    action: string;
    params?: Record<string, any>;
}

export type ActionRpc = EntityActionCall;

/**
 * Action handler called when a template emits an event. Returns a typed
 * entity action — every per-device op goes through Entity.InvokeAction.
 */
export type ActionHandler = (
    id: number,
    status: any,
    ...args: any[]
) => ActionRpc;

function entityAction(
    action: string,
    params?: Record<string, any>
): EntityActionCall {
    return {kind: 'entityAction', action, params};
}

export interface Tag {
    icon?: string;
    text: string;
}

export interface EntityProfileOverride {
    /** Override template component for this profile */
    template?: Component;
    /** Override or merge actions for this profile */
    actions?: Record<string, ActionHandler>;
    /** Override extra props for this profile */
    extraProps?: (entity: any) => Record<string, any>;
}

export interface EntityDef {
    /** FontAwesome icon class */
    icon: string;
    /** Board template component (null = use EntityWidget fallback) */
    template: Component | null;
    /** Event name → RPC handler. Keys must match the template's emit names exactly. */
    actions?: Record<string, ActionHandler>;
    /** Extra props to pass to the template beyond status/settings/canExecute */
    extraProps?: (entity: any) => Record<string, any>;
    /** Generate tags for widget description area. If undefined, generic builder is used. */
    tags?: (status: any, properties: any) => Tag[];
    /** Device-profile-specific overrides (e.g. 'dali' for DALI dimmers) */
    profiles?: Record<string, EntityProfileOverride>;
}

// ---------------------------------------------------------------------------
// Action helpers
//
// Closures return backend-owned entity actions or explicit backend RPC calls.
// ---------------------------------------------------------------------------

export type LightProfile = 'light' | 'cct' | 'rgb' | 'rgbw' | 'rgbcct';

/** Dimmer actions — backend Light.* namespace. */
function dimmerActions(_profile: LightProfile): Record<string, ActionHandler> {
    return {
        toggle: () => entityAction('toggle'),
        setBrightness: (_id, _s, value) =>
            value === 0
                ? entityAction('setOutput', {on: false})
                : entityAction('setBrightness', {brightness: value}),
        setTemp: (_id, _s, value) =>
            entityAction('setColorTemperature', {ct: value}),
        toggleAfter: (_id, status, seconds) =>
            entityAction('toggleAfter', {
                on: !status?.output,
                seconds
            })
    };
}

/** Smart bulb / LED controller — backend-owned action surface. */
function bulbActions(_profile: LightProfile): Record<string, ActionHandler> {
    return {
        toggle: () => entityAction('toggle'),
        setRgb: (_id, _s, rgb) => entityAction('setColor', {rgb}),
        setWhite: (_id, _s, value) => entityAction('setWhite', {white: value}),
        setBrightness: (_id, _s, value) =>
            value === 0
                ? entityAction('setOutput', {on: false})
                : entityAction('setBrightness', {brightness: value}),
        setCt: (_id, _s, value) =>
            entityAction('setColorTemperature', {ct: value}),
        setMode: (_id, _s, mode) => entityAction('setMode', {mode}),
        toggleAfter: (_id, status, seconds) =>
            entityAction('toggleAfter', {
                on: !status?.output,
                seconds
            })
    };
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

function curyTags(status: any): Tag[] {
    const tags: Tag[] = [];
    const leftSlot = status.slots?.left;
    const rightSlot = status.slots?.right;
    const leftHasVial =
        leftSlot?.vial?.serial && leftSlot.vial.serial !== '0000000000000000';
    const rightHasVial =
        rightSlot?.vial?.serial && rightSlot.vial.serial !== '0000000000000000';

    if (leftHasVial) {
        const name = leftSlot.vial.name || 'L';
        if (leftSlot.on)
            tags.push({
                text: `${name}: ${leftSlot.intensity}%`,
                icon: 'fas fa-spray-can'
            });
        if (leftSlot.boost)
            tags.push({text: `${name} Boost`, icon: 'fas fa-rocket'});
    }
    if (rightHasVial) {
        const name = rightSlot.vial.name || 'R';
        if (rightSlot.on)
            tags.push({
                text: `${name}: ${rightSlot.intensity}%`,
                icon: 'fas fa-spray-can'
            });
        if (rightSlot.boost)
            tags.push({text: `${name} Boost`, icon: 'fas fa-rocket'});
    }
    if (status.away_mode)
        tags.push({text: 'Away', icon: 'fas fa-plane-departure'});

    if (
        leftHasVial &&
        typeof leftSlot.vial.level === 'number' &&
        leftSlot.vial.level >= 0
    )
        tags.push({text: `L:${leftSlot.vial.level}%`, icon: 'fas fa-vial'});
    if (
        rightHasVial &&
        typeof rightSlot.vial.level === 'number' &&
        rightSlot.vial.level >= 0
    )
        tags.push({text: `R:${rightSlot.vial.level}%`, icon: 'fas fa-vial'});

    if (status.errors?.length > 0)
        tags.push({
            text: `${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`,
            icon: 'fas fa-triangle-exclamation'
        });
    return tags;
}

function thermostatTags(status: any): Tag[] {
    const tags: Tag[] = [];
    if (status.current_C != null) tags.push({text: `${status.current_C}°C`});
    if (status.target_C != null)
        tags.push({text: `→ ${status.target_C}°C`, icon: 'fas fa-crosshairs'});
    if (status.output) tags.push({text: 'Heating', icon: 'fas fa-fire'});
    return tags;
}

function cameraTags(status: any): Tag[] {
    const tags: Tag[] = [];
    if (status?.motion)
        tags.push({text: 'Motion', icon: 'fas fa-person-walking'});
    if (status?.recording)
        tags.push({text: 'Recording', icon: 'fas fa-circle'});
    return tags;
}

function matterTags(status: any): Tag[] {
    const tags: Tag[] = [];
    if (status?.num_fabrics != null)
        tags.push({
            text: `${status.num_fabrics} Fabric${status.num_fabrics !== 1 ? 's' : ''}`,
            icon: 'fas fa-network-wired'
        });
    if (status?.commissionable)
        tags.push({text: 'Pairing', icon: 'fas fa-link'});
    return tags;
}

function lightTags(status: any): Tag[] {
    const tags: Tag[] = [];
    if (status?.errors?.length)
        tags.push({
            text: `${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`,
            icon: 'fas fa-triangle-exclamation'
        });
    if (status?.flags?.includes('uncalibrated'))
        tags.push({text: 'Uncalibrated', icon: 'fas fa-sliders'});
    if (status?.output === true)
        tags.push({text: 'ON', icon: 'fas fa-power-off'});
    else if (status?.output === false)
        tags.push({text: 'OFF', icon: 'fas fa-power-off'});
    if (status?.brightness != null)
        tags.push({text: `${status.brightness}%`, icon: 'fas fa-sun'});
    if (status?.temp != null)
        tags.push({text: `${status.temp}K`, icon: 'fas fa-temperature-half'});
    if (status?.apower != null && status.apower !== 0)
        tags.push({text: `${status.apower} W`, icon: 'fas fa-bolt'});
    return tags;
}

function bulbTags(status: any): Tag[] {
    const tags: Tag[] = [];
    if (status?.errors?.length)
        tags.push({
            text: `${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`,
            icon: 'fas fa-triangle-exclamation'
        });
    if (status?.output === true)
        tags.push({text: 'ON', icon: 'fas fa-power-off'});
    else if (status?.output === false)
        tags.push({text: 'OFF', icon: 'fas fa-power-off'});
    if (status?.brightness != null)
        tags.push({text: `${status.brightness}%`, icon: 'fas fa-sun'});
    if (status?.mode === 'cct' && status?.ct != null)
        tags.push({text: `${status.ct}K`, icon: 'fas fa-temperature-half'});
    if (status?.mode === 'rgb')
        tags.push({text: 'Color', icon: 'fas fa-palette'});
    if (status?.apower != null && status.apower !== 0)
        tags.push({text: `${status.apower} W`, icon: 'fas fa-bolt'});
    return tags;
}

function switchTags(status: any): Tag[] {
    const tags: Tag[] = [];
    if (status?.errors?.length)
        tags.push({
            text: `${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`,
            icon: 'fas fa-triangle-exclamation'
        });
    if (status?.output === true)
        tags.push({text: 'ON', icon: 'fas fa-power-off'});
    else if (status?.output === false)
        tags.push({text: 'OFF', icon: 'fas fa-power-off'});
    if (status?.apower != null && status.apower !== 0)
        tags.push({text: `${status.apower} W`, icon: 'fas fa-bolt'});
    if (status?.voltage != null) tags.push({text: `${status.voltage} V`});
    if (status?.temperature?.tC != null)
        tags.push({
            text: `${status.temperature.tC}°C`,
            icon: 'fas fa-microchip'
        });
    return tags;
}

function mediaTags(status: any): Tag[] {
    const tags: Tag[] = [];
    const pb = status.playback;
    if (pb?.enable) tags.push({text: 'Playing', icon: 'fas fa-circle-play'});
    else tags.push({text: 'Stopped', icon: 'fas fa-circle-stop'});
    if (pb?.volume != null)
        tags.push({text: `Vol ${pb.volume}%`, icon: 'fas fa-volume-high'});
    return tags;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ENTITY_REGISTRY: Record<string, EntityDef> = {
    // --- Switches & relays ---
    switch: {
        icon: 'fas fa-toggle-on',
        template: EntityTemplate_Switch,
        actions: {
            toggle: () => entityAction('toggle'),
            toggleAfter: (_id, status, seconds) =>
                entityAction('toggleAfter', {
                    on: !status?.output,
                    seconds
                })
        },
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id
        }),
        tags: (status) => switchTags(status)
    },

    // --- Dimmers ---
    light: {
        icon: 'fas fa-light-ceiling',
        template: EntityTemplate_Light,
        actions: dimmerActions('light'),
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id
        }),
        tags: (status) => lightTags(status),
        profiles: {
            dali: {
                template: EntityTemplate_DaliLight,
                extraProps: (entity) => ({
                    shellyID: entity.source,
                    entityId: entity.id
                })
            }
        }
    },

    // --- Smart bulbs (all use Bulb template, different RPC types) ---
    cct: {
        icon: 'fas fa-lightbulb',
        template: EntityTemplate_Bulb,
        actions: bulbActions('cct'),
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id,
            rpcType: 'CCT'
        }),
        tags: (status) => bulbTags(status)
    },
    rgb: {
        icon: 'fas fa-palette',
        template: EntityTemplate_Bulb,
        actions: bulbActions('rgb'),
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id,
            rpcType: 'RGB'
        }),
        tags: (status) => bulbTags(status)
    },
    rgbw: {
        icon: 'fas fa-palette',
        template: EntityTemplate_Bulb,
        actions: bulbActions('rgbw'),
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id,
            rpcType: 'RGBW'
        }),
        tags: (status) => bulbTags(status)
    },
    rgbcct: {
        icon: 'fas fa-palette',
        template: EntityTemplate_Bulb,
        actions: bulbActions('rgbcct'),
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id,
            rpcType: 'RGBCCT'
        }),
        tags: (status) => bulbTags(status)
    },

    // --- Addressable LED strip (Pill `ledstrip` mode). Distinct from light/bulb. ---
    ledstrip: {
        icon: 'fas fa-bars',
        template: EntityTemplate_LedStrip,
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id,
            componentKey: `ledstrip:${entity.properties?.id ?? 0}`
        })
    },

    // --- Covers / rollers ---
    cover: {
        icon: 'fas fa-blinds',
        template: EntityTemplate_Cover,
        actions: {
            open: () => entityAction('open'),
            openDuration: (_id, _s, duration) =>
                entityAction('open', {duration}),
            stop: () => entityAction('stop'),
            close: () => entityAction('close'),
            closeDuration: (_id, _s, duration) =>
                entityAction('close', {duration}),
            setPosition: (_id, _s, pos) => entityAction('setPosition', {pos}),
            setTilt: (_id, _s, slat_pos) => entityAction('setTilt', {slat_pos})
        },
        extraProps: (entity) => ({
            favorites: entity.properties?.favorites,
            shellyID: entity.source,
            entityId: entity.id
        })
    },

    // --- Energy / power meters ---
    em: {
        icon: 'fas fa-meter-bolt',
        template: EntityTemplate_EM,
        extraProps: (entity) => ({entity})
    },
    em1: {
        icon: 'fas fa-meter-bolt',
        template: EntityTemplate_Meter,
        extraProps: (entity) => ({
            shellyID: entity.source
        })
    },
    pm1: {
        icon: 'fas fa-meter-bolt',
        template: EntityTemplate_Meter,
        extraProps: (entity) => ({
            shellyID: entity.source
        })
    },

    // --- Sensors ---
    temperature: {
        icon: 'fas fa-thermometer-half',
        template: EntityTemplate_Sensor,
        extraProps: (entity) => ({
            shellyID: entity.source,
            sensorType: 'temperature'
        })
    },
    humidity: {
        icon: 'fas fa-droplet-degree',
        template: EntityTemplate_Sensor,
        extraProps: (entity) => ({
            shellyID: entity.source,
            sensorType: 'humidity'
        })
    },
    flood: {
        icon: 'fas fa-droplet-percent',
        template: EntityTemplate_Sensor,
        tags: (status) => {
            const errors = status?.errors as string[] | undefined;
            if (errors?.includes('cable_unplugged'))
                return [
                    {text: 'Cable fault', icon: 'fas fa-triangle-exclamation'}
                ];
            if (status?.alarm === true)
                return [{text: 'FLOOD', icon: 'fas fa-water'}];
            if (status?.mute)
                return [{text: 'Muted', icon: 'fas fa-bell-slash'}];
            return [];
        },
        extraProps: (entity) => ({shellyID: entity.source, sensorType: 'flood'})
    },
    smoke: {
        icon: 'fas fa-sensor-fire',
        template: EntityTemplate_Sensor,
        actions: {
            mute: (_id, _s, value: boolean) =>
                entityAction('mute', {mute: value})
        },
        extraProps: (entity) => ({shellyID: entity.source, sensorType: 'smoke'})
    },
    devicepower: {
        icon: 'fas fa-battery-three-quarters',
        template: EntityTemplate_Sensor,
        extraProps: (entity) => ({
            shellyID: entity.source,
            sensorType: 'devicepower'
        })
    },
    voltmeter: {
        icon: 'fas fa-meter',
        template: EntityTemplate_Sensor,
        extraProps: (entity) => ({
            shellyID: entity.source,
            sensorType: 'voltmeter'
        })
    },

    // --- Inputs ---
    input: {
        icon: 'fas fa-sensor',
        template: EntityTemplate_Input,
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id
        })
    },

    // --- BTHome sensors ---
    bthomesensor: {
        icon: 'fas fa-thermometer-half',
        template: EntityTemplate_BthomeSensor,
        extraProps: (entity) => ({
            objName: entity.properties?.objName,
            unit: entity.properties?.unit,
            sensorType: entity.properties?.sensorType,
            shellyID: entity.source
        })
    },

    // --- Cury (Scent Diffuser) ---
    cury: {
        icon: 'fas fa-spray-can',
        template: EntityTemplate_Cury,
        actions: {
            'toggle-slot': (_id, _s, slot, on) =>
                entityAction('setSlot', {slot, on}),
            'set-intensity': (_id, _s, slot, intensity) =>
                entityAction('setIntensity', {slot, intensity}),
            boost: (_id, _s, slot) =>
                entityAction('setBoost', {slot, on: true}),
            'stop-boost': (_id, _s, slot) =>
                entityAction('setBoost', {slot, on: false}),
            'set-ambient-color': (_id, _s, rgb) =>
                entityAction('setAmbientColor', {rgb}),
            'toggle-away-mode': (_id, _s, enabled) =>
                entityAction('setAwayMode', {on: enabled}),
            'set-mode': (_id, _s, mode) =>
                entityAction('setCuryMode', {
                    mode: mode === 'null' ? null : mode
                })
        },
        extraProps: (entity) => ({
            shellyID: entity.source
        }),
        tags: (status) => curyTags(status)
    },

    // --- Wall Display components ---
    illuminance: {
        icon: 'fas fa-brightness',
        template: EntityTemplate_Illuminance,
        extraProps: (entity) => ({shellyID: entity.source}),
        tags: () => []
    },
    thermostat: {
        icon: 'fas fa-temperature-arrow-up',
        template: EntityTemplate_Thermostat,
        extraProps: (entity) => ({shellyID: entity.source}),
        actions: {
            toggle: (_id, status) =>
                entityAction('setEnabled', {
                    enabled: !(status?.enable ?? false)
                }),
            'set-target': (_id, _s, target_C) =>
                entityAction('setTarget', {target_C})
        },
        tags: (status) => thermostatTags(status)
    },
    media: {
        icon: 'fas fa-speaker',
        template: EntityTemplate_Media,
        extraProps: (entity) => ({
            shellyID: entity.source
        }),
        actions: {
            'play-pause': () => entityAction('playPause'),
            prev: () => entityAction('previous'),
            next: () => entityAction('next'),
            'set-volume': (_id, _s, volume) =>
                entityAction('setVolume', {volume}),
            'play-favourite': (_id, _s, favouriteId) =>
                entityAction('playFavourite', {favouriteId}),
            'radio-next': () => entityAction('playNextFavourite'),
            'radio-prev': () => entityAction('playPreviousFavourite'),
            'radio-stop': () => entityAction('radioStop')
        },
        tags: (status) => mediaTags(status)
    },
    ui: {
        icon: 'fas fa-display',
        template: EntityTemplate_Ui,
        actions: {
            'set-screen': (_id, _s, screen) =>
                entityAction('setScreen', {screen}),
            swipe: (_id, _s, direction) => entityAction('swipe', {direction}),
            tap: () => entityAction('tap')
        },
        extraProps: (entity) => ({shellyID: entity.source}),
        tags: () => []
    },
    matter: {
        icon: 'fas fa-qrcode',
        template: EntityTemplate_Matter,
        actions: {
            toggle: (_id, _s, enable) =>
                entityAction('setEnabled', {enabled: enable})
        },
        extraProps: (entity) => ({
            shellyID: entity.source
        }),
        tags: (status) => matterTags(status)
    },

    // --- Camera ---
    camera: {
        icon: 'fas fa-camera-cctv',
        template: EntityTemplate_Camera,
        extraProps: (entity) => ({
            shellyID: entity.source
        }),
        actions: {
            'toggle-arm': (_id, _s, armed: boolean) =>
                entityAction('setArmed', {armed}),
            'toggle-privacy': (_id, _s, privacy: boolean) =>
                entityAction('setPrivacy', {privacy}),
            capture: () => entityAction('capture'),
            'start-recording': () => entityAction('startRecording'),
            'stop-recording': () => entityAction('stopRecording')
        },
        tags: (status) => cameraTags(status)
    },

    // --- Virtual components ---
    boolean: {
        icon: 'fas fa-toggle-on',
        template: EntityTemplate_Boolean,
        actions: {
            set: (_id, _s, value: boolean) => entityAction('setValue', {value})
        },
        extraProps: (entity) => ({
            view: entity.properties?.view,
            labelTrue: entity.properties?.labelTrue,
            labelFalse: entity.properties?.labelFalse
        })
    },
    number: {
        icon: 'fas fa-hashtag',
        template: EntityTemplate_Number,
        actions: {
            set: (_id, _s, value: number) => entityAction('setValue', {value})
        },
        extraProps: (entity) => ({
            view: entity.properties?.view,
            unit: entity.properties?.unit,
            min: entity.properties?.min,
            max: entity.properties?.max,
            step: entity.properties?.step
        })
    },
    text: {
        icon: 'fas fa-font',
        template: EntityTemplate_Text,
        actions: {
            set: (_id, _s, value: string) => entityAction('setValue', {value})
        },
        extraProps: (entity) => ({
            view: entity.properties?.view,
            maxLength: entity.properties?.maxLength
        })
    },
    enum: {
        icon: 'fas fa-list',
        template: EntityTemplate_Enum,
        actions: {
            set: (_id, _s, value: string) => entityAction('setValue', {value})
        },
        extraProps: (entity) => ({
            view: entity.properties?.view,
            options: entity.properties?.options
        })
    },
    button: {
        icon: 'fas fa-hand-pointer',
        template: EntityTemplate_VirtualButton,
        actions: {
            press: () => entityAction('press')
        }
    },
    group: {
        icon: 'fas fa-object-group',
        template: null,
        tags: (status) => {
            const tags: Tag[] = [];
            const members = status?.members;
            if (Array.isArray(members))
                tags.push({text: `${members.length} members`});
            return tags;
        }
    },

    // --- Camera zones ---
    camerazone: {
        icon: 'fas fa-camera-security',
        template: EntityTemplate_CameraZone,
        extraProps: (entity) => ({shellyID: entity.source}),
        tags: (status) => {
            const tags: Tag[] = [];
            if (status?.motion === true)
                tags.push({text: 'Motion', icon: 'fas fa-person-walking'});
            else if (status?.motion === false)
                tags.push({text: 'Clear', icon: 'fas fa-check-circle'});
            return tags;
        }
    },

    // --- Presence sensor ---
    presence: {
        icon: 'fas fa-sensor',
        template: EntityTemplate_Presence,
        extraProps: (entity) => ({shellyID: entity.source}),
        tags: () => []
    },
    presencezone: {
        icon: 'fas fa-radar',
        template: EntityTemplate_PresenceZone,
        extraProps: (entity) => ({shellyID: entity.source}),
        tags: (status) => {
            const tags: Tag[] = [];
            if (status?.value === true)
                tags.push({text: 'Occupied', icon: 'fas fa-person'});
            else if (status?.value === false)
                tags.push({
                    text: 'Empty',
                    icon: 'fas fa-person-walking-dashed-line-arrow-right'
                });
            if (status?.num_objects > 0)
                tags.push({
                    text: `${status.num_objects} object${status.num_objects > 1 ? 's' : ''}`
                });
            return tags;
        }
    },

    // --- Schedule (device-level service, one per device) ---
    schedule: {
        icon: 'fas fa-calendar-days',
        template: EntityTemplate_Schedule,
        extraProps: (entity) => ({
            shellyID: entity.source
        }),
        tags: () => []
    },

    // --- BLU TRV ---
    blutrv: {
        icon: 'fas fa-pipe-valve',
        template: EntityTemplate_BluTrv,
        actions: {
            'start-boost': (_id, _s, duration) =>
                entityAction('startBoost', {duration}),
            'clear-boost': () => entityAction('clearBoost')
        },
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityId: entity.id
        }),
        tags: (status) => {
            const tags: Tag[] = [];
            if (status?.errors?.length)
                tags.push({
                    text: status.errors
                        .map((e: string) => e.replace(/_/g, ' '))
                        .join(', '),
                    icon: 'fas fa-triangle-exclamation'
                });
            if (status?.connected === false)
                tags.push({text: 'Disconnected', icon: 'fas fa-link-slash'});
            return tags;
        }
    },

    // --- BLU Gateway ---
    blugw: {
        icon: 'fas fa-tower-broadcast',
        template: EntityTemplate_BluGw,
        extraProps: (entity) => ({shellyID: entity.source}),
        tags: (_status, properties) => {
            const tags: Tag[] = [];
            if (properties?.sys_led_enable === false)
                tags.push({text: 'LED Off', icon: 'fas fa-lightbulb-slash'});
            return tags;
        }
    },

    // --- BTHome Device (physical BLE device) ---
    bthomedevice: {
        icon: 'fab fa-bluetooth-b',
        template: BTHomeDeviceEntityView,
        extraProps: (entity) => ({
            shellyID: entity.source,
            entityProperties: entity.properties
        }),
        tags: () => []
    },

    // --- BTHome Controls (learned BLE remote buttons/dimmers) ---
    bthomecontrol: {
        icon: 'fas fa-gamepad',
        template: null,
        tags: () => []
    },

    // --- XT1 Service devices (Powered by Shelly / Shelly X) ---
    service: {
        icon: 'fas fa-microchip',
        template: EntityTemplate_Service,
        extraProps: (entity) => ({
            entityId: entity.id,
            shellyID: entity.source,
            entityProperties: entity.properties
        }),
        tags: () => []
    }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the icon class for an entity type. For BTHome sensors, uses centralized bthome config. */
export function getEntityIcon(
    type: string,
    properties?: Record<string, any>
): string {
    if (
        (type === 'bthomesensor' || type === 'bthomedevice') &&
        properties?.objName
    ) {
        return getBThomeIcon(properties.objName);
    }
    return ENTITY_REGISTRY[type]?.icon ?? 'fas fa-power-off';
}

/** Get the board template component for an entity type, with optional profile override. */
export function getEntityTemplate(
    type: string,
    profile?: string
): Component | undefined {
    const def = ENTITY_REGISTRY[type];
    if (!def) return undefined;
    if (profile && def.profiles?.[profile]?.template) {
        return def.profiles[profile].template;
    }
    return def.template ?? undefined;
}

/** Get the full entity definition, or undefined for unknown types. */
export function getEntityDef(type: string): EntityDef | undefined {
    return ENTITY_REGISTRY[type];
}

/**
 * Resolve the effective actions for an entity type + profile.
 * Profile actions are merged on top of the base actions.
 */
export function getEntityActions(
    type: string,
    profile?: string
): Record<string, ActionHandler> | undefined {
    const def = ENTITY_REGISTRY[type];
    if (!def) return undefined;
    const base = def.actions ?? {};
    if (profile && def.profiles?.[profile]?.actions) {
        return {...base, ...def.profiles[profile].actions};
    }
    return Object.keys(base).length ? base : undefined;
}

/**
 * Resolve the effective extraProps for an entity type + profile.
 * Profile extraProps override the base.
 */
export function getEntityExtraProps(
    type: string,
    profile?: string
): ((entity: any) => Record<string, any>) | undefined {
    const def = ENTITY_REGISTRY[type];
    if (!def) return undefined;
    if (profile && def.profiles?.[profile]?.extraProps) {
        return def.profiles[profile].extraProps;
    }
    return def.extraProps;
}
