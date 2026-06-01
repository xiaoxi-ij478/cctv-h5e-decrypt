"use strict";

import * as jscrc from "js-crc";

import * as util from "./util.js";

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
    MPEGTSPMTProgramAssoc,
    MPEGTS
};

// TS layer packet
// these classes receive a bytearray as constructor argument

abstract class MPEGTSPacketBase {
    constructor();
    constructor(data: number[]);

    constructor(data?: number[]) {
        if (typeof data === "undefined")
            return;

        this.init(data);
    }

    protected abstract realInit(data: number[]): void;
    protected abstract realReset(): void;
    protected abstract realDump(): number[];

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

    dump(): number[] {
        return this.realDump();
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

    protected realDump(): number[] {
        return [
            0x47,
            Number(!this.isContinuePacket) << 6 | this.transportPriority << 5 | this.pid >> 8,
            this.pid & 0xFF,
            Number(this.hasAdaptionControl) << 5 | Number(this.hasPayload) << 4 | this.continuityCount
        ];
    }
}

class MPEGTSPacketAdaptionField extends MPEGTSPacketBase {
    length: number = 0;
    payload: number[] = [];

    protected realInit(data: number[]): void {
        this.length = data.splice(0, 1)[0];
        this.payload = data;
    }

    protected realReset(): void {
        this.length = 0;
        this.payload = [];
    }

    protected realDump(): number[] {
        return [
            this.length,
            ...this.payload
        ];
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
        this.payload = [];
    }

    protected realDump(): number[] {
        return [
            ...this.header.dump(),
            ...this.adaptionField.dump(),
            ...this.payload
        ];
    }
}

// PES layer packet
// these classes receive a MPEGTSPacket object as argument
//
// if you're familiar with reset() and reinit(),
// that's because I copied them from MPEGTSPacketBase :)
abstract class MPEGTSPESPacketBase {
    protected currentCounter: number = 0;
    protected buffer: number[] = [];
    protected remainingLength: number = 0; // expected to be set by subclasses
    complete: boolean = false;
    pid: number = 0;

    constructor();
    constructor(data: MPEGTSPacket);

    constructor(data?: MPEGTSPacket) {
        if (typeof data === "undefined")
            return;

        this.init(data);
    }

    protected abstract get requiredBytes(): number;
    protected abstract realInit(): void;
    protected abstract realReset(): void;
    protected abstract realUpdate(): boolean; // returns true when completed
    protected abstract realDump(): number[];

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
        this.buffer = [];
    }

    reinit(data: MPEGTSPacket): void {
        this.reset();
        this.init(data);
    }

    update(data: MPEGTSPacket): boolean {
        if (this.complete)
            throw new Error("Can't update a complete packet");

        if (!data.header.isContinuePacket) {
            // we assume the user want to RESET this packet
            this.reset();
            this.currentCounter = data.header.continuityCount;
            this.pid = data.header.pid;

        } else {
            this.currentCounter++;
            this.currentCounter &= 0xF;

            util.checkNumberEqual(data.header.pid, this.pid, "provided packet's pid do not match that of this pes", true);

            if (!data.header.isContinuePacket)
                throw new Error("update() expects a continue packet");

            util.checkNumberEqual(data.header.continuityCount, this.currentCounter, "continuity count mismatch", true);
        }

        if (data.header.hasPayload) {
            this.buffer = this.buffer.concat(data.payload);

            if (!this.realUpdate())
                this.complete = true;
        }

        return this.complete;
    }

    dump(): number[] {
        if (!this.complete)
            throw new Error("can't dump incomplete packet");

        return this.realDump();
    }
}

// PSI requires to remove the first byte and the length it indicates
abstract class MPEGTSPSIPacketBase extends MPEGTSPESPacketBase {
    protected additionalData: number[] = [];

    protected init(data: MPEGTSPacket): void {
        if (data.header.isContinuePacket)
            throw new Error("MPEGTSPSIPacketBase init() expects an initial packet");

        this.currentCounter = data.header.continuityCount;
        this.pid = data.header.pid;

        if (data.header.hasPayload) {
            this.additionalData = data.payload.slice(0, data.payload[0] + 1);
            this.buffer = data.payload.slice(data.payload[0] + 1);
        }

        if (this.buffer.length < this.requiredBytes)
            throw new Error("payload length less than required " + this.requiredBytes + " bytes");

        this.realInit();
    }

    dump(): number[] {
        return [
            this.additionalData.length,
            ...this.additionalData,
            ...super.dump()
        ];
    }
}

type MPEGTSPATPIDMapping = {
    program: number;
    pid: number;
}

class MPEGTSPAT extends MPEGTSPSIPacketBase {
    private crc32obj: jscrc.Crc = jscrc.crc32.create();
    transportStreamID: number = 0;
    programPMTPIDMapping: MPEGTSPATPIDMapping[] = [];

    protected realInit(): void {
        util.checkNumberEqual(this.buffer[0], 0, "table id not 0", true);
        util.checkNumberEqual(this.buffer[1] >> 7, 1, "section syntax indicator not 1", true);
        util.checkNumberEqual(this.buffer[1] >> 6 & 0x1, 0, "zero not 0", true);
        util.checkNumberEqual(this.buffer[1] >> 5 & 0x3, 3, "reserved not 3", true);

        // the remaining length also counts the header and CRC
        this.remainingLength = (this.buffer[1] & 0xF) << 8 | this.buffer[2];
        this.remainingLength -= 9;

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
        this.programPMTPIDMapping = [];
    }

    protected realUpdate(): boolean {
        for (; this.remainingLength !== 4 && this.buffer.length >= 4; this.remainingLength -= 4) {
            util.checkNumberEqual(this.buffer[2] >> 5, 7, "reserved3 not 7", true);

            this.programPMTPIDMapping.push({
                program: this.buffer[0] << 8 | this.buffer[1],
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

    protected realDump(): number[] {
        const sectionLength: number = 9 + 4 * this.programPMTPIDMapping.length;
        const crc32obj: jscrc.Crc = jscrc.crc32.create();
        let dataToCRC: number[] = [
            0x00,
            0xB0 | sectionLength >> 8,
            sectionLength & 0xFF,
            this.transportStreamID >> 8,
            this.transportStreamID & 0xFF,
            0xC1,
            0x00,
            0x00,
            ...(this.programPMTPIDMapping.map(
                e => [
                    e.program >> 8,
                    e.program & 0xFF,
                    0xE0 | e.pid >> 8,
                    e.pid & 0xFF
                ]
            ).flat())
        ];

        crc32obj.update(dataToCRC);
        dataToCRC = dataToCRC.concat(crc32obj.array());
        return dataToCRC;
    }
}

type MPEGTSPMTStreamInfo = {
    streamType: number;
    pid: number;
    descriptor: number[];
};

class MPEGTSPMT extends MPEGTSPSIPacketBase {
    private crc32obj: jscrc.Crc = jscrc.crc32.create();
    assocProgram: number = 0;
    pcrpid: number = 0;
    descriptor: number[] = [];
    streams: MPEGTSPMTStreamInfo[] = [];

    protected realInit(): void {
        util.checkNumberEqual(this.buffer[0], 2, "table id not 2", true);
        util.checkNumberEqual(this.buffer[1] >> 7, 1, "section syntax indicator not 1", true);
        util.checkNumberEqual(this.buffer[1] >> 6 & 0x1, 0, "zero not 0", true);
        util.checkNumberEqual(this.buffer[1] >> 5 & 0x3, 3, "reserved not 3", true);

        // the remaining length also counts the header and CRC
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

        const descriptorLength = (this.buffer[10] & 0xF) << 8 | this.buffer[11];
        this.descriptor = this.buffer.slice(12, descriptorLength);
        this.crc32obj.update(this.buffer.splice(0, 12 + descriptorLength));

        if (!this.realUpdate())
            this.complete = true;
    }

    protected get requiredBytes(): number {
        return 12;
    }

    protected realReset(): void {
        this.crc32obj = jscrc.crc32.create();
        this.assocProgram = this.pcrpid = 0;
        this.streams = [];
    }

    protected realUpdate(): boolean {
        for (; this.remainingLength !== 4 && this.buffer.length >= 5; this.remainingLength -= 4) {
            let descriptorLength = (this.buffer[3] & 0xF) << 8 | this.buffer[4];
            if (5 + descriptorLength > this.buffer.length)
                break;

            util.checkNumberEqual(this.buffer[1] >> 5, 7, "reserved not 7", true);
            util.checkNumberEqual(this.buffer[3] >> 4, 15, "reserved2 not 15", true);

            this.streams.push({
                streamType: this.buffer[0],
                pid: (this.buffer[2] & 0x1F) << 8 | this.buffer[3],
                descriptor: this.buffer.slice(5, descriptorLength)
            });
            this.crc32obj.update(this.buffer.splice(0, 5 + descriptorLength));
        }

        if (this.remainingLength !== 4)
            return false;

        if (!util.arrayEquals(this.crc32obj.array(), this.buffer))
            throw new Error("PMT CRC32 mismatch");

        return true;
    }

    protected realDump(): number[] {
        const sectionLength: number = (
            9 +
            5 * this.streams.length +
            this.streams.reduce((a, e) => a + e.descriptor.length, 0)
        );
        const crc32obj: jscrc.Crc = jscrc.crc32.create();
        let dataToCRC: number[] = [
            0x02,
            0xB0 | sectionLength >> 8,
            sectionLength & 0xFF,
            this.assocProgram >> 8,
            this.assocProgram & 0xFF,
            0xC1,
            0x00,
            0x00,
            0xE0 | this.pcrpid >> 8,
            this.pcrpid & 0xFF,
            0xF0 | this.descriptor.length >> 8,
            this.descriptor.length & 0xFF,
            ...this.descriptor,
            ...(this.streams.map(
                e => [
                    e.streamType,
                    0xE0 | e.pid >> 8,
                    e.pid & 0xFF,
                    0xF0 | e.descriptor.length >> 8,
                    e.descriptor.length & 0xFF,
                    ...e.descriptor
                ]
            ).flat())
        ];

        crc32obj.update(dataToCRC);
        dataToCRC = dataToCRC.concat(crc32obj.array());
        return dataToCRC;
    }
}

class MPEGTSPES extends MPEGTSPESPacketBase {
    streamID: number = 0;
    // NOTE! pts and dts are 33-bit unsigned integers so they must be stored as BigInts
    pts: BigInt = 0n;
    dts: BigInt = 0n;
    hasPTS: boolean = false;
    hasDTS: boolean = false;
    header: number[] = [];
    payload: number[] = [];

    protected realInit(): void {
        if (this.buffer[0] || this.buffer[1] || this.buffer[2] !== 1)
            throw new Error("PES start code not 0x000001");

        this.streamID = this.buffer[3];
        this.remainingLength = this.buffer[4] << 8 | this.buffer[5];
        if (this.remainingLength)
            this.remainingLength = -1;

        this.header = this.buffer.splice(0, 5);

        // we only analyze deeper for video/audio streams
        if (this.streamID >> 5 === 6 || this.streamID >> 4 === 14) {
            util.checkNumberEqual(this.buffer[0] >> 6, 2, "start two bits not 2", true);

            switch (this.buffer[1] >> 6) {
                case 3:
                    this.hasDTS = this.hasPTS = true;
                    break;

                case 2:
                    console.warn("this PES has no DTS information");
                    this.hasPTS = true;
                    break;

                case 1:
                    throw new Error("PTS DTS flags value 1 is forbidden");

                case 0:
                    console.warn("this PES has no PTS and DTS information");
                    break;
            }

            if (this.hasDTS) { // we can save time by getting pts and dts at one time
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

            } else if (this.hasPTS) {
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

            this.header = this.header.concat(this.buffer.splice(0, 2 + this.buffer[2]));
        }

        if (!this.realUpdate())
            this.complete = true;
    }

    protected get requiredBytes(): number {
        return 6;
    }

    protected realReset(): void {
        this.streamID = 0;
        this.pts = this.dts = 0n;
        this.hasPTS = this.hasDTS = false;
        this.header = [];
        this.payload = [];
    }

    protected realUpdate(): boolean {
        if (this.remainingLength === -1) {
            this.payload = this.payload.concat(this.buffer);
            this.buffer = [];
            return false;
        }

        const sliceLength = Math.min(this.remainingLength, this.buffer.length);
        this.remainingLength -= sliceLength;
        this.payload = this.payload.concat(this.buffer.slice(0, sliceLength));
        this.buffer = [];
        return !this.remainingLength;
     }
    
    protected realDump(): number[] {
        return [
            ...this.header,
            ...this.payload
        ];
    }
}

type MPEGTSPESPacketWithIndex = {
    pes: MPEGTSPES;
    indexes: number[];
};

type MPEGTSPMTProgramAssoc = {
    pmt: MPEGTSPMT;
    pid: number;
    program: number;
};

// the super class representating a whole TS
class MPEGTS {
    pat: MPEGTSPAT = new MPEGTSPAT;
    pmts: MPEGTSPMTProgramAssoc[] = [];
    packets: MPEGTSPacket[] = [];

    constructor();
    constructor(data: number[]);

    constructor(data?: number[]) {
        if (typeof data === "undefined")
            return;

        this.update(data.slice());
    }

    reset(): void {
        this.pat.reset();
        this.pmts = [];
        this.packets = [];
    }

    update(data: number[]): void {
        data = data.slice();

        // first find if there's PAT
        while (data.length)
            this.packets.push(new MPEGTSPacket(data.splice(0, 188)));

        let patUpdated = false;
        for (const packet of this.packets) {
            if (packet.header.pid)
                continue;

            // we found one
            patUpdated = true;
            this.pat.update(packet);
            this.pmts = [];
            break;
        }

        // update PMT only if PAT is updated
        if (!patUpdated)
            return;

        // we find PMT a second time in case it is BEFORE PAT
        for (const packet of this.packets)
            for (const { program, pid } of this.pat.programPMTPIDMapping) {
                if (packet.header.pid !== pid)
                    continue;

                this.pmts.push({
                    pmt: new MPEGTSPMT(packet),
                    pid,
                    program
                });
                break;
            }
    }

    getPacketsByPID(pid: number): MPEGTSPESPacketWithIndex[] | MPEGTSPMT | MPEGTSPAT {
        const ret: MPEGTSPESPacketWithIndex[] = [];

        // return special tables rather than lookup again
        if (!pid)
            return this.pat;

        for (const { pmt, pid: pmtPID, program } of this.pmts)
            if (pid === pmtPID)
                return pmt;

        for (const packetIndex in this.packets) {
            let packet = this.packets[packetIndex];

            if (packet.header.pid !== pid)
                continue;

            if (ret.at(-1)?.pes.complete)
                ret.push({
                    pes: new MPEGTSPES(packet),
                    indexes: [Number(packetIndex)]
                });
            else {
                ret.at(-1)?.pes.update(packet);
                ret.at(-1)?.indexes.push(Number(packetIndex));
            }
        }

        return ret;
    }

    dump(): number[] {
        return this.packets.map(e => e.dump()).flat();
    }
}
