"use strict";

import * as cctvWorkerModule from "./external/cctv.worker.js";

import * as nalutil from "./nalutil.js";
import * as mpegts from "./mpegts.js";
import * as util from "./util.js";
import * as cmdutil from "./cmdutil.js";

export { Decrypter };

// note: this is a synchronous decrypter.
// if you call the decrypt function, your js runtime env will be blocked
// so it is recommended to use this class in a worker
class Decrypter {
    // each of the Decrypter instance will have its own CNTVH5PlayerModule module object
    private CNTVH5PlayerModule = cctvWorkerModule.CNTVModule();
    private shouldDecrypt = false;
    private vmpTag = "";
    private sessionBegin = false;
    private loadFinished: Promise<void>;

    private static readonly pageHost = "https://tv.cctv.com";
    private static readonly mediaTagID = "player_container_player";
    private static readonly MemoryExtend = 2048;

    constructor() {
        this.loadFinished = new Promise(
            resolve =>
                this.CNTVH5PlayerModule.onRuntimeInitialized = () => resolve()
        );
    }

    private __common(o: "InitPlayer" | "UnInitPlayer" | "UpdatePlayer"): number {
        const memory: number = this.CNTVH5PlayerModule._jsmalloc(Decrypter.mediaTagID.length + Decrypter.MemoryExtend);

        this.CNTVH5PlayerModule.HEAP8.fill(0, memory, memory + Decrypter.mediaTagID.length + Decrypter.MemoryExtend);
        this.CNTVH5PlayerModule.HEAP8.set(Array.from(Decrypter.mediaTagID, e => e.charCodeAt(0)), memory);

        let ret: number = 0;
        switch (o) {
            case "InitPlayer":
                ret = this.CNTVH5PlayerModule._CNTV_InitPlayer(memory);
                break;

            case "UnInitPlayer":
                ret = this.CNTVH5PlayerModule._CNTV_UnInitPlayer(memory);
                break;

            case "UpdatePlayer":
                this.vmpTag = this.CNTVH5PlayerModule._CNTV_UpdatePlayer(memory).toString(16).padStart(8, "0");
                break;
        }

        this.CNTVH5PlayerModule._jsfree(memory);
        return ret;
    }
    private InitPlayer(): number   { return this.__common("InitPlayer"); }
    private UnInitPlayer(): number { return this.__common("UnInitPlayer"); }
    private UpdatePlayer(): number { return this.__common("UpdatePlayer"); }

    async beginDecryptSession(): Promise<void> {
        if (this.sessionBegin)
            throw new Error("session already started");

        await this.loadFinished;
        this.sessionBegin = true;
        this.InitPlayer();
        // wait for the json download to complete
        // i know it's very inaccurate
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    endDecryptSession(): void {
        if (!this.sessionBegin)
            throw new Error("session not started yet");

        this.sessionBegin = false;
        this.UnInitPlayer();
    }

    // warning: this function will modify `data` in-place
    decryptNALU(data: nalutil.NALU): nalutil.NALU {
        if (!this.sessionBegin)
            throw new Error("session not started yet");

        this.UpdatePlayer();
        let useSpecialmediaTagID = true;
        switch (data.nalUnitType) {
            case 25:
                this.shouldDecrypt = data.payload[0] === 1;
                useSpecialmediaTagID = false;

                break;

            case 1:
            case 5:
                if (!this.shouldDecrypt)
                    return data;

                break;

            default:
                return data;
        }

        // i just list the keys set by cctv for fun here
        // const StaticCallModuleVod = {
        //    H264NalSet:   (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD7(a, b, c, d),
        //    H265NalData:  (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD6(a, b, c, d),
        //    AVS1AudioKey: (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD5(a, b, c, d),
        //    HEVC2AAC:     (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD4(a, b, c, d),
        //    HASHMap:      (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD3(a, b, c, d),
        //    BASE64Dec:    (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD2(a, b, c, d),
        //    MediaSession: (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD1(a, b, c, d),
        //    Mp4fragment:  (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD0(a, b, c, d),
        //    MpegAudio:    (a, b, c, d) => this.CNTVH5PlayerModule._CNTV_jsdecVOD8(a, b, c, d),
        //    AACDemuxer:   (a, b, c, d) => this.CNTVH5PlayerModule._jsdecVOD(b, c, d)
        //};
        // const StaticCallModuleVodAPI = (a, b, c, d, index) => StaticCallModuleVod[index](a, b, c, d);

        // media tag id cannot be determined after dts and whether it's first session is determined
        // so we switch to use prefix and suffix
        // full format is "myPlayer_player##<dts timestamp>##<seeked ? 1 : 0>
        // (though i was unable to produce 1 on seek)
        const localmediaTagID =
            useSpecialmediaTagID ? `${Decrypter.mediaTagID}##1000000##0` : Decrypter.mediaTagID;

        const addr = this.CNTVH5PlayerModule._jsmalloc(data.payload.byteLength + 1 + Decrypter.MemoryExtend);
        const addr2 = this.CNTVH5PlayerModule._jsmalloc(localmediaTagID.length + 1);

        this.CNTVH5PlayerModule.HEAP8[addr] = data.header;
        this.CNTVH5PlayerModule.HEAP8.set(data.payload, addr + 1);
        this.CNTVH5PlayerModule.HEAP8.set(
            Array.from(Decrypter.pageHost, e => e.charCodeAt(0)), addr + data.payload.byteLength + 1
        );
        this.CNTVH5PlayerModule.HEAP8.set(Array.from(localmediaTagID, e => e.charCodeAt(0)), addr2);

        // how is this function called:
        // if (d && '' != d) for (var m in d) this[r(492)].includes(d[m]) &&
        // this[r(497)](e, p, h, c, l, Object[r(533)](this.StaticCallModuleVod) [m]);
        // f = this.StaticCallModuleVodAPI(e, p, h, c, l, Object[r(533)](this[r(510)]) [8])
        // where:
        // r(492) == StaticCallModuleVodMap == Array.from("0123456")
        // r(497) == StaticCallModuleVodAPI
        // r(533) == keys
        // r(510) == StaticCallModuleVod
        // d == vmpTag
        // e == CNTVH5PlayerModule
        // h == addr
        // p == addr2
        // c == data.payload.byteLength
        // l == pageHost.length
        //
        // in this version i simplified the CNTVH5PlayerModule argument
        for (let i = 0; i < this.vmpTag.length; i++)
            if ("0123456".includes(this.vmpTag[i]))
                this.CNTVH5PlayerModule[
                    `_CNTV_jsdecVOD${7 - i}` as keyof cctvWorkerModule.CNTVModuleType
                ](
                    addr2,
                    addr,
                    data.payload.byteLength + 1,
                    Decrypter.pageHost.length
                );

        const decryptedLength = this.CNTVH5PlayerModule._CNTV_jsdecVOD8(
            addr2,
            addr,
            data.payload.byteLength + 1,
            Decrypter.pageHost.length
        );

        data.reloadData(Uint8Array.from(this.CNTVH5PlayerModule.HEAP8.subarray(addr, addr + decryptedLength)));

        this.CNTVH5PlayerModule._jsfree(addr);
        this.CNTVH5PlayerModule._jsfree(addr2);

        return data;
    }

    // warning: this function will modify `tsFile` in-place
    decryptTsBuffer(tsFile: mpegts.MPEGTS): mpegts.MPEGTS {
        let videoStreamPID = -1;
/*
        // assume there's just one PMT
        for (const stream of tsFile.pmts[0].pmt.streams) {
            if (stream.streamType !== 0x1B)
                continue; // video stream

            videoStreamPID = stream.pid;
            break;
        }

        if (videoStreamPID === -1)
            throw new Error("video stream not found");
*/
        // for now, just assume 0x100 is video PID
        const peses = (tsFile.getPacketsByPID(0x100) as mpegts.MPEGTSPESPacketWithIndex[]);
        for (
            const [i, { pes, indexes }] of
            peses.entries()
        ) {
            const nalus = nalutil.splitNALU(pes.payload!);

            for (const nalu of nalus)
                this.decryptNALU(nalu);

            let newNALU = nalutil.joinNALU(nalus);

            for (const index of indexes) {
                const tsPacket: mpegts.MPEGTSPacket = tsFile.packets[index];
                const offset: number = tsPacket.header.isContinuePacket ? 0 : pes.payloadStartOffset;
                // copy the whole ts packet payload by default
                let bytesToCopy: number = tsPacket.payload!.byteLength;

                if (!tsPacket.payload)
                    continue;

                if (tsPacket.payload.byteLength - offset > newNALU.byteLength) {
                    // this means that the remaining NALU would be smaller than the current TS packet
                    // so we need to adjust adaptation field accordingly

                    if (!tsPacket.adaptationField)
                        tsPacket.adaptationField = new mpegts.MPEGTSPacketAdaptationField;

                    // adaptation field payload length =
                    // 188 (ts packet length)
                    // - 4 (ts packet header)
                    // - 1 (adaptation field length)
                    // - offset (if it is a begin packet then also count pes header)
                    // - newNALU.byteLength (actual data length)
                    tsPacket.adaptationField.payloadLength = 188 - 4 - 1 - offset - newNALU.byteLength;
                    if (tsPacket.adaptationField.payloadLength)
                        tsPacket.adaptationField.payload = util.concatUint8Arrays([
                                // the header (we put nothing inside)
                                Uint8Array.of(0x00),

                                tsPacket.adaptationField.payloadLength > 1 ?
                                    new Uint8Array(tsPacket.adaptationField.payloadLength - 1).fill(0xFF) :
                                    new Uint8Array
                            ]);

                    // set the actual copy length to the nalu length plus the pes header if exists
                    bytesToCopy = newNALU.byteLength + offset;
                }

                tsPacket.payload = util.concatUint8Arrays([
                    // pes header if exists
                    tsPacket.payload.subarray(0, offset),
                    // nalu content
                    newNALU.subarray(0, bytesToCopy - offset)
                ]);
                // remove the copied bytes
                newNALU = newNALU.subarray(bytesToCopy - offset);
            }
        }

        return tsFile;
    }
}
