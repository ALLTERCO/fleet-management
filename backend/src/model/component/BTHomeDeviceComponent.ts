// BTHomeDevice — BLU button/dimmer family. RPC surface lives on
// BTHomeComponent (Device.*); this class exists only to own the event
// schema for `bthomedevice:N` instances, so findComponentEvent has a
// doc-grounded source for them.

import Component from './Component';

export default class BTHomeDeviceComponent extends Component<any> {
    constructor() {
        super('bthomedevice', {
            set_config_methods: false,
            auto_apply_config: false,
            // BTHomeDevice.md → Notifications + Events.
            events: [
                ...[
                    'single_push',
                    'double_push',
                    'triple_push',
                    'long_push',
                    'long_double_push',
                    'long_triple_push',
                    'rotate_left',
                    'rotate_right',
                    // hold_press: BTHomeControl.mdx cross-ref. BLU Wall
                    // EU/US 4-button devices since fw 1.0.23.
                    'hold_press'
                ].map((event) => ({
                    event,
                    attrs: [
                        {
                            name: 'idx',
                            type: 'number' as const,
                            desc: 'Object-type index that triggered'
                        },
                        {
                            name: 'channel',
                            type: 'number' as const,
                            desc: 'Data channel (-1 if N/A)'
                        },
                        {
                            name: 'sensors',
                            type: 'object' as const,
                            desc: 'Sensor statuses at trigger time'
                        }
                    ]
                })),
                {event: 'new_objects'}
            ]
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
