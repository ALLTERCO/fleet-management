<template>
    <div class="card-content has-background-shelly" >
        <div class="content">
            <div class="notification is-warning mb-0">You are currently viewing a cached status from {{new Date(device.lastStatusTs).toUTCString()}}</div>
            <div class="control">
                <input type="text" class="input" v-model="filter" placeholder="Search keys">
            </div>
            <pre class="filtered">{{ filteredText }}</pre>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, computed } from "vue";
import ShellyDevice from "@/ShellyDevice";

export default defineComponent({
    props: {
        device: {
            type: Object as () => ShellyDevice,
            required: true
        }
    },
    setup(props) {
        const device = toRef(props, 'device');
        const filter = ref("");

        const filteredText = computed(() => {
            if (filter.value == undefined || filter.value.length == 0) {
                return JSON.stringify(status.value, undefined, 2);
            }
            let filtered = {};
            for (const key in status.value) {
                if (key.startsWith(filter.value)) {
                    Object.assign(filtered, { [key]: status.value[key] })
                }
            }
            return JSON.stringify(filtered, undefined, 2);
        })

        const status = computed(() => {
            return device.value.lastStatus;
        })

        return {
            status,
            filter,
            filteredText,
        }
    }
})
</script>

<style scoped>
.filtered {
    max-height: 50vh;
    overflow: scroll;
}

pre {
    text-align: left;
}

.card-content {
    padding: 0px;
}

input,
pre {
    color: white;
    background-color: var(--shelly-comp-bg);
}

input {
    border-top: 0px;
    border-left: 0px;
    border-right: 0px;
    border-bottom: 1px solid gray;
    border-radius: 0px;
}

::placeholder {
    color: white;
}
</style>