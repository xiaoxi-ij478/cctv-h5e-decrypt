"use strict";

import * as jscrc from "@modules/js-crc";

import * as util from "./util";

export {
    MPEGTSPacketBase,
    MPEGTSPacketHeader,
    MPEGTSPacketAdaptionField,
    MPEGTSPacket,
    MPEGTSPESPacketBase,
    MPEGTSPSIPacketBase,
    MPEGTSPATPIDMapping,
    MPEGTSPAT,
    MPEGTSPMTStreamInfo,
    MPEGTSPMT,
    MPEGTSPES,
    MPEGTSPESPacketWithIndex,
    MPEGTS
};

// TS layer packet
// these classes receive a bytearray as constructor argument

abstract class MPEGTSPacketBase {
    protected abstract realInit(data: number[]): void;
    protected abstract realReset(): void;

    constructor();
    constructor(data: number[]);

    constructor(data?: number[]) {
        if (typeof data === "undefined")
            return;

        init(data);
    }

    protected init(data: number[]): void {
        data = data.slice();

        this.realInit(data);
    }

    reset(): void {
        this.realReset();
    }

    reinit(data: number[]): void {
        this.reset();
        this.init(data);
    }
}

class MPEGTSPacketHeader extends MPEGTSPacketBase {
    isContinuePacket: boolean = false;
    hasAdaptionControl: boolean = false;
    hasPayload: boolean = false;
    continuityCount: number = 0;
    transportPriority: number = 0;
    pid: number = 0;

    protected realInit(data: number[]): void {
        util.checkNumberEqual(data[0], 0x47, "sync byte error", true);
        util.checkNumberNotEqual(data[1] >> 7, 1, "error indicator set", true);

        this.isContinuePacket = !(data[1] >> 6 & 0x1);
        this.transportPriority = data[1] >> 5 & 0x1;
        this.pid = (data[1] & 0x1F) << 8 | data[2];

        util.checkNumberNotEqual(data[3] >> 4 & 0x3, 0, "adaption field control field === 0");

        this.hasAdaptionControl = Boolean(data[3] >> 5 & 0x1);
        this.hasPayload = Boolean(data[3] >> 4 & 0x1);
        // we handle off the continuity check to the user
        this.continuityCount = data[3] & 0xF;
    }

    protected realReset(): void {
        this.isContinuePacket = this.hasAdaptionControl = this.hasPayload = false;
        this.continuityCount = this.transportPriority = this.pid = 0;
    }
}

class MPEGTSPacketAdaptionField extends MPEGTSPacketBase {
    length: number = 0;
    payload: number[] = [];

    protected realInit(data: number[]): void {
        this.length = data.splice(0, 1);
        this.payload = data;
    }

    protected realReset(): void {
        this.length = 0;
        this.payload.splice();
    }
}

class MPEGTSPacket extends MPEGTSPacketBase {
    header: MPEGTSPacketHeader = new MPEGTSPacketHeader;
    adaptionField: MPEGTSPacketAdaptionField = new MPEGTSPacketAdaptionField;
    payload: number[] = [];

    protected realInit(data: number[]): void {
        if (data.length !== 188) {
            console.warn("this MPEG TS Packet has trailing garbage, will discard them");
            data.splice(188);
        }

        this.header = new MPEGTSPacketHeader(data);
        data.splice(0, 4);
        if (this.header.hasAdaptionControl) {
            this.adaptionField = new MPEGTSPacketAdaptionField(data);
            data.splice(0, this.adaptionField.length);
        }

        if (this.header.hasPayload)
            this.payload = data;
    }

    protected realReset(): void {
        this.header.reset();
        this.adaptionField.reset();
        this.payload.splice();
    }
}

// PES layer packet
// these classes receive a MPEGTSPacket object as argument
//
// if you're familiar with reset() and reinit(),
// that's because I copied them from MPEGTSPacketBase :)
abstract class MPEGTSPESPacketBase {
    private currentCounter: number = 0;
    protected buffer: number[] = [];
    protected remainingLength: number = 0; // expected to be set by subclasses
    complete: boolean = false;
    pid: number = 0;

    constructor();
    constructor(data: MPEGTSPacket);

    constructor(data?: MPEGTSPacket) {
        if (typeof data === "undefined");
            return;

        init(data);
    }

    protected abstract get requiredBytes(): number;
    protected abstract realInit(): void;
    protected abstract realReset(): void;
    protected abstract realUpdate(): boolean; // returns true when completed

    protected init(data: MPEGTSPacket): void {
        if (data.header.isContinuePacket)
            throw new Error("MPEGTSPESPacketBase init() expects an initial packet");

        this.currentCounter = data.header.continuityCount;
        this.pid = data.header.pid;

        if (data.header.hasPayload)
            this.buffer = data.payload.slice();

        if (this.buffer.length < this.requiredBytes)
            throw new Error("payload length less than required " + this.requiredBytes + " bytes");

        this.realInit();
    }

    reset(): void {
        this.realReset();
        this.currentCounter = this.pid = 0;
        this.complete = false;
        this.buffer.splice();
    }

    reinit(data: MPEGTSPacket): void {
        this.reset();
        this.init(data);
    }

    update(data: MPEGTSPacket): boolean {
        if (complete)
            throw new Error("Can't update a complete packet");

        if (!data.isContinuePacket) {
            // we assume the user want to RESET this packet
            reset();
            this.currentCounter = data.header.continuityCount;
            this.pid = data.header.pid;

        } else {
            this.currentCounter++;
            this.currentCounter &= 0xF;

            util.checkNumberEqual(data.header.pid, this.pid, "provided packet's pid do not match that of this pes", true);

            if (!data.header.isContinuePacket)
                throw new Error("update() expects a continue packet");

            util.checkNumberEqual(data.header.continuityCount, this.currentCounter, "continuity count mismatch", truea);
        }

        if (!data.header.hasPayload)
            return;

        this.buffer = this.buffer.concat(data.payload);
        if (!this.realUpdate())
            this.complete = true;

        return this.complete;
    }
}

// PSI requires to remove the first byte and the length it indicates
abstract class MPEGTSPSIPacketBase extends MPEGTSPESPacketBase {
    protected init(data: MPEGTSPacket): void {
        if (data.header.isContinuePacket)
            throw new Error("MPEGTSPSIPacketBase init() expects an initial packet");

        this.currentCounter = data.header.continuityCount;
        this.pid = data.header.pid;

        if (data.header.hasPayload)
            this.buffer = data.payload.slice(data.payload[0] + 1);

        if (this.buffer.length < this.requiredBytes)
            throw new Error("payload length less than required " + this.requiredBytes + " bytes");

        this.realInit();
    }
}

type MPEGTSPATPIDMapping = {
    programNumber: number;
    pid: number;
}

class MPEGTSPAT extends MPEGTSPSIPacketBase {
    private crc32obj: jscrc.Model = jscrc.crc32.create();
    transportStreamID: number = 0;
    programPMTPIDMapping: MPEGTSPATPIDMapping[] = [];

    protected realInit(): void {
        util.checkNumberEqual(this.buffer[0], 0, "table id not 0", true);
        util.checkNumberEqual(this.buffer[1] >> 7, 1, "section syntax indicator not 1", true);
        util.checkNumberEqual(this.buffer[1] >> 6 & 0x1, 0, "zero not 0", true);
        util.checkNumberEqual(this.buffer[1] >> 5 & 0x3, 3, "reserved not 3", true);

        // the remaining length also counts the header
        this.remainingLength = (this.buffer[1] & 0xF) << 8 | this.buffer[2];
        this.remainingLength -= 5;

        this.transportStreamID = this.buffer[3] << 8 | this.buffer[4];

        util.checkNumberEqual(this.buffer[5] >> 6, 3, "reserved2 not 3", true);
        util.checkNumberEqual(this.buffer[5] >> 1 & 0x1F, 0, "version not 0", true);
        util.checkNumberEqual(this.buffer[5] & 0x1, 1, "current next indicator not 1", true);
        util.checkNumberEqual(this.buffer[6], 0, "section number not 0", true);
        util.checkNumberEqual(this.buffer[7], 0, "last section number not 0", true);

        this.crc32obj.update(this.buffer.splice(0, 8));

        if (!this.realUpdate())
            this.complete = true;
    }

    protected get requiredBytes(): number {
        return 8;
    }

    protected realReset(): void {
        this.crc32obj = jscrc.crc32.create();
        this.programPMTPIDMapping.splice();
    }

    protected realUpdate(): boolean {
        for (; this.remainingLength !== 4 && this.buffer.length >= 4; this.remainingLength -= 4) {
            util.checkNumberEqual(this.buffer[2] >> 5, 7, "reserved3 not 7", true);

            this.programPMTPIDMapping.push({
                programNumber: this.buffer[0] << 8 | this.buffer[1],
                pid: this.buffer[2] & 0x1F | this.buffer[3]
            });
            this.crc32obj.update(this.buffer.splice(0, 4));
        }

        if (this.remainingLength !== 4)
            return false;

        if (!util.arrayEquals(this.crc32obj.array(), this.buffer))
            throw new Error("PAT CRC32 mismatch");

        return true;
    }
}

type MPEGTSPMTStreamInfo = {
    streamType: number;
    pid: number;
};

class MPEGTSPMT extends MPEGTSPSIPacketBase {
    private crc32obj: jscrc.Model = jscrc.crc32.create();
    assocProgram: number = 0;
    pcrpid: number = 0;
    streams: MPEGTSPMTStreamInfo[] = [];

    protected realInit(): void {
        util.checkNumberEqual(this.buffer[0], 2, "table id not 2", true);
        util.checkNumberEqual(this.buffer[1] >> 7, 1, "section syntax indicator not 1", true);
        util.checkNumberEqual(this.buffer[1] >> 6 & 0x1, 0, "zero not 0", true);
        util.checkNumberEqual(this.buffer[1] >> 5 & 0x3, 3, "reserved not 3", true);

        // the remaining length also counts the header
        this.remainingLength = (this.buffer[1] & 0xF) << 8 | this.buffer[2];
        this.remainingLength -= 9;

        this.assocProgram = this.buffer[3] << 8 | this.buffer[4];

        util.checkNumberEqual(this.buffer[5] >> 6, 3, "reserved2 not 3", true);
        util.checkNumberEqual(this.buffer[5] >> 1 & 0x1F, 0, "version not 0", true);
        util.checkNumberEqual(this.buffer[5] & 0x1, 1, "current next indicator not 1", true);
        util.checkNumberEqual(this.buffer[6], 0, "section number not 0", true);
        util.checkNumberEqual(this.buffer[7], 0, "last section number not 0", true);
        util.checkNumberEqual(this.buffer[8] >> 5, 3, "reserved3 not 3", true);

        this.pcrpid = (this.buffer[8] & 0x1F) << 8 | this.buffer[9];

        util.checkNumberEqual(this.buffer[10] >> 4, 15, "reserved4 not 15", true);

        const descriptionLength = (this.buffer[10] & 0xF) << 8 | this.buffer[11];
        this.crc32obj.update(this.buffer.splice(0, 12 + descriptionLength));

        if (!this.realUpdate())
            this.complete = true;
    }

    protected get requiredBytes(): number {
        return 12;
    }

    protected realReset(): void {
        this.crc32obj = jscrc.crc32.create();
        this.assocProgram = this.pcrpid = 0;
        this.streams.splice();
    }

    protected realUpdate(): boolean {
        for (; this.remainingLength !== 4 && this.buffer.length >= 5; this.remainingLength -= 4) {
            let descriptionLength = (this.buffer[3] & 0xF) << 8 | this.buffer[4];
            if (5 + descriptionLength > this.buffer.length)
                break;

            util.checkNumberEqual(this.buffer[1] >> 5, 7, "reserved not 7", true);
            util.checkNumberEqual(this.buffer[3] >> 4, 15, "reserved2 not 15", true);

            this.streams.push({
                streamType: this.buffer[0],
                pid: (this.buffer[2] & 0x1F) << 8 | this.buffer[3]
            });
            this.crc32obj.update(this.buffer.splice(0, 5 + descriptionLength));
        }

        if (this.remainingLength !== 4)
            return false;

        if (!util.arrayEquals(this.crc32obj.array(), this.buffer))
            throw new Error("PMT CRC32 mismatch");

        return true;
    }
}

class MPEGTSPES extends MPEGTSPESPacketBase {
    streamID: number = 0;
    // NOTE! pts and dts are 33-bit unsigned integers so they must be stored as BigInts
    pts: BigInt = 0;
    dts: BigInt = 0;
    haspts: boolean = false;
    hasdts: boolean = false;
    header: number[] = [];
    payload: number[] = [];

    protected realInit(): void {
        super(data);
        if (typeof data === "undefined")
            return;

        if (this.buffer[0] || this.buffer[1] || this.buffer[2] !== 1)
            throw new Error("PES start code not 0x000001");

        this.streamID = this.buffer[3];
        this.remainingLength = this.buffer[4] << 8 | this.buffer[5];
        if (this.remainingLength)
            this.remainingLength = -1;

        this.buffer.splice(0, 5);

        // we only analyze deeper for video/audio streams
        if (this.streamID >> 5 === 6 || this.streamID >> 4 === 14) {
            util.checkNumberEqual(this.buffer[0] >> 6, 2, "start two bits not 2", true);

            switch (this.buffer[1] >> 6) {
                case 3:
                    hasDTS = hasPTS = true;
                    break;

                case 2:
                    console.warn("this PES has no DTS information");
                    hasPTS = true;
                    break;

                case 1:
                    throw new Error("PTS DTS flags value 1 is forbidden");

                case 0:
                    console.warn("this PES has no PTS and DTS information");
                    break;
            }

            if (hasDTS) { // we can save time by getting pts and dts at one time
                util.checkNumberEqual(this.buffer[8] >> 4, 3, "fixed 0b0011 not correct");
                util.checkNumberEqual(this.buffer[8] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[10] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[12] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[13] >> 4, 1, "fixed 0b0001 not correct");
                util.checkNumberEqual(this.buffer[13] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[15] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[17] & 1, 1, "fixed 0b1 not correct");

                this.pts = (
                    (BigInt(this.buffer[8]) >> 1n & 0x7n) << 30n |
                    (BigInt(this.buffer[9]) << 7n | BigInt(this.buffer[10]) >> 1n) << 15n |
                    (BigInt(this.buffer[11]) << 7n | BigInt(this.buffer[12]) >> 1n)
                );

                this.dts = (
                    (BigInt(this.buffer[13]) >> 1n & 0x7n) << 30n |
                    (BigInt(this.buffer[14]) << 7n | BigInt(this.buffer[15]) >> 1n) << 15n |
                    (BigInt(this.buffer[16]) << 7n | BigInt(this.buffer[17]) >> 1n)
                );

            } else if (hasPTS) {
                util.checkNumberEqual(this.buffer[3] >> 4, 2, "fixed 0b0010 not correct");
                util.checkNumberEqual(this.buffer[3] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[5] & 1, 1, "fixed 0b1 not correct");
                util.checkNumberEqual(this.buffer[7] & 1, 1, "fixed 0b1 not correct");

                this.pts = (
                    (BigInt(this.buffer[3]) >> 1n & 0x7n) << 30n |
                    (BigInt(this.buffer[4]) << 7n | BigInt(this.buffer[5]) >> 1n) << 15n |
                    (BigInt(this.buffer[6]) << 7n | BigInt(this.buffer[7]) >> 1n)
                );
            }


            this.buffer.splice(0, 2 + this.buffer[2]);
        }

        if (!this.realUpdate())
            this.complete = true;
    }

    protected get requiredBytes(): number {
        return 6;
    }

    protected realReset(): void {
        this.streamID = 0;
        pts = dts = 0;
        haspts = hasdts = false;
        this.header.splice();
        this.payload.splice();
    }

    protected realUpdate(): boolean {
        if (this.remainingLength === -1) {
            this.payload = this.payload.concat(this.buffer);
            this.buffer.splice();
            return false;
        }

        this.remainingLength -= this.buffer.length;
        this.payload = this.payload.concat(this.buffer);
        this.buffer.splice();
        return !this.remainingLength;
     }
}

type MPEGTSPESPacketWithIndex = {
    pes: MPEGTSPES;
    index: number[];
};

// the super class representating a whole TS
class MPEGTS {
    pat: MPEGTSPAT = new MPEGTSPAT;
    pmts: MPEGTSPMT[] = [];
    packets: MPEGTSPacket[] = [];

    constructor();
    constructor(data: number[]);

    constructor(data?: number[]) {
        data = data.slice();
        if (typeof data === "undefined")
            return;

        this.update(data);
    }

    reset(): void {
        this.pat.reset();
        this.pmts.splice();
        this.packets.splice();
    }

    update(data: number[]): void {
        data = data.slice();

        // first find if there's PAT
        while (data.length)
            this.packets.push(new MPEGTSPacket(data.splice(0, 188)));

        let patUpdated = false;
        for (let packet of this.packets) {
            if (packet.header.pid)
                continue;

            // we found one
            patUpdated = true;
            pat.update(packet);
            pmts.splice();

            if (!patUpdated)
                return;

            this.pmts.splice();
        }

        // update PMT only if PAT is updated
        // we find PMT a second time in case it is BEFORE PAT
        for (let packet of this.packets) {
            if (packet.header.pid !== pat.programPMTPIDMapping[1])
                continue;

            pmts.push(new MPEGTSPMT(packet));
            break;
        }
    }

    getPacketsByPID(pid: number): MPEGTSPESPacketWithIndex[] | MPEGTSPMT | MPEGTSPAT {
        const ret: MPEGTSPES[] = [];

        // return special tables rather than lookup again
        switch (pid) {
            case 0:
                return new MPEGTSPAT(packet);

            case pat.programPMTPIDMapping[1]:
                return new MPEGTSPMT(packet);
        }

        for (let packetIndex in this.packets) {
            let packet = this.packets[packetIndex];

            if (packet.header.pid !== pid)
                continue;

            if (ret.at(-1).pes.complete)
                ret.push({
                    pes: new MPEGTSPES(packet),
                    index: [packetIndex]
                });
            else {
                ret.at(-1).pes.update(packet);
                ret.at(-1).index.push(packetIndex);
            }
        }

        return ret;
    }
}
