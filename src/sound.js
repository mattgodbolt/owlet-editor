const Gestures = ["pointerdown", "keydown"];
const ResumeTimeoutMs = 1000;
const OffValues = new Set(["0", "false", "no", "off"]);

/** Whether a URL's query string (`?sound`, `?sound=1`) asks for sound, which still takes a click to start. */
export function soundRequested(search) {
    const value = new URLSearchParams(search).get("sound");
    return value !== null && !OffValues.has(value.toLowerCase());
}

/**
 * Whether the machine is heard. It is off until switched on, and is not remembered: browsers only let a page make
 * sound after a click or key press, so `enable` has to be called from one.
 *
 * state is "off", "armed" (a link asked for sound, so the next click or key press turns it on), "on", or
 * "unavailable" (the browser would not start audio; `failure` says why).
 */
export class Sound {
    constructor(audio, onChange = () => {}) {
        this.audio = audio;
        this.onChange = onChange;
        this.state = "off";
        this.failure = null;
        this.running = false;
        this.stopArming = null;
        this.apply();
    }

    get isOn() {
        return this.state === "on";
    }

    /** Turns sound on at the next click or key press, for a link that asked for it. */
    arm(target = window) {
        if (this.isOn) return;
        this.stopArming?.();
        const turnOn = () => this.enable();
        for (const gesture of Gestures) target.addEventListener(gesture, turnOn, true);
        this.stopArming = () => {
            for (const gesture of Gestures) target.removeEventListener(gesture, turnOn, true);
            this.stopArming = null;
        };
        this.setState("armed");
    }

    /** Call this straight from a click or key press. */
    async enable() {
        if (this.state === "on") return;
        const wasArmed = this.state === "armed";
        this.stopArming?.();
        // resume() waits for a gesture the browser accepts rather than failing, so do not wait for it for long.
        await Promise.race([
            Promise.all([this.audio.tryResume(), this.audio.ready]),
            new Promise(resolve => setTimeout(resolve, ResumeTimeoutMs)),
        ]);
        const {audioContext, noAudio} = this.audio;
        if (!noAudio && audioContext?.state === "running") {
            this.audio.startListening();
            this.failure = null;
            this.setState("on");
        } else if (wasArmed && !noAudio) {
            // That was not a gesture the browser counts, such as Escape, so wait for the next.
            this.arm();
        } else {
            this.failure = this.audio.failure;
            this.setState("unavailable");
        }
    }

    disable() {
        this.stopArming?.();
        this.audio.stopListening();
        this.failure = null;
        this.setState("off");
    }

    /** Whether the machine is running, as it is only heard while it does. */
    setRunning(running) {
        this.running = running;
        this.apply();
    }

    setState(state) {
        this.state = state;
        this.apply();
        this.onChange(state);
    }

    apply() {
        if (this.isOn && this.running) this.audio.unmute();
        else this.audio.mute();
    }
}
