<template>
    <div v-for="item in menu_items" v-if="device != undefined">
        <div class="card" style="background-color: transparent;">
            <header class="card-header" @click="shownClicked(item)"
                style="border-bottom: 1px solid white; border-radius: 0px;">
                <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                    <template v-if="item.shown">
                        <span class="icon">
                            <i class="fas fa-chevron-down"></i>
                        </span>
                    </template>
                    <template v-else>
                        <span class="icon">
                            <i class="fas fa-chevron-right"></i>
                        </span>
                    </template>
                    <p style="padding-left: 0px; font-weight: 500">
                        {{item.label}}
                    </p>
                </div>
            </header>
            <Transition name="slidedown">
                <component :device_mac="device_mac" :device="device" :is="item.component" v-show="item.shown" />
            </Transition>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, toRef, ref, shallowRef } from 'vue';
import StatusView from './StatusView.vue';
import RPC from './RPC.vue';
import ShellyDevice from '@/ShellyDevice';

export default defineComponent({
    props: {
        device_mac: {
            type: String,
            required: true
        },
        device: {
            type: Object as () => ShellyDevice,
            required: true
        }
    },
    setup(props) {
        const device_mac = toRef(props, 'device_mac');
        const device = toRef(props, 'device');
        interface menu_t {
            component: any,
            label: string,
            icon: string,
            shown: boolean
        }

        const menu_items = ref([
            {
                component: shallowRef(RPC),
                label: 'RPC Call',
                icon: 'fa-file',
                shown: false
            }
        ] as menu_t[]);

        if(device.value.lastStatus != undefined){
            menu_items.value.unshift({
                component: shallowRef(StatusView),
                label: 'Status',
                icon: 'fa-file',
                shown: false
            })
        } else {
            menu_items.value[0]!.shown = true;
        }

        const shownClicked = (item: menu_t) => {
            item.shown = !item.shown;
            if(item.shown){
                for(const otherItem of menu_items.value){
                    otherItem.shown = otherItem.label === item.label;
                }
            }
        }

        return { device_mac, menu_items, shownClicked };
    }
})
</script>