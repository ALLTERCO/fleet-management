// The two button rows the gas conversion editors share: the footer under every
// form, and the load-older row under every list. One copy, so the three forms
// cannot drift apart.

import {defineComponent, h} from 'vue';
import Button from '@/components/core/Button.vue';

export const EditorFooter = defineComponent({
    props: {
        error: {type: String, default: ''},
        saving: Boolean,
        saveLabel: {type: String, required: true}
    },
    emits: ['cancel'],
    setup(props, {emit}) {
        return () =>
            h('div', [
                props.error
                    ? h(
                          'p',
                          {class: 'ua-form-error', role: 'alert'},
                          props.error
                      )
                    : null,
                h('div', {class: 'ua-editor__footer'}, [
                    h(
                        Button,
                        {
                            type: 'blue-hollow',
                            size: 'sm',
                            onClick: () => emit('cancel')
                        },
                        () => 'Cancel'
                    ),
                    h(
                        Button,
                        {
                            type: 'green',
                            size: 'sm',
                            submit: true,
                            loading: props.saving
                        },
                        () => props.saveLabel
                    )
                ])
            ]);
    }
});

export const LoadOlder = defineComponent({
    props: {loading: Boolean, label: {type: String, required: true}},
    emits: ['click'],
    setup(props, {emit}) {
        return () =>
            h('div', {class: 'ua-load-more'}, [
                h(
                    Button,
                    {
                        type: 'blue-hollow',
                        size: 'sm',
                        loading: props.loading,
                        onClick: () => emit('click')
                    },
                    () => props.label
                )
            ]);
    }
});
