import EventEmitter from "events";

interface Item {
    value: Promise<any>,
    priority: number,
    timeout: number,
    callback: (elem?:any, error?: Error) => void
}

async function addTimeout<T>(promise: Promise<T>, timeout: number) {
    return new Promise<T>((resolve, reject) => {
        promise.then(resolve).catch(reject);
        setTimeout(reject, timeout);
    })
}

export default class PriorityQueue {
    private items: Item[] = [];
    private started = false;
    private eventEmitter: EventEmitter;

    static DEQUEUE = "dequeue";
    static STOP = "stop";
    static START = "start";

    constructor(){
        this.eventEmitter = new EventEmitter();
    }
    
    on(eventName: string | symbol, listener: (...args: any[]) => void){
        console.log("added listener")
        this.eventEmitter.on(eventName, listener);
    }

    enqueue(item: any, params?: {timeout?: number, callback?: (...args:any[]) => void, priority?: number}){
        const timeout = params?.timeout || 5000;
        const callback = params?.callback || function(){}
        const priority = params?.priority || 1;
        this.items.push({
            value: item instanceof Promise ? item : Promise.resolve(item),
            timeout,
            callback,
            priority
        });
        this.start();
    }

    private size(){
        return this.items.length;
    }

    private hasNext(){
        return this.size() > 0;
    }
    
    private async dequeue() {
        if(!this.hasNext()) return;

        let index = 0;
        for(let i = 1; i < this.items.length; i++){
            if(this.items[i].priority > this.items[index].priority){
                index = i;
            }
        }
        const item = this.items[index]!;
        this.items.splice(index, 1);
        let value = undefined, error = undefined;

        try {
            value = await addTimeout(item.value, item.timeout);
        } catch (err) {
            error = err;
        }
        this.eventEmitter.emit(PriorityQueue.DEQUEUE, value, error);
        item.callback(value, error);
    }

    public async start(){
        if(this.started) return;
        this.started = true;
        this.eventEmitter.emit(PriorityQueue.START);
        while(this.started && this.hasNext()){
            await this.dequeue()
        }
        this.stop();
    }

    stop(){
        this.started = false;
        this.eventEmitter.emit(PriorityQueue.STOP);
    }
}

