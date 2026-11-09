import {AudioHandler} from "jsbeeb/src/web/audio-handler";
import {DefaultAudioOutput} from "jsbeeb/src/audio-output";
import {failureText} from "./sound";

/**
 * jsbeeb's audio handler, without its page: the "audio is suspended" banner it manages goes to a node that is
 * never shown, as Sound tells the user what is going on instead.
 */
export class OwletAudio extends AudioHandler {
    constructor(options) {
        super({
            warningNode: document.createElement("div"),
            noSeek: true,
            audioOutput: DefaultAudioOutput,
            speakerAmount: 1,
            ...options,
        });
        this.listening = false;
    }

    // The chip reports its progress about 500 times a second, and the audio thread does not drain what it is sent
    // while the context is suspended, so while nobody is listening the events are dropped instead.
    flushChipEvents() {
        if (this.listening) super.flushChipEvents();
        else this._chipEvents = [];
    }

    startListening() {
        // What was dropped included the chip's registers, so send them all now.
        this._chipEvents = [
            {
                cycle: this.soundChip.scheduler.epoch,
                kind: "state",
                value: this.soundChip.snapshotState(),
            },
        ];
        this.listening = true;
    }

    stopListening() {
        this.listening = false;
        this._chipEvents = [];
    }

    // What ties the chip to a CPU's scheduler, so that a CPU which fails to build can give it back to the one
    // that is still running: that one's own tasks go on using these.
    bindings() {
        const {scheduler, lastRunEpoch, activeTask, progressTask} = this.soundChip;
        return {scheduler, lastRunEpoch, activeTask, progressTask};
    }

    restoreBindings(bindings) {
        Object.assign(this.soundChip, bindings);
    }

    suspend() {
        this.audioContext?.suspend().catch(() => {});
    }

    get failure() {
        return failureText(this.warningNode.textContent, !!this.audioContext);
    }
}
