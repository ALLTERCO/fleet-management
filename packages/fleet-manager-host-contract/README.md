# Fleet Manager Host contract

`@shelly/fleet-manager-host-contract` is the public contract shared by Fleet
Manager and its external UI hosts. It publishes generated request, response and
method metadata plus portable behaviour checks. It does not contain Fleet's
transport, stores, framework bindings or runtime implementation.

## Public imports

```ts
import {
    checkHostConformance,
    type HostConformanceAdapter,
    type HostParams,
    type HostResult,
} from '@shelly/fleet-manager-host-contract';
```

Generated method metadata is available from the package root. The generated
contract is type-only.

## Conformance

Each Host implementation supplies a small adapter around its own resource and
pagination primitives:

```ts
const adapter: HostConformanceAdapter = {
    version: host.version,
    versionNumber: host.versionNumber,
    has: (name) => host.has(name),
    createResource: ({initial, load}) => createLocalResource({initial, load}),
    listAll: ({loadPage, pageSize}) => loadEveryPage(loadPage, pageSize),
};

const {failures} = await checkHostConformance(adapter);
expect(failures).toEqual([]);
```

`checkHostConformance` is test-runner neutral. A conformance mismatch is
returned as `{case, message}` rather than thrown, so a consumer can report all
failures in its own runner. The checks cover:

- Host version metadata and an unknown capability returning `false`;
- a successful resource reaching `ready` with its loaded value;
- generic and permission failures reaching `error` with the normalized Host
  error shape;
- offset pagination returning every item once and stopping at the final page.

The adapter exists only to test an implementation. Importing this package does
not create a Fleet client or make a network request.

## Install

The package ships in this repository, in `packages/fleet-manager-host-contract`.
It is not on the public npm registry. The Fleet Manager image build copies it
from this folder.

To use it in another project, install it from a checkout of this repository:

```sh
npm install /path/to/fleet-management/packages/fleet-manager-host-contract
```

Or build a tarball once and install that:

```sh
cd /path/to/fleet-management/packages/fleet-manager-host-contract
npm pack
npm install /path/to/shelly-fleet-manager-host-contract-<version>.tgz
```

Use the checkout of the same Fleet Manager release you run, so the contract
matches the server. The `HOST_CONTRACT_BUILD_METADATA` export names the Fleet
release and the generated contract method count. A source checkout reports
`sourceCommit: null`.
