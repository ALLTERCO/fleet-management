<template>
    <div class="column is-two-fifths" v-if="history">
        <nav class="panel is-primary">
            <header class="card-header" style="border-bottom: 1px solid white; border-radius: 0px;">
                    <div class="card-header-title card-header-title-shelly has-text-white is-clickable is-unselectable">
                        <p style="padding-left: 0px">History</p>
                    </div>
                </header>
            <div class="panel-block has-background-shelly">
                <p class="control has-icons-left">
                    <input class="input" type="text" placeholder="Search" v-model="search">
                    <span class="icon is-left">
                        <i class="fas fa-search" aria-hidden="true"></i>
                    </span>
                </p>
            </div>
            <div v-if="filteredHistory().length > 0" class="h-block has-background-shelly">
                <a v-for="(entry, index) in filteredHistory()" :key="entry.timestamp" class="panel-block"
                    @click="clicked(index)" :class="{ 'is-active': index == historyStore.selectedIndex }">
                    <span class="panel-icon">
                        <i class="fas fa-book" aria-hidden="true"></i>
                    </span>
                    <span class="has-text-white">
                        {{ new Date(entry.timestamp).toISOString() }}/{{ entry.device_mac }}
                    </span>
                </a>
            </div>
            <span v-else><strong>No history found</strong></span>
        </nav>
    </div>
</template>
<script lang="ts">
import { useHistoryStore } from "@/stores/history";
import { storeToRefs } from "pinia";
import { defineComponent, ref } from "vue";

export default defineComponent({
    name: "History Browser",
    setup() {
        const historyStore = useHistoryStore();
        const { history } = storeToRefs(historyStore);
        const search = ref('');
        const clicked = (index: number) => {
            historyStore.select(index);
        }
        const filteredHistory = () => {
            console.log(search.value)
            return history.value.filter(h => search.value.length == 0 ? true :
                h.device_mac.includes(search.value) || new Date(h.timestamp).toISOString().includes(search.value))
        }
        return { history, clicked, historyStore, search, filteredHistory };
    }
});
</script>

<style scoped>
.column {
    max-height: 100vh;
    height: 100vh;
    overflow-y: scroll;
}


.is-active {
    background-color: var(--shelly-bg);
}

a.panel-block:hover, label.panel-block:hover {
	background-color: var(--shelly-bg);
}
</style>