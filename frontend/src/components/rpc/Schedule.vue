<template>
    <div>
        <div class="flex flex-row gap-4 mt-2">
            <Button
                type="blue"
                :class="{ 'is-selected': !useCustom, 'is-primary': !useCustom }"
                @click="useCustom = false"
                @keyup.enter="useCustom = false"
                >Builder</Button
            >
            <Button
                type="blue"
                :class="{ 'is-selected': useCustom, 'is-primary': useCustom }"
                @click="useCustom = true"
                @keyup.enter="useCustom = true"
                >Custom</Button
            >
        </div>
        <div v-if="useCustom" class="custom mt-2">
            <Input v-model="custom" label="Cron" />
            <Notification class="mt-4"
                >Read more about the format
                <a class="underline" href="https://github.com/mongoose-os-libs/cron" target="_blank"
                    >here</a
                ></Notification
            >
        </div>
        <div v-if="!useCustom" class="builder">
            <Input
                v-model="builder.seconds"
                class="w-full max-w-[160px] my-1"
                label="Seconds"
                type="number"
                placeholder="Seconds (0-59)"
                :min="0"
                :max="59"
            />

            <Input
                v-model="builder.minutes"
                class="w-full max-w-[160px] my-1"
                label="Minutes"
                type="number"
                placeholder="Minutes (0-59)"
                :min="0"
                :max="59"
            />

            <Input
                v-model="builder.hours"
                class="w-full max-w-[160px] my-1"
                label="Hours"
                type="number"
                placeholder="Hours (0-23)"
                :min="0"
                :max="23"
            />

            <div class="field">
                <label class="label">Day of the Week</label>
                <div class="checkbox-container">
                    <div class="checkbox-item">
                        <input id="sun" v-model="builder.day_of_week" type="checkbox" name="Sun" value="SUN" />
                        <label for="sun">Sun</label>
                    </div>
                    <div class="checkbox-item">
                        <input id="mon" v-model="builder.day_of_week" type="checkbox" name="Mon" value="MON" />
                        <label for="mon">Mon</label>
                    </div>
                    <div class="checkbox-item">
                        <input id="tue" v-model="builder.day_of_week" type="checkbox" name="Tue" value="TUE" />
                        <label for="tue">Tue</label>
                    </div>
                    <div class="checkbox-item">
                        <input id="wed" v-model="builder.day_of_week" type="checkbox" name="Wed" value="WED" />
                        <label for="wed">Wed</label>
                    </div>
                    <div class="checkbox-item">
                        <input id="thu" v-model="builder.day_of_week" type="checkbox" name="Thu" value="THU" />
                        <label for="thu">Thu</label>
                    </div>
                    <div class="checkbox-item">
                        <input id="fri" v-model="builder.day_of_week" type="checkbox" name="Fri" value="FRI" />
                        <label for="fri">Fri</label>
                    </div>
                    <div class="checkbox-item">
                        <input id="sat" v-model="builder.day_of_week" type="checkbox" name="Sat" value="SAT" />
                        <label for="sat">Sat</label>
                    </div>
                </div>
            </div>
        </div>
        <div class="flex flex-row gap-4">
            <div class="control">
                <Button type="blue" @click="saveClicked">Save</Button>
            </div>
            <div class="control">
                <Button type="blue" @click="resetClicked">Reset</Button>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import {reactive, ref} from 'vue';
import Button from '../core/Button.vue';
import Input from '../core/Input.vue';
import Notification from '../core/Notification.vue';

const emit = defineEmits<(e: 'change', cron: string) => void>();

const useCustom = ref(false);

const custom = ref('');
const builder = reactive({
    seconds: '0',
    minutes: '0',
    hours: '0',
    day_of_week: []
});

function resetClicked() {
    useCustom.value = false;
    custom.value = '';
    builder.seconds = '0';
    builder.minutes = '0';
    builder.hours = '0';
    builder.day_of_week = [];
}

function saveClicked() {
    if (useCustom.value) {
        emit('change', custom.value);
    } else {
        emit(
            'change',
            `${builder.seconds} ${builder.minutes} ${builder.hours} * * ${builder.day_of_week.join(',')}`
        );
    }
}
</script>
<style scoped>
.checkbox-container {
    display: flex;
    justify-content: flex-start;
    flex-wrap: wrap;
    margin-top: 10px;
    gap: 1.5rem;
}

.checkbox-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 15px;
    width: 40px;
}

.checkbox-item > input {
    width: 18px;
    height: 18px;
}

input:invalid {
    border-color: red;
}

input:invalid::after {
    content: attr(title);
    color: red;
    font-size: var(--text-xs);
    display: block;
}
</style>
