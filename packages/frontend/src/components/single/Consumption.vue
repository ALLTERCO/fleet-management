<template>
    <div class="card" style="background-color: transparent;">
        <header class="card-header" @click="shown = !shown" style="border-bottom: 1px solid white; border-radius: 0px;">
            <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable" style="height: 44px">
                <div class="left-icon">
                    <span class="icon m-auto">
                        <i class="fas fa-bolt"></i>
                    </span>
                </div>
                <template v-if="shown">
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
                    Consumption
                </p>
            </div>
        </header>
        <Transition name="slidedown">
            <div class="card-content p-0" v-show="shown">
                <div class="content my-4 has-background-shelly" style="border-radius: .5rem">
                    <ConsumptionChart :data="data" :type="select" />
                </div>
            </div>
        </Transition>
    </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, toRef, ref, watch } from "vue";
import ConsumptionChart from "./ConsumptionChart.vue";
import * as http from "@/tools/http";

export default defineComponent({
    props: {
        device_mac: {
            type: String,
            required: true
        },
    },
    components: { ConsumptionChart },
    setup(props) {
        const device_mac = toRef(props, 'device_mac');
        const select = ref("Hourly");
        const shown = ref(true);

        const data = ref();

        const updateData = async () => {
            let start = 0, end = Date.now() / 1000;
            switch (select.value) {
                case 'Hourly':
                    start = Date.now() / 1000 - 60 * 60;
                    break;

                case 'Day':
                    start = Date.now() / 1000 - 24 * 60 * 60;
                    break;
            }
            try {
                data.value = await http.getConsumption(device_mac.value, 0, select.value, start, end);
            } catch (error) {
                data.value = [];
            }
        }

        onMounted(updateData);

        watch(shown, val => {
            if (val) updateData();
        })

        return { device_mac, data, select, updateData, shown }
    }
})
</script>

<style>
.left-icon {
    border-right: 1px solid grey;
    padding: 0 !important;
    height: 100%;
    margin-top: auto;
    margin-bottom: auto;
    display: flex;
    flex-flow: column;
    justify-content: space-around;
    width: 44px;
}
</style>