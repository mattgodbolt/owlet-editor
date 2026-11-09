import {describe, expect, it, vi} from "vitest";
import {Sound, soundRequested} from "../src/sound";

const fakeAudio = (contextState = "running") => ({
    audioContext: {state: contextState},
    noAudio: false,
    ready: Promise.resolve("ok"),
    failure: "no worklet",
    tryResume: vi.fn(async () => {}),
    startListening: vi.fn(),
    stopListening: vi.fn(),
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
        expect(audio.startListening).toHaveBeenCalled();
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
        expect(audio.stopListening).toHaveBeenCalled();
        expect(audio.mute).toHaveBeenCalled();
    });

    it("should say when the browser will not start audio", async () => {
        vi.useFakeTimers();
        const sound = new Sound(fakeAudio("suspended"));
        const enabled = sound.enable();
        await vi.advanceTimersByTimeAsync(2000);
        await enabled;
        expect(sound.state).toBe("unavailable");
        expect(sound.failure).toBe("no worklet");
        vi.useRealTimers();
    });

    it("should tell its owner each time it changes", async () => {
        const onChange = vi.fn();
        const sound = new Sound(fakeAudio(), onChange);
        await sound.enable();
        sound.disable();
        expect(onChange.mock.calls.map(([state]) => state)).toEqual(["on", "off"]);
    });

    describe("armed by a link", () => {
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
