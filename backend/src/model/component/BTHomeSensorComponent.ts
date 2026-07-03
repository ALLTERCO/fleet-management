// BTHomeSensor — single BLU sensor reading owned by a BTHomeDevice.
// Stub class — RPC surface lives on BTHomeComponent (Sensor.*); this
// class exists only to own the event schema for `bthomesensor:N`.

import Component from './Component';

export default class BTHomeSensorComponent extends Component<any> {
    constructor() {
        super('bthomesensor', {
            set_config_methods: false,
            auto_apply_config: false,
            // BTHomeSensor.md → Webhook Events.
            events: [
                {
                    event: 'value_change',
                    attrs: [
                        {
                            name: 'value',
                            type: 'number',
                            desc: 'New value; type matches sensor obj_id'
                        }
                    ]
                },
                {
                    event: 'state_change',
                    attrs: [
                        {
                            name: 'value',
                            type: 'boolean',
                            desc: 'New state (binary_sensor type)'
                        }
                    ]
                }
            ]
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
