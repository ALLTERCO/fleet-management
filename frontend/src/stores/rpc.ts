import { defineStore } from 'pinia';
import { useDevicesStore } from './devices';
import { getSavedTemplates } from '../tools/websocket';
import { sendRPC } from '../tools/websocket';
import { reactive, ref, Ref } from 'vue';
import { useToastStore } from './toast';

type device_response = { mac: string, response: string }

export const useRpcStore = defineStore('rpc', () => {
    const builder = reactive({
        method: '',
        rows: [] as [string, string][]
    })
    const selected = reactive({
        group: "",
        template: ""
    })
    const lastResponses: Ref<device_response[]> = ref([]);
    const templates: Ref<Record<string, any>> = ref({});

    const toastStore = useToastStore()

    function getSelectedGroup() {
        return templates.value[selected.group]
    }

    function getGroupNames() {
        return Object.keys(templates.value);
    }

    async function sendBuilder(cron?: string) {
        const deviceStore = useDevicesStore();
        const selectedDevices = deviceStore.getSelected();
        if (selectedDevices.length == 0) throw new Error("No device selected");
        lastResponses.value.length = 0; // clear last
        const responses: Record<string, string> = {}

        const method = builder.method;
        const params = Object.fromEntries(builder.rows);

        for (const device of selectedDevices) {
            sendRPC(device.shellyID, method, params).then(response => {
                responses[device.shellyID] = response;
                lastResponses.value.push({
                    mac: device.shellyID,
                    response: JSON.stringify(response)
                });
            }, (err) => console.error("error in rpc", err));

            if (cron !== undefined) {
                sendRPC(device.shellyID, 'Schedule.Create', {
                    enable: true,
                    timespec: cron,
                    calls: [{ method, params }]
                }).then((resp) => {
                    toastStore.addToast(JSON.stringify(resp), 'success')
                }, err => {
                    toastStore.addToast(JSON.stringify(err), 'danger')
                })
            }
        }

        selectTemplate(selected.template);
        return responses;
    }

    async function fetchTemplates() {
        templates.value = await getSavedTemplates();
        selectGroup(Object.keys(templates.value)[0]);
    }

    function selectGroup(groupName: string) {
        if (getGroupNames().includes(groupName)) {
            selected.group = groupName;
            selectTemplate(getSelectedGroup()[0].name);
        }
    }

    function selectTemplate(name: string) {
        const template = getSelectedGroup().find((templ: any) => templ.name == name);
        if (template) {
            selected.template = template.name;
            builder.method = template.method;
            builder.rows = template.rowData;
        }
    }

    return {
        builder, selected, lastResponses, getSelectedGroup, getGroupNames,
        send: sendBuilder, fetchTemplates, selectGroup, selectTemplate
    }
});