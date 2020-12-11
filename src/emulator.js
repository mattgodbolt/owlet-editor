import _ from 'underscore';
import Cpu6502 from 'jsbeeb/6502';
import canvasLib from 'jsbeeb/canvas';
import Video from 'jsbeeb/video';
import Debugger from 'jsbeeb/debug';
import SoundChip from 'jsbeeb/soundchip';
import DdNoise from 'jsbeeb/ddnoise';
import models from 'jsbeeb/models';
import Cmos from 'jsbeeb/cmos';
import utils from 'jsbeeb/utils';
import Promise from 'promise';

utils.setBaseUrl('jsbeeb/');

const ClocksPerSecond = (2 * 1000 * 1000) | 0;
const MaxCyclesPerFrame = ClocksPerSecond / 10;

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
        const screen = this.root.find('.screen');
        this.canvas = canvasLib.bestCanvas(screen[0]);
        this.frames = 0;
        this.frameSkip = 0;
        const model = models.findModel('B');
        model.os.push('gxr.rom');
        this.resizer = new ScreenResizer(screen);
        this.leftMargin = 115;
        this.rightMargin = 130;
        this.topMargin = 45;
        this.bottomMargin = 30;
        window.theEmulator = this;

        this.video = new Video.Video(model.isMaster, this.canvas.fb32, _.bind(this.paint, this));

        this.soundChip = new SoundChip.FakeSoundChip();
        this.ddNoise = new DdNoise.FakeDdNoise();

        this.dbgr = new Debugger(this.video);
        const cmos = new Cmos({
            'load': function () {
                if (window.localStorage.cmosRam) {
                    return JSON.parse(window.localStorage.cmosRam);
                }
                return null;
            },
            'save': function (data) {
                window.localStorage.cmosRam = JSON.stringify(data);
            }
        });
        const config = {};
        this.cpu = new Cpu6502(model, this.dbgr, this.video, this.soundChip, this.ddNoise, cmos, config);

        this.lastFrameTime = 0;
        this.onAnimFrame = _.bind(this.frameFunc, this);
        this.ready = false;
    }

    async initialise() {
        await Promise.all([this.cpu.initialise(), this.ddNoise.initialise()]);
        this.ready = true;
    }

    start() {
        if (this.running) return;
        this.running = true;
        requestAnimationFrame(this.onAnimFrame);
    }

    pause() {
        this.running = false;
    }

    async beebjit(tokenised){
      const processor = this.cpu;
      const response = await fetch('https://ur670des43.execute-api.us-east-1.amazonaws.com/beta?basic='+btoa(tokenised),{
        headers:{"x-api-key":"YrqLWPW1mvbEIJs1bT0m3DAoTJLKd9xaGEQaI5xa"}
      });
      let beebjitData = await response.json();
      let data = window.atob(beebjitData.data);
      let address = parseInt(beebjitData.address,16);
       for (let i = 0; i < data.length; i++) {
           processor.writemem(address+i, data.charCodeAt(i));
           console.log(i, data.charCodeAt(i))
       }
    }

    runProgram(tokenised) {
        if (!this.ready) return;
        this.cpu.reset(true);
        const processor = this.cpu;
        // TODO - get a precise cycle timestamp for breakpoint so beebjit can match it
        const idleAddr = processor.model.isMaster ? 0xe7e6 : 0xe581;
        const hook = processor.debugInstruction.add(addr => {
            if (addr !== idleAddr) return;
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
            hook.remove();
            this.writeToKeyboardBuffer('RUN\r');
        });
        this.start();
    }

    writeToKeyboardBuffer(text) {
      const processor = this.cpu;
      const keyboardBuffer = 0x0300;  // BBC Micro OS 1.20
      const IBPaddress = 0x02E1;      // input buffer pointer
      let inputBufferPointer = processor.readmem(IBPaddress);
      for (let a = 0; a<text.length;a++){
        processor.writemem(keyboardBuffer+inputBufferPointer, text.charCodeAt(a));
        inputBufferPointer++;
        if (inputBufferPointer>0xff) {inputBufferPointer=0xE0;}
      }
      processor.writemem(IBPaddress,inputBufferPointer);
    }

    frameFunc(now) {
        requestAnimationFrame(this.onAnimFrame);
        if (this.running && this.lastFrameTime !== 0) {
            const sinceLast = now - this.lastFrameTime;
            let cycles = (sinceLast * ClocksPerSecond / 1000) | 0;
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
        const teletextAdjustX = (this.video && this.video.teletextMode) ? 15 : 0;
        this.canvas.paint(
            minx + this.leftMargin + teletextAdjustX,
            miny + this.topMargin,
            maxx - this.rightMargin + teletextAdjustX,
            maxy - this.bottomMargin);
    }
}
