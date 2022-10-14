<template>
    <div class="chart" v-if="chartData">
        <Line :chart-data="chartData" :chart-options="options" :height="200" />
    </div>
</template>

<script lang="ts">
import { defineComponent, toRef, ref, watch } from "vue";
import { Line } from 'vue-chartjs';

import {
    Chart as ChartJS,
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
} from 'chart.js'

ChartJS.register(
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale
)

export default defineComponent({
    props: {
        data: {
            type: Object,
            required: true
        },
        locale: {
            type: Object,
            required: false,
            default: { hour: '2-digit', minute: '2-digit' }
        },
        type: {
            type: String,
            required: true,
            default: 'Hourly'
        }
    },
    components: { Line },
    setup(props) {
        const data = toRef(props, 'data');
        const locale = toRef(props, 'locale');

        const chartData = ref(undefined as any);

        watch(data, (newData) => {
            if (Array.isArray(newData)) {
                chartData.value = {
                    labels: newData.map(x => {
                        const date = new Date(x[0] * 1000);
                        return date.toLocaleString(undefined, locale.value);
                    }),
                    datasets: [{
                        data: newData.map(x => Number(x[1]).toFixed(3)),
                        fill: true,
                        borderColor: 'rgba(42, 207, 108, 1)',
                        color: 'rgba(42, 207, 108, 1)',
                        tension: 0.01,
                        stepped: 'middle'
                    }]
                }
            }
        });

        const options = {
            scales: {
                y: {
                    beginAtZero: true,
                    color: 'rgb(255,255,255)',
                    grid: {
                        color: 'rgb(128,128,128)'
                    },
                    precision: 0
                },
                x: {
                    grid: {
                        display: false,
                    }
                },
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: (data: any) => {
                            return data.parsed.y + ' wh'
                        },
                        title: (data:any) => {
                            return data[0].label
                        } 
                    }
                }
            },

        }

        return {
            chartData,
            options
        }
    }
})
</script>