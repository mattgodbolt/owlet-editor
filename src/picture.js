const RowPixels = 1024;

/**
 * The picture in the canvas's framebuffer, copied from jsbeeb's video chip. A paint at flyback is a whole field; a
 * paint to the beam (jsbeeb's debugPaint) brings only the rows down to `paintedTo`, with a dot at the beam, and leaves
 * the last field below them. The last whole field is kept while one of those is shown, to be put back.
 */
export class Picture {
    constructor(fb32) {
        this.fb32 = fb32;
        this.wholeField = new Uint32Array(fb32.length);
        this.showsWholeField = true;
    }

    /** Copies the rows from `miny` down to `paintedTo`, or to `maxy` for a whole field, of `video`'s framebuffer. */
    take(video, miny, maxy, paintedTo) {
        const toBeam = paintedTo !== undefined;
        // Each paint to the beam goes over the whole field, not the last such paint, whose dot may be lower down.
        if (toBeam && !this.restoreWholeField()) this.wholeField.set(this.fb32);
        this.showsWholeField = !toBeam;
        const end = toBeam ? paintedTo : maxy;
        this.fb32.set(video.fb32.subarray(miny * RowPixels, end * RowPixels), miny * RowPixels);
    }

    /** Puts the last whole field back if a paint to the beam replaced it, and says whether it did. */
    restoreWholeField() {
        if (this.showsWholeField) return false;
        this.fb32.set(this.wholeField);
        this.showsWholeField = true;
        return true;
    }
}
