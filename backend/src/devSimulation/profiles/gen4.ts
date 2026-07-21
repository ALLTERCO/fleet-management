import type {DeviceProfile} from '../types';
import {
    coverComponents,
    dimmerComponents,
    energyMeterComponents,
    floodComponents,
    inputComponents,
    makeProfile,
    mergeComponents,
    type ProfileComponents,
    type ProfileIdentity,
    presenceComponents,
    relayComponents,
    uiComponents
} from './shared';

const DOC_ROOT = 'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4';

interface Gen4Spec {
    identity: Omit<ProfileIdentity, 'gen' | 'sourceUrl'>;
    doc: string;
    components: ProfileComponents;
    modbus?: boolean;
}

function gen4Profile(spec: Gen4Spec): DeviceProfile {
    return makeProfile({
        identity: {
            ...spec.identity,
            gen: 4,
            sourceUrl: `${DOC_ROOT}/${spec.doc}/`
        },
        components: spec.components,
        connectivity: {bthome: true, modbus: spec.modbus}
    });
}

function powerStripComponents(): ProfileComponents {
    return mergeComponents(
        relayComponents({outputs: 4, inputs: 0, metered: true}),
        uiComponents('powerstrip_ui')
    );
}

const SPECS: readonly Gen4Spec[] = [
    {
        identity: {
            key: 'shelly-1-g4',
            displayName: 'Shelly 1 Gen4',
            idPrefix: 'shelly1g4',
            macPrefix: 'A4010100',
            model: 'S4SW-001X16EU',
            app: 'S1G4'
        },
        doc: 'Shelly1G4',
        components: relayComponents({outputs: 1, inputs: 1, metered: false}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-1pm-g4',
            displayName: 'Shelly 1PM Gen4',
            idPrefix: 'shelly1pmg4',
            macPrefix: 'A4010200',
            model: 'S4SW-001P16EU',
            app: 'S1PMG4'
        },
        doc: 'Shelly1PMG4',
        components: relayComponents({outputs: 1, inputs: 1, metered: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-2pm-g4',
            displayName: 'Shelly 2PM Gen4',
            idPrefix: 'shelly2pmg4',
            macPrefix: 'A4010300',
            model: 'S4SW-002P16EU',
            app: 'S2PMG4',
            profile: 'cover'
        },
        doc: 'Shelly2PMG4',
        components: coverComponents({covers: 1, inputs: 2}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-dimmer-010v-g4',
            displayName: 'Shelly Dimmer 0/1-10V PM Gen4',
            idPrefix: 'shelly0110dimg4',
            macPrefix: 'A4010400',
            model: 'S4DM-0010WW',
            app: 'Dimmer010G4'
        },
        doc: 'ShellyDimmer0110VPMG4',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-dimmer-g4',
            displayName: 'Shelly Dimmer Gen4',
            idPrefix: 'shellydimmerg4',
            macPrefix: 'A4010500',
            model: 'S4DM-0A101WWL',
            app: 'DimmerG4'
        },
        doc: 'ShellyDimmerG4',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-dimmer-us-g4',
            displayName: 'Shelly Dimmer US Gen4',
            idPrefix: 'shellydimmerusg4',
            macPrefix: 'A4010600',
            model: 'S4DM-0A102US',
            app: 'DimmerUSG4'
        },
        doc: 'ShellyDimmerG4US',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-em-g4',
            displayName: 'Shelly EM Gen4',
            idPrefix: 'shellyemg4',
            macPrefix: 'A4010700',
            model: 'S4EM-002CXCEU',
            app: 'EMG4'
        },
        doc: 'ShellyEMG4',
        components: energyMeterComponents({channels: 2, relay: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-flood-g4',
            displayName: 'Shelly Flood Gen4',
            idPrefix: 'shellyfloodg4',
            macPrefix: 'A4010800',
            model: 'S4SN-0071A',
            app: 'FloodG4'
        },
        doc: 'ShellyFlood',
        components: floodComponents()
    },
    {
        identity: {
            key: 'shelly-flood-s-g4',
            displayName: 'Shelly Flood S Gen4',
            idPrefix: 'shellyfloodsg4',
            macPrefix: 'A4010900',
            model: 'S4SN-0071Z',
            app: 'FloodSG4'
        },
        doc: 'ShellyFloodS',
        components: floodComponents()
    },
    {
        identity: {
            key: 'shelly-1-mini-g4',
            displayName: 'Shelly 1 Mini Gen4',
            idPrefix: 'shelly1minig4',
            macPrefix: 'A4010A00',
            model: 'S4SW-001X8EU',
            app: 'Mini1G4'
        },
        doc: 'ShellyMini1G4',
        components: relayComponents({outputs: 1, inputs: 1, metered: false}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-1pm-mini-g4',
            displayName: 'Shelly 1PM Mini Gen4',
            idPrefix: 'shelly1pmminig4',
            macPrefix: 'A4010B00',
            model: 'S4SW-001P8EU',
            app: 'Mini1PMG4'
        },
        doc: 'ShellyMini1PMG4',
        components: relayComponents({outputs: 1, inputs: 1, metered: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-em-mini-g4',
            displayName: 'Shelly EM Mini Gen4',
            idPrefix: 'shellyemminig4',
            macPrefix: 'A4010C00',
            model: 'S4EM-001PXCEU16',
            app: 'EMMiniG4'
        },
        doc: 'ShellyMiniEMG4',
        components: energyMeterComponents({channels: 1}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-plug-us-g4',
            displayName: 'Shelly Plug US Gen4',
            idPrefix: 'shellyplugusg4',
            macPrefix: 'A4010D00',
            model: 'S4PL-00116US',
            app: 'PlugUSG4'
        },
        doc: 'ShellyPlugUSG4',
        components: mergeComponents(
            relayComponents({outputs: 1, inputs: 0, metered: true}),
            uiComponents('plugs_ui'),
            {
                config: {'illuminance:0': {id: 0, name: 'Ambient light'}},
                status: {'illuminance:0': {id: 0, lux: 120}}
            }
        )
    },
    {
        identity: {
            key: 'shelly-power-strip-g4',
            displayName: 'Shelly PowerStrip Gen4 (ADE7953)',
            idPrefix: 'shellypstripg4',
            macPrefix: 'A4010E00',
            model: 'S4PL-00416EU',
            app: 'PowerStripG4'
        },
        doc: 'ShellyPowerStripG4',
        components: powerStripComponents()
    },
    {
        identity: {
            key: 'shelly-presence-g4',
            displayName: 'Shelly Presence Gen4',
            idPrefix: 'shellypresence',
            macPrefix: 'A4010F00',
            model: 'S4SN-0U61X',
            app: 'PresenceG4'
        },
        doc: 'ShellyPresenceG4',
        components: presenceComponents()
    },
    {
        identity: {
            key: 'shelly-i4-g4',
            displayName: 'Shelly i4 Gen4',
            idPrefix: 'shellyi4g4',
            macPrefix: 'A4011000',
            model: 'S4SN-0A24X',
            app: 'I4G4'
        },
        doc: 'ShellyI4G4',
        components: inputComponents(4)
    },
    {
        identity: {
            key: 'shelly-power-strip-bl0973-g4',
            displayName: 'Shelly PowerStrip Gen4 (BL0973)',
            idPrefix: 'shellypstripg4',
            macPrefix: 'A4011100',
            model: 'S4PL-10416EU',
            app: 'PowerStripG4'
        },
        doc: 'ShellyPowerStripG4',
        components: powerStripComponents()
    }
];

export const GEN4_PROFILES: readonly DeviceProfile[] = Object.freeze(
    SPECS.map(gen4Profile)
);
