var $ = require('jquery');
var _ = require('underscore');
var Cpu6502 = require('jsbeeb/6502');
var canvasLib = require('jsbeeb/canvas');
var Video = require('jsbeeb/video');
var Debugger = require('jsbeeb/debug');
var SoundChip = require('jsbeeb/soundchip');
var DdNoise = require('jsbeeb/ddnoise');
var models = require('jsbeeb/models');
var Cmos = require('jsbeeb/cmos');
var utils = require('jsbeeb/utils');
var Promise = require('promise');
import tokenise from 'jsbeeb/basic-tokenise';

utils.setBaseUrl('jsbeeb/');

const ClocksPerSecond = (2 * 1000 * 1000) | 0;
const MaxCyclesPerFrame = ClocksPerSecond / 10;

export function Emulator(root) {
    this.root = $(root);
    this.canvas = canvasLib.bestCanvas(this.root.find('.screen')[0]);
    this.frames = 0;
    this.frameSkip = 0;
    const model = models.findModel('B');

    this.video = new Video.Video(model.isMaster, this.canvas.fb32, _.bind(this.paint, this));

    var audioContext = typeof AudioContext !== 'undefined' ? new AudioContext()
        : typeof webkitAudioContext !== 'undefined' ? new webkitAudioContext()
            : null;

    if (audioContext) {
        this.soundChip = new SoundChip.SoundChip(audioContext.sampleRate);
        // NB must be assigned to some kind of object else it seems to get GC'd by
        // Safari...
        this.soundChip.jsAudioNode = audioContext.createScriptProcessor(2048, 0, 1);
        this.soundChip.jsAudioNode.onaudioprocess = _.bind(function pumpAudio(event) {
            var outBuffer = event.outputBuffer;
            var chan = outBuffer.getChannelData(0);
            this.soundChip.render(chan, 0, chan.length);
        }, this);
        this.soundChip.jsAudioNode.connect(audioContext.destination);
        this.ddNoise = new DdNoise.DdNoise(audioContext);
    } else {
        this.soundChip = new SoundChip.FakeSoundChip();
        this.ddNoise = new DdNoise.FakeDdNoise();
    }

    this.dbgr = new Debugger(this.video);
    var cmos = new Cmos({
        load: function () {
            if (window.localStorage.cmosRam) {
                return JSON.parse(window.localStorage.cmosRam);
            }
            return null;
        },
        save: function (data) {
            window.localStorage.cmosRam = JSON.stringify(data);
        }
    });
    var config = {};
    this.cpu = new Cpu6502(model, this.dbgr, this.video, this.soundChip, this.ddNoise, cmos, config);

    this.lastFrameTime = 0;
    this.onAnimFrame = _.bind(this.frameFunc, this);
    this.ready = false;
}

Emulator.prototype.initialise = async function () {
    await Promise.all([this.cpu.initialise(), this.ddNoise.initialise()]);
    this.ready = true;
}

Emulator.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.onAnimFrame);
};

Emulator.prototype.onStart = async function (program) {
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
        this.sendRawKeyboardToBBC([1000].concat(bbcKeys), false);
    });
    this.start();
};

Emulator.prototype.sendRawKeyboardToBBC = function (keysToSend, checkCapsAndShiftLocks) {
    var lastChar;
    var nextKeyMillis = 0;
    const processor = this.cpu;
    processor.sysvia.disableKeyboard();

    if (checkCapsAndShiftLocks) {
        var toggleKey = null;
        if (!processor.sysvia.capsLockLight) toggleKey = BBC.CAPSLOCK;
        else if (processor.sysvia.shiftLockLight) toggleKey = BBC.SHIFTLOCK;
        if (toggleKey) {
            keysToSend.unshift(toggleKey);
            keysToSend.push(toggleKey);
        }
    }

    var sendCharHook = processor.debugInstruction.add(function nextCharHook() {
        var millis = processor.cycleSeconds * 1000 + processor.currentCycles / (ClocksPerSecond / 1000);
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

        var ch = keysToSend[0];
        var debounce = lastChar === ch;
        lastChar = ch;
        if (debounce) {
            lastChar = undefined;
            nextKeyMillis = millis + 30;
            return;
        }

        var time = 50;
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

Emulator.prototype.frameFunc = function (now) {
    requestAnimationFrame(this.onAnimFrame);
    if (this.running && this.lastFrameTime !== 0) {
        var sinceLast = now - this.lastFrameTime;
        var cycles = (sinceLast * ClocksPerSecond / 1000) | 0;
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
};

Emulator.prototype.paint = function paint(minx, miny, maxx, maxy) {
    this.frames++;
    if (this.frames < this.frameSkip) return;
    this.frames = 0;
    this.canvas.paint(minx, miny, maxx, maxy);
};
