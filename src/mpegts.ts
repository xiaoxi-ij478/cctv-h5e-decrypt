"use strict";

import * as jsCrc from "js-crc";
import * as jsCrcModels from "js-crc/models";

import * as util from "./util.js";
import * as cmdutil from "./cmdutil.js";

export {
    MPEGTSPacketBase,
    MPEGTSPacketHeader,
    MPEGTSPacketAdaptationField,
    MPEGTSPacket,
    MPEGTSPESPacketBase,
    MPEGTSPATPIDMapping,
    MPEGTSPAT,
    MPEGTSPMTStreamInfo,
    MPEGTSPMT,
    MPEGTSPES,
    MPEGTSPESPacketWithIndex,
    MPEGTSPMTProgramAssoc,
    MPEGTS
};

const disableIntegrityCheck: boolean = false;

// TS layer packet
// these classes receive a bytearray as constructor argument
abstract class MPEGTSPacketBase {
    protected abstract init(data: Uint8Array<ArrayBuffer>): void;
    abstract reset(): void;
    abstract dump(): Uint8Array<ArrayBuffer>;

    reinit(data: Uint8Array<ArrayBuffer>): void {
        this.reset();
        this.init(data);
    }
}

class MPEGTSPacketHeader extends MPEGTSPacketBase {
    isContinuePacket = false;
    hasAdaptationControl = false;
    hasPayload = false;
    continuityCount = 0;
    transportPriority = 0;
    pid = 0;

    constructor();
    constructor(data: Uint8Array<ArrayBuffer>);

    constructor(data?: Uint8Array<ArrayBuffer>) {
        super();

        if (typeof data === "undefined")
            return;

        this.init(data);
    }

    protected init(data: Uint8Array<ArrayBuffer>): void {
        util.checkNumberEqual(data[0], 0x47, "sync byte error", !disableIntegrityCheck);
        util.checkNumberNotEqual(data[1] >> 7, 1, "error indicator set", !disableIntegrityCheck);

        this.isContinuePacket = !(data[1] >> 6 & 0x1);
        this.transportPriority = data[1] >> 5 & 0x1;
        this.pid = (data[1] & 0x1F) << 8 | data[2];

        util.checkNumberNotEqual(data[3] >> 4 & 0x3, 0, "adaptation field control field === 0", !disableIntegrityCheck);

        this.hasAdaptationControl = Boolean(data[3] >> 5 & 0x1);
        this.hasPayload = Boolean(data[3] >> 4 & 0x1);
        // we handle off the continuity check to the user
        this.continuityCount = data[3] & 0xF;
    }

    reset(): void {
        this.isContinuePacket = this.hasAdaptationControl = this.hasPayload = false;
        this.continuityCount = this.transportPriority = this.pid = 0;
    }

    dump(): Uint8Array<ArrayBuffer> {
        return Uint8Array.of(
            0x47,
            Number(!this.isContinuePacket) << 6 | this.transportPriority << 5 | this.pid >> 8,
            this.pid & 0xFF,
            Number(this.hasAdaptationControl) << 5 | Number(this.hasPayload) << 4 | this.continuityCount
        );
    }
}

class MPEGTSPacketAdaptationField extends MPEGTSPacketBase {
    payloadLength = 0;
    payload: Uint8Array<ArrayBuffer> | null = null;

    constructor();
    constructor(data: Uint8Array<ArrayBuffer>);

    constructor(data?: Uint8Array<ArrayBuffer>) {
        super();

        if (typeof data === "undefined")
            return;

        this.init(data);
    }

    protected init(data: Uint8Array<ArrayBuffer>): void {
        this.payloadLength = data[0];
        this.payload = data.subarray(1, this.payloadLength + 1);
    }

    reset(): void {
        this.payloadLength = 0;
        this.payload = null;
    }

    dump(): Uint8Array<ArrayBuffer> {
        return Uint8Array.of(
            this.payloadLength,
            ...(this.payload ?? [])
        );
    }
}

class MPEGTSPacket extends MPEGTSPacketBase {
    header = new MPEGTSPacketHeader;
    adaptationField: MPEGTSPacketAdaptationField | null = null;
    payload: Uint8Array<ArrayBuffer> | null = null;

    constructor();
    constructor(data: Uint8Array<ArrayBuffer>);

    constructor(data?: Uint8Array<ArrayBuffer>) {
        super();

        if (typeof data === "undefined")
            return;

        this.init(data);
    }

    protected init(data: Uint8Array<ArrayBuffer>): void {
        if (!disableIntegrityCheck && data.length !== 188) {
            cmdutil.warn("this MPEG TS Packet has trailing garbage, will discard them");
            data = data.subarray(0, 188);
        }

        this.header.reinit(data.subarray(0, 4));
        data = data.subarray(4);

        if (this.header.hasAdaptationControl) {
            this.adaptationField = new MPEGTSPacketAdaptationField(data);
            data = data.subarray(this.adaptationField.payloadLength + 1);
        }

        if (this.header.hasPayload)
            this.payload = data;
    }

    reset(): void {
        this.header.reset();
        this.adaptationField = null;
        this.payload = null;
    }

    dump(): Uint8Array<ArrayBuffer> {
        return Uint8Array.of(
            ...this.header.dump(),
            ...(this.adaptationField?.dump() ?? []),
            ...(this.payload ?? [])
        );
    }
}

// PES layer packet
// these classes receive a MPEGTSPacket object as argument
//
// if you're familiar with reset() and reinit(),
// that's because I copied them from MPEGTSPacketBase :)
abstract class MPEGTSPESPacketBase {
    protected currentCounter = 0;
    protected buffer = new Uint8Array;
    protected remainingLength = 0; // expected to be set by subclasses
    initialized = false;
    complete = false;
    pid = 0;

    protected abstract get requiredBytes(): number;
    protected abstract realInit(): void;
    protected abstract realReset(): void;
    protected abstract realUpdate(): boolean; // returns true when completed
    protected abstract realDump(): Uint8Array<ArrayBuffer>;

    protected init(data: MPEGTSPacket): void {
        if (!disableIntegrityCheck && data.header.isContinuePacket)
            throw new Error("MPEGTSPESPacketBase init() expects an initial packet");

        this.currentCounter = data.header.continuityCount;
        this.pid = data.header.pid;

        if (!data.header.hasPayload)
            return;

        this.initialized = true;
        this.buffer = data.payload!;

        if (!disableIntegrityCheck && this.buffer.length < this.requiredBytes)
            throw new Error("payload length less than required " + this.requiredBytes + " bytes");

        this.realInit();

        if (this.realUpdate())
            this.complete = true;
    }

    reset(): void {
        this.realReset();
        this.currentCounter = this.pid = 0;
        this.complete = this.initialized = false;
        this.buffer = new Uint8Array;
    }

    reinit(data: MPEGTSPacket): void {
        this.reset();
        this.init(data);
    }

    update(data: MPEGTSPacket): boolean {
        if (this.complete)
            throw new Error("Can't update a complete packet");

        if (!disableIntegrityCheck && !data.header.isContinuePacket)
            throw new Error("update() expects a continue packet");

        this.currentCounter++;
        this.currentCounter &= 0xF;

        util.checkNumberEqual(
            data.header.pid,
            this.pid,
            "provided packet's pid do not match that of this pes",
            !disableIntegrityCheck
        );
        util.checkNumberEqual(
            data.header.continuityCount,
            this.currentCounter,
            "continuity count mismatch",
            !disableIntegrityCheck
        );

        if (!data.header.hasPayload)
            return false;

        if (!this.initialized) {
            this.init(data);
            return this.complete;
        }

        this.buffer = util.appendUint8Array(this.buffer, data.payload!);

        if (this.realUpdate())
            this.complete = true;

        return this.complete;
    }

    dump(): Uint8Array<ArrayBuffer> {
        if (!this.complete)
            throw new Error("can't dump incomplete packet");

        return this.realDump();
    }
}

// PSI requires to remove the first byte and the length it indicates
abstract class MPEGTSPSIPacketBase extends MPEGTSPESPacketBase {
    protected additionalData: Uint8Array<ArrayBuffer> | null = null;

    protected init(data: MPEGTSPacket): void {
        if (!disableIntegrityCheck && data.header.isContinuePacket)
            throw new Error("MPEGTSPSIPacketBase init() expects an initial packet");

        this.initialized = true;
        this.currentCounter = data.header.continuityCount;
        this.pid = data.header.pid;

        if (data.header.hasPayload) {
            this.additionalData = data.payload!.subarray(0, data.payload![0]);
            this.buffer = data.payload!.subarray(data.payload![0] + 1);
        }

        if (!disableIntegrityCheck && this.buffer!.length < this.requiredBytes)
            throw new Error("payload length less than required " + this.requiredBytes + " bytes");

        this.realInit();

        if (this.realUpdate())
            this.complete = true;
    }

    dump(): Uint8Array<ArrayBuffer> {
        return Uint8Array.of(
            this.additionalData?.byteLength ?? 0,
            ...(this.additionalData ?? []),
            ...super.dump()
        );
    }
}

type MPEGTSPATPIDMapping = {
    program: number;
    pid: number;
}

class MPEGTSPAT extends MPEGTSPSIPacketBase {
    private crc32obj = jsCrcModels.default.crc_32_mpeg_2.create();
    transportStreamID = 0;
    programPMTPIDMapping: MPEGTSPATPIDMapping[] = [];

    constructor();
    constructor(data: MPEGTSPacket);

    constructor(data?: MPEGTSPacket) {
        super();

        if (typeof data === "undefined") {
            this.reset();
            return;
        }

        this.init(data);
    }

    protected realInit(): void {
        util.checkNumberEqual(this.buffer[0], 0, "table id not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[1] >> 7, 1, "section syntax indicator not 1", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[1] >> 6 & 0x1, 0, "zero not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[1] >> 4 & 0x3, 3, "reserved not 3", !disableIntegrityCheck);

        // the remaining length also counts the header and CRC
        this.remainingLength = (this.buffer[1] & 0xF) << 8 | this.buffer[2];
        if (!disableIntegrityCheck && this.remainingLength > 0x3FD)
            throw new Error("section length greater than 1021");

        this.remainingLength -= 5 /* header following section length */;

        this.transportStreamID = this.buffer[3] << 8 | this.buffer[4];

        util.checkNumberEqual(this.buffer[5] >> 6, 3, "reserved2 not 3", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[5] >> 1 & 0x1F, 0, "version not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[5] & 0x1, 1, "current next indicator not 1", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[6], 0, "section number not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[7], 0, "last section number not 0", !disableIntegrityCheck);

        this.crc32obj.update(this.buffer.subarray(0, 8 /* total header length */));
        this.buffer = this.buffer.subarray(8);
    }

    protected get requiredBytes(): number {
        return 8;
    }

    protected realReset(): void {
        this.crc32obj = jsCrcModels.default.crc_32_mpeg_2.create();
        this.programPMTPIDMapping = [];
    }

    protected realUpdate(): boolean {
        for (; this.remainingLength > 4 && this.buffer.length >= 4; this.remainingLength -= 4) {
            util.checkNumberEqual(this.buffer[2] >> 5, 7, "reserved3 not 7", !disableIntegrityCheck);

            this.programPMTPIDMapping.push({
                program: this.buffer[0] << 8 | this.buffer[1],
                pid: (this.buffer[2] & 0x1F) << 8 | this.buffer[3]
            });
            this.crc32obj.update(this.buffer.subarray(0, 4));
            this.buffer = this.buffer.subarray(4);
        }

        if (this.remainingLength < 4) {
            if (!disableIntegrityCheck)
                throw new Error("CRC32 length < 4");

        } else if (this.remainingLength > 4)
            return false;

        if (
            !disableIntegrityCheck &&
            !util.arrayEquals(
                Uint8Array.from(this.crc32obj.array()),
                this.buffer.subarray(0, 4)
            )
        )
            throw new Error("PAT CRC32 mismatch");

        this.remainingLength = 0;
        return true;
    }

    protected realDump(): Uint8Array<ArrayBuffer> {
        const sectionLength: number = (
            5 + // header following section length
            4 + // crc
            4 * this.programPMTPIDMapping.length // pmt pid mapping length
        );
        if (!disableIntegrityCheck && sectionLength > 0x3FD)
            throw new Error("section length greater than 1021");

        const crc32obj: jsCrc.Crc = jsCrcModels.default.crc_32_mpeg_2.create();
        let dataToCRC = Uint8Array.of(
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
        );

        crc32obj.update(dataToCRC);
        dataToCRC = util.appendUint8Array(dataToCRC, Uint8Array.from(crc32obj.array()));
        return dataToCRC;
    }
}

type MPEGTSPMTStreamInfo = {
    streamType: number;
    pid: number;
    descriptor: Uint8Array<ArrayBuffer>;
};

class MPEGTSPMT extends MPEGTSPSIPacketBase {
    private crc32obj = jsCrcModels.default.crc_32_mpeg_2.create();
    assocProgram = 0;
    pcrpid = 0;
    descriptor = new Uint8Array;
    streams: MPEGTSPMTStreamInfo[] = [];

    constructor();
    constructor(data: MPEGTSPacket);

    constructor(data?: MPEGTSPacket) {
        super();

        if (typeof data === "undefined") {
            this.reset();
            return;
        }

        this.init(data);
    }

    protected realInit(): void {
        util.checkNumberEqual(this.buffer[0], 2, "table id not 2", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[1] >> 7, 1, "section syntax indicator not 1", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[1] >> 6 & 0x1, 0, "zero not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[1] >> 4 & 0x3, 3, "reserved not 3", !disableIntegrityCheck);

        this.remainingLength = (this.buffer[1] & 0xF) << 8 | this.buffer[2];
        if (!disableIntegrityCheck && this.remainingLength > 0x3FD)
            throw new Error("section length greater than 1021");

        this.assocProgram = this.buffer[3] << 8 | this.buffer[4];

        util.checkNumberEqual(this.buffer[5] >> 6, 3, "reserved2 not 3", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[5] >> 1 & 0x1F, 0, "version not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[5] & 0x1, 1, "current next indicator not 1", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[6], 0, "section number not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[7], 0, "last section number not 0", !disableIntegrityCheck);
        util.checkNumberEqual(this.buffer[8] >> 5, 7, "reserved3 not 7", !disableIntegrityCheck);

        this.pcrpid = (this.buffer[8] & 0x1F) << 8 | this.buffer[9];

        util.checkNumberEqual(this.buffer[10] >> 4, 15, "reserved4 not 15", !disableIntegrityCheck);

        const descriptorLength = (this.buffer[10] & 0xF) << 8 | this.buffer[11];
        this.descriptor = this.buffer.subarray(12, descriptorLength + 12);

        // the remaining length also counts the header and CRC
        this.remainingLength -= 9 /* header following section length */ + descriptorLength;

        this.crc32obj.update(this.buffer.subarray(0, 12 /* total header length */ + descriptorLength));
        this.buffer = this.buffer.subarray(12 + descriptorLength);
    }

    protected get requiredBytes(): number {
        return 12;
    }

    protected realReset(): void {
        this.crc32obj = jsCrcModels.default.crc_32_mpeg_2.create();
        this.assocProgram = this.pcrpid = 0;
        this.descriptor = new Uint8Array;
        this.streams = [];
    }

    protected realUpdate(): boolean {
        while (this.remainingLength > 4 && this.buffer.length >= 5) {
            let descriptorLength = (this.buffer[3] & 0xF) << 8 | this.buffer[4];
            if (5 + descriptorLength > this.buffer.length)
                break;

            util.checkNumberEqual(this.buffer[1] >> 5, 7, "reserved not 7", !disableIntegrityCheck);
            util.checkNumberEqual(this.buffer[3] >> 4, 15, "reserved2 not 15", !disableIntegrityCheck);

            this.streams.push({
                streamType: this.buffer[0],
                pid: (this.buffer[1] & 0x1F) << 8 | this.buffer[2],
                descriptor: this.buffer.subarray(5, descriptorLength)
            });
            this.crc32obj.update(this.buffer.subarray(0, 5 + descriptorLength));
            this.buffer = this.buffer.subarray(5 + descriptorLength);
            this.remainingLength -= 5 + descriptorLength;
        }

        if (this.remainingLength < 4) {
            if (!disableIntegrityCheck)
                throw new Error("CRC32 length < 4");

        } else if (this.remainingLength > 4)
            return false;

        if (
            !disableIntegrityCheck &&
            !util.arrayEquals(
                Uint8Array.from(this.crc32obj.array()),
                this.buffer.subarray(0, 4)
            )
        )
            throw new Error("PMT CRC32 mismatch");

        this.remainingLength = 0;
        return true;
    }

    protected realDump(): Uint8Array<ArrayBuffer> {
        const sectionLength: number = (
            9 + // header following section length
            4 + // crc
            5 * this.streams.length + // streams basic length
            this.streams.reduce((a, e) => a + e.descriptor.length, 0) // streams descriptor length
        );
        if (!disableIntegrityCheck && sectionLength > 0x3FD)
            throw new Error("section length greater than 1021");

        const crc32obj: jsCrc.Crc = jsCrcModels.default.crc_32_mpeg_2.create();
        let dataToCRC = Uint8Array.of(
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
        );

        crc32obj.update(dataToCRC);
        dataToCRC = util.appendUint8Array(dataToCRC, Uint8Array.from(crc32obj.array()));
        return dataToCRC;
    }
}

class MPEGTSPES extends MPEGTSPESPacketBase {
    streamID = 0;
    // NOTE! pts and dts are 33-bit unsigned integers so they must be stored as BigInts
    // pts = 0n;
    // dts = 0n;
    // hasPTS = false;
    // hasDTS = false;
    header = new Uint8Array;
    payload = new Uint8Array;
    payloadStartOffset = 0;

    constructor();
    constructor(data: MPEGTSPacket);

    constructor(data?: MPEGTSPacket) {
        super();

        if (typeof data === "undefined") {
            this.reset();
            return;
        }

        this.init(data);
    }

    protected realInit(): void {
        if (!disableIntegrityCheck && (this.buffer[0] || this.buffer[1] || this.buffer[2] !== 1))
            throw new Error("PES start code not 0x000001");

        this.streamID = this.buffer[3];
        this.remainingLength = this.buffer[4] << 8 | this.buffer[5];
        if (!this.remainingLength)
            this.remainingLength = -1;

        // if the size is undefined it must be at least 1 MiB, so we allocate 1 MiB
        this.payload = util.allocUint8Array(this.remainingLength === -1 ? (1 << 20) : this.remainingLength);
        this.header = this.buffer.subarray(0, 6);
        this.buffer = this.buffer.subarray(6);

        // we only analyze deeper for video/audio streams
        if (this.streamID >> 5 === 6 || this.streamID >> 4 === 14) {
            util.checkNumberEqual(this.buffer[0] >> 6, 2, "start two bits not 2", !disableIntegrityCheck);
/*
            switch (this.buffer[1] >> 6) {
                case 3:
                    this.hasDTS = this.hasPTS = true;
                    break;

                case 2:
                    // cmdutil.warn("this PES has no DTS information");
                    this.hasPTS = true;
                    break;

                case 1:
                    if (!disableIntegrityCheck)
                        throw new Error("PTS DTS flags value 1 is forbidden");

                case 0:
                    // cmdutil.warn("this PES has no PTS and DTS information");
                    break;
            }

            if (this.hasDTS) {
                if (!disableIntegrityCheck) {
                    util.checkNumberEqual(this.buffer[3] >> 4, 3, "fixed 0b0011 not correct");
                    util.checkNumberEqual(this.buffer[3] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[5] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[7] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[8] >> 4, 1, "fixed 0b0001 not correct");
                    util.checkNumberEqual(this.buffer[8] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[10] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[12] & 1,   1, "fixed 0b1 not correct");
                }

                this.pts = (
                    (BigInt(this.buffer[3]) >> 1n & 0x7n) << 30n |
                    (BigInt(this.buffer[4]) << 7n | BigInt(this.buffer[5]) >> 1n) << 15n |
                    (BigInt(this.buffer[6]) << 7n | BigInt(this.buffer[7]) >> 1n)
                );

                this.dts = (
                    (BigInt(this.buffer[8]) >> 1n & 0x7n) << 30n |
                    (BigInt(this.buffer[9]) << 7n | BigInt(this.buffer[10]) >> 1n) << 15n |
                    (BigInt(this.buffer[11]) << 7n | BigInt(this.buffer[12]) >> 1n)
                );

            } else if (this.hasPTS) {
                if (!disableIntegrityCheck) {
                    util.checkNumberEqual(this.buffer[3] >> 4, 2, "fixed 0b0010 not correct");
                    util.checkNumberEqual(this.buffer[3] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[5] & 1, 1, "fixed 0b1 not correct");
                    util.checkNumberEqual(this.buffer[7] & 1, 1, "fixed 0b1 not correct");
                }

                this.pts = (
                    (BigInt(this.buffer[3]) >> 1n & 0x7n) << 30n |
                    (BigInt(this.buffer[4]) << 7n | BigInt(this.buffer[5]) >> 1n) << 15n |
                    (BigInt(this.buffer[6]) << 7n | BigInt(this.buffer[7]) >> 1n)
                );
            }
*/
            this.payloadStartOffset = 6 + 3 + this.buffer[2];
            this.header = util.appendUint8Array(
                this.header,
                this.buffer.subarray(0, 3 + this.buffer[2])
            );
            this.buffer = this.buffer.subarray(3 + this.buffer[2])
        }
    }

    protected get requiredBytes(): number {
        return 6;
    }

    protected realReset(): void {
        this.streamID = 0;
        // this.pts = this.dts = 0n;
        // this.hasPTS = this.hasDTS = false;
        this.header = this.payload = new Uint8Array;
    }

    protected realUpdate(): boolean {
        if (this.remainingLength === -1) {
            this.payload = util.appendUint8Array(this.payload, this.buffer);
            this.buffer = new Uint8Array;
            return false;
        }

        const sliceLength = Math.min(this.remainingLength, this.buffer.length);
        this.remainingLength -= sliceLength;
        this.payload = util.appendUint8Array(
            this.payload,
            this.buffer.subarray(0, sliceLength)
        );
        this.buffer = new Uint8Array;
        return !this.remainingLength;
     }

    protected realDump(): Uint8Array<ArrayBuffer> {
        return Uint8Array.of(
            ...this.header,
            ...this.payload
        );
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
    // pat = new MPEGTSPAT;
    // pmts: MPEGTSPMTProgramAssoc[] = [];
    packets: MPEGTSPacket[] = [];

    constructor();
    constructor(data: Uint8Array<ArrayBuffer>);

    constructor(data?: Uint8Array<ArrayBuffer>) {
        if (typeof data === "undefined")
            return;

        this.update(data);
    }

    reset(): void {
        // this.pat.reset();
        // this.pmts = [];
        this.packets = [];
    }

    update(data: Uint8Array<ArrayBuffer>): void {
        while (data.byteLength) {
            this.packets.push(new MPEGTSPacket(data.subarray(0, 188)));
            data = data.subarray(188);
        }
/*
        // first find if there's PAT
        let patUpdated = false;
        for (const packet of this.packets) {
            if (packet.header.pid)
                continue;

            if (!this.pat.initialized) {
                this.pat.reinit(packet);
                continue;
            } else if (!this.pat.complete) {
                this.pat.update(packet);
                continue;
            }

            if (patUpdated)
                continue;

            // we found one
            patUpdated = true;
            this.pat = new MPEGTSPAT(packet);
            this.pmts = [];
        }

        // update PMT only if PAT is updated
        if (!patUpdated)
            return;

        // we find PMT a second time in case it is BEFORE PAT
        for (const packet of this.packets)
            for (const { program, pid } of this.pat.programPMTPIDMapping) {
                if (!program)
                    continue;

                if (packet.header.pid !== pid)
                    continue;

                let noAdd = false;
                for (const { pmt, pid: pmtPID, program } of this.pmts)
                    if (pid === pmtPID)
                        noAdd = true;

                if (!noAdd)
                    this.pmts.push({
                        pmt: new MPEGTSPMT(packet),
                        pid,
                        program
                    });

                break;
            }
*/
    }

    getPacketsByPID(pid: number): MPEGTSPESPacketWithIndex[] { // | MPEGTSPMT | MPEGTSPAT {
        const ret: MPEGTSPESPacketWithIndex[] = [];
/*
        // return special tables rather than lookup again
        if (!pid)
            return this.pat;

        for (const { pmt, pid: pmtPID, program } of this.pmts)
            if (pid === pmtPID)
                return pmt;
*/
        // do two pass to speed up pes packet merge
        // first pass: just create pes packet without updating
        for (const packetIndex in this.packets) {
            let packet = this.packets[packetIndex];

            if (packet.header.pid !== pid)
                continue;

            if (!packet.header.isContinuePacket)
                ret.push({
                    pes: new MPEGTSPES(packet),
                    indexes: [Number(packetIndex)]
                });
        }

        // second pass: actual update, use s as the current packet index
        let s = -1;
        for (const packetIndex in this.packets) {
            let packet = this.packets[packetIndex];

            if (packet.header.pid !== pid)
                continue;

            if (!packet.header.isContinuePacket) {
                s++;
                continue;
            }

            ret[s]!.pes.update(packet);
            ret[s]!.indexes.push(Number(packetIndex));
        }

        return ret;
    }

    dump(): Uint8Array<ArrayBuffer> {
        return util.concatUint8Arrays(this.packets.map((e, i) => e.dump()));
    }
}
