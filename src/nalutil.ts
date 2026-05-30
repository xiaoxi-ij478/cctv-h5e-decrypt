"use strict";

import * as util from "./util";

export { NALUnit, splitNALU, joinNALU };

const NAL_START_FIRST: number[] = [0x00, 0x00, 0x00, 0x01];
const NAL_START_SECOND: number[] = [0x00, 0x00, 0x01];

function getNALUPos(buf: number[]): [number, number][] {
    let start: number, prev = 0, off = 0;
    const ret: [number, number][] = [];

    buf.forEach(
        (el, idx) => {
            // format:
            // !00 00 00 00 01 xx or
            // !00 00 00 01 xx
            if (
                el == 0 &&
                (idx !== 0 && buf[idx - 1] !== 0) &&
                buf[idx + 1] === 0 &&
                ((buf[idx + 2] === 0 && buf[idx + 3] === 1) || buf[idx + 2] === 1)
            ) {
                ret.push([prev, idx]);
                prev = idx;
            }
        }
    );
    ret.push([prev, buf.length]);

    return ret;
}

function splitNALU(buf: number[]): NALU[] {
    return getNALUPos(buf).map(
        ([start, length]) => NALU(buf.slice(start, start + length))
    );
}

function joinNALU(nalus: NALU[]): number[] {
    return nalus.map(e => e.dump()).flat();
}

class NALU {
    private start: [number, number, number] | [number, number];
    private header: number;
    data: number[];

    forbiddenZeroBit: number;
    nalRefIdc: number;
    nalUnitType: number;

    constructor(data: number[]) {
        if (util.arrayEquals(data.slice(0, 4), NAL_START_FIRST)) {
            this.start = data.slice(0, 4);
            this.header = data[4];
            this.data = data.slice(5);
        } else if (util.arrayEquals(data.slice(0, 3), NAL_START_SECOND)) {
            this.start = data.slice(0, 3);
            this.header = data[3];
            this.data = data.slice(4);
        } else
            throw new Error("NAL unit start mismatch");

        this.forbiddenZeroBit = this.header >> 7;
        this.nalRefIdc = this.header >> 5 & 0x3;
        this.nalUnitType = this.header & 0x1F;
    }

    reloadData(newData: number[]): void {
        this.header = newData[0];
        this.data = newData.slice(1);

        this.forbiddenZeroBit = this.header >> 7;
        this.nalRefIdc = this.header >> 5 & 0x3;
        this.nalUnitType = this.header & 0x1F;
    }

    dump(): number[] {
        return [this.start, this.header, this.data].flat();
    }
}
