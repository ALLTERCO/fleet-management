<template>
    <BasicLayout>
        <div class="is-flex flex-direction-row">
            <SideMenu />
            <div class="container p-4" style="margin-left: 200px !important; overflow: hidden;">
                <slot />
            </div>
        </div>
    </BasicLayout>
</template>

<script setup lang="ts">
import BasicLayout from "@/layouts/BasicLayout.vue"
import SideMenu from "@/components/SideMenu.vue";
</script>

