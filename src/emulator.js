import _ from "underscore";
import * as canvasLib from "jsbeeb/src/web/canvas";
import {PassthroughFilter} from "jsbeeb/src/video-filters/passthrough-filter";
import {Keyboard} from "jsbeeb/src/web/keyboard";
import {keyCodes} from "jsbeeb/src/keymap";
import {Video} from "jsbeeb/src/video";
import * as models from "jsbeeb/src/models";
import {machineSpec, nullIo} from "jsbeeb/src/machine-spec";
import Promise from "promise";
import ResizeObserver from "resize-observer-polyfill";
import Snapshot from "./snapshot";
import {setTotalCycles, totalCycles} from "./cycles";
import {OwletAudio} from "./owlet-audio";
import {Sound} from "./sound";

const BotStartCycles = 725000; // bbcmicrobot start time
const MaxSecondsPerFrame = 0.1;
const urlParams = new URLSearchParams(window.location.search);

let modelName = "BBC Micro Model B";
let beebjitIncoming = false;
const Model = models.findModel("B");

// jsbeeb maps the keypad's Enter to the Master's keypad key, which a Model B lacks; Owlet has always made it Return.
function keypadEnterAsReturn(event) {
    if (event.code !== "NumpadEnter") return event;
    return new Proxy(event, {
        get: (target, property) => {
            if (property === "code") return keyCodes.ENTER;
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

class ScreenResizer {
    constructor(screen) {
        this.screen = screen;
        const origHeight = screen.height();
        const origWidth = screen.width();
        this.desiredAspectRatio = origWidth / origHeight;
        this.minHeight = origHeight / 4;
        this.minWidth = origWidth / 4;
        this.observer = new ResizeObserver(() => this.resizeScreen());
        this.observer.observe(this.screen.parent()[0]);
        this.resizeScreen();
    }

    resizeScreen() {
        const InnerBorder = 0;
        let width = Math.max(this.minWidth, this.screen.parent().innerWidth() - InnerBorder);
        let height = Math.max(this.minHeight, this.screen.parent().innerHeight() - InnerBorder);
        if (width / height <= this.desiredAspectRatio) {
            height = width / this.desiredAspectRatio;
        } else {
            width = height * this.desiredAspectRatio;
        }
        this.screen.height(height).width(width);
    }
}

export class Emulator {
    constructor(root) {
        this.root = root;
        const screen = this.root.find(".screen");
        this.canvas = canvasLib.bestCanvas(screen[0], PassthroughFilter);
        this.emuStatus = document.getElementById("emu_status");
        this.frames = 0;
        this.frameSkip = 0;
        this.resizer = new ScreenResizer(screen);
        this.leftMargin = 115;
        this.rightMargin = 130;
        this.topMargin = 45;
        this.bottomMargin = 30;
        this.loopEnabled = true;
        this.loopStart = 60680000;
        this.loopLength = 6000000 + 320000;
        this.state = null;
        this.snapshot = new Snapshot();
        this.loop = !!urlParams.get("loop");
        this.showCoords = false; // coordinate display mode

        window.theEmulator = this;
        const emulator = this;

        this.video = new Video(
            Model.isMaster,
            this.canvas.fb32.length,
            // jsbeeb's video chip paints into a framebuffer of its own, so copy it over to the canvas's.
            function (minx, miny, maxx, maxy) {
                emulator.paint(this, minx, miny, maxx, maxy);
            },
        );

        this.audio = new OwletAudio({
            cpuSpeed: Model.cyclesPerSecond,
            isAtom: false,
            hasMusic5000: false,
        });
        this.sound = new Sound(this.audio);
        this.useGxr = false;
        this.cpu = null;
        this.keyboard = null;

        screen.mousemove(event => this.mouseMove(event));
        screen.mouseleave(() => this.mouseLeave());
        screen.keyup(event => this.keyUp(event.originalEvent));
        screen.keydown(event => this.keyDown(event.originalEvent));
        screen.blur(() => this.clearKeys());
        setInterval(this.timer.bind(this), 1000);
        this.lastFrameTime = 0;
        this.onAnimFrame = _.bind(this.frameFunc, this);
        this.ready = false;
        this.rebuilding = false;
    }

    buildCpu() {
        return new Model.Cpu(Model, {
            ...nullIo({
                video: this.video,
                soundChip: this.audio.soundChip,
                model: Model,
            }),
            ddNoise: this.audio.ddNoise,
            config: machineSpec({
                keyLayout: "natural",
                extraRoms: this.useGxr ? ["gxr.rom"] : [],
            }),
        });
    }

    async initialise() {
        // The ROMs a machine is fitted with are fixed when it is built, so each initialise builds afresh.
        // The new CPU is only swapped in once it is loaded and reset, so a frame never runs a half-built one.
        // Building it hands the one sound chip to its scheduler, so the old CPU must not run in the meantime.
        this.rebuilding = true;
        try {
            const cpu = this.buildCpu();
            await Promise.all([cpu.initialise(), this.audio.ddNoise.initialise()]);
            this.clearKeys();
            this.cpu = cpu;
            this.keyboard = new Keyboard({
                processor: cpu,
                inputEnabledFunction: () => false,
                runningFunction: () => this.running,
                keyLayout: "natural",
            });
            this.ready = true;
        } finally {
            this.rebuilding = false;
        }
    }

    gxr() {
        this.useGxr = true;
        modelName = "BBC Micro Model B | GXR";
    }

    hasGxr() {
        return modelName.indexOf("GXR") >= 0;
    }

    get cyclesPerSecond() {
        return this.cpu.model.cyclesPerSecond;
    }

    get totalCycles() {
        return totalCycles(this.cpu);
    }

    setTotalCycles(cycles) {
        setTotalCycles(this.cpu, cycles);
    }

    timer() {
        if (this.cpu && !beebjitIncoming && !this.showCoords) {
            this.emuStatus.innerHTML = `${modelName} | ${Math.floor(
                this.totalCycles / this.cyclesPerSecond,
            )} s`;
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.sound.setRunning(true);
        requestAnimationFrame(this.onAnimFrame);
    }

    pause() {
        this.running = false;
        this.sound.setRunning(false);
    }

    async beebjit(tokenised) {
        this.pause();

        beebjitIncoming = true;

        function myCounter() {
            this.emuStatus.innerHTML += ".";
            if (this.emuStatus.innerHTML.length > 18) this.emuStatus.innerHTML = "Calling beebjit";
        }

        this.emuStatus.innerHTML = "Calling beebjit";
        const counterInterval = setInterval(myCounter.bind(this), 200);
        const basic = btoa(tokenised).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

        const response = await fetch(
            "https://api.bbcmic.ro/beta?saveAddress=0&saveLength=8000&basic=" + basic,
            {
                headers: {
                    "x-api-key": "YrqLWPW1mvbEIJs1bT0m3DAoTJLKd9xaGEQaI5xa",
                },
            },
        );
        beebjitIncoming = false;
        this.state = await response.json();
        const t0 = performance.now();
        this.snapshot.load(this.state, this.cpu);
        this.loopStart = this.cyclesPerSecond * 60 * 60 * 3; // 3 hours
        this.setTotalCycles(this.loopStart);
        this.loopLength = 6000000 + 320000;

        const t1 = performance.now();
        const t2 = Math.round((t1 - t0) * 1000) / 1000;
        console.log(`State snapshot loaded in ${t2}ms.`);

        this.start();

        clearInterval(counterInterval);
        this.timer();
    }

    async runProgram(tokenised) {
        // A CPU that is being replaced must not run, as the new one has taken the sound chip's scheduler.
        if (!this.ready || this.rebuilding) return;
        this.cpu.reset(true);
        const processor = this.cpu;
        await processor.execute(BotStartCycles); // match bbcmicrobot
        const page = processor.readmem(0x18) << 8;
        for (let i = 0; i < tokenised.length; ++i) {
            processor.writemem(page + i, tokenised.charCodeAt(i));
        }
        // Set VARTOP (0x12/3) and TOP(0x02/3)
        const end = page + tokenised.length;
        const endLow = end & 0xff;
        const endHigh = (end >>> 8) & 0xff;
        processor.writemem(0x02, endLow);
        processor.writemem(0x03, endHigh);
        processor.writemem(0x12, endLow);
        processor.writemem(0x13, endHigh);
        this.writeToKeyboardBuffer("RUN\r");
        this.start();
    }

    writeToKeyboardBuffer(text) {
        const processor = this.cpu;
        const keyboardBuffer = 0x0300; // BBC Micro OS 1.20
        const IBPaddress = 0x02e1; // input buffer pointer
        let inputBufferPointer = processor.readmem(IBPaddress);
        for (let a = 0; a < text.length; a++) {
            processor.writemem(keyboardBuffer + inputBufferPointer, text.charCodeAt(a));
            inputBufferPointer++;
            if (inputBufferPointer > 0xff) {
                inputBufferPointer = 0xe0;
            }
        }
        processor.writemem(IBPaddress, inputBufferPointer);
    }

    frameFunc(now) {
        requestAnimationFrame(this.onAnimFrame);
        // Take snapshot
        if (this.loop && !this.state && this.totalCycles >= this.loopStart) {
            this.pause();
            this.state = this.snapshot.save(this.cpu).state;
            this.start();
            console.log("snapshot taken at " + this.totalCycles + " cycles");
        }

        // Loop back
        if (this.loop && this.state && this.totalCycles >= this.loopStart + this.loopLength) {
            this.pause();
            this.snapshot.load(this.state, this.cpu);
            this.setTotalCycles(this.loopStart);
            this.start();
        }

        if (this.running && !this.rebuilding && this.lastFrameTime !== 0) {
            const sinceLast = now - this.lastFrameTime;
            let cycles = ((sinceLast * this.cyclesPerSecond) / 1000) | 0;
            cycles = Math.min(cycles, this.cyclesPerSecond * MaxSecondsPerFrame);
            try {
                if (!this.cpu.execute(cycles)) {
                    this.pause(); // TODO: breakpoint
                }
            } catch (e) {
                this.pause();
                console.log(`Emulator stopped at PC=${this.cpu.pc.toString(16)}`);
                throw e;
            }
        }
        this.lastFrameTime = now;
    }

    paint(video, minx, miny, maxx, maxy) {
        this.frames++;
        if (this.frames < this.frameSkip) return;
        this.frames = 0;
        this.canvas.fb32.set(video.fb32.subarray(miny * 1024, maxy * 1024), miny * 1024);
        const teletextAdjustX = video.teletextMode ? 15 : 0;
        this.canvas.paint(
            minx + this.leftMargin + teletextAdjustX,
            miny + this.topMargin,
            maxx - this.rightMargin + teletextAdjustX,
            maxy - this.bottomMargin,
            {
                fields: 1,
                lineBaseEven: video.lineBaseEven,
                lineBaseOdd: video.lineBaseOdd,
                phaseBaseEven: video.phaseBaseEven,
                phaseBaseOdd: video.phaseBaseOdd,
                lineGrid: video.lineGrid,
            },
        );
    }

    keyDown(event) {
        if (!this.keyboard) return;
        // A keypad Home, with Num Lock off, is "Numpad7" by code but "Home" by key.
        if (
            this.running &&
            event.ctrlKey &&
            (event.code === keyCodes.HOME || event.key === "Home")
        ) {
            this.pause();
            event.preventDefault();
            return;
        }
        this.keyboard.keyDown(keypadEnterAsReturn(event));
    }

    clearKeys() {
        if (this.keyboard) this.keyboard.clearKeys();
    }

    mouseLeave() {
        this.showCoords = false;
        this.timer();
    }

    mouseMove(event) {
        if (!this.cpu) return;
        this.showCoords = true;
        const processor = this.cpu;
        const screen = this.root.find(".screen");
        let screenMode = processor.readmem(0x0355);
        let W;
        let H;
        let graphicsMode = true;
        switch (screenMode) {
            case 0:
                W = 80;
                H = 32;
                break;
            case 1:
            case 4:
                W = 40;
                H = 32;
                break;
            case 2:
            case 5:
                W = 20;
                H = 32;
                break;
            case 3:
                W = 80;
                H = 25.6;
                graphicsMode = false;
                break;
            case 6:
                W = 40;
                H = 25.6;
                graphicsMode = false;
                break;
            case 7:
                W = 40;
                H = 25.6;
                graphicsMode = false;
                break;
            default:
                // Unknown screen mode!
                return;
        }
        // 8 and 16 here are fudges to allow for a margin around the screen
        // canvas - not sure exactly where that comes from...
        let x = event.offsetX - 8;
        let y = event.offsetY - 8;
        const sw = screen.width() - 16;
        const sh = screen.height() - 16;
        let X = Math.floor((x * W) / sw);
        let Y = Math.floor((y * H) / sh);
        let html = `Text: (${X},${Y})`;
        if (graphicsMode) {
            // Graphics Y increases up the screen.
            y = sh - y;
            x = Math.floor((x * 1280) / sw);
            y = Math.floor((y * 1024) / sh);
            html += ` &nbsp; Graphics: (${x},${y})`;
        }
        this.emuStatus.innerHTML = html;
    }

    keyUp(event) {
        if (this.keyboard) this.keyboard.keyUp(keypadEnterAsReturn(event));
    }

    readmem(address) {
        return this.cpu.readmem(address);
    }
}
