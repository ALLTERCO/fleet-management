import type {DeviceProfile} from '../types';
import {
    bulbComponents,
    climateComponents,
    coverComponents,
    dimmerComponents,
    energyMeterComponents,
    inputComponents,
    makeProfile,
    mergeComponents,
    type ProfileComponents,
    type ProfileIdentity,
    pmComponents,
    relayComponents,
    uiComponents
} from './shared';

const DOC_ROOT = 'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen3';

interface Gen3Spec {
    identity: Omit<ProfileIdentity, 'gen' | 'sourceUrl'>;
    doc: string;
    components: ProfileComponents;
    modbus?: boolean;
}

function gen3Profile(spec: Gen3Spec): DeviceProfile {
    return makeProfile({
        identity: {
            ...spec.identity,
            gen: 3,
            sourceUrl: `${DOC_ROOT}/${spec.doc}/`
        },
        components: spec.components,
        connectivity: {bthome: true, modbus: spec.modbus}
    });
}

function plugComponents(): ProfileComponents {
    return mergeComponents(
        relayComponents({outputs: 1, inputs: 0, metered: true}),
        uiComponents('plugs_ui')
    );
}

const SPECS: readonly Gen3Spec[] = [
    {
        identity: {
            key: 'shelly-1-g3',
            displayName: 'Shelly 1 Gen3',
            idPrefix: 'shelly1g3',
            macPrefix: 'A3010100',
            model: 'S3SW-001X16EU',
            app: 'S1G3'
        },
        doc: 'Shelly1G3',
        components: relayComponents({outputs: 1, inputs: 1, metered: false})
    },
    {
        identity: {
            key: 'shelly-1l-g3',
            displayName: 'Shelly 1L Gen3',
            idPrefix: 'shelly1lg3',
            macPrefix: 'A3010200',
            model: 'S3SW-0A1X1EUL',
            app: 'S1LG3'
        },
        doc: 'Shelly1LG3',
        components: relayComponents({outputs: 1, inputs: 2, metered: false})
    },
    {
        identity: {
            key: 'shelly-1pm-g3',
            displayName: 'Shelly 1PM Gen3',
            idPrefix: 'shelly1pmg3',
            macPrefix: 'A3010300',
            model: 'S3SW-001P16EU',
            app: 'S1PMG3'
        },
        doc: 'Shelly1PMG3',
        components: relayComponents({outputs: 1, inputs: 1, metered: true})
    },
    {
        identity: {
            key: 'shelly-2l-g3',
            displayName: 'Shelly 2L Gen3',
            idPrefix: 'shelly2lg3',
            macPrefix: 'A3010400',
            model: 'S3SW-0A2X4EUL',
            app: 'S2LG3'
        },
        doc: 'Shelly2LG3',
        components: relayComponents({outputs: 2, inputs: 2, metered: false})
    },
    {
        identity: {
            key: 'shelly-2pm-g3',
            displayName: 'Shelly 2PM Gen3',
            idPrefix: 'shelly2pmg3',
            macPrefix: 'A3010500',
            model: 'S3SW-002P16EU',
            app: 'S2PMG3',
            profile: 'cover'
        },
        doc: 'Shelly2PMG3',
        components: coverComponents({covers: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-3em-63t-g3',
            displayName: 'Shelly 3EM-63T Gen3',
            idPrefix: 'shelly3em63g3',
            macPrefix: 'A3010600',
            model: 'S3EM-003CXCEU63',
            app: 'S3EMG3',
            profile: 'triphase'
        },
        doc: 'Shelly3EMG3',
        components: energyMeterComponents({channels: 3, threePhase: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-3em-63w-g3',
            displayName: 'Shelly 3EM-63W Gen3',
            idPrefix: 'shelly3em63g3',
            macPrefix: 'A3011B00',
            model: 'S3EM-003CXCEU63',
            app: 'S3EMG3',
            profile: 'triphase'
        },
        doc: 'Shelly3EMG3',
        components: energyMeterComponents({channels: 3, threePhase: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-az-plug-g3',
            displayName: 'Shelly AZ Plug',
            idPrefix: 'shellyazplug',
            macPrefix: 'A3010700',
            model: 'S3PL-10112EU',
            app: 'AZPlug'
        },
        doc: 'ShellyAZPlug',
        components: plugComponents()
    },
    {
        identity: {
            key: 'shelly-d-dimmer-g3',
            displayName: 'Shelly DALI Dimmer Gen3',
            idPrefix: 'shellyddimmerg3',
            macPrefix: 'A3010800',
            model: 'S3DM-0A1WW',
            app: 'DDimmerG3'
        },
        doc: 'ShellyDDimmerG3',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-dimmer-010v-g3',
            displayName: 'Shelly Dimmer 0/1-10V PM Gen3',
            idPrefix: 'shelly0110dimg3',
            macPrefix: 'A3010900',
            model: 'S3DM-0010WW',
            app: 'Dimmer010G3'
        },
        doc: 'ShellyDimmer0110VPMG3',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-dimmer-g3',
            displayName: 'Shelly Dimmer Gen3',
            idPrefix: 'shellydimmerg3',
            macPrefix: 'A3010A00',
            model: 'S3DM-0A101WWL',
            app: 'DimmerG3'
        },
        doc: 'ShellyDimmerG3',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-duo-bulb-g3',
            displayName: 'Shelly Duo Bulb Gen3',
            idPrefix: 'shellyduobulbg3',
            macPrefix: 'A3010B00',
            model: 'S3BL-D010009AEU',
            app: 'DuoBulbG3'
        },
        doc: 'ShellyDuoBulbG3',
        components: bulbComponents('cct')
    },
    {
        identity: {
            key: 'shelly-em-g3',
            displayName: 'Shelly EM Gen3',
            idPrefix: 'shellyemg3',
            macPrefix: 'A3010C00',
            model: 'S3EM-002CXCEU',
            app: 'EMG3'
        },
        doc: 'ShellyEMG3',
        components: energyMeterComponents({channels: 2, relay: true})
    },
    {
        identity: {
            key: 'shelly-ht-g3',
            displayName: 'Shelly H&T Gen3',
            idPrefix: 'shellyhtg3',
            macPrefix: 'A3010D00',
            model: 'S3SN-0U12A',
            app: 'HTG3'
        },
        doc: 'ShellyHTG3',
        components: climateComponents()
    },
    {
        identity: {
            key: 'shelly-az-ht-g3',
            displayName: 'Shelly AZ H&T',
            idPrefix: 'shellyazht',
            macPrefix: 'A3011A00',
            model: 'S3SN-1U12A',
            app: 'AZHT'
        },
        doc: 'ShellyAZHT',
        components: climateComponents()
    },
    {
        identity: {
            key: 'shelly-i4-g3',
            displayName: 'Shelly i4 Gen3',
            idPrefix: 'shellyi4g3',
            macPrefix: 'A3010E00',
            model: 'S3SN-0024X',
            app: 'I4G3'
        },
        doc: 'ShellyI4G3',
        components: inputComponents(4)
    },
    {
        identity: {
            key: 'shelly-1-mini-g3',
            displayName: 'Shelly 1 Mini Gen3',
            idPrefix: 'shelly1minig3',
            macPrefix: 'A3010F00',
            model: 'S3SW-001X8EU',
            app: 'Mini1G3'
        },
        doc: 'ShellyMini1G3',
        components: relayComponents({outputs: 1, inputs: 1, metered: false})
    },
    {
        identity: {
            key: 'shelly-1pm-mini-g3',
            displayName: 'Shelly 1PM Mini Gen3',
            idPrefix: 'shelly1pmminig3',
            macPrefix: 'A3011000',
            model: 'S3SW-001P8EU',
            app: 'Mini1PMG3'
        },
        doc: 'ShellyMini1PMG3',
        components: relayComponents({outputs: 1, inputs: 1, metered: true})
    },
    {
        identity: {
            key: 'shelly-pm-mini-g3',
            displayName: 'Shelly PM Mini Gen3',
            idPrefix: 'shellypmminig3',
            macPrefix: 'A3011100',
            model: 'S3PM-001PCEU16',
            app: 'MiniPMG3'
        },
        doc: 'ShellyMiniPMG3',
        components: pmComponents()
    },
    {
        identity: {
            key: 'shelly-outdoor-plug-s-g3',
            displayName: 'Shelly Outdoor Plug S Gen3',
            idPrefix: 'shellyoutdoorsg3',
            macPrefix: 'A3011200',
            model: 'S3PL-20112EU',
            app: 'OutdoorPlugSG3'
        },
        doc: 'ShellyOutdoorPlugSG3',
        components: plugComponents()
    },
    {
        identity: {
            key: 'shelly-plug-cn-g3',
            displayName: 'Shelly Plug CN Gen3',
            idPrefix: 'shellyplugcng3',
            macPrefix: 'A3011300',
            model: 'S3PL-00110CN',
            app: 'PlugCNG3'
        },
        doc: 'ShellyPlugCNG3',
        components: relayComponents({outputs: 1, inputs: 0, metered: true})
    },
    {
        identity: {
            key: 'shelly-plug-m-g3',
            displayName: 'Shelly Plug M Gen3',
            idPrefix: 'shellyplugmg3',
            macPrefix: 'A3011400',
            model: 'S3PL-30110EU',
            app: 'PlugMG3'
        },
        doc: 'ShellyPlugMG3',
        components: plugComponents()
    },
    {
        identity: {
            key: 'shelly-plug-pm-g3',
            displayName: 'Shelly Plug PM Gen3',
            idPrefix: 'shellyplugpmg3',
            macPrefix: 'A3011500',
            model: 'S3PL-30116EU',
            app: 'PlugPMG3'
        },
        doc: 'ShellyPlugPMG3',
        components: mergeComponents(pmComponents(), uiComponents('plugpm_ui'))
    },
    {
        identity: {
            key: 'shelly-plug-s-g3',
            displayName: 'Shelly Plug S Gen3',
            idPrefix: 'shellyplugsg3',
            macPrefix: 'A3011600',
            model: 'S3PL-00112EU',
            app: 'PlugSG3'
        },
        doc: 'ShellyPlugSG3',
        components: plugComponents()
    },
    {
        identity: {
            key: 'shelly-rgbcct-bulb-g3',
            displayName: 'Shelly Multicolor Bulb E27 Gen3',
            idPrefix: 'shellyrgbcctbulbg3',
            macPrefix: 'A3011700',
            model: 'S3BL-C010007AEU',
            app: 'RGBCCTBulbG3'
        },
        doc: 'ShellyRGBCCTBulbG3',
        components: bulbComponents('rgbcct')
    },
    {
        identity: {
            key: 'shelly-shutter-g3',
            displayName: 'Shelly Shutter Gen3',
            idPrefix: 'shellyshutterg3',
            macPrefix: 'A3011800',
            model: 'S3SH-0A2P4EU',
            app: 'ShutterG3',
            profile: 'cover'
        },
        doc: 'ShellyShutter',
        components: coverComponents({covers: 1, inputs: 2})
    },
    {
        identity: {
            key: 'the-pill-g3',
            displayName: 'The Pill by Shelly',
            idPrefix: 'shellypill',
            macPrefix: 'A3011900',
            model: 'S3SN-0U53X',
            app: 'Pill'
        },
        doc: 'ThePill',
        components: mergeComponents(inputComponents(2), {
            config: {
                pill: {mode: 'sensor'},
                'voltmeter:0': {id: 0, name: 'Analog input'},
                'temperature:0': {id: 0, name: 'Probe temperature'},
                'humidity:0': {id: 0, name: 'Probe humidity'},
                serial: {baud: 9600},
                mbrtuclient: {enable: true}
            },
            status: {
                pill: {},
                'voltmeter:0': {id: 0, voltage: 4.2},
                'temperature:0': {id: 0, tC: 22.9, tF: 73.2},
                'humidity:0': {id: 0, rh: 45},
                serial: {},
                mbrtuclient: {}
            }
        }),
        modbus: true
    }
];

export const GEN3_PROFILES: readonly DeviceProfile[] = Object.freeze(
    SPECS.map(gen3Profile)
);
