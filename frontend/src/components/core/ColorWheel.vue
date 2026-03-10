<template>
    <div class="flex justify-center">
        <div class="relative">
            <canvas ref="wheel" width="250px" height="250px" @click="onClick" />
            <span
                ref="pointer"
                class="absolute border-4 rounded-full"
                :style="`width: ${pointerSize / 2}px; height: ${pointerSize / 2}px; left: ${pointerX}px; top: ${pointerY}px; background-color: ${pointerColor}; transform: translate(-50%, -50%)`"
                @click="onClick"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref, toRef, watch} from 'vue';

const props = defineProps<{rgb: [number, number, number]}>();
const emit = defineEmits<{
    change: [[number, number, number]];
}>();
const wheel = ref<HTMLCanvasElement | null>(null);
const color = toRef(props, 'rgb');
const pointerX = ref<number>(0);
const pointerY = ref<number>(0);
const pointerSize = 60;

let context: CanvasRenderingContext2D | null = null;
let pointerColor: string;
let radius: number;
let centerX: number;
let centerY: number;

function draw() {
    const canvas = wheel.value;
    if (!canvas) {
        return;
    }

    context = canvas.getContext('2d', {willReadFrequently: true});

    if (!context) {
        return;
    }

    radius = Math.min(canvas.width, canvas.height) / 2;
    centerX = canvas.width / 2;
    centerY = canvas.height / 2;

    for (let angle = 0; angle < 360; angle += 0.02) {
        const rad = (angle * Math.PI) / 180.0;
        const endX = radius * Math.cos(rad);
        const endY = radius * Math.sin(rad);

        context.strokeStyle = `hsl(${angle}deg, 100%, 50%)`;

        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(centerX + endX, centerY + endY);
        context.stroke();
        context.closePath();
    }

    const gradient = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radius
    );
    gradient.addColorStop(0, 'rgb(255, 255, 255)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.closePath();
    context.fill();

    const [r, g, b] = color.value;
    updatePointer(r, g, b);
}

function onClick(event: MouseEvent) {
    const canvas = wheel.value;
    if (!context || !canvas) {
        return;
    }

    const {left, top} = canvas.getBoundingClientRect();

    const x = event.clientX - left;
    const y = event.clientY - top;

    const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

    if (dist > radius) {
        return;
    }

    const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
    emit('change', [red, green, blue]);
    updatePointer(red, green, blue);
}

// https://gist.github.com/mjackson/5311256#file-color-conversion-algorithms-js-L84
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const s = max == 0 ? 0 : d / max;
    let h = 0;

    if (max == min) {
        h = 0; // achromatic
    } else {
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }

        h /= 6;
    }

    return [h, s, max];
}

function updatePointer(red: number, green: number, blue: number) {
    pointerColor = `rgb(${red}, ${green}, ${blue})`;

    const [h, s] = rgbToHsv(red, green, blue);
    const angle = h * Math.PI * 2;
    pointerX.value = radius * s * Math.cos(angle) + centerX;
    pointerY.value = radius * s * Math.sin(angle) + centerY;
}

onMounted(() => {
    draw();
});

watch(color, () => {
    const [r, g, b] = color.value;
    updatePointer(r, g, b);
});
</script>
