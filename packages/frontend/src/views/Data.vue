<template>
    <div class="container">
        <div class="card has-background-shelly">
            <div class="card-header">
                <div class="card-header-title  has-text-white">Data flow</div>
            </div>
            <div class="card-content" v-if="events.length > 0">
                <div class="p">
                    <div class="field is-horizontal">
                        <div class="field-label is-normal">
                            <label class="label has-text-white">Device</label>
                        </div>
                        <div class="field-body">
                            <div class="field is-narrow">
                                <div class="control">
                                    <div class="select is-fullwidth">
                                        <select v-model="selectedDevice">
                                            <option v-for="device in devices" :key="device">{{ device }}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="field is-horizontal">
                        <div class="field-label is-normal">
                            <label class="label has-text-white">Method</label>
                        </div>
                        <div class="field-body">
                            <div class="field is-narrow">
                                <div class="control">
                                    <div class="select is-fullwidth">
                                        <select v-model="selectedMethod">
                                            <option v-for="method in methods" :key="method">{{ method }}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="field is-horizontal">
                        <div class="field-label is-normal">
                            <label class="label has-text-white">Per page</label>
                        </div>
                        <div class="field-body">
                            <div class="field is-narrow">
                                <div class="control">
                                    <div class="select is-fullwidth">
                                        <select v-model="perPage">
                                            <option v-for="page in [25,50,100,200]" :key="page">{{ page }}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card-content" v-else>
                <h1 class="title has-text-white">No recorded events</h1>
            </div>
        </div>

        <nav class="pagination is-centered mt-4" role="navigation" aria-label="pagination" v-if="lastPage > 1">
            <a class="pagination-previous" v-show="page != 1" @click="page = prevPage">Previous</a>
            <a class="pagination-next" v-show="page != lastPage" @click="page = nextPage">Next page</a>
            <ul class="pagination-list">
                <template v-if="prevPage > 1">
                    <li><a class="pagination-link" aria-label="Goto page 1"  @click="page = 1">1</a></li>
                    <li><span class="pagination-ellipsis">&hellip;</span></li>
                </template>
                <li v-if="page != 1"><a class="pagination-link" aria-label="Goto page {{prevPage}}" @click="page = prevPage">{{prevPage}}</a></li>
                <li><a class="pagination-link is-current" aria-label="Page {{page}}" aria-current="page">{{page}}</a></li>
                <template v-if="nextPage < lastPage">
                    <li><a class="pagination-link" aria-label="Goto page {{nextPage}}" @click="page = nextPage">{{nextPage}}</a></li>
                    <li><span class="pagination-ellipsis">&hellip;</span></li>
                </template>
                <li v-if="page != lastPage"><a class="pagination-link" aria-label="Goto page {{lastPage}}" @click="page = lastPage">{{lastPage}}</a></li>
            </ul>
        </nav>
        <div v-for="(item, index) of filteredEvents">
            <div class="card" style="background-color: transparent;">
                <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;"
                    @click="clicked(index)">
                    <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                        <div style="border-right: 1px solid white;">
                            <span class="icon">
                                <i class="fas fa-clock"></i>
                            </span>
                            {{ new Date(item.timestamp).toISOString().replace("T", " ").replace("Z", " ").slice(0, -5)
                            }}
                        </div>
                        <span class="icon" v-if="selectedIndex == index">
                            <i class="fas fa-chevron-down"></i>
                        </span>
                        <span class="icon" v-else>
                            <i class="fas fa-chevron-right"></i>
                        </span>
                        <p style="padding-left: 0px">
                            {{ item.method }}
                        </p>
                        <span style="position: absolute; right: 0px;">
                            {{ item.shellyID }}
                        </span>
                    </div>
                </header>
                <Transition name="slidedown" v-show="selectedIndex == index">
                    <pre>{{ JSON.stringify(item.data, undefined, 4) }}</pre>
                </Transition>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { useEventStore } from "../stores/events";
import { storeToRefs } from "pinia";

export default defineComponent({
    setup() {
        const eventStore = useEventStore();
        const { events } = storeToRefs(eventStore);
        const selectedIndex = ref(0);

        const clicked = (index: number) => {
            if (selectedIndex.value == index) {
                selectedIndex.value = NaN;
            } else {
                selectedIndex.value = index;
            }
        }

        const selectedDevice = ref("All");
        const selectedMethod = ref("All");

        const filteredEvents = computed(() => {
            let filtered = events.value;
            if (selectedDevice.value != 'All') {
                filtered = filtered.filter(e => e.shellyID == selectedDevice.value);
            }
            if (selectedMethod.value != 'All') {
                filtered = filtered.filter(e => e.method == selectedMethod.value);
            }
            return filtered;
        })

        const devices = computed(() => {
            return new Set(["All", ...events.value.map(e => e.shellyID)]);
        });

        const methods = computed(() => {
            return new Set(["All", ...events.value.map(e => e.method)])
        })

        const page = ref(1), lastPage = computed(() => eventStore.pages);
        const nextPage = computed(() => Math.min(lastPage.value, page.value+1));
        const prevPage = computed(() => Math.max(1, page.value-1));

        const perPage = ref(25), timeFrame = ref("Last 1 hour");

        watch(page, async () => {
            await eventStore.changePage(page.value);
        })

        watch([selectedDevice, selectedMethod, perPage], () => {
            eventStore.change({
                shellyID: selectedDevice.value == 'All' ? undefined : selectedDevice.value,
                method: selectedMethod.value == 'All' ? undefined : selectedMethod.value,
                page: 1,
                perPage: perPage.value
            })
        })

        return {
            events,
            selectedIndex,
            clicked,
            devices,
            selectedDevice,
            methods,
            selectedMethod,
            filteredEvents,
            page,
            nextPage,
            prevPage,
            lastPage,
            perPage,
            timeFrame
        };
    },
})
</script>

<style scoped>
td,
th {
    color: white
}

.card-header-title {
    font-weight: 400;
}

li > a, pre, .pagination-previous, .pagination-next {
    text-align: left;
    color: white;
    background-color: var(--shelly-comp-bg);
}

a:hover {
    color: white
}
</style>