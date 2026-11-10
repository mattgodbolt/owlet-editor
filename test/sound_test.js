import {describe, expect, it, vi} from "vitest";
import {Sound, failureText, soundRequested} from "../src/sound";

const fakeContext = state =>
    Object.assign(new EventTarget(), {state, suspend: vi.fn(async () => {})});

const fakeAudio = (contextState = "running") => ({
    audioContext: contextState ? fakeContext(contextState) : null,
    noAudio: false,
    ready: Promise.resolve("ok"),
    failure: "no worklet",
    tryResume: vi.fn(async () => {}),
    mute: vi.fn(),
    unmute: vi.fn(),
});

describe("Sound links", () => {
    it.each([
        ["", false],
        ["?t=1234", false],
        ["?sound", true],
        ["?sound=", true],
        ["?sound=1", true],
        ["?sound=true", true],
        ["?sound=0", false],
        ["?sound=OFF", false],
        ["?x=1&sound", true],
    ])("should read %j as sound %s", (search, requested) => {
        expect(soundRequested(search)).toBe(requested);
    });
});

describe("Sound failures", () => {
    it.each([
        [
            "a page with no audio worklet API",
            "No audio worklet API was found",
            "sound needs a secure page (https)",
        ],
        [
            "an audio system that would not start",
            "The audio system could not be started (Blocked by an extension)",
            "the audio system could not be started (Blocked by an extension)",
        ],
        ["no Web Audio at all", "This browser has no Web Audio", "this browser has no Web Audio"],
        ["a browser that would not let it start", null, "this browser would not start audio"],
    ])("should explain %s", (_name, failure, expected) => {
        expect(failureText(failure)).toBe(expected);
    });
});

describe("Sound", () => {
    it("should start off, and silent", () => {
        const audio = fakeAudio();
        const sound = new Sound(audio);
        expect(sound.state).toBe("off");
        expect(audio.mute).toHaveBeenCalled();
        expect(audio.unmute).not.toHaveBeenCalled();
    });

    it("should be heard only while on and running", async () => {
        const audio = fakeAudio();
        const sound = new Sound(audio);
        sound.setRunning(true);
        expect(audio.unmute).not.toHaveBeenCalled();
        await sound.enable();
        expect(sound.state).toBe("on");
        expect(audio.unmute).toHaveBeenCalled();
        audio.mute.mockClear();
        sound.setRunning(false);
        expect(audio.mute).toHaveBeenCalled();
        audio.unmute.mockClear();
        sound.setRunning(true);
        expect(audio.unmute).toHaveBeenCalled();
    });

    it("should stay quiet when turned on while paused", async () => {
        const audio = fakeAudio();
        const sound = new Sound(audio);
        await sound.enable();
        expect(sound.state).toBe("on");
        expect(audio.unmute).not.toHaveBeenCalled();
    });

    it("should turn off", async () => {
        const audio = fakeAudio();
        const sound = new Sound(audio);
        sound.setRunning(true);
        await sound.enable();
        audio.mute.mockClear();
        sound.disable();
        expect(sound.state).toBe("off");
        expect(audio.mute).toHaveBeenCalled();
    });

    it("should suspend the audio when turned off, so that nothing runs for nothing", async () => {
        const audio = fakeAudio();
        const sound = new Sound(audio);
        await sound.enable();
        expect(audio.audioContext.suspend).not.toHaveBeenCalled();
        sound.disable();
        expect(audio.audioContext.suspend).toHaveBeenCalled();
    });

    it("should start only once however many times it is asked while starting", async () => {
        const audio = fakeAudio();
        const onChange = vi.fn();
        const sound = new Sound(audio, onChange);
        await Promise.all([sound.enable(), sound.enable()]);
        expect(onChange.mock.calls).toEqual([["on"]]);
        expect(audio.tryResume).toHaveBeenCalledTimes(2);
    });

    describe("when the browser stops the audio of its own accord", () => {
        it("should say so, and turn on again at the next gesture", async () => {
            const audio = fakeAudio();
            const sound = new Sound(audio);
            sound.setRunning(true);
            await sound.enable();

            audio.audioContext.state = "interrupted";
            audio.audioContext.dispatchEvent(new Event("statechange"));
            expect(sound.state).toBe("armed");

            audio.audioContext.state = "running";
            window.dispatchEvent(new Event("pointerdown"));
            await vi.waitFor(() => expect(sound.state).toBe("on"));
            sound.disable();
        });

        it("should go on leaving a click on the button to the button", async () => {
            const audio = fakeAudio();
            const sound = new Sound(audio);
            const button = document.body.appendChild(document.createElement("button"));
            sound.ignore = event => event.target === button;
            await sound.enable();

            audio.audioContext.state = "interrupted";
            audio.audioContext.dispatchEvent(new Event("statechange"));
            audio.tryResume.mockClear();
            button.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            await Promise.resolve();

            expect(sound.state).toBe("armed");
            expect(audio.tryResume).not.toHaveBeenCalled();
            sound.disable();
            button.remove();
        });

        it("should stop audio that starts when nobody asked for it", () => {
            const audio = fakeAudio("suspended");
            const sound = new Sound(audio);

            audio.audioContext.state = "running";
            audio.audioContext.dispatchEvent(new Event("statechange"));

            expect(audio.audioContext.suspend).toHaveBeenCalled();
            expect(sound.state).toBe("off");
        });

        it("should not stop audio that is starting because it was asked for", async () => {
            const audio = fakeAudio("suspended");
            audio.tryResume = vi.fn(async () => {
                audio.audioContext.state = "running";
                audio.audioContext.dispatchEvent(new Event("statechange"));
            });
            const sound = new Sound(audio);

            await sound.enable();

            expect(sound.state).toBe("on");
            expect(audio.audioContext.suspend).not.toHaveBeenCalled();
        });

        it("should turn on at once, when a link asked for sound, if the browser lets the audio start", async () => {
            const audio = fakeAudio("suspended");
            const sound = new Sound(audio);
            sound.arm(window);

            audio.audioContext.state = "running";
            audio.audioContext.dispatchEvent(new Event("statechange"));

            await vi.waitFor(() => expect(sound.state).toBe("on"));
            expect(audio.audioContext.suspend).not.toHaveBeenCalled();
            sound.disable();
        });

        it("should stop audio that starts after the wait for it was given up", async () => {
            vi.useFakeTimers();
            const audio = fakeAudio("suspended");
            audio.tryResume = vi.fn(() => new Promise(() => {}));
            const sound = new Sound(audio);
            const enabled = sound.enable();
            await vi.advanceTimersByTimeAsync(2000);
            await enabled;
            expect(sound.state).toBe("unavailable");

            audio.audioContext.state = "running";
            audio.audioContext.dispatchEvent(new Event("statechange"));

            expect(audio.audioContext.suspend).toHaveBeenCalled();
            expect(sound.state).toBe("unavailable");
            vi.useRealTimers();
        });

        it("should not mind the audio being suspended by turning it off", async () => {
            const audio = fakeAudio();
            const sound = new Sound(audio);
            await sound.enable();
            sound.disable();
            audio.audioContext.state = "suspended";
            audio.audioContext.dispatchEvent(new Event("statechange"));
            expect(sound.state).toBe("off");
        });
    });

    it("should say when the browser will not start audio", async () => {
        vi.useFakeTimers();
        const sound = new Sound(fakeAudio("suspended"));
        const enabled = sound.enable();
        await vi.advanceTimersByTimeAsync(2000);
        await enabled;
        expect(sound.state).toBe("unavailable");
        expect(sound.failure).toBe("no worklet");
        expect(sound.retryable).toBe(true);
        vi.useRealTimers();
    });

    it("should tell its owner each time it changes", async () => {
        const onChange = vi.fn();
        const sound = new Sound(fakeAudio(), onChange);
        await sound.enable();
        sound.disable();
        expect(onChange.mock.calls.map(([state]) => state)).toEqual(["on", "off"]);
    });

    describe("when the browser hands over a context that is already running", () => {
        it("should stop it when nobody asked for sound", () => {
            const audio = fakeAudio("running");
            const sound = new Sound(audio);

            sound.reconcile();

            expect(audio.audioContext.suspend).toHaveBeenCalled();
            expect(sound.state).toBe("off");
        });

        it("should turn sound on at once when a link asked for it", async () => {
            const audio = fakeAudio("running");
            const sound = new Sound(audio);
            sound.arm(window);

            sound.reconcile();

            await vi.waitFor(() => expect(sound.state).toBe("on"));
            expect(audio.audioContext.suspend).not.toHaveBeenCalled();
            sound.disable();
        });

        it("should leave a context that is not running alone", () => {
            const audio = fakeAudio("suspended");
            const sound = new Sound(audio);

            sound.reconcile();

            expect(audio.audioContext.suspend).not.toHaveBeenCalled();
            expect(sound.state).toBe("off");
        });
    });

    describe("when there is no audio at all", () => {
        it("should have nothing to reconcile", () => {
            const sound = new Sound(fakeAudio(null));
            expect(() => sound.reconcile()).not.toThrow();
            expect(sound.state).toBe("off");
        });

        it("should say so rather than wait for a gesture that cannot help", async () => {
            const sound = new Sound(fakeAudio(null));
            sound.arm(window);
            window.dispatchEvent(new Event("pointerdown"));
            await vi.waitFor(() => expect(sound.state).toBe("unavailable"));
            expect(sound.retryable).toBe(false);
        });
    });

    describe("armed by a link", () => {
        it("should leave a gesture to whatever turns sound on itself", async () => {
            const audio = fakeAudio();
            const sound = new Sound(audio);
            const button = document.body.appendChild(document.createElement("button"));
            sound.ignore = event => event.target === button;
            sound.arm(window);

            button.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            await Promise.resolve();
            expect(sound.state).toBe("armed");
            expect(audio.tryResume).not.toHaveBeenCalled();

            document.body.dispatchEvent(new Event("pointerdown", {bubbles: true}));
            await vi.waitFor(() => expect(sound.state).toBe("on"));
            button.remove();
        });

        it("should turn on at the first click, and only listen once", async () => {
            const audio = fakeAudio();
            const sound = new Sound(audio);
            sound.arm(window);
            expect(sound.state).toBe("armed");
            window.dispatchEvent(new Event("pointerdown"));
            await vi.waitFor(() => expect(sound.state).toBe("on"));
            expect(audio.tryResume).toHaveBeenCalledTimes(1);
            window.dispatchEvent(new Event("keydown"));
            expect(audio.tryResume).toHaveBeenCalledTimes(1);
        });

        it("should turn on at the first key press", async () => {
            const sound = new Sound(fakeAudio());
            sound.arm(window);
            window.dispatchEvent(new Event("keydown"));
            await vi.waitFor(() => expect(sound.state).toBe("on"));
        });

        it("should wait for another gesture if the browser did not count the first", async () => {
            vi.useFakeTimers();
            const audio = fakeAudio("suspended");
            const sound = new Sound(audio);
            sound.arm(window);
            window.dispatchEvent(new Event("keydown"));
            await vi.advanceTimersByTimeAsync(2000);
            expect(sound.state).toBe("armed");
            audio.audioContext.state = "running";
            window.dispatchEvent(new Event("pointerdown"));
            await vi.advanceTimersByTimeAsync(10);
            expect(sound.state).toBe("on");
            vi.useRealTimers();
        });

        it("should use a gesture that arrives while an earlier one is still being waited on", async () => {
            const audio = fakeAudio("suspended");
            let firstResume;
            audio.tryResume = vi.fn(() => {
                if (audio.tryResume.mock.calls.length === 1)
                    return new Promise(resolve => (firstResume = resolve));
                audio.audioContext.state = "running";
                firstResume();
                return Promise.resolve();
            });
            const sound = new Sound(audio);
            sound.arm(window);

            window.dispatchEvent(new Event("keydown"));
            window.dispatchEvent(new Event("pointerdown"));

            await vi.waitFor(() => expect(sound.state).toBe("on"));
            expect(audio.tryResume).toHaveBeenCalledTimes(2);
        });

        it("should not listen any more once switched off", () => {
            const audio = fakeAudio();
            const sound = new Sound(audio);
            sound.arm(window);
            sound.disable();
            window.dispatchEvent(new Event("pointerdown"));
            expect(audio.tryResume).not.toHaveBeenCalled();
            expect(sound.state).toBe("off");
        });
    });
});
