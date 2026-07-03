import {mount} from '@vue/test-utils';
import {nextTick} from 'vue';
import {afterEach, describe, expect, it, vi} from 'vitest';
import DashboardPalette from '@/components/dashboard/DashboardPalette.vue';

afterEach(() => {
    document.body.innerHTML = '';
});

function mountPalette(props = {}) {
    return mount(DashboardPalette, {
        attachTo: document.body,
        props: {
            visible: true,
            rows: [],
            activeId: null,
            recentIds: [],
            canCreate: true,
            creating: false,
            canRename: vi.fn(() => true),
            canDelete: vi.fn(() => true),
            ...props
        }
    });
}

describe('DashboardPalette', () => {
    it('can open directly in create mode for the manage-page New action', async () => {
        mountPalette({initialMode: 'create'});
        await nextTick();
        await nextTick();

        expect(document.body.textContent).toContain('Create dashboard');
        expect(document.body.textContent).toContain('Type');
        expect(document.body.textContent).toContain('Name');
    });
});
