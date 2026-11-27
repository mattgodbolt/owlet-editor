// @vitest-environment node
import {describe, expect, it} from "vitest";
import {TestMachine} from "jsbeeb/src/test-machine";
import {Video} from "jsbeeb/src/video";
import {findModel} from "jsbeeb/src/models";
import {Picture} from "../src/picture";
import {Machines} from "../src/machines";

const RowPixels = 1024;
const FramebufferPixels = RowPixels * 768;
const Step = 500;
// Well down the picture, so that the beam is on it and has rows of this field above it.
const BeamLines = {from: 120, to: 200};

const rows = (fb32, from, to) => fb32.slice(from * RowPixels, to * RowPixels);

/** Boots `machine` with a real video chip whose paints go into a picture, as the emulator's do. */
async function boot(machine) {
    const picture = new Picture(new Uint32Array(FramebufferPixels));
    const paints = [];
    const video = new Video(findModel(machine).isMaster, FramebufferPixels, function paint(
        minx,
        miny,
        maxx,
        maxy,
        paintedTo,
    ) {
        paints.push({miny, maxy, paintedTo});
        picture.take(this, miny, maxy, paintedTo);
    });
    const testMachine = new TestMachine(machine, {video});
    await testMachine.initialise();
    await testMachine.runFor(Machines[machine].startCycles);
    return {testMachine, video, picture, paints};
}

async function runToBeamLines(testMachine, video) {
    const inRange = () => {
        const {line} = video.beamPosition();
        return line >= BeamLines.from && line < BeamLines.to;
    };
    while (inRange()) await testMachine.runFor(Step);
    while (!inRange()) await testMachine.runFor(Step);
}

describe("the picture", () => {
    for (const machine of Object.keys(Machines)) {
        it(`on the ${Machines[machine].name}, shows this field down to the beam over the last whole one, and puts that back`, async () => {
            const {testMachine, video, picture, paints} = await boot(machine);
            await runToBeamLines(testMachine, video);
            const field = picture.fb32.slice();

            video.debugPaint();
            const {miny, maxy, paintedTo} = paints.at(-1);
            expect(paintedTo).toBeGreaterThan(miny);
            expect(paintedTo).toBeLessThan(maxy);
            expect(rows(picture.fb32, paintedTo, maxy)).toEqual(rows(field, paintedTo, maxy));
            expect(rows(picture.fb32, miny, paintedTo)).not.toEqual(rows(field, miny, paintedTo));

            // The beam moves on within the field: the next paint to it goes over the whole field, not the last paint.
            await testMachine.runFor(Step);
            video.debugPaint();
            const further = paints.at(-1).paintedTo;
            expect(further).toBeGreaterThan(paintedTo);
            expect(rows(picture.fb32, further, maxy)).toEqual(rows(field, further, maxy));

            expect(picture.restoreWholeField()).toBe(true);
            expect(picture.fb32).toEqual(field);
            expect(picture.restoreWholeField()).toBe(false);

            video.debugPaint();
            const wholePaints = paints.filter(({paintedTo}) => paintedTo === undefined).length;
            while (paints.filter(({paintedTo}) => paintedTo === undefined).length === wholePaints)
                await testMachine.runFor(Step);
            const shown = picture.fb32.slice();
            expect(picture.restoreWholeField()).toBe(false);
            expect(picture.fb32).toEqual(shown);
        });
    }
});
