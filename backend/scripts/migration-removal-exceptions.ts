// Exact content pins preserve shipped history without exempting future edits.
export const HISTORICAL_REMOVAL_EXCEPTIONS = [
    {
        path: 'device/em/6001_fn_append_stats.sql',
        sha256: 'd1de7384b697b587e5ca196d22df986b22d66714a453be8d1cf7da33173f2f3f',
        functions: ['device_em.fn_append_stats']
    },
    {
        path: 'device/em/6007_drop_fn_report_ranges.sql',
        sha256: 'eb4b1ce39d7c665f1746d58a8afa83efcd24f5c783f41658b764a376202ceeab',
        functions: ['device_em.fn_report_ranges']
    },
    {
        path: 'device/em/6710_drop_fn_reconcile_lifetime.sql',
        sha256: '02549a9a94077c363c4417a087c75000655e959c2622e506dd3f1eba68ee13e2',
        functions: ['device_em.fn_reconcile_lifetime']
    },
    {
        path: 'device/em/6730_drop_report_diff_fns.sql',
        sha256: '11d2f2f04888c3967b54d6c302b7f62c2f43ff1f322bd40bc9b43964e63424ce',
        functions: [
            'device_em.fn_report_mount_diff',
            'device_em.fn_report_diff'
        ]
    },
    {
        path: 'device/em/6763_drop_fn_energy_summary.sql',
        sha256: '7eaa8a7fde77ecff03b63570ee4f6c12cf76aff61361cad07de154ece5a053f6',
        functions: ['device_em.fn_energy_summary']
    }
] as const;
