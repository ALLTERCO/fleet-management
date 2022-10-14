<template>
    <div>
        <div class="columns">
            <HistoryBrowser />
            <HistoryView />
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import HistoryBrowser from "@/components/HistoryBrowser.vue";
import HistoryView from "@/components/HistoryView.vue";

export default defineComponent({
    components: { HistoryBrowser, HistoryView }
})
</script>