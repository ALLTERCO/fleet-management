# Public API types — RPC contract surface

This directory is the **single source of truth** for every public RPC
namespace's contract. Each file builds the namespace's
`DescribeOutput` — methods, param/response schemas, permissions, and
errors — using `DescribeBuilder` from
[`backend/src/rpc/describe.ts`](../../rpc/describe.ts).

The output is what `<Component>.Describe` returns at runtime, what
gets committed as a golden fixture under
`backend/test/fixtures/golden/<namespace>.Describe.golden.json`, and
what feeds the auto-generated
[`docs/generated/backend-rpc-inventory.md`](../../../../docs/generated/backend-rpc-inventory.md).

## Rules

1. One file per namespace: `switch.ts`, `cover.ts`, `entity.ts`, …
2. **Schemas + DescribeBuilder only** — no runtime handler logic. The
   handler lives in the matching `model/component/<Namespace>Component.ts`.
3. Required envelope fields (`shellyID`, `id`, `config`) are typed
   strict (`type: 'integer'` / `'string'` / `'object'`). Field ranges
   on device-controlled values (brightness, rgb, white, transition,
   etc.) are device-validated — leave them untyped or note
   "(device-validated)" in the field description.
4. Use `additionalProperties: true` on `Set`-style methods that accept
   firmware-passthrough fields. Keep `false` on pure envelope methods
   (`Toggle`, `Stop`, `ResetCounters`).
5. Use `RESP_OPAQUE = {description: 'Device-defined (object or null).'}`
   for firmware-defined responses — Shelly may return `null` from
   `Set`/`Toggle`/`SetConfig`. Don't promise `type: 'object'` if
   firmware doesn't.
6. Re-export the `<NAMESPACE>_DESCRIBE` symbol from this directory's
   [`index.ts`](./index.ts) and add it to
   [`backend/test/apiDescribeGoldenCoverage.test.ts`](../../../test/apiDescribeGoldenCoverage.test.ts).

## File template

```ts
import {DescribeBuilder, type DescribeOutput} from '../../rpc/describe';
import type {JsonSchema} from '../../rpc/validation';
import {SHELLY_ID_SCHEMA} from './_shared';

const CHANNEL_ID: JsonSchema = {type: 'integer', minimum: 0};
const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA, id: CHANNEL_ID}
};
const P_SET_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        config: {type: 'object'}
    }
};
const RESP_OPAQUE: JsonSchema = {description: 'Device-defined (object or null).'};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const b = new DescribeBuilder('<namespace>');

b.registerMethod('Toggle', {
    params: P_ID,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: '<Namespace>.Toggle.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: '<Namespace>.SetConfig.'
});

export const <NAMESPACE>_DESCRIBE: DescribeOutput = b.build();
```

## Component handler template

```ts
// backend/src/model/component/<Namespace>Component.ts
import type {DescribeOutput} from '../../rpc/describe';
import {
    <NAMESPACE>_DESCRIBE,
    <NAMESPACE>_SET_CONFIG_PARAMS_SCHEMA,
    <NAMESPACE>_TOGGLE_PARAMS_SCHEMA,
    type <Namespace>SetConfigParams,
    type <Namespace>ToggleParams
} from '../../types/api/<namespace>';
import {passthroughRpc} from '../devicePassthrough';
import Component from './Component';

export default class <Namespace>Component extends Component<any> {
    constructor() {
        super('<namespace>', {set_config_methods: false, auto_apply_config: false});
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return <NAMESPACE>_DESCRIBE;
    }

    @Component.Expose('Toggle')
    @Component.CrudPermission('devices', 'execute', (p) => p?.shellyID)
    toggle(params: unknown) {
        return passthroughRpc<<Namespace>ToggleParams>(params, {
            namespace: '<Namespace>',
            method: 'Toggle',
            paramsSchema: <NAMESPACE>_TOGGLE_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id})
        });
    }

    @Component.Expose('SetConfig')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    rpcSetConfig(params: unknown) {
        return passthroughRpc<<Namespace>SetConfigParams>(params, {
            namespace: '<Namespace>',
            method: 'SetConfig',
            paramsSchema: <NAMESPACE>_SET_CONFIG_PARAMS_SCHEMA,
            payload: (v) => ({id: v.id, config: v.config})
        });
    }

    protected override getDefaultConfig() {
        return {};
    }
}
```

`set_config_methods: false` disables the inherited `setconfig` RPC so
the typed `@Component.Expose('SetConfig')` handler is the only
`setconfig` registered. Method names are lower-cased on dispatch, so
`Switch.SetConfig` → namespace `switch`, submethod `setconfig`.

## Shared helpers

Device wrappers use `passthroughRpc` — don't re-hand-roll device calls.

| Helper | Purpose |
| --- | --- |
| `passthroughRpc(params, {namespace, method, paramsSchema, payload?})` | the one device-RPC wrapper: validate → resolve device → wrap errors → send. Default payload is the validated params minus `shellyID`. [`devicePassthrough.ts`](../../model/devicePassthrough.ts) |
| `getDeviceOrThrow(shellyID)` | resolve a device or throw `DeviceNotFound`. [`deviceAdminRpc.ts`](../../model/deviceAdminRpc.ts) |
| `wrapDeviceRpc(label, () => …)` | wrap any device call with `RpcError.DeviceFailed` mapping |
| `isPlainObject(v)` | type-narrow validation helper |

## Current namespaces

**Primitives (1:1 with firmware components):** `switch`, `cover`,
`input`, `light`, `rgb`, `rgbw`, `cct`, `rgbcct`.

**Composite / vendor:** `bthome`, `blugw`, `cury`, `matter`, `pill`,
`camera`, `meter`, `trv`, `thermostat`, `ui`, `media`, `dali`, `addon`,
`virtual`, `illuminance`, `smoke`, `service`, `sys`, `mqtt`, `ws`,
`network`, `security`.

**Fleet primitives:** `device`, `entity`.

**Server-side:** `firmware`, `backup`, `alert`, `notification`,
`dashboard`, `group`, `location`, `tag`, `energy`, `report`,
`integration`, `policy`, `variables`, `storage`, `waitingroom`,
`presence`, `user`, `organization`, `admin`, `audit`,
`system`, `pluginmanager`, `mail`, `grafana`, `alexa`, `mdns`.

**Resources without their own RPC namespace:** `automation` and `action`
exist as authz scopes / assignment resource types / alert subjects but are
NOT exposed as `automation.*` or `action.*` RPC methods — automations are
provisioned and executed by Node-RED, and action templates live in
`registryNames.ts`. No `automation.ts` / `action.ts` schema file exists
because there is no RPC surface to declare.

The auto-generated complete inventory is at
[`docs/generated/backend-rpc-inventory.md`](../../../../docs/generated/backend-rpc-inventory.md).
