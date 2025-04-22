/**
 * Development-only shim for smoothie.js
 *
 * This file provides mock implementations of SmoothieChart and TimeSeries
 * to avoid issues with module format compatibility in development mode.
 */

// Fake implementations that provide just enough functionality for development
export class SmoothieChart {
    constructor(options = {}) {
        this.options = options;
        this.series = [];
        console.log("Using mock SmoothieChart for development");
    }

    addTimeSeries(series, options = {}) {
        this.series.push({series, options});
    }

    // eslint-disable-next-line no-unused-vars
    streamTo(canvas, delay = 100) {
        // No-op in development
    }

    static timeFormatter(date) {
        const hours = date.getHours().toString().padStart(2, "0");
        const minutes = date.getMinutes().toString().padStart(2, "0");
        const seconds = date.getSeconds().toString().padStart(2, "0");
        return `${hours}:${minutes}:${seconds}`;
    }
}

export class TimeSeries {
    constructor() {
        this.data = [];
    }

    append(time, value) {
        this.data.push({time, value});
    }
}

// Also provide default export for compatibility
export default {
    SmoothieChart,
    TimeSeries,
};
