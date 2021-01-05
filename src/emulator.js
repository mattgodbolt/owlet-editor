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

let   modelName = "BBC Micro Model B";
const Model = models.findModel("B");

if (!urlParams.get("experimental")) {
    Model.os.push("gxr.rom");
    modelName += " | GXR ROM"
}

class ScreenResizer {
    constructor(screen) {
        this.screen = screen;
        const origHeight = screen.height();
        const origWidth = screen.width();
        this.desiredAspectRatio = origWidth / origHeight;
        this.minHeight = origHeight / 4;
        this.minWidth = origWidth / 4;
        try{
        this.observer = new ResizeObserver(() => this.resizeScreen());
        this.observer.observe(this.screen.parent()[0]);} catch(e){console.log(e);};

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

        setInterval(this.timer.bind(this),1000)
        this.lastFrameTime = 0;
        this.onAnimFrame = _.bind(this.frameFunc, this);
        this.ready = false;
    }

    async initialise() {
        await Promise.all([this.cpu.initialise(), this.ddNoise.initialise()]);
        this.ready = true;
    }

    timer() {
      this.emuStatus.innerHTML = modelName+" | "+this.cpu.cycleSeconds+" s";
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
        function copyRegion(data, startAddr, endAddr){
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
        let beebjitData = await response.json();
        let data = window.atob(beebjitData.data);
        copyRegion(data, 0x1900, 0x7fff);
        this.cpu.cycleSeconds = 60*60*3;
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
}
