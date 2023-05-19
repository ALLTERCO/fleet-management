<script setup lang="ts">
import { reactive, ref } from 'vue';

const emit = defineEmits<{
    (e: 'change', cron: string): void
}>();

const useCustom = ref(false);

const custom = ref("");
const builder = reactive({
    seconds: "0",
    minutes: "0",
    hours: "0",
    day_of_week: []
})

function resetClicked() {
    useCustom.value = false;
    custom.value = "";
    builder.seconds = "0";
    builder.minutes = "0";
    builder.hours = "0";
    builder.day_of_week = [];
}

function saveClicked() {
    if (useCustom.value) {
        emit('change', custom.value);
    } else {
        emit('change', `${builder.seconds} ${builder.minutes} ${builder.hours} * * ${builder.day_of_week.join(',')}`)
    }
}

</script>
<template>
    <div>
        <div class="buttons has-addons">
            <button class="button has-text-white" :class="{ 'is-selected': !useCustom, 'is-primary': !useCustom }"
                @click="useCustom = false" @keyup.enter="useCustom = false">Builder</button>
            <button class="button has-text-white" :class="{ 'is-selected': useCustom, 'is-primary': useCustom }"
                @click="useCustom = true" @keyup.enter="useCustom = true">Custom</button>
        </div>
        <div class="custom" v-if="useCustom">
            <div class="field">
                <label class="label">Cron </label>
                <div class="control">
                    <input class="input" type="text" name="cron" v-model="custom">
                </div>
                <p class="help">Read more about the format <a href="https://github.com/mongoose-os-libs/cron"
                        target="_blank">here</a></p>
            </div>
        </div>
        <div class="builder" v-if="!useCustom">
            <div class="field">
                <label class="label" id="secondsLabel">Seconds</label>
                <div class="control">
                    <input class="input" type="number" name="seconds" min="0" max="59" placeholder="Seconds (0-59)" required
                        v-model="builder.seconds" aria-labelledby="secondsLabel" />
                </div>
            </div>

            <div class="field">
                <label class="label" id="minutesLabel">Minutes</label>
                <div class="control">
                    <input class="input" type="number" name="minutes" min="0" max="59" placeholder="Minutes (0-59)" required
                        v-model="builder.minutes" aria-labelledby="minutesLabel" />
                </div>
            </div>

            <div class="field">
                <label class="label" id="hoursLabel">Hours</label>
                <div class="control">
                    <input class="input" type="number" name="hours" min="0" max="23" placeholder="Hours (0-23)" required
                        v-model="builder.hours" aria-labelledby="hoursLabel" />
                </div>
            </div>

            <div class="field">
                <label class="label">Day of the Week</label>
                <div class="checkbox-container">
                    <div class="checkbox-item">
                        <input type="checkbox" name="Sun" value="SUN" id="sun" v-model="builder.day_of_week" />
                        <label for="sun">Sun</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" name="Mon" value="MON" id="mon" v-model="builder.day_of_week" />
                        <label for="mon">Mon</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" name="Tue" value="TUE" id="tue" v-model="builder.day_of_week" />
                        <label for="tue">Tue</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" name="Wed" value="WED" id="wed" v-model="builder.day_of_week" />
                        <label for="wed">Wed</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" name="Thu" value="THU" id="thu" v-model="builder.day_of_week" />
                        <label for="thu">Thu</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" name="Fri" value="FRI" id="fri" v-model="builder.day_of_week" />
                        <label for="fri">Fri</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" name="Sat" value="SAT" id="sat" v-model="builder.day_of_week" />
                        <label for="sat">Sat</label>
                    </div>
                </div>
            </div>

        </div>
        <div class="field is-grouped mt-4">
            <div class="control">
                <button class="button is-primary" type="submit" @click="saveClicked">Save</button>
            </div>
            <div class="control">
                <button class="button is-light" type="reset" @click="resetClicked">Reset</button>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
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

    input {
        width: 18px;
        height: 18px;
    }
}

input:invalid {
    border-color: red;
}

input:invalid::after {
    content: attr(title);
    color: red;
    font-size: 0.8rem;
    display: block;
}
</style>
