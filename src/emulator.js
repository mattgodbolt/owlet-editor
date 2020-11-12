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
import tokenise from 'jsbeeb/basic-tokenise';

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
        console.log(width, height);
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
        this.resizer = new ScreenResizer(screen);

        this.video = new Video.Video(model.isMaster, this.canvas.fb32, _.bind(this.paint, this));

        const audioContext = typeof AudioContext !== 'undefined' ? new AudioContext()
            : null;

        if (audioContext) {
            this.soundChip = new SoundChip.SoundChip(audioContext.sampleRate);
            // NB must be assigned to some kind of object else it seems to get GC'd by
            // Safari...
            this.soundChip.jsAudioNode = audioContext.createScriptProcessor(2048, 0, 1);
            this.soundChip.jsAudioNode.onaudioprocess = _.bind(function pumpAudio(event) {
                const outBuffer = event.outputBuffer;
                const chan = outBuffer.getChannelData(0);
                this.soundChip.render(chan, 0, chan.length);
            }, this);
            this.soundChip.jsAudioNode.connect(audioContext.destination);
            this.ddNoise = new DdNoise.DdNoise(audioContext);
        } else {
            this.soundChip = new SoundChip.FakeSoundChip();
            this.ddNoise = new DdNoise.FakeDdNoise();
        }

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

    async runProgram(program) {
        if (!this.ready) return;
        this.cpu.reset(true);
        const tokeniser = await tokenise.create();
        const tokenised = tokeniser.tokenise(program);
        const processor = this.cpu;
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
            const bbcKeys = utils.stringToBBCKeys('RUN\n');
            this.sendRawKeyboardToBBC([200].concat(bbcKeys), false);
        });
        this.start();
    }

    sendRawKeyboardToBBC(keysToSend) {
        let lastChar;
        let nextKeyMillis = 0;
        const processor = this.cpu;
        processor.sysvia.disableKeyboard();

        const sendCharHook = processor.debugInstruction.add(function nextCharHook() {
            const millis = processor.cycleSeconds * 1000 + processor.currentCycles / (ClocksPerSecond / 1000);
            if (millis < nextKeyMillis) {
                return;
            }

            if (lastChar && lastChar !== utils.BBC.SHIFT) {
                processor.sysvia.keyToggleRaw(lastChar);
            }

            if (keysToSend.length === 0) {
                // Finished
                processor.sysvia.enableKeyboard();
                sendCharHook.remove();
                return;
            }

            const ch = keysToSend[0];
            const debounce = lastChar === ch;
            lastChar = ch;
            if (debounce) {
                lastChar = undefined;
                nextKeyMillis = millis + 30;
                return;
            }

            let time = 50;
            if (typeof lastChar === "number") {
                time = lastChar;
                lastChar = undefined;
            } else {
                processor.sysvia.keyToggleRaw(lastChar);
            }

            // remove first character
            keysToSend.shift();

            nextKeyMillis = millis + time;
        });
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
        this.canvas.paint(minx, miny, maxx, maxy);
    }
}
