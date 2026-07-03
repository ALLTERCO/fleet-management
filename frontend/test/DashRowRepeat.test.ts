// Component: DashRowRepeat — verifies the joined-signature watcher fires
// only when ids actually change, not on every parent render (I3 regression).

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import DashRowRepeat from '@/components/dashboard/DashRowRepeat.vue';

const ROW_RUN_SLOT = {row: '<div class="row">{{params.item.id}}</div>'};

describe('DashRowRepeat', () => {
    it('renders one details element per item', () => {
        const wrapper = mount(DashRowRepeat, {
            props: {
                title: 'Groups',
                items: [
                    {id: 'a', label: 'A'},
                    {id: 'b', label: 'B'}
                ]
            },
            slots: ROW_RUN_SLOT
        });
        expect(wrapper.findAll('.drr__row').length).toBe(2);
    });

    it('expand-all opens every row', async () => {
        const wrapper = mount(DashRowRepeat, {
            props: {
                title: 'Groups',
                items: [
                    {id: 'a', label: 'A'},
                    {id: 'b', label: 'B'}
                ]
            },
            slots: ROW_RUN_SLOT
        });
        await wrapper.findAll('.drr__btn')[0].trigger('click');
        const rows = wrapper.findAll('details.drr__row');
        for (const row of rows) {
            expect(row.attributes('open')).toBeDefined();
        }
    });

    it('regression: a new items array with identical ids does not collapse user-expanded rows', async () => {
        const items = [
            {id: 'a', label: 'A'},
            {id: 'b', label: 'B'}
        ];
        const wrapper = mount(DashRowRepeat, {
            props: {title: 'Groups', items},
            slots: ROW_RUN_SLOT
        });
        // User expands 'a'.
        await wrapper.findAll('.drr__btn')[0].trigger('click');
        await nextTick();

        // Parent re-renders with a NEW array reference but same ids — what
        // .map() does on every Vue update. Previous-bug: watch fired and
        // reseed wiped openIds; fixed by joined-signature comparison.
        await wrapper.setProps({
            items: [
                {id: 'a', label: 'A'},
                {id: 'b', label: 'B'}
            ]
        });
        await nextTick();

        const rows = wrapper.findAll('details.drr__row');
        expect(rows[0].attributes('open')).toBeDefined();
        expect(rows[1].attributes('open')).toBeDefined();
    });

    it('new ids inherit defaultExpanded; existing ids preserve their state', async () => {
        const wrapper = mount(DashRowRepeat, {
            props: {
                title: 'Groups',
                items: [{id: 'a', label: 'A'}],
                defaultExpanded: false
            },
            slots: ROW_RUN_SLOT
        });
        // User expands 'a'.
        await wrapper.findAll('.drr__btn')[0].trigger('click');
        await nextTick();

        await wrapper.setProps({
            items: [
                {id: 'a', label: 'A'},
                {id: 'b', label: 'B'}
            ]
        });
        await nextTick();

        const rows = wrapper.findAll('details.drr__row');
        // 'a' stays open, 'b' starts closed (defaultExpanded=false).
        expect(rows[0].attributes('open')).toBeDefined();
        expect(rows[1].attributes('open')).toBeUndefined();
    });
});
