"use strict";

import { CNTVModule } from "/cctv_worker_new";
import * as nalutil from "./nalutil";

type CNTVjsdecFuncType = (
    mediaTagIDAddr: number,
    dataAndPageHostAddr: number,
    dataLength: number,
    pageHostLength: number
) => number;

// note: they may be inaccurate, because i'm just guessing them...
declare let CNTVModule: {
    HEAP8: Int8Array;

    _CNTV_InitPlayer(mediaTagIDAddr: number): number;
    _CNTV_UnInitPlayer(mediaTagIDAddr: number): number;
    _CNTV_UpdatePlayer(mediaTagIDAddr: number): number;
    _CNTV_jsdecVOD0: CNTVjsdecFuncType;
    _CNTV_jsdecVOD1: CNTVjsdecFuncType;
    _CNTV_jsdecVOD2: CNTVjsdecFuncType;
    _CNTV_jsdecVOD3: CNTVjsdecFuncType;
    _CNTV_jsdecVOD4: CNTVjsdecFuncType;
    _CNTV_jsdecVOD5: CNTVjsdecFuncType;
    _CNTV_jsdecVOD6: CNTVjsdecFuncType;
    _CNTV_jsdecVOD7: CNTVjsdecFuncType;
    _CNTV_jsdecVOD8: CNTVjsdecFuncType;

    _jsmalloc(size: number): number;
    _jsfree(addr: number): void;

    onRuntimeInitialized(): void;
};

// media tag id cannot be determined after dts and whether it's first session is determined
// so we switch to use prefix and suffix
// full format is "myPlayer_player##<dts timestamp>##<seeked ? 1 : 0>
// (though i was unable to produce 1 on seek)
const mediaTagIDPrefix: string = "myPlayer_player##", mediaTagIDSuffix: string = "##";
const MemoryExtend: number = 2048;
let vmpTag: string = "";
let shouldDecrypt: boolean = false;
let sessionBegan: boolean = false;

function __common(o: "InitPlayer" | "UnInitPlayer" | "UpdatePlayer"): number {
    const memory = CNTVModule._jsmalloc(mediaTagID.length + MemoryExtend);

    CNTVModule.HEAP8.fill(0, memory, memory + mediaTagID.length + MemoryExtend);
    CNTVModule.HEAP8.set(Array.from(mediaTagID, e => e.charCodeAt(0)), memory);

    let ret: number;
    switch (o) {
        case "InitPlayer":
            ret = CNTVModule._CNTV_InitPlayer(memory);
            break;
        case "UnInitPlayer":
            ret = CNTVModule._CNTV_UnInitPlayer(memory);
            break;
        case "UpdatePlayer":
            vmpTag = CNTVModule._CNTV_UpdatePlayer(memory).toString(16);
            vmpTag = ['0'.repeat(8 - vmpTag.length), vmpTag].join('');
            ret = 0;
            break;
    }

    CNTVModule._jsfree(memory);
    return ret;
}

function InitPlayer(): number { return __common("InitPlayer"); }
function UnInitPlayer(): number { return __common("UnInitPlayer"); }
function UpdatePlayer(): number { return __common("UpdatePlayer"); }

function beginDecryptSession(): void {
    if (sessionBegan)
        throw new Error("session already started");

    InitPlayer();
}

function endDecryptSession(): void {
    if (!sessionBegan)
        throw new Error("session not started yet");

    UnInitPlayer();
}

// warning: this function will modify `data` in-place
function decryptNALU(data: nalutil.NALU): nalutil.NALU {
    if (!sessionBegan)
        throw new Error("session not started yet");

    switch (data.nalUnitType) {
        case 1:
        case 5:
        case 25:
            break;

        default:
            return data;
    }

    UpdatePlayer();

    const pageHost: string = "https://tv.cctv.com";
    const addr: number = CNTVModule._jsmalloc(data.data.length + MemoryExtend);

    // in fact, these can be replaced with simple _CNTV_jsdec<n> calls,
    // but i just list the keys set by cctv for fun here
    // to not saturate the screen with argument lists, i shortened them to a single letter
    // for the details of the arguments see the type definition at the top of this file
    const StaticCallModuleVod = {
        H264NalSet: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD7(a, b, c, d);
        },
        H265NalData: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD6(a, b, c, d);
        },
        AVS1AudioKey: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD5(a, b, c, d);
        },
        HEVC2AAC: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD4(a, b, c, d);
        },
        HASHMap: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD3(a, b, c, d);
        },
        BASE64Dec: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD2(a, b, c, d);
        },
        MediaSession: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD1(a, b, c, d);
        },
        Mp4fragment: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD0(a, b, c, d);
        },
        MpegAudio: function (CNTVModule, a, b, c, d) {
            return CNTVModule._CNTV_jsdecVOD8(a, b, c, d);
        },
        AACDemuxer: function (CNTVModule, a, b, c, d) {
            return CNTVModule._jsdecVOD(b, c, d);
        }
    };
    function StaticCallModuleVodAPI(CNTVModule, a, b, c, d, index): number {
        return StaticCallModuleVod[index](CNTVModule, a, b, c, d);
    }

    CNTVModule.HEAP8.set(data.data, addr);
    CNTVModule.HEAP8.set(
        Array.from(pageHost, e => e.charCodeAt(0)), addr + data.data.length
    );
    const addr2: number = CNTVModule._jsmalloc(mediaTagID.length);
    CNTVModule.HEAP8.set(Array.from(mediaTagID, e => e.charCodeAt(0)), addr2);

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
    // e == CNTVModule
    // h == addr
    // p == addr2
    // c == data.data.length
    // l == pageHost.length
    for (const i in vmpTag)
        if ("0123456".includes(vmpTag[i]))
            StaticCallModuleVodAPI(
                CNTVModule,
                addr2,
                addr,
                data.data.length,
                pageHost.length,
                Object.keys(StaticCallModuleVod)[i]
            );

    const decryptedLength: number = StaticCallModuleVodAPI(
        CNTVModule,
        addr2,
        addr,
        data.data.length,
        pageHost.length,
        Object.keys(StaticCallModuleVod)[8]
    );
    data.data = Array.from(CNTVModule.HEAP8.slice(addr, addr + decryptedLength));

    CNTVModule._jsfree(addr);
    CNTVModule._jsfree(addr2);

    if (data.nalUnitType === 25)
        shouldDecrypt = data.data[0] === 1;

    return data;
}
