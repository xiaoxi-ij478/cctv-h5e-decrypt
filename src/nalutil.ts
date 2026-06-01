"use strict";

import * as util from "./util.js";

export { NALU, splitNALU, joinNALU };

const NAL_START_FIRST: number[] = [0x00, 0x00, 0x00, 0x01];
const NAL_START_SECOND: number[] = [0x00, 0x00, 0x01];

function getNALUPos(buf: Uint8Array): [number, number][] {
    console.log(buf);
    let start: number, prev = 0, off = 0;
    const ret: [number, number][] = [];

    buf.forEach(
        (el, idx) => {
            // format:
            // !00 00 00 00 01 xx or
            // !00 00 00 01 xx
            if (
                el == 0 &&
                buf[idx + 1] === 0 &&
                (idx !== 0 && buf[idx - 1] !== 0) &&
                ((buf[idx + 2] === 0 && buf[idx + 3] === 1) || buf[idx + 2] === 1)
            ) {
                ret.push([prev, idx]);
                prev = idx;
            }
        }
    );
    ret.push([prev, buf.byteLength]);

    return ret;
}

function splitNALU(buf: Uint8Array): NALU[] {
    return getNALUPos(buf).map(
        ([start, end]) => new NALU(util.moveSliceUint8Array(buf, start, end - start))
    );
}

function joinNALU(nalus: NALU[]): Uint8Array {
    return nalus.reduce((a, e) => util.concatUint8Arrays(a, e.dump()), new Uint8Array);
}

class NALU {
    private start: number[];
    private header: number;
    data: Uint8Array;

    forbiddenZeroBit: number;
    nalRefIdc: number;
    nalUnitType: number;

    constructor(data: Uint8Array) {
        console.log(data);
        if (data.length <= 4)
            throw new Error("data length <= 4");

        if (util.arrayEquals(util.moveSliceUint8Array(data, 0, 4), NAL_START_FIRST)) {
            this.start = util.moveSliceUint8Array(data, 0, 4);
            this.header = data[4];
            this.data = util.moveSliceUint8Array(data, 5);
        } else if (util.arrayEquals(data.slice(0, 3), NAL_START_SECOND)) {
            this.start = util.moveSliceUint8Array(data, 0, 3);
            this.header = data[3];
            this.data = util.moveSliceUint8Array(data, 4);
        } else
            throw new Error("NAL unit start mismatch");

        this.forbiddenZeroBit = this.header >> 7;
        this.nalRefIdc = this.header >> 5 & 0x3;
        this.nalUnitType = this.header & 0x1F;
    }

    reloadData(newData: Uint8Array): void {
        this.header = newData[0];
        this.data = util.moveSliceUint8Array(data, 1);

        this.forbiddenZeroBit = this.header >> 7;
        this.nalRefIdc = this.header >> 5 & 0x3;
        this.nalUnitType = this.header & 0x1F;
    }

    dump(): Uint8Array {
        return Uint8Array.of(...this.start, this.header, ...this.data);
    }
}
