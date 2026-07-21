// AUTO-GENERATED — do not edit by hand.
// Source: docs/generated/api-catalog.json (Describe + inventories)
// Regenerate: cd backend && npm run generate

export interface HostMethodMetadata {
    namespaceKind: 'device' | 'fleet-manager';
    readOnly: boolean;
    destructive: boolean;
    consequential: boolean;
    requiresOnlineDevice: boolean;
    /** Dispatcher/tunnel: the real effect depends on caller input. */
    effectDependsOnInput?: boolean;
    /** This method IS a raw escape hatch — prefer curated wrappers. */
    escapeHatch?: boolean;
    /** Recommended hand-written wrapper, e.g. host.devices.setKind. */
    wrapper?: string;
}

export interface HostEscapeHatch {
    name: string;
    path: string;
    note: string;
    /** Set when the hatch is itself an RPC method in the catalog. */
    rpcId?: string;
}

export const HOST_ESCAPE_HATCHES: readonly HostEscapeHatch[] = [
    {
        name: 'host.api',
        path: 'frontend/src/shell/template-host/api.ts',
        note: 'Generic RPC proxy over every namespace. Prefer the curated host domains.'
    },
    {
        name: 'call',
        path: 'frontend/src/shell/template-host/api.ts',
        note: 'Raw single RPC call. Prefer a named host wrapper.'
    },
    {
        name: 'listAll',
        path: 'frontend/src/shell/template-host/api.ts',
        note: 'Raw auto-paged RPC call. Prefer a named host wrapper.'
    },
    {
        name: 'useTemplateRpc',
        path: 'frontend/src/shell/template-host/rpc.ts',
        note: 'Raw reactive RPC wrapper for templates. Prefer domain composables.'
    },
    {
        name: 'host.devices.call',
        path: 'frontend/src/shell/template-host/devices.ts',
        note: 'Relays an arbitrary RPC to a Shelly device. Device firmware surface, not FM.',
        rpcId: 'device.call'
    },
    {
        name: 'createHostDomain().call',
        path: 'frontend/src/shell/template-host/domain.ts',
        note: 'Untyped namespace-scoped RPC call. Prefer callTyped or a named wrapper.'
    }
] as const;

export const HOST_METHOD_METADATA: Record<string, HostMethodMetadata> = {
    'addon.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'addon.peripheral.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'addon.peripheral.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'addon.prooutput.addperipheral': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'addon.prooutput.getperipherals': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'addon.prooutput.removeperipheral': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'addon.sensor.addperipheral': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'addon.sensor.getperipherals': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'addon.sensor.onewirescan': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'addon.sensor.removeperipheral': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'admin.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'admin.listcommands': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'admin.postgrescall': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        effectDependsOnInput: true
    },
    'admin.reconciledevices': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.instance.ack': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.acknowledge'
    },
    'alert.instance.annotate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.instance.deleteannotation': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.instance.editannotation': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.instance.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.getInstance'
    },
    'alert.instance.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.listInstances'
    },
    'alert.instance.listannotations': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.instance.listtransitions': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.transitions'
    },
    'alert.instance.resolvemanual': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.resolve'
    },
    'alert.instance.silence': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.silence'
    },
    'alert.instance.unack': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.unacknowledge'
    },
    'alert.instance.unsilence': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.unsilence'
    },
    'alert.rule.checkduplicate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.rule.createfromtemplate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.rule.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.rule.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.listRules'
    },
    'alert.rule.listcomponentpaths': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.listeligibledevices': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.listfirings': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.listkinds': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.alerts.listKinds'
    },
    'alert.rule.listmetricpaths': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.listtemplates': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.preview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alert.rule.template.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.rule.template.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.rule.template.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alert.rule.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alexa.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'alexa.disable': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'alexa.enable': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'analytics.attributewindow': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'analytics.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'asset.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'asset.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'asset.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'asset.migrateimages': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'asset.setlabel': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'assignment.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'assignment.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'assignment.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'assignment.listforpersona': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'assignment.listforresource': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'assignment.listforsubject': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'assignment.listunused': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'audit.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'audit.export': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'audit.query': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'auth.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'auth.mintscopedtoken': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'authz_audit.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'authz_audit.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'backup.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'backup.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'backup.downloadfromdevice': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'backup.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'backup.getfile': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'backup.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'backup.rename': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'backup.restoretodevice': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'backup.startdownloadjob': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'backup.startrestorejob': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'bill.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'bill.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'bill.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'bill.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'ble.cloudrelay.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ble.cloudrelay.listinfos': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ble.deletepaireddevice': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ble.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ble.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ble.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ble.listpaireddevices': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ble.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ble.startpairing': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ble.stoppairing': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bluassist.bond.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bluassist.bond.enable': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bluassist.bond.has': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bluassist.call': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true,
        effectDependsOnInput: true
    },
    'bluassist.connect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bluassist.connection.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bluassist.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bluassist.disconnect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bluassist.discover': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bluassist.read': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bluassist.scan': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bluassist.setnotify': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bluassist.write': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'blugw.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'blugw.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'blugw.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'blugw.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bm.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bm.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bm.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bm.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'branding.activate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.deletefont': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.deleteicon': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.deletelogo': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'branding.getdefault': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'branding.getmailtemplate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'branding.getpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'branding.getpreview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'branding.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.resetmailtemplate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.setfont': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.seticon': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.setlogo': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.setmailtemplate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'branding.setpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'bthome.control.create': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.control.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.control.enumerate': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.control.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.control.getlearningstate': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.control.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.control.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.control.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.control.startlearning': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.control.stoplearning': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.control.update': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.device.addmanual': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.device.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.device.getknownobjects': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.device.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.device.remove': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.device.rename': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true,
        wrapper: 'host.bluetoothDevices.renameGatewayChild'
    },
    'bthome.device.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.device.setkey': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.listgateways': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true,
        wrapper: 'host.bluetoothDevices.listGateways'
    },
    'bthome.object.listinfos': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.resetencryptioncounter': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.sensor.add': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.sensor.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.sensor.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.sensor.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'bthome.sensor.pair': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.sensor.rename': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.sensor.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'bthome.startdiscovery': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'button.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'button.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'button.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'button.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'button.trigger': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.addzone': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.captureimage': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.deletezone': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.getcapabilities': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.startrecording': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.stoprecording': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.storage.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.storage.eject': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.storage.format': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.storage.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.storage.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.storage.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.storage.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.streamer.answer': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.streamer.offer': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.streamer.setstreamsource': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.streamer.stopstream': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'camera.zone.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.zone.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'camera.zone.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cb.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cb.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cb.getlog': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cb.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cb.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cb.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cct.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cct.dimdown': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cct.dimstop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cct.dimup': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cct.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cct.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cct.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cct.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cct.toggle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'certificate.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.export': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.getissuedefaults': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.import': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.issuedevicecert': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.listpushes': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.preflightpush': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.pushstatus': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'certificate.pushtodevices': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.setgroups': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.settags': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.signcsr': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'certificate.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'channel.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'channel.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'channel.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'channel.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'channel.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'channel.listproviders': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'channel.resethealth': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'channel.test': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'channel.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'client.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'client.setsubscription': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'cloud.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cloud.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cloud.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cloud.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.calibrate': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.close': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cover.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cover.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cover.gotoposition': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.open': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cover.stop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'credential.clear': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'credential.confirmold': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'credential.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'credential.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'credential.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'credential.listfailed': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'credential.listpushes': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'credential.pushstatus': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'credential.retry': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'credential.reveal': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'credential.rotate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'credential.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'cury.boost': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cury.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cury.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cury.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cury.getvialinfo': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'cury.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cury.setawaymode': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cury.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cury.setmode': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'cury.stopboost': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'dali.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'dali.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'dali.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'dali.group.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'dali.group.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'dali.group.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'dali.group.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'dali.pingknowndevices': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'dali.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'dali.startscan': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'dashboard.activity.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.additem': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.cleardefault': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.clone': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.deletebulk': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.export': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.getdefault': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.getsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.getuiconfig': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.import': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.item.add': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.item.addbulk': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.item.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.item.remove': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.item.reorder': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.item.setall': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.item.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.listpinned': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.pin': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.removeitem': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.reorder': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.reorderitems': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.reorderpins': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.setdefault': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.setsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.template.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.template.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.template.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.template.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.template.preview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.template.savefromdashboard': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.template.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.unpin': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'dashboard.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'dashboard.updateitemsize': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'device.call': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        effectDependsOnInput: true,
        escapeHatch: true
    },
    'device.checkreplacement': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.checkReplacement'
    },
    'device.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.delete'
    },
    'device.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'device.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.get'
    },
    'device.getdevicechannels': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'device.getimage': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.getImage'
    },
    'device.getinfo': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'device.getkind': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.getKind'
    },
    'device.getsetup': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'device.getstatushistory': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'device.getstatustimeline': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'device.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.list'
    },
    'device.listretired': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.listRetired'
    },
    'device.relationships.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.relationships.getDeviceGraph'
    },
    'device.relationships.query': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.relationships.query'
    },
    'device.replacehardware': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.replaceHardware'
    },
    'device.restore': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.restore'
    },
    'device.retire': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.retire'
    },
    'device.setimage': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.setImage'
    },
    'device.setkind': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.devices.setKind'
    },
    'device.topology': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceevents.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceevents.query': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.authmethods': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.connection.disconnect': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.connection.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.connection.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.credential.cancelrotation': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.credential.createtoken': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.credential.finalizerotation': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.credential.revoke': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.credential.rotate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.enrollmenttoken.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.enrollmenttoken.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.enrollmenttoken.revoke': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.identity.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.identity.disable': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.identity.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.identity.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.identity.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.profile.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.rejection.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'deviceingress.rejection.resolve': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.setup.bundle': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.setup.plan': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'deviceingress.setup.reportapply': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'devicepower.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'devicepower.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'devicepower.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'devicepower.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'discovery.admitdevice': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'discovery.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'discovery.probe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'discovery.scanlan': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'domain_policy.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'domain_policy.getinstance': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'domain_policy.getpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'domain_policy.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'domain_policy.setinstance': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'domain_policy.setpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'em.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em.getcttypes': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em.phasetophasecalib': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em.phasetophasecalibreset': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em1.calibratefrom': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em1.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1.getcttypes': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1.reverttofactorycalibration': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em1.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em1data.deletealldata': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em1data.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1data.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1data.getdata': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1data.getnetenergies': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1data.getrecords': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1data.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'em1data.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'em1data.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'emdata.deletealldata': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'emdata.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'emdata.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'emdata.getdata': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'emdata.getnetenergies': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'emdata.getrecords': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'emdata.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'emdata.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'emdata.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'energy.current': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.metrics.current'
    },
    'energy.deletelogicalmeter': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'energy.deletemeterconnection': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'energy.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'energy.getresetaudit': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'energy.listlogicalmeters': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'energy.listmeasurementpoints': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'energy.listmeterconnections': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'energy.query': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.metrics.history'
    },
    'energy.savelogicalmeter': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'energy.savemeterconnection': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'energy.setpointoverride': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'entity.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'entity.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'entity.getactionschema': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'entity.getcapabilities': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'entity.invokeaction': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        effectDependsOnInput: true
    },
    'entity.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'eth.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'eth.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'eth.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'eth.listclients': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'eth.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'fan.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'fan.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'fan.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'fan.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'fan.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'firmware.checkforupdatebulk': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.createlibrarydownloadurl': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.createuploadticket': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.deletelibraryentry': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.getautoupdatechannel': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.getautoupdatedevices': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.getautoupdatemode': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.getautoupdatemodes': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.getautoupdatestatus': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.getlastautoupdaterun': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'firmware.listlibrary': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.registermanualupdate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.setautoupdate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.setautoupdatebulk': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.setautoupdatechannel': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.setautoupdatemode': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.setautoupdatemodebulk': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.startupdatejob': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.triggerautoupdate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.unregistermanualupdate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'firmware.updatelibraryentry': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'fleet.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleet.getcapabilities': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleet.getmetrics': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleetmap.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleetmap.getalertsnapshot': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleetmap.getenergysnapshot': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleetmap.getsignalsnapshot': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleetsummary.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'fleetsummary.getenergy': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'flood.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'flood.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'flood.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'flood.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'grafana.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'grafana.getconfig': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'grafana.getdashboard': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'group.addmembers': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.addMembers'
    },
    'group.children': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.children'
    },
    'group.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'group.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'group.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'group.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.get'
    },
    'group.kind.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'group.kind.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'group.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.list'
    },
    'group.listactivity': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.activity'
    },
    'group.listdevicememberships': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'group.listmembers': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.members'
    },
    'group.path': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.path'
    },
    'group.removemembers': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.groups.removeMembers'
    },
    'group.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'http.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'http.get': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'http.post': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'http.request': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'humidity.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'humidity.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'humidity.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'humidity.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'identity.addoidcprovider': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'identity.deleteidentityprovider': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'identity.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'identity.getjwtintentsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'identity.getscimsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'identity.getsmtpsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'identity.listidentityproviders': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'identity.rotateactionsigningkeys': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'identity.setscimenabled': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'identity.setsmtpsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'identity.testsmtpsettings': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'illuminance.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'illuminance.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'illuminance.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'illuminance.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'input.checkexpression': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'input.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'input.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'input.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'input.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'input.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'input.trigger': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'job.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'job.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'job.listactive': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'kind.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'kind.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'kind.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'kind.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'kind.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'kind.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'knx.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'knx.getcomponentconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'knx.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'knx.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'knx.listcomponents': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'knx.setcomponentconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'knx.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'kvs.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'kvs.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'kvs.get': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'kvs.getmany': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'kvs.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'kvs.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.addeffect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.addscripteffect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ledstrip.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ledstrip.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ledstrip.listalleffects': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ledstrip.listallpalettes': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ledstrip.listallprotocols': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ledstrip.nexteffect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.removeeffect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.removescripteffect': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ledstrip.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.calibrate': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'light.dimdown': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.dimstop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.dimup': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'light.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'light.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.setall': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'light.toggle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'lnm.create': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'lnm.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'lnm.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'lnm.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'lnm.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'lnm.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'location.backfillgeo': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'location.children': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.children'
    },
    'location.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.create'
    },
    'location.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.delete'
    },
    'location.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'location.eventreplay': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'location.floorplan.createuploadticket': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'location.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.get'
    },
    'location.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.list'
    },
    'location.listassignments': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.assignments'
    },
    'location.listcountries': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'location.listkinds': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.listKinds'
    },
    'location.listregions': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'location.path': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.path'
    },
    'location.removeassignment': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.removeAssignment'
    },
    'location.searchplaces': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'location.setassignment': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.assign'
    },
    'location.setassignments': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'location.signalheatmap': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'location.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.locations.update'
    },
    'login_text.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'login_text.getdefault': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'login_text.gettext': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'login_text.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'login_text.settext': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'mail.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'mail.send': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'matter.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'matter.factoryreset': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'matter.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'matter.getsetupcode': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'matter.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'matter.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'mbrtuclient.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.readcoils': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.readdiscreteinputs': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.readholdingregisters': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.readinputregisters': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mbrtuclient.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'mbrtuclient.writecoils': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'mbrtuclient.writeholdingregisters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'mbrtuclient.writesingleregister': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'mdns.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mdns.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mdns.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mdns.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.background.createuploadticket': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.background.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.background.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.decreasevolume': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.increasevolume': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.listaudioalbums': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.listaudioartists': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.player.next': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.pause': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.play': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.playalert': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.playaudioclip': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.playorpause': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.playringtone': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.previous': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.player.stop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.putmedia': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.radio.listfavourites': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.radio.playfavourite': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.radio.playnextfavourite': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.radio.playpreviousfavourite': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.radio.stop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.reload': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.reportimage.createuploadticket': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: true
    },
    'media.reportimage.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'media.setvolume': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'message_text.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'message_text.getdefault': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'message_text.gettext': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'message_text.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'message_text.settext': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'mobile.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'mobile.getbootstrap': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'mobile.syncdelta': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'modbus.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'modbus.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'modbus.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'modbus.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'mqtt.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mqtt.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mqtt.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'mqtt.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'notification_policy.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification_policy.getpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification_policy.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification_policy.setpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.bundle.applyimport': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.bundle.export': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.bundle.exportalertmanager': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.bundle.exportgrafana': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.bundle.importalertmanager': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.bundle.importgrafana': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.bundle.planimport': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.bundle.validate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.destination.addmembers': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.destination.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.destination.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.destination.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.destination.getmodel': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.destination.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.destination.listmembers': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.destination.removemembers': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.destination.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.emailasset.createuploadticket': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.emailasset.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.emailasset.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.emailasset.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.emailtemplate.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.emailtemplate.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.emailtemplate.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.emailtemplate.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.emailtemplate.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.history.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.history.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.history.requeue': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.inbox.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.inbox.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.inbox.markallread': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.inbox.markread': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.inbox.markunread': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.listtokens': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.oauth.start': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.oncall.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.oncall.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.oncall.resolve': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.oncall.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.preference.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.preference.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.renderemailpreview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.rendertemplate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.routing.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.routing.evaluate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.routing.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.routing.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.subscribe': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.template.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.template.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'notification.template.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.template.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'notification.template.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'object.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'object.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'object.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'object.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'object.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'organization.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'organization.getdefaults': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'organization.getprofile': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'organization.getscopemodel': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'organization.setprofile': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'ota.abort': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ota.commit': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ota.data': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ota.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ota.revert': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ota.start': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ota.update': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ota.write': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'permission.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'permission.getidentitypolicies': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'permission.getroles': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'permission.grantroles': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'permission.listadministrators': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'permission.revokeroles': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'persona.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'persona.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'persona.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'persona.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'persona.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'persona.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'pill.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'pill.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'pill.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'pill.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'plugin.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'plugin.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'plugin.remove': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'plugin.upload': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'pm1.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'pm1.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'pm1.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'pm1.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'pm1.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'policy.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'policy.getdefaults': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'policy.resetdefault': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'policy.updatedefaults': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'presence.addzone': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'presence.deletezone': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'presence.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presence.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presence.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presence.livetrack': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presence.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'presence.setsensor': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'presence.tiltcalibrate': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'presence.zone.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'presencezone.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presencezone.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presencezone.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'presencezone.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'privacy.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'privacy.getpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'privacy.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'privacy.setpolicy': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'report.cancel': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'report.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'report.generate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'report.getreport': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'report.purgereports': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'report.suggesttimeshift': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'reporttemplate.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'reporttemplate.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'reporttemplate.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'reporttemplate.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'reporttemplate.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'reporttemplate.run': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'reporttemplate.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'restrictions.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'restrictions.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'restrictions.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'rgb.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgb.dimdown': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgb.dimstop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgb.dimup': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgb.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgb.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgb.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgb.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgb.toggle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbcct.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgbcct.dimdown': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbcct.dimstop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbcct.dimup': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbcct.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgbcct.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgbcct.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbcct.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbcct.toggle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbw.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgbw.dimdown': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbw.dimstop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbw.dimup': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbw.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgbw.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'rgbw.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbw.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'rgbw.toggle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'schedule.create': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'schedule.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'schedule.deleteall': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'schedule.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'schedule.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'schedule.update': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'script.create': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'script.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'script.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'script.eval': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true,
        effectDependsOnInput: true
    },
    'script.getcode': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'script.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'script.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'script.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'script.putcode': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'script.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'script.start': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'script.stop': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'security.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'security.puthttpservercabundle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'security.puthttpservercert': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'security.puthttpserverkey': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'security.puttlsclientcert': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'security.puttlsclientkey': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'security.putuserca': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'sensor.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'sensor.events': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'sensor.query': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'serial.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'serial.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'serial.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'serves.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'serves.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'serves.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'serves.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'serves.unset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'service.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'service.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'service.getinfo': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'service.getresources': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'service.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'service.listconfigoptions': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'service.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'service.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.checkforupdate': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.detectlocation': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.factoryreset': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.getcomponents': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.getdeviceinfo': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.listmethods': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.listprofiles': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.listtimezones': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'shelly.reboot': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.resetauthcode': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.resetwificonfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.setauth': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.setprofile': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'shelly.update': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'smoke.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'smoke.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'smoke.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'smoke.mute': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'smoke.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'storage.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'storage.getall': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'storage.getitem': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'storage.keys': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'storage.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'storage.removeitem': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'storage.setitem': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'switch.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'switch.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'switch.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'switch.resetcounters': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'switch.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'switch.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'switch.toggle': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'sys.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'sys.downloadsettings': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'sys.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'sys.getinternaltemperatures': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'sys.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'sys.listdebugcomponents': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'sys.restartapplication': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'sys.restoresettings': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'sys.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'sys.setdebugconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'sys.settime': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'system.bootstrap': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.dbwrites.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.dbwrites.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'system.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getconnectioninspector': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getmodulehistory': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getslowbuilds': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getslowclients': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getslowdevicecommands': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getslowrpcs': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.gettopology': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.gettopologydiff': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.getvariables': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.health.getdebugreport': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.health.getfull': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.health.gethistory': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.health.getstreams': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.listconnections': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.log.listlevels': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.log.setlevel': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'system.observability.reset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'system.observability.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'system.submittelemetry': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.subscribe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'system.unsubscribe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tag.assign': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tag.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tag.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tag.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tag.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tag.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tag.listassignments': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tag.listforsubject': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tag.unassign': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tag.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tariff.add': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tariff.assign': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tariff.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tariff.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tariff.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tariff.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'tariff.setlivesource': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'tariff.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'temperature.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'temperature.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'temperature.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'temperature.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.create': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.debug_setsensortemperature': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.decreasetargettemperature': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'thermostat.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'thermostat.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'thermostat.increasetargettemperature': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.addprofile': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.addrule': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.changerule': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.createprofile': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.createrule': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.deleteallrules': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.deleteprofile': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.deleterule': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.listprofiles': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.listrules': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.renameprofile': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.schedule.updaterule': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'thermostat.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.calibrate': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.call': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true,
        effectDependsOnInput: true
    },
    'trv.checkforupdates': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.clearboost': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.clearflag': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.clearoverride': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getremoteconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getremotedeviceinfo': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getremotestatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getremotetrvconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getremotetrvstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.pairingcomplete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.schedule.add': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.schedule.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'trv.schedule.remove': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.schedule.update': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.setboost': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.setexternaltemperature': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.setflag': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.setoverride': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.setposition': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.settarget': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.showmessage': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'trv.updatefirmware': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ui.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ui.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ui.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ui.listavailable': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ui.plug.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ui.screen.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ui.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ui.swipe': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'ui.tap': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'user_group.addmembers': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user_group.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user_group.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user_group.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user_group.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user_group.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user_group.listmembers': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user_group.removemembers': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user_group.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.attachcustompersona': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.authenticate': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.authenticatealexa': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.createpat': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.createscopedpat': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.createserviceuser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.createzitadeluser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.deactivateuser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.deleteserviceuser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.deletezitadeluser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.geteffectivepermissionsv2': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.getme': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.listpats': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.listscopedpats': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.listserviceusers': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.listzitadelusers': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.previewscopedpat': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.profilepicture.createuploadticket': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.profilepicture.geturl': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.profilepicture.remove': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.reactivateuser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.refresh': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.refreshalexa': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.revokealluserpats': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.revokepat': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.revokescopedpat': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.rotatescopedpat': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.rotatetoken': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.sendpasswordreset': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.setallowdebug': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.simulatev2': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'user.updatezitadeluser': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'user.zitadelavailable': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'variables.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'variables.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'variables.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'variables.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'variables.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'virtual_meta.clear': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'virtual_meta.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'virtual_meta.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'virtual_meta.fetch': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'virtual_meta.set': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'virtual.add': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.boolean.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.boolean.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.boolean.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.boolean.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.componentset': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.enum.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.enum.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.enum.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.enum.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.group.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.group.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.group.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.group.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.number.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.number.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.number.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.number.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.text.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.text.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'virtual.text.set': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.text.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtual.trigger': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'virtualdevice.binding.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.create'
    },
    'virtualdevice.binding.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.list'
    },
    'virtualdevice.binding.listsources': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.listSources'
    },
    'virtualdevice.binding.replace': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.replace'
    },
    'virtualdevice.binding.replacementreport': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.replacementReport'
    },
    'virtualdevice.binding.retire': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.retire'
    },
    'virtualdevice.binding.validatedraft': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.bindings.validateDraft'
    },
    'virtualdevice.bluetooth.candidate.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.listCandidates'
    },
    'virtualdevice.bluetooth.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.delete'
    },
    'virtualdevice.bluetooth.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.get'
    },
    'virtualdevice.bluetooth.image.createuploadticket': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.createImageUploadTicket'
    },
    'virtualdevice.bluetooth.key.clear': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'virtualdevice.bluetooth.key.setref': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'virtualdevice.bluetooth.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.list'
    },
    'virtualdevice.bluetooth.promotefromgateway': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.promoteFromGateway'
    },
    'virtualdevice.bluetooth.transport.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.listTransports'
    },
    'virtualdevice.bluetooth.transport.setprimary': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.setPrimaryTransport'
    },
    'virtualdevice.bluetooth.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.bluetoothDevices.update'
    },
    'virtualdevice.command.invoke': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.command.invoke'
    },
    'virtualdevice.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.create'
    },
    'virtualdevice.delete': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.delete'
    },
    'virtualdevice.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'virtualdevice.draft.preview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.draft.preview'
    },
    'virtualdevice.extraction.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.extraction.create'
    },
    'virtualdevice.extraction.preview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.extraction.preview'
    },
    'virtualdevice.extraction.replacementpreview': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.extraction.replacementPreview'
    },
    'virtualdevice.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.get'
    },
    'virtualdevice.history.backfill': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.history.backfill'
    },
    'virtualdevice.history.readprovenance': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.history.readProvenance'
    },
    'virtualdevice.history.readrole': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.history.readRole'
    },
    'virtualdevice.image.createuploadticket': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.createImageUploadTicket'
    },
    'virtualdevice.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.list'
    },
    'virtualdevice.manifest.apply': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.manifest.apply'
    },
    'virtualdevice.manifest.export': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.manifest.export'
    },
    'virtualdevice.manifest.plan': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.manifest.plan'
    },
    'virtualdevice.manifest.validate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.manifest.validate'
    },
    'virtualdevice.profile.create': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.profiles.create'
    },
    'virtualdevice.profile.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.profiles.list'
    },
    'virtualdevice.profile.matchsources': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.profiles.matchSources'
    },
    'virtualdevice.profile.suggestfromdevice': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.profiles.suggestFromDevice'
    },
    'virtualdevice.profile.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.profiles.update'
    },
    'virtualdevice.profile.validate': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.profiles.validate'
    },
    'virtualdevice.update': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false,
        wrapper: 'host.virtualDevices.update'
    },
    'voltmeter.checkexpression': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'voltmeter.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'voltmeter.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'voltmeter.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'voltmeter.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'waitingroom.acceptallstart': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.acceptbulkcancel': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.acceptbulkstart': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.acceptbulkstatus': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.acceptpendingbyexternalid': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.acceptpendingbyid': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.approve': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: false,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.describe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.get': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.getcounts': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.getdenied': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.getpending': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.list': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.listdenied': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.probe': {
        namespaceKind: 'fleet-manager',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: false
    },
    'waitingroom.quarantine': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.reject': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'waitingroom.rejectpending': {
        namespaceKind: 'fleet-manager',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: false
    },
    'web.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'web.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'web.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'web.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'webhook.create': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'webhook.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'webhook.deleteall': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'webhook.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'webhook.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'webhook.listallsupported': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'webhook.listsupported': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'webhook.update': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'wifi.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'wifi.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'wifi.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'wifi.listapclients': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'wifi.savednetworks.delete': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'wifi.savednetworks.list': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'wifi.scan': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'wifi.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'wifi.speedtest': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ws.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ws.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ws.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'ws.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'xmod.applyproductjws': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    },
    'xmod.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'xmod.getinfo': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'xmod.getproductjws': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'zigbee.describe': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'zigbee.getconfig': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'zigbee.getstatus': {
        namespaceKind: 'device',
        readOnly: true,
        destructive: false,
        consequential: false,
        requiresOnlineDevice: true
    },
    'zigbee.setconfig': {
        namespaceKind: 'device',
        readOnly: false,
        destructive: true,
        consequential: true,
        requiresOnlineDevice: true
    }
} as const;
