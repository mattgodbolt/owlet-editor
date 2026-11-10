const Gestures = ["pointerdown", "keydown"];
const ResumeTimeoutMs = 1000;
const OffValues = new Set(["0", "false", "no", "off"]);

/** Whether a URL's query string (`?sound`, `?sound=1`) asks for sound, which still takes a click to start. */
export function soundRequested(search) {
    const value = new URLSearchParams(search).get("sound");
    return value !== null && !OffValues.has(value.toLowerCase());
}

/**
 * Why there is no sound, in words for the user, from the `failure` of jsbeeb's audio handler, which is null when
 * the audio is fine but the browser would not let it start.
 */
export function failureText(failure) {
    if (!failure) return "this browser would not start audio";
    if (failure.startsWith("No audio worklet API")) return "sound needs a secure page (https)";
    return failure.charAt(0).toLowerCase() + failure.slice(1);
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
        this.armTarget = window;
        // A gesture this says is for something that turns sound on itself (the button) is left to that.
        this.ignore = () => false;
        this.pending = null;
        this.apply();
        audio.audioContext?.addEventListener?.("statechange", () => this.contextChanged());
    }

    get isOn() {
        return this.state === "on";
    }

    /** Whether trying again could work, which it cannot when the browser has no audio to start. */
    get retryable() {
        return this.state === "unavailable" && !this.audio.noAudio && !!this.audio.audioContext;
    }

    /** Turns sound on at the next click or key press, for a link that asked for it. */
    arm(target = window) {
        if (this.isOn) return;
        this.armTarget = target;
        this.stopArming?.();
        const turnOn = event => {
            if (!this.ignore(event)) this.enable();
        };
        for (const gesture of Gestures) target.addEventListener(gesture, turnOn, true);
        this.stopArming = () => {
            for (const gesture of Gestures) target.removeEventListener(gesture, turnOn, true);
            this.stopArming = null;
        };
        this.setState("armed");
    }

    /** Call this straight from a click or key press. */
    enable() {
        if (this.isOn) return Promise.resolve();
        // The start in flight may be waiting on a gesture the browser did not accept, so this one tries too.
        if (this.pending) this.audio.tryResume();
        if (!this.pending) {
            this.pending = this.start().finally(() => {
                this.pending = null;
            });
        }
        return this.pending;
    }

    async start() {
        const wasArmed = this.state === "armed";
        // resume() waits for a gesture the browser accepts rather than failing, so do not wait for it for long.
        await Promise.race([
            Promise.all([this.audio.tryResume(), this.audio.ready]),
            new Promise(resolve => setTimeout(resolve, ResumeTimeoutMs)),
        ]);
        const {audioContext, noAudio} = this.audio;
        if (!noAudio && audioContext?.state === "running") {
            this.stopArming?.();
            this.failure = null;
            this.setState("on");
        } else if (wasArmed && !noAudio && audioContext) {
            // That was not a gesture the browser counts, such as Escape, so wait for the next.
            this.arm(this.armTarget);
        } else {
            this.stopArming?.();
            this.failure = failureText(this.audio.failure);
            this.setState("unavailable");
        }
    }

    disable() {
        this.stopArming?.();
        this.failure = null;
        this.setState("off");
        this.audio.audioContext?.suspend().catch(() => {});
    }

    /** Whether the machine is running, as it is only heard while it does. */
    setRunning(running) {
        this.running = running;
        this.apply();
    }

    // The browser can stop the audio of its own accord (an interruption on a phone, say), and only a
    // gesture can start it again.
    contextChanged() {
        if (!this.isOn || this.audio.audioContext.state === "running") return;
        this.state = "off";
        this.arm(this.armTarget);
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
