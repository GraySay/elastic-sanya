class EventBus {
    constructor() {
        this.events = {};
    }

    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }

    off(event, listener) {
        if (this.events[event]) {
            this.events[event] = this.events[event].filter(l => l !== listener);
        }
    }

    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach(listener => listener(data));
        }
    }

    once(event, listener) {
        const self = this;
        function onceListener(data) {
            self.off(event, onceListener);
            listener(data);
        }
        this.on(event, onceListener);
    }
}

export default new EventBus();
