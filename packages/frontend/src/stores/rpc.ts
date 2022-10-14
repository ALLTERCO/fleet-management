import { defineStore } from 'pinia';
import { useDevicesStore } from './devices';
import { useHistoryStore } from './history';
import { sendRPC, saveRpc, getSavedTemplates } from '@/tools/http';
import { rpc_template, response_t } from '@/interfaces';

export const useRpcStore = defineStore('rpc', {
    state: () => {
        return {
            method: "",
            rowData: [] as [string, string][],
            templates: {} as rpc_template,
            selected_group_name: "",
            selected_template_name: "",
            last_responses: [] as response_t[]
        }
    },
    getters: {
        getSelectedGroup(state){
            return state.templates[state.selected_group_name];
        },
        getGroupNames(state){
            return Object.keys(state.templates);
        }
    },
    actions: {
        async send() {
            const deviceStore = useDevicesStore();
            const historyStore = useHistoryStore();
            const selected = deviceStore.getSelected;
            if(selected.length == 0) throw new Error("No device selected");
            this.last_responses.length = 0; // clear last
            const responses = {} as {[key:string]:string}
            
            for await (const device of selected) {
                const response = await sendRPC(device.shellyID, this.method, Object.fromEntries(this.rowData));
                responses[device.shellyID] = response;
                historyStore.add(device.shellyID, {
                    method: this.method,
                    rowData: this.rowData
                }, JSON.stringify(response))
                this.last_responses.push({
                    mac: device.shellyID,
                    response: JSON.stringify(response)
                });

            }
            this.selectTemplate(this.selected_template_name);
            return responses;
        },
        save(name:string){
            return saveRpc(name, this.method, this.rowData);
        },
        async fetchTemplates(){
            this.templates = await getSavedTemplates();
            this.selectGroup(Object.keys(this.templates)[0]);
        },
        selectGroup(groupName: string){
            if(this.getGroupNames.includes(groupName)){
                this.selected_group_name = groupName;
                this.selectTemplate(this.getSelectedGroup[0].name)
            }
        },
        selectTemplate(name: string){
            const template = this.getSelectedGroup.find(templ => templ.name == name);
            if(template){
                this.selected_template_name = template.name;
                this.method = template.method;
                this.rowData = template.rowData;
            }
        }
    }
})