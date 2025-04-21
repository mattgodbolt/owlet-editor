import _ from "underscore";
import {Cpu6502} from "jsbeeb/src/6502";
import * as canvasLib from "jsbeeb/src/canvas";
import {Video} from "jsbeeb/src/video";
import {Debugger} from "jsbeeb/src/web/debug";
import {FakeSoundChip} from "jsbeeb/src/soundchip";
import {FakeDdNoise} from "jsbeeb/src/ddnoise";
import * as models from "jsbeeb/src/models";
import {Cmos} from "jsbeeb/src/cmos";
import * as utils from "jsbeeb/src/utils";
import Promise from "promise";
import ResizeObserver from "resize-observer-polyfill";
import Snapshot from "./snapshot";

utils.setBaseUrl("/");

const BotStartCycles = 725000; // bbcmicrobot start time
const ClocksPerSecond = (2 * 1000 * 1000) | 0;
const MaxCyclesPerFrame = ClocksPerSecond / 10;
const urlParams = new URLSearchParams(window.location.search);

let modelName = "BBC Micro Model B";
let beebjitIncoming = false;
const Model = models.findModel("B");

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

class Emulator6502 extends Cpu6502 {
    constructor(model, dbgr, video, soundChip, ddNoise, cmos, config) {
        super(
            model,
            dbgr,
            video,
            soundChip,
            ddNoise,
            null, // Music5000
            cmos,
            config,
            null, // econet
        );
    }

    execute(numCyclesToRun) {
        // Patch to stop it resetting cycle count on execute.
        // Number.MAX_SAFE_INTEGER should gives us plenty of headroom
        this.halted = false;
        this.targetCycles += numCyclesToRun;
        return this.executeInternalFast();
    }
}

export class Emulator {
    constructor(root) {
        this.root = root;
        const screen = this.root.find(".screen");
        this.canvas = canvasLib.bestCanvas(screen[0]);
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

        this.video = new Video(Model.isMaster, this.canvas.fb32, _.bind(this.paint, this));

        this.soundChip = new FakeSoundChip();
        this.ddNoise = new FakeDdNoise();

        this.dbgr = new Debugger(this.video);
        const cmos = new Cmos({
            load: function () {
                if (window.localStorage.cmosRam) {
                    return JSON.parse(window.localStorage.cmosRam);
                }
                return null;
            },
            save: function (data) {
                window.localStorage.cmosRam = JSON.stringify(data);
            },
        });
        const config = {
            keyLayout: 'natural',
        };
        this.cpu = new Emulator6502(
            Model,
            this.dbgr,
            this.video,
            this.soundChip,
            this.ddNoise,
            cmos,
            config,
        );

        screen.mousemove(event => this.mouseMove(event));
        screen.mouseleave(() => this.mouseLeave());
        screen.keyup(event => this.keyUp(event));
        screen.keydown(event => this.keyDown(event));
        screen.blur(() => this.clearKeys());
        setInterval(this.timer.bind(this), 1000);
        this.lastFrameTime = 0;
        this.onAnimFrame = _.bind(this.frameFunc, this);
        this.ready = false;

        this.lastShiftLocation = this.lastAltLocation = this.lastCtrlLocation = 0;
    }

    async initialise() {
        await Promise.all([this.cpu.initialise(), this.ddNoise.initialise()]);
        this.ready = true;
    }

    gxr() {
        Model.os.push("gxr.rom");
        modelName += " | GXR";
    }

    hasGxr() {
        return modelName.indexOf("GXR") >= 0;
    }

    timer() {
        if (!beebjitIncoming && !this.showCoords) {
            this.emuStatus.innerHTML = `${modelName} | ${Math.floor(
                this.cpu.currentCycles / 2000000,
            )} s`;
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        requestAnimationFrame(this.onAnimFrame);
    }

    pause() {
        this.running = false;
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
        this.cpu.currentCycles = 2000000 * 60 * 60 * 3; // 3 hours
        this.cpu.targetCycles = 2000000 * 60 * 60 * 3;
        this.loopStart = 2000000 * 60 * 60 * 3;
        this.loopLength = 6000000 + 320000;

        const t1 = performance.now();
        const t2 = Math.round((t1 - t0) * 1000) / 1000;
        console.log(`State snapshot loaded in ${t2}ms.`);

        this.start();

        clearInterval(counterInterval);
        this.timer();
    }

    async runProgram(tokenised) {
        if (!this.ready) return;
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
        if (this.loop && !this.state && this.cpu.currentCycles >= this.loopStart) {
            this.pause();
            this.state = this.snapshot.save(this.cpu).state;
            this.start();
            console.log("snapshot taken at " + this.cpu.currentCycles + " cycles");
        }

        // Loop back
        if (this.loop && this.state && this.cpu.currentCycles >= this.loopStart + this.loopLength) {
            this.pause();
            this.snapshot.load(this.state, this.cpu);
            this.cpu.currentCycles = this.loopStart;
            this.cpu.targetCycles = this.loopStart;
            this.start();
        }

        if (this.running && this.lastFrameTime !== 0) {
            const sinceLast = now - this.lastFrameTime;
            let cycles = ((sinceLast * ClocksPerSecond) / 1000) | 0;
            cycles = Math.min(cycles, MaxCyclesPerFrame);
            try {
                if (!this.cpu.execute(cycles)) {
                    this.running = false; // TODO: breakpoint
                }
            } catch (e) {
                this.running = false;
                this.dbgr.debug(this.cpu.pc);
                throw e;
            }
        }
        this.lastFrameTime = now;
    }

    paint(minx, miny, maxx, maxy) {
        this.frames++;
        if (this.frames < this.frameSkip) return;
        this.frames = 0;
        const teletextAdjustX = this.video && this.video.teletextMode ? 15 : 0;
        this.canvas.paint(
            minx + this.leftMargin + teletextAdjustX,
            miny + this.topMargin,
            maxx - this.rightMargin + teletextAdjustX,
            maxy - this.bottomMargin,
        );
    }

    keyDown(event) {
        if (!this.running) return;

        const code = this.keyCode(event);
        const processor = this.cpu;
        if (code === utils.keyCodes.HOME && event.ctrlKey) {
            this.pause();
        } else if (code === utils.keyCodes.F12 || code === utils.keyCodes.BREAK) {
            processor.setReset(true);
        } else {
            processor.sysvia.keyDown(code, event.shiftKey);
        }
        event.preventDefault();
    }

    clearKeys() {
        const processor = this.cpu;
        if (processor && processor.sysvia) processor.sysvia.clearKeys();
    }

    mouseLeave() {
        this.showCoords = false;
        this.timer();
    }

    mouseMove(event) {
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
        // Always let the key ups come through.
        const code = this.keyCode(event);
        const processor = this.cpu;
        if (processor && processor.sysvia) processor.sysvia.keyUp(code);
        if (!this.running) return;
        if (code === utils.keyCodes.F12 || code === utils.keyCodes.BREAK) {
            processor.setReset(false);
        }
        event.preventDefault();
    }

    keyCode(event) {
        const ret = event.which || event.charCode || event.keyCode;
        const keyCodes = utils.keyCodes;
        switch (event.location) {
            default:
                // keyUp events seem to pass location = 0 (Chrome)
                switch (ret) {
                    case keyCodes.SHIFT:
                        return this.lastShiftLocation === 1
                            ? keyCodes.SHIFT_LEFT
                            : keyCodes.SHIFT_RIGHT;
                    case keyCodes.ALT:
                        return this.lastAltLocation === 1 ? keyCodes.ALT_LEFT : keyCodes.ALT_RIGHT;
                    case keyCodes.CTRL:
                        return this.lastCtrlLocation === 1
                            ? keyCodes.CTRL_LEFT
                            : keyCodes.CTRL_RIGHT;
                }
                break;
            case 1:
                switch (ret) {
                    case keyCodes.SHIFT:
                        this.lastShiftLocation = 1;
                        return keyCodes.SHIFT_LEFT;

                    case keyCodes.ALT:
                        this.lastAltLocation = 1;
                        return keyCodes.ALT_LEFT;

                    case keyCodes.CTRL:
                        this.lastCtrlLocation = 1;
                        return keyCodes.CTRL_LEFT;
                }
                break;
            case 2:
                switch (ret) {
                    case keyCodes.SHIFT:
                        this.lastShiftLocation = 2;
                        return keyCodes.SHIFT_RIGHT;

                    case keyCodes.ALT:
                        this.lastAltLocation = 2;
                        return keyCodes.ALT_RIGHT;

                    case keyCodes.CTRL:
                        this.lastCtrlLocation = 2;
                        return keyCodes.CTRL_RIGHT;
                }
                break;
            case 3: // numpad
                switch (ret) {
                    case keyCodes.ENTER:
                        return utils.keyCodes.NUMPADENTER;

                    case keyCodes.DELETE:
                        return utils.keyCodes.NUMPAD_DECIMAL_POINT;
                }
                break;
        }

        return ret;
    }

    readmem(address) {
        return this.cpu.readmem(address);
    }
}
