import type {DeviceProfile} from '../types';
import {
    coverComponents,
    dimmerComponents,
    energyMeterComponents,
    makeProfile,
    mergeComponents,
    type ProfileComponents,
    type ProfileIdentity,
    relayComponents,
    uiComponents
} from './shared';

const DOC_ROOT = 'https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2';

interface ProSpec {
    identity: Omit<ProfileIdentity, 'gen' | 'sourceUrl'>;
    doc: string;
    components: ProfileComponents;
    modbus?: boolean;
}

function proProfile(spec: ProSpec): DeviceProfile {
    return makeProfile({
        identity: {
            ...spec.identity,
            gen: 2,
            sourceUrl: `${DOC_ROOT}/${spec.doc}/`
        },
        components: spec.components,
        connectivity: {bthome: true, eth: true, modbus: spec.modbus}
    });
}

function circuitBreakerComponents(channels: number): ProfileComponents {
    const config: ProfileComponents['config'] = {
        'cb:0': {
            id: 0,
            name: 'Main breaker',
            undervoltage_limit: 200,
            voltage_limit: 250,
            autorecovery_enable: false
        }
    };
    const status: ProfileComponents['status'] = {
        'cb:0': {
            id: 0,
            output: true,
            source: 'local',
            total_cycles: 7,
            safety: false
        }
    };
    for (let channel = 0; channel < channels; channel++) {
        config[`voltmeter:${channel}`] = {
            id: channel,
            name: `Phase ${String.fromCharCode(65 + channel)}`
        };
        status[`voltmeter:${channel}`] = {
            id: channel,
            voltage: 230.4 - channel * 0.6
        };
    }
    return {config, status};
}

const SPECS: readonly ProSpec[] = [
    {
        identity: {
            key: 'shelly-pro-1',
            displayName: 'Shelly Pro 1',
            idPrefix: 'shellypro1',
            macPrefix: 'A2010100',
            model: 'SPSW-201XE16EU',
            app: 'Pro1'
        },
        doc: 'ShellyPro1',
        components: relayComponents({outputs: 1, inputs: 2, metered: false})
    },
    {
        identity: {
            key: 'shelly-pro-1pm',
            displayName: 'Shelly Pro 1PM',
            idPrefix: 'shellypro1pm',
            macPrefix: 'A2010200',
            model: 'SPSW-201PE16EU',
            app: 'Pro1PM'
        },
        doc: 'ShellyPro1PM',
        components: relayComponents({outputs: 1, inputs: 2, metered: true})
    },
    {
        identity: {
            key: 'shelly-pro-2',
            displayName: 'Shelly Pro 2',
            idPrefix: 'shellypro2',
            macPrefix: 'A2010300',
            model: 'SPSW-202XE16EU',
            app: 'Pro2'
        },
        doc: 'ShellyPro2',
        components: relayComponents({outputs: 2, inputs: 2, metered: false})
    },
    {
        identity: {
            key: 'shelly-pro-2pm',
            displayName: 'Shelly Pro 2PM',
            idPrefix: 'shellypro2pm',
            macPrefix: 'A2010400',
            model: 'SPSW-202PE16EU',
            app: 'Pro2PM',
            profile: 'cover'
        },
        doc: 'ShellyPro2PM',
        components: coverComponents({covers: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-pro-3',
            displayName: 'Shelly Pro 3',
            idPrefix: 'shellypro3',
            macPrefix: 'A2010500',
            model: 'SPSW-003XE16EU',
            app: 'Pro3'
        },
        doc: 'ShellyPro3',
        components: relayComponents({outputs: 3, inputs: 3, metered: false})
    },
    {
        identity: {
            key: 'shelly-pro-3em',
            displayName: 'Shelly Pro 3EM',
            idPrefix: 'shellypro3em',
            macPrefix: 'A2010600',
            model: 'SPEM-003CEBEU',
            app: 'Pro3EM',
            profile: 'triphase'
        },
        doc: 'ShellyPro3EM',
        components: energyMeterComponents({channels: 3, threePhase: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-pro-3em-400',
            displayName: 'Shelly Pro 3EM-400',
            idPrefix: 'shellypro3em400',
            macPrefix: 'A2010F00',
            model: 'SPEM-003CEBEU400',
            app: 'Pro3EM400',
            profile: 'triphase'
        },
        doc: 'ShellyPro3EM',
        components: energyMeterComponents({channels: 3, threePhase: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-pro-4pm',
            displayName: 'Shelly Pro 4PM',
            idPrefix: 'shellypro4pm',
            macPrefix: 'A2010700',
            model: 'SPSW-104PE16EU',
            app: 'FourPro'
        },
        doc: 'ShellyPro4PM',
        components: mergeComponents(
            relayComponents({outputs: 4, inputs: 4, metered: true}),
            uiComponents()
        )
    },
    {
        identity: {
            key: 'shelly-pro-1cb',
            displayName: 'Shelly Pro 1CB',
            idPrefix: 'shellypro1cb',
            macPrefix: 'A2011000',
            model: 'SPCB-01VENEU',
            app: 'ProCB'
        },
        doc: 'ShellyProCB',
        components: circuitBreakerComponents(1)
    },
    {
        identity: {
            key: 'shelly-pro-2cb',
            displayName: 'Shelly Pro 2CB',
            idPrefix: 'shellypro2cb',
            macPrefix: 'A2011100',
            model: 'SPCB-02VENEU',
            app: 'ProCB'
        },
        doc: 'ShellyProCB',
        components: circuitBreakerComponents(2)
    },
    {
        identity: {
            key: 'shelly-pro-3cb',
            displayName: 'Shelly Pro 3CB',
            idPrefix: 'shellypro3cb',
            macPrefix: 'A2010800',
            model: 'SPCB-03VENEU',
            app: 'ProCB'
        },
        doc: 'ShellyProCB',
        components: circuitBreakerComponents(3)
    },
    {
        identity: {
            key: 'shelly-pro-4cb',
            displayName: 'Shelly Pro 4CB',
            idPrefix: 'shellypro4cb',
            macPrefix: 'A2011200',
            model: 'SPCB-04VENEU',
            app: 'ProCB'
        },
        doc: 'ShellyProCB',
        components: circuitBreakerComponents(4)
    },
    {
        identity: {
            key: 'shelly-pro-dimmer-010v',
            displayName: 'Shelly Pro Dimmer 0/1-10V PM',
            idPrefix: 'shellypro0110pm',
            macPrefix: 'A2010900',
            model: 'SPCC-001PE10EU',
            app: 'ProDimmer010'
        },
        doc: 'ShellyProDimmer0110VPM',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-pro-dimmer-1pm',
            displayName: 'Shelly Pro Dimmer 1PM',
            idPrefix: 'shellyprodm1pm',
            macPrefix: 'A2010A00',
            model: 'SPDM-001PE01EU',
            app: 'ProDimmer1PM'
        },
        doc: 'ShellyProDimmer1PM',
        components: dimmerComponents({lights: 1, inputs: 2})
    },
    {
        identity: {
            key: 'shelly-pro-dimmer-2pm',
            displayName: 'Shelly Pro Dimmer 2PM',
            idPrefix: 'shellyprodm2pm',
            macPrefix: 'A2010B00',
            model: 'SPDM-002PE01EU',
            app: 'ProDimmer2PM'
        },
        doc: 'ShellyProDimmer2PM',
        components: dimmerComponents({lights: 2, inputs: 4})
    },
    {
        identity: {
            key: 'shelly-pro-dual-cover-pm',
            displayName: 'Shelly Pro Dual Cover PM',
            idPrefix: 'shellypro2cover',
            macPrefix: 'A2010C00',
            model: 'SPSH-002PE16EU',
            app: 'ProDualCoverPM',
            profile: 'cover'
        },
        doc: 'ShellyProDualCoverPM',
        components: mergeComponents(
            coverComponents({covers: 2, inputs: 4}),
            uiComponents()
        )
    },
    {
        identity: {
            key: 'shelly-pro-em',
            displayName: 'Shelly Pro EM-50',
            idPrefix: 'shellyproem50',
            macPrefix: 'A2010D00',
            model: 'SPEM-002CEBEU50',
            app: 'ProEM'
        },
        doc: 'ShellyProEM',
        components: energyMeterComponents({channels: 2, relay: true}),
        modbus: true
    },
    {
        identity: {
            key: 'shelly-pro-rgbww-pm',
            displayName: 'Shelly Pro RGBWW PM',
            idPrefix: 'shellyprorgbwwpm',
            macPrefix: 'A2010E00',
            model: 'SPDC-0D5PE16EU',
            app: 'ProRGBWWPM',
            profile: 'rgbcct'
        },
        doc: 'ShellyProRGBWWPM',
        components: mergeComponents(
            {
                config: {
                    'rgb:0': {id: 0, name: 'RGB strip'},
                    'cct:0': {id: 0, name: 'White strip'},
                    pro_rgbwwpm: {hf_mode: false}
                },
                status: {
                    'rgb:0': {
                        id: 0,
                        output: true,
                        brightness: 70,
                        rgb: [85, 30, 15]
                    },
                    'cct:0': {
                        id: 0,
                        output: true,
                        brightness: 62,
                        ct: 3600
                    },
                    pro_rgbwwpm: {}
                }
            },
            relayComponents({outputs: 0, inputs: 5, metered: false})
        )
    }
];

export const PRO_PROFILES: readonly DeviceProfile[] = Object.freeze(
    SPECS.map(proProfile)
);
