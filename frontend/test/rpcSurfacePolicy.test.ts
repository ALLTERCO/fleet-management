import {describe, expect, it} from 'vitest';
import {
    classifyRpcSurface,
    isInstantCommandRpc
} from '@/helpers/rpcSurfacePolicy';
import dependencyInventory from '../../docs/generated/frontend-backend-dependencies.json';

type RpcDependencyCall = {
    target: string;
    sourceFile: string;
    sourceLine: number;
};

const ALLOWED_INSTANT_COMMAND_FILES = new Set([
    'frontend/src/stores/entities.ts',
    'frontend/src/stores/devices.ts'
]);

const ALLOWED_GROUP_MUTATION_FILES = new Set(['frontend/src/stores/groups.ts']);

const GROUP_MUTATION_METHODS = new Set([
    'group.create',
    'group.update',
    'group.delete',
    'group.addmembers',
    'group.removemembers'
]);

const rpcCalls = dependencyInventory.calls as RpcDependencyCall[];

describe('rpc surface policy', () => {
    it('classifies every generated frontend RPC dependency', () => {
        const unclassified = uniqueRpcTargets().filter(
            (target) => !classifyRpcSurface(target)
        );

        expect(unclassified).toEqual([]);
    });

    it('keeps instant command RPCs behind catalog-owned stores', () => {
        const invalidCalls = rpcCalls
            .filter((call) => isInstantCommandRpc(call.target))
            .filter(
                (call) => !ALLOWED_INSTANT_COMMAND_FILES.has(call.sourceFile)
            )
            .map(formatCall);

        expect(invalidCalls).toEqual([]);
    });

    it('keeps group mutation RPCs behind the groups store', () => {
        const invalidCalls = rpcCalls
            .filter((call) => GROUP_MUTATION_METHODS.has(call.target))
            .filter(
                (call) => !ALLOWED_GROUP_MUTATION_FILES.has(call.sourceFile)
            )
            .map(formatCall);

        expect(invalidCalls).toEqual([]);
    });

    it('does not classify config reads as instant UI commands', () => {
        expect(classifyRpcSurface('Switch.SetConfig')?.category).toBe(
            'pending-command'
        );
        expect(classifyRpcSurface('Shelly.Reboot')?.category).toBe(
            'pending-command'
        );
        expect(classifyRpcSurface('Entity.InvokeAction')?.category).toBe(
            'instant-command'
        );
    });

    it('keeps access read RPCs separate from access changes', () => {
        const readOnlyAccessMethods = uniqueRpcTargets().filter((target) =>
            isAccessReadMethod(target)
        );
        const misclassified = readOnlyAccessMethods
            .filter(
                (target) =>
                    classifyRpcSurface(target)?.category === 'access-change'
            )
            .sort();

        expect(misclassified).toEqual([]);
    });

    it('classifies access mutations as access changes', () => {
        expect(classifyRpcSurface('User.CreateServiceUser')?.category).toBe(
            'access-change'
        );
        expect(classifyRpcSurface('User.PreviewScopedPAT')?.category).toBe(
            'read'
        );
        expect(classifyRpcSurface('assignment.create')?.category).toBe(
            'access-change'
        );
        expect(classifyRpcSurface('assignment.listforresource')?.category).toBe(
            'read'
        );
    });

    it('classifies the full virtual-device RPC surface', () => {
        const expected = new Map<string, string>([
            ['virtualdevice.Create', 'pending-command'],
            ['virtualdevice.Get', 'read'],
            ['virtualdevice.List', 'read'],
            ['virtualdevice.Update', 'pending-command'],
            ['virtualdevice.Delete', 'pending-command'],
            ['virtualdevice.Extraction.Preview', 'read'],
            ['virtualdevice.Extraction.Create', 'pending-command'],
            ['virtualdevice.Profile.List', 'read'],
            ['virtualdevice.Profile.Create', 'pending-command'],
            ['virtualdevice.Profile.Validate', 'read'],
            ['virtualdevice.Binding.List', 'read'],
            ['virtualdevice.Binding.ListSources', 'read'],
            ['virtualdevice.Binding.ValidateDraft', 'read'],
            ['virtualdevice.Draft.Preview', 'read'],
            ['virtualdevice.Binding.Create', 'pending-command'],
            ['virtualdevice.Binding.Replace', 'pending-command'],
            ['virtualdevice.Binding.Retire', 'pending-command'],
            ['virtualdevice.Command.Invoke', 'instant-command'],
            ['virtualdevice.History.ReadRole', 'read'],
            ['virtualdevice.History.ReadProvenance', 'read'],
            ['virtualdevice.History.Backfill', 'pending-command'],
            ['virtualdevice.Binding.ReplacementReport', 'read'],
            ['virtualdevice.Manifest.Validate', 'read'],
            ['virtualdevice.Manifest.Export', 'read'],
            ['virtualdevice.Manifest.Plan', 'read'],
            ['virtualdevice.Manifest.Apply', 'pending-command'],
            ['virtualdevice.Bluetooth.Candidate.List', 'read'],
            ['virtualdevice.Bluetooth.PromoteFromGateway', 'pending-command'],
            ['virtualdevice.Bluetooth.List', 'read'],
            ['virtualdevice.Bluetooth.Get', 'read'],
            ['virtualdevice.Bluetooth.Transport.List', 'read'],
            ['virtualdevice.Bluetooth.Transport.SetPrimary', 'pending-command'],
            ['virtualdevice.Bluetooth.Key.SetRef', 'pending-command'],
            ['virtualdevice.Bluetooth.Key.Clear', 'pending-command']
        ]);

        const actual = Array.from(expected.keys()).filter(
            (method) =>
                classifyRpcSurface(method)?.category !== expected.get(method)
        );

        expect(actual).toEqual([]);
    });
});

function uniqueRpcTargets(): string[] {
    return Array.from(new Set(rpcCalls.map((call) => call.target))).sort();
}

function formatCall(call: RpcDependencyCall): string {
    return `${call.sourceFile}:${call.sourceLine} ${call.target}`;
}

function isAccessReadMethod(method: string): boolean {
    const lower = method.toLowerCase();
    if (lower.includes('.preview')) return true;
    if (lower.includes('.simulate')) return true;
    if (lower.includes('.zitadelavailable')) return true;
    if (lower.includes('.profilepicture.geturl')) return true;
    return (
        lower.includes('.get') ||
        lower.includes('.list') ||
        lower.endsWith('.history')
    );
}
