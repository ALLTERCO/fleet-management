import { defineStore } from 'pinia';
import { history_t, rpc_req_t } from '@/interfaces';
import * as http from '@/tools/http';

export const useHistoryStore = defineStore('history', {
    state: () => {
        return {
            selectedIndex: 0,
            history: [] as history_t[]
        }
    },
    actions: {
        add(device_mac: string, request: rpc_req_t, response: string){
            this.history.unshift({
                timestamp: Date.now(),
                device_mac,
                request,
                response
            })
        },
        select(index: number){
            if(index > this.history.length - 1) index = this.history.length - 1;
            if(index < 0) index = 0;
            this.selectedIndex = index;
        },
        async fetch(){
            this.history = await http.getHistory();
        },
        getLast(device_mac:string){
            return this.history.find(entry => entry.device_mac === device_mac);
        }
    },
    getters: {
        getAllHistory(state){
            return state.history;
        },
        getSelected(state){
            if(state.history.length == 0){
                return undefined;
            }
            return state.selectedIndex < state.history.length ? state.history[state.selectedIndex] : state.history[0];
        },
    }
})