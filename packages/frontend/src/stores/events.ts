import { defineStore } from 'pinia';
import { event_t } from "../interfaces";
const MAX_ENTRIES = 20;
import * as http from '@/tools/http';

export const useEventStore = defineStore('events', {
    state: () => {
        return {
            events: [] as event_t[],
            page: 1,
            total: 0,
            perPage: 25
        }
    },
    actions: {
        addData(entry: {shellyID:string, method:string, message:object, timestamp:number}) {
            let {shellyID, method, message, timestamp} = entry;

            let eventObj:event_t = {
                timestamp,
                shellyID,
                method,
                data:message
            };

            if(this.page == 1){
                this.events.unshift(eventObj);
                if (this.events.length > MAX_ENTRIES) {
                    this.events.length = MAX_ENTRIES;
                }
            }
        },
        async changePage(page: number){
            this.page = page;
            const { count, events } = await http.getEvents({page});
            this.events = events;
            this.total = count;
        },
        async change({ shellyID, method, page, perPage }: { shellyID?: string, method?: string, page?: number, perPage?: number }){
            if(page != undefined){
                this.page = page;
            }
            if(perPage != undefined){
                this.perPage = perPage;
            }
            const { count, events } = await http.getEvents({ shellyID, method, page, perPage });
            this.events = events;
            this.total = count;
        }
    },
    getters: {
        pages(state){
            return Math.ceil(state.total / state.perPage);
        }
    }
})