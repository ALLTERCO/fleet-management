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
        .map((v, k) => `${prefix}${k}${suffix}`);

const floatsData = [
    'cover:0.aenergy.total',
    'cover:0.id',
    'cover:0.aenergy.minute_ts',
    'temperature:100.id',
    'temperature:100.tC',
    'temperature:100.tF',
    'temperature:0.id',
    'temperature:0.tC',
    'temperature:0.tF'
]
    .concat(x({prefix: 'cover:0.aenergy.by_minute.'}))
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
    .concat(x({prefix: 'em1data:', repeat: 5, suffix: '.id'}))
    .concat(x({prefix: 'em1data:', repeat: 5, suffix: '.total_act_energy'}))
    .concat(x({prefix: 'em1data:', repeat: 5, suffix: '.total_act_ret_energy'}))
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
    .concat(x({prefix: 'switch:', repeat: 5, suffix: '.ret_aenergy.total'}));

export const floats = {
    raw: floatsData,
    group: floatsData.map((v) =>
        v.replace(/:\d+/i, ':*').replace(/\.\d+/i, '.*')
    )
};
