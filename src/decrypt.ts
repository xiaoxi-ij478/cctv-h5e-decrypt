"use strict";

import * as cctvWorkerModule from "./external/cctv.worker.js";

import * as nalutil from "./nalutil.js";
import * as util from "./util.js";

export { Decrypter };

class Decrypter {
    // each of the Decrypter instance will have its own CNTVH5PlayerModule module object
    private CNTVH5PlayerModule: cctvWorkerModule.CNTVModuleType;
    private shouldDecrypt: boolean = false;
    private vmpTag: string = "";
    private static readonly MemoryExtend: number = 2048;
    private ssss:number=0;

    loadFinished: Promise<void>;
    sessionBegin: boolean = false;

    constructor() {
        // trick the cctv.worker.js into thinking it is in a genuine environment
        globalThis.self = {
            location: globalThis.location = {
                hash: "",
                host: "",
                hostname: "",
                href: "blob:https://www.12371.cn/5bca710b-9f02-41f0-a9f1-102bbc65192a",
                origin: "https://www.12371.cn",
                pathname: "",
                port: "",
                protocol: "blob:",
                search: ""
            }
        };

        this.CNTVH5PlayerModule = cctvWorkerModule.CNTVModule();
        this.loadFinished = new Promise(
            resolve => {
                this.CNTVH5PlayerModule.onRuntimeInitialized = () => {
                    resolve();
                }
            }
        );
    }

    private __common(o: "InitPlayer" | "UnInitPlayer" | "UpdatePlayer"): number {
        const mediaTagID: string = "myPlayer_player";
        const memory: number = this.CNTVH5PlayerModule._jsmalloc(mediaTagID.length + 2048);

        this.CNTVH5PlayerModule.HEAP8.fill(0, memory, memory + mediaTagID.length + 2048);
        this.CNTVH5PlayerModule.HEAP8.set(Array.from(mediaTagID, e => e.charCodeAt(0)), memory);

        let ret: number = 0;
        switch (o) {
            case "InitPlayer":
                ret = this.CNTVH5PlayerModule._CNTV_InitPlayer(memory);
                break;

            case "UnInitPlayer":
                ret = this.CNTVH5PlayerModule._CNTV_UnInitPlayer(memory);
                break;

            case "UpdatePlayer":
                const _t: number = this.CNTVH5PlayerModule._CNTV_UpdatePlayer(memory);
                this.vmpTag = _t.toString(16);
                this.vmpTag = '0'.repeat(8 - this.vmpTag.length) + this.vmpTag;

                break;
        }

        this.CNTVH5PlayerModule._jsfree(memory);
        return ret;
    }
    private InitPlayer(): number { return this.__common("InitPlayer"); }
    private UnInitPlayer(): number { return this.__common("UnInitPlayer"); }
    private UpdatePlayer(): number { return this.__common("UpdatePlayer"); }

    beginDecryptSession(): void {
        if (this.sessionBegin)
            throw new Error("session already started");

        this.sessionBegin = true;
        this.InitPlayer();
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
        let useSpecialMediaTagID: boolean = true;
        switch (data.nalUnitType) {
            case 25:
                this.shouldDecrypt = data.payload[0] === 1;
                useSpecialMediaTagID = false;
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
        const pageHost: string = "https://www.12371.cn";
        const mediaTagID: string =
            useSpecialMediaTagID ? `myPlayer_player##0##0` : `myPlayer_player`;

        const addr: number = this.CNTVH5PlayerModule._jsmalloc(data.payload.byteLength + 1 + 2048);
        const addr2: number = this.CNTVH5PlayerModule._jsmalloc(mediaTagID.length + 1);

        this.CNTVH5PlayerModule.HEAP8[addr] = data.header;
        this.CNTVH5PlayerModule.HEAP8.set(data.payload, addr + 1);
        this.CNTVH5PlayerModule.HEAP8.set(
            Array.from(pageHost, e => e.charCodeAt(0)), addr + data.payload.byteLength + 1
        );
        this.CNTVH5PlayerModule.HEAP8.set(Array.from(mediaTagID, e => e.charCodeAt(0)), addr2);

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
                    pageHost.length
                );

        const decryptedLength: number = this.CNTVH5PlayerModule._CNTV_jsdecVOD8(
            addr2,
            addr,
            data.payload.byteLength + 1,
            pageHost.length
        );

        data.reloadData(Uint8Array.from(this.CNTVH5PlayerModule.HEAP8.subarray(addr, addr + decryptedLength)));

        this.CNTVH5PlayerModule._jsfree(addr);
        this.CNTVH5PlayerModule._jsfree(addr2);

        return data;
    }
}
