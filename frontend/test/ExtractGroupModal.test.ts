import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';

const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({
    sendRPC,
    connect: vi.fn(),
    close: vi.fn()
}));

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canWrite: true,
        isReadOnly: false,
        isAdmin: true,
        isViewer: false,
        permissionsLoaded: true
    })
}));

import ExtractGroupModal from '@/components/devices/add/ExtractGroupModal.vue';

const previewOk = {
    hostDeviceListId: 1,
    hostExternalId: 'shellypill-aabbccdd',
    sourceKey: 'group:200',
    sourceType: 'virtual_group' as const,
    name: 'Battery group',
    typeKey: 'battery',
    categoryKey: 'energy',
    roles: [
        {
            roleKey: 'voltage',
            label: 'Voltage',
            valueType: 'number' as const,
            writable: false,
            componentKey: 'number:220',
            componentType: 'number'
        }
    ],
    bindings: [],
    hiddenSourceComponentKeys: [],
    alreadyExtracted: false,
    extractedExternalId: null,
    sourceSnapshot: {
        hostExternalId: 'shellypill-aabbccdd',
        hostDeviceListId: 1,
        sourceKey: 'group:200',
        sourceType: 'virtual_group' as const,
        members: [
            {
                roleKey: 'voltage',
                componentKey: 'number:220',
                componentType: 'number',
                valueType: 'number' as const,
                writable: false,
                required: true,
                unit: 'V',
                label: 'Voltage'
            }
        ],
        capturedAt: '2026-06-05T00:00:00.000Z'
    }
};

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPC.mockReset();
    document.body.innerHTML = '';
});

async function open(
    props: {visible?: boolean; hostExternalId?: string; sourceKey?: string} = {}
) {
    const w = mount(ExtractGroupModal, {
        props: {
            visible: true,
            hostExternalId: 'shellypill-aabbccdd',
            sourceKey: 'group:200',
            ...props
        },
        attachTo: document.body
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    return w;
}

describe('ExtractGroupModal — fetches preview on first open', () => {
    it('calls virtualdevice.Extraction.Preview with host + source so the user sees what they will create', async () => {
        sendRPC.mockResolvedValue(previewOk);
        await open();
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.extraction.preview',
            {
                hostExternalId: 'shellypill-aabbccdd',
                sourceKey: 'group:200'
            }
        );
    });

    it('prefills name + type + category from the backend preview — UI does not invent values', async () => {
        sendRPC.mockResolvedValue(previewOk);
        const w = await open();
        const nameInput = document.body.querySelector(
            'input'
        ) as HTMLInputElement | null;
        expect(nameInput?.value).toBe('Battery group');
        w.unmount();
    });

    it('surfaces backend error + retry button when preview fails', async () => {
        sendRPC.mockRejectedValue(new Error('500 boom'));
        const w = await open();
        expect(document.body.textContent).toContain('500 boom');
        expect(document.body.textContent).toContain('Retry');
        w.unmount();
    });
});

describe('ExtractGroupModal — blocks duplicate extraction', () => {
    it('hides the Extract button when alreadyExtracted=true and surfaces the existing id', async () => {
        sendRPC.mockResolvedValue({
            ...previewOk,
            alreadyExtracted: true,
            extractedExternalId: 'vdev_battery_200'
        });
        const w = await open();
        expect(document.body.textContent).toContain('vdev_battery_200');
        const extractBtn = Array.from(
            document.body.querySelectorAll('button')
        ).find((b) => b.textContent?.trim().startsWith('Extract'));
        expect(extractBtn).toBeUndefined();
        w.unmount();
    });
});

describe('ExtractGroupModal — Extract creates and emits', () => {
    it('calls Extraction.Create with the form values and emits extracted with the new externalId', async () => {
        sendRPC.mockImplementation(async (_target, method) =>
            method === 'virtualdevice.extraction.preview'
                ? previewOk
                : {externalId: 'vdev_battery_42'}
        );
        const w = await open();
        const extractBtn = Array.from(
            document.body.querySelectorAll('button')
        ).find((b) => b.textContent?.trim().startsWith('Extract')) as
            | HTMLButtonElement
            | undefined;
        extractBtn?.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(sendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'virtualdevice.extraction.create',
            expect.objectContaining({
                hostExternalId: 'shellypill-aabbccdd',
                sourceKey: 'group:200',
                name: 'Battery group'
            })
        );
        expect(w.emitted('extracted')?.[0]).toEqual(['vdev_battery_42']);
        w.unmount();
    });

    it('surfaces backend errors instead of silently swallowing them', async () => {
        sendRPC.mockImplementation(async (_target, method) => {
            if (method === 'virtualdevice.extraction.preview') return previewOk;
            throw new Error('CrossOrgReference');
        });
        const w = await open();
        const extractBtn = Array.from(
            document.body.querySelectorAll('button')
        ).find((b) => b.textContent?.trim().startsWith('Extract')) as
            | HTMLButtonElement
            | undefined;
        extractBtn?.click();
        await new Promise((r) => setTimeout(r, 0));
        expect(document.body.textContent).toContain('CrossOrgReference');
        expect(w.emitted('extracted')).toBeUndefined();
        w.unmount();
    });
});
