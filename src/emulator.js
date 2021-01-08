import _ from "underscore";
import Cpu6502 from "jsbeeb/6502";
import canvasLib from "jsbeeb/canvas";
import Video from "jsbeeb/video";
import Debugger from "jsbeeb/debug";
import SoundChip from "jsbeeb/soundchip";
import DdNoise from "jsbeeb/ddnoise";
import models from "jsbeeb/models";
import Cmos from "jsbeeb/cmos";
import utils from "jsbeeb/utils";
import Promise from "promise";

utils.setBaseUrl("jsbeeb/");

const BotStartCycles = 725000; // bbcmicrobot start time
const ClocksPerSecond = (2 * 1000 * 1000) | 0;
const MaxCyclesPerFrame = ClocksPerSecond / 10;
const urlParams = new URLSearchParams(window.location.search);

let modelName = "BBC Micro Model B";
const Model = models.findModel("B");

if (!urlParams.get("experimental")) {
    Model.os.push("gxr.rom");
    modelName += " | GXR ROM";
}

class ScreenResizer {
    constructor(screen) {
        this.screen = screen;
        const origHeight = screen.height();
        const origWidth = screen.width();
        this.desiredAspectRatio = origWidth / origHeight;
        this.minHeight = origHeight / 4;
        this.minWidth = origWidth / 4;
        try {
            this.observer = new ResizeObserver(() => this.resizeScreen());
            this.observer.observe(this.screen.parent()[0]);
        } catch (e) {
            console.log(e);
        }
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
        this.canvas = canvasLib.bestCanvas(screen[0]);
        this.emuStatus = document.getElementById("emu_status");
        this.frames = 0;
        this.frameSkip = 0;
        this.resizer = new ScreenResizer(screen);
        this.leftMargin = 115;
        this.rightMargin = 130;
        this.topMargin = 45;
        this.bottomMargin = 30;
        window.theEmulator = this;

        this.video = new Video.Video(Model.isMaster, this.canvas.fb32, _.bind(this.paint, this));

        this.soundChip = new SoundChip.FakeSoundChip();
        this.ddNoise = new DdNoise.FakeDdNoise();

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
        const config = {};
        this.cpu = new Cpu6502(
            Model,
            this.dbgr,
            this.video,
            this.soundChip,
            this.ddNoise,
            cmos,
            config
        );

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

    timer() {
        this.emuStatus.innerHTML = modelName + " | " + this.cpu.cycleSeconds + " s";
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
        function copyRegion(data, startAddr, endAddr) {
            for (let i = startAddr; i <= endAddr; i++) {
                processor.writemem(i, data.charCodeAt(i));
            }
        }

        const basic = btoa(tokenised).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const processor = this.cpu;
        const response = await fetch(
            "https://api.bbcmic.ro/beta?saveAddress=0&saveLength=8000&basic=" + basic,
            {
                headers: {
                    "x-api-key": "YrqLWPW1mvbEIJs1bT0m3DAoTJLKd9xaGEQaI5xa",
                },
            }
        );
        const beebjitData = await response.json();
        const data = window.atob(beebjitData.data);
        copyRegion(data, 0x1900, 0x7fff);
        this.cpu.cycleSeconds = 60 * 60 * 3;
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
            maxy - this.bottomMargin
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
}
