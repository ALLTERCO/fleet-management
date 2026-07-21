// creates array based on prefix/suffix/repeat rule
// for instance, prefix = a, suffix = b and repeat = 8
// result will be [a0b, a1b .... a8b]
const x = ({
    prefix,
    suffix = '',
    repeat = 5
}: {
    prefix: string;
    suffix?: string;
    repeat?: number;
}): string[] =>
    '.'
        .repeat(repeat)
        .split('.')
        .map((_v, k) => `${prefix}${k}${suffix}`);

const floatsData = [
    // Cover (up to 2 instances: Pro Dual Cover PM)
    'cover:0.aenergy.total',
    'cover:0.id',
    'cover:0.aenergy.minute_ts',
    'cover:1.aenergy.total',
    'cover:1.id',
    'cover:1.aenergy.minute_ts',
    'temperature:100.id',
    'temperature:100.tC',
    'temperature:100.tF',
    'temperature:0.id',
    'temperature:0.tC',
    'temperature:0.tF',
    'humidity:100.id',
    'humidity:100.rh',
    'humidity:0.id',
    'humidity:0.rh'
]
    .concat(x({prefix: 'cover:0.aenergy.by_minute.'}))
    .concat(x({prefix: 'cover:1.aenergy.by_minute.'}))
    // Cover power metering fields (up to 2 instances)
    .concat(
        [0, 1].reduce((a: string[], i) => {
            return a.concat([
                `cover:${i}.voltage`,
                `cover:${i}.current`,
                `cover:${i}.apower`,
                `cover:${i}.pf`,
                `cover:${i}.freq`,
                `cover:${i}.temperature.tC`,
                `cover:${i}.temperature.tF`
            ]);
        }, [])
    )
    // Light power metering fields (up to 5 instances: Pro RGBWW PM light profile)
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.voltage'}))
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.current'}))
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.apower'}))
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.aenergy.total'}))
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.aenergy.minute_ts'}))
    .concat(
        x({prefix: '', repeat: 5, suffix: ''}).reduce((a: string[], v) => {
            return a.concat(
                x({
                    prefix: 'light:',
                    repeat: 5,
                    suffix: `.aenergy.by_minute.${v}`
                })
            );
        }, [])
    )
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.temperature.tC'}))
    .concat(x({prefix: 'light:', repeat: 5, suffix: '.temperature.tF'}))
    // RGB/RGBW power metering fields (PlusRGBWPM)
    .concat([
        'rgb:0.voltage',
        'rgb:0.current',
        'rgb:0.apower',
        'rgb:0.aenergy.total',
        'rgb:0.aenergy.minute_ts',
        'rgb:0.temperature.tC',
        'rgb:0.temperature.tF'
    ])
    .concat(x({prefix: 'rgb:0.aenergy.by_minute.'}))
    .concat([
        'rgbw:0.voltage',
        'rgbw:0.current',
        'rgbw:0.apower',
        'rgbw:0.aenergy.total',
        'rgbw:0.aenergy.minute_ts',
        'rgbw:0.temperature.tC',
        'rgbw:0.temperature.tF'
    ])
    .concat(x({prefix: 'rgbw:0.aenergy.by_minute.'}))
    // CCT power metering fields (Pro RGBWW PM, DuoBulbG3)
    .concat(x({prefix: 'cct:', repeat: 2, suffix: '.voltage'}))
    .concat(x({prefix: 'cct:', repeat: 2, suffix: '.current'}))
    .concat(x({prefix: 'cct:', repeat: 2, suffix: '.apower'}))
    .concat(x({prefix: 'cct:', repeat: 2, suffix: '.temperature.tC'}))
    .concat(x({prefix: 'cct:', repeat: 2, suffix: '.temperature.tF'}))
    // RGBCCT power metering fields (RGBCCTBulbG3)
    .concat([
        'rgbcct:0.apower',
        'rgbcct:0.aenergy.total',
        'rgbcct:0.aenergy.minute_ts'
    ])
    .concat(x({prefix: 'rgbcct:0.aenergy.by_minute.'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.act_power'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.aprt_power'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.current'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.freq'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.id'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.pf'}))
    .concat(x({prefix: 'em1:', repeat: 5, suffix: '.voltage'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.act_power'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.aprt_power'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.current'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.freq'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.id'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.pf'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.voltage'}))
    // Pro 3EM: per-phase fields (a_, b_, c_ prefixed)
    .concat(
        ['a', 'b', 'c'].reduce((acc: string[], phase) => {
            return acc
                .concat(
                    x({prefix: 'em:', repeat: 5, suffix: `.${phase}_act_power`})
                )
                .concat(
                    x({
                        prefix: 'em:',
                        repeat: 5,
                        suffix: `.${phase}_aprt_power`
                    })
                )
                .concat(
                    x({prefix: 'em:', repeat: 5, suffix: `.${phase}_current`})
                )
                .concat(
                    x({prefix: 'em:', repeat: 5, suffix: `.${phase}_voltage`})
                )
                .concat(x({prefix: 'em:', repeat: 5, suffix: `.${phase}_pf`}))
                .concat(
                    x({prefix: 'em:', repeat: 5, suffix: `.${phase}_freq`})
                );
        }, [])
    )
    // Pro 3EM: aggregate and neutral fields
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.total_act_power'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.total_aprt_power'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.total_current'}))
    .concat(x({prefix: 'em:', repeat: 5, suffix: '.n_current'}))
    .concat(x({prefix: 'em1data:', repeat: 5, suffix: '.id'}))
    .concat(x({prefix: 'em1data:', repeat: 5, suffix: '.total_act_energy'}))
    .concat(x({prefix: 'em1data:', repeat: 5, suffix: '.total_act_ret_energy'}))
    // emdata: monophase mode (per-channel totals without phase prefix)
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.total_act_energy'}))
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.total_act_ret_energy'}))
    // emdata: triphase mode (per-phase totals with a_/b_/c_ prefix)
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.a_total_act_energy'}))
    .concat(
        x({prefix: 'emdata:', repeat: 5, suffix: '.a_total_act_ret_energy'})
    )
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.b_total_act_energy'}))
    .concat(
        x({prefix: 'emdata:', repeat: 5, suffix: '.b_total_act_ret_energy'})
    )
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.c_total_act_energy'}))
    .concat(
        x({prefix: 'emdata:', repeat: 5, suffix: '.c_total_act_ret_energy'})
    )
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.id'}))
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.total_act'}))
    .concat(x({prefix: 'emdata:', repeat: 5, suffix: '.total_act_ret'}))
    // Battery monitor (bm) — must be listed or the capture loop drops it before
    // routeEnergyRow. Mirrors energyClassifier BM_FIELDS.
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.voltage'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.current'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.power'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.soc'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.soh'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.cycles'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.energy_ch.total'}))
    .concat(x({prefix: 'bm:', repeat: 2, suffix: '.energy_disch.total'}))
    // bm per-cell voltage/temperature (PowerTrack up to 4 battery channels)
    .concat(
        x({prefix: 'bm:', repeat: 2, suffix: ''}).flatMap((v) =>
            [1, 2, 3, 4].flatMap((c) => [
                `${v}.batteries.B${c}.voltage`,
                `${v}.batteries.B${c}.tC`
            ])
        )
    )
    .concat(
        x({prefix: '', repeat: 5, suffix: ''}).reduce((a: string[], v) => {
            return a.concat(
                x({
                    prefix: 'pm1:',
                    repeat: 5,
                    suffix: `.aenergy.by_minute.${v}`
                })
            );
        }, [])
    )
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.aenergy.minute_ts'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.aenergy.total'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.aenergy.id'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.voltage'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.current'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.apower'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.freq'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.pf'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.aprtpower'}))
    .concat(
        x({prefix: '', repeat: 5, suffix: ''}).reduce((a: string[], v) => {
            return a.concat(
                x({
                    prefix: 'pm1:',
                    repeat: 5,
                    suffix: `.ret_aenergy.by_minute.${v}`
                })
            );
        }, [])
    )
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.ret_aenergy.minute_ts'}))
    .concat(x({prefix: 'pm1:', repeat: 5, suffix: '.ret_aenergy.total'}))
    .concat(
        x({prefix: '', repeat: 5, suffix: ''}).reduce((a: string[], v) => {
            return a.concat(
                x({
                    prefix: 'switch:',
                    repeat: 10,
                    suffix: `.aenergy.by_minute.${v}`
                })
            );
        }, [])
    )
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.voltage'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.current'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.apower'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.freq'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.pf'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.aenergy.minute_ts'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.temperature.tC'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.temperature.tF'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.aenergy.total'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.aenergy.id'}))
    .concat(
        x({prefix: '', repeat: 5, suffix: ''}).reduce((a: string[], v) => {
            return a.concat(
                x({
                    prefix: 'switch:',
                    repeat: 10,
                    suffix: `.ret_aenergy.by_minute.${v}`
                })
            );
        }, [])
    )
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.ret_aenergy.minute_ts'}))
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.ret_aenergy.total'}))
    // Wall Display — illuminance sensor
    .concat(x({prefix: 'illuminance:', repeat: 2, suffix: '.lux'}))
    .concat(x({prefix: 'illuminance:', repeat: 2, suffix: '.id'}))
    // Wall Display — thermostat
    .concat(x({prefix: 'thermostat:', repeat: 2, suffix: '.target_C'}))
    .concat(x({prefix: 'thermostat:', repeat: 2, suffix: '.current_C'}))
    .concat(x({prefix: 'thermostat:', repeat: 2, suffix: '.id'}))
    // BLU TRV (up to 5 per gateway)
    .concat(x({prefix: 'blutrv:', repeat: 5, suffix: '.target_C'}))
    .concat(x({prefix: 'blutrv:', repeat: 5, suffix: '.current_C'}))
    .concat(x({prefix: 'blutrv:', repeat: 5, suffix: '.pos'}))
    .concat(x({prefix: 'blutrv:', repeat: 5, suffix: '.battery'}))
    .concat(x({prefix: 'blutrv:', repeat: 5, suffix: '.rssi'}));

export const floats = {
    raw: floatsData,
    group: floatsData.map((v) =>
        v.replace(/:\d+/i, ':*').replace(/\.\d+/i, '.*')
    )
};

const floatFieldGroups = new Map(
    floats.raw.map((field, index) => [field, floats.group[index]])
);
const bluetoothStatusField =
    /^(bthomedevice|bthomesensor|bthomecontrol|blutrv):\d+\..+$/;

export function statusFieldGroup(field: string): string | undefined {
    return (
        floatFieldGroups.get(field) ??
        (bluetoothStatusField.test(field) ? 'bluetooth' : undefined)
    );
}
