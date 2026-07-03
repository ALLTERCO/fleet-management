/** Integration test — Modal.vue rendered with the modalStack helper.
 *  Verifies the parts that the unit tests can't see end-to-end:
 *    - Each open Modal pushes a higher --modal-depth than the previous.
 *    - Body overflow stays 'hidden' while ANY Modal is open, and is restored
 *      only when the last one closes (the failure mode bc18a356 fixed).
 *    - Closing the inner Modal does not unlock the outer modal's body lock.
 */

import {mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import Modal from '@/components/modals/Modal.vue';
import {
    _resetModalStackForTests,
    openModalDepthCount
} from '@/helpers/modalStack';

beforeEach(() => {
    _resetModalStackForTests();
    document.body.style.overflow = '';
});

afterEach(() => {
    document.body.style.overflow = '';
});

function readModalDepth(rootEl: Element): number {
    const style = (rootEl as HTMLElement).style.getPropertyValue(
        '--modal-depth'
    );
    return Number(style);
}

function findModalRoots(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.modal-root'));
}

describe('Modal × modalStack', () => {
    it('locks body scroll the first time a Modal opens', async () => {
        const wrapper = mount(Modal, {
            attachTo: document.body,
            props: {visible: false}
        });
        await wrapper.setProps({visible: true});
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');
        wrapper.unmount();
    });

    it('restores body overflow when the only open Modal closes', async () => {
        const wrapper = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();
        await wrapper.setProps({visible: false});
        await nextTick();
        expect(document.body.style.overflow).toBe('');
        wrapper.unmount();
    });

    it('assigns strictly higher --modal-depth to each nested Modal', async () => {
        const outer = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();
        const inner = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();

        const roots = findModalRoots();
        expect(roots.length).toBe(2);
        const depths = roots.map(readModalDepth).sort((a, b) => a - b);
        expect(depths[1]).toBeGreaterThan(depths[0]);

        inner.unmount();
        outer.unmount();
    });

    it('keeps body locked while the outer Modal stays open and the inner closes', async () => {
        const outer = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();
        const inner = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');

        await inner.setProps({visible: false});
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');
        expect(openModalDepthCount()).toBe(1);

        await outer.setProps({visible: false});
        await nextTick();
        expect(document.body.style.overflow).toBe('');
        expect(openModalDepthCount()).toBe(0);

        inner.unmount();
        outer.unmount();
    });

    it('releases the inner depth slot so a re-opened Modal sits above the outer', async () => {
        const outer = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();
        const outerDepth = readModalDepth(findModalRoots()[0]);

        const inner = mount(Modal, {
            attachTo: document.body,
            props: {visible: true}
        });
        await nextTick();
        await inner.setProps({visible: false});
        await nextTick();
        await inner.setProps({visible: true});
        await nextTick();

        const innerRoot = findModalRoots().find(
            (el) => readModalDepth(el) !== outerDepth
        );
        expect(innerRoot).toBeTruthy();
        expect(readModalDepth(innerRoot as HTMLElement)).toBeGreaterThan(
            outerDepth
        );

        inner.unmount();
        outer.unmount();
    });
});
