import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';

vi.mock('@/api/assetRpc', () => ({
    AssetUploadError: class AssetUploadError extends Error {},
    deleteAsset: vi.fn(),
    listAssets: vi.fn(async () => ({items: []})),
    renameAsset: vi.fn(),
    uploadAsset: vi.fn()
}));

describe('AssetPickerModal — bundled device pictures', () => {
    it('lets callers pick a shipped device picture model', async () => {
        const w = mount(AssetPickerModal, {
            props: {visible: true, defaultContext: 'device'},
            global: {
                stubs: {
                    Modal: {
                        template:
                            '<div><slot name="title" /><slot /><slot name="footer" /></div>'
                    },
                    MdiIconPicker: true,
                    AccentTokenPicker: true,
                    Button: {
                        template: '<button @click="$emit(\'click\')"><slot /></button>'
                    },
                    Spinner: true,
                    FormField: {
                        template: '<label><slot /></label>'
                    },
                    Input: {
                        template: '<input />'
                    }
                }
            }
        });

        await w.findAll('button').find((b) => b.text().includes('Devices'))?.trigger('click');
        await w.find('input[aria-label="Filter device pictures"]').setValue('SBDW');
        await w.find('[data-device-model="SBDW-002C"] button').trigger('click');

        expect(w.emitted('select-device-picture')?.[0]?.[0]).toMatchObject({
            model: 'SBDW-002C'
        });
    });
});
