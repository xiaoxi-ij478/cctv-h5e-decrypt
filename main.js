"use strict";

import child_process from "child_process";
import events from "events";
import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import process from "process";

const NAL_START_FIRST = Buffer.from("00000001", "hex");
const NAL_START_SECOND = Buffer.from("000001", "hex");
const THREAD_NUMBER = 8;

let quietFFmpeg = false;

function NALUnit(data) {
    if (data.subarray(0, 4).equals(NAL_START_FIRST)) {
        this.start = data.subarray(0, 4);
        this.header = data[4];
        this.data = data.subarray(5);
    } else if (data.subarray(0, 3).equals(NAL_START_SECOND)) {
        this.start = data.subarray(0, 3);
        this.header = data[3];
        this.data = data.subarray(4);
    } else
        throw new Error("NAL unit start mismatch");

    this.forbiddenZeroBit = this.header >> 7;
    this.nalRefIdc = this.header >> 5 & 0x3;
    this.nalUnitType = this.header & 0x1F;
}

NALUnit.prototype.reload = function (data) {
    this.header = data[0];
    this.data = data.subarray(1);

    this.forbiddenZeroBit = this.header >> 7;
    this.nalRefIdc = this.header >> 5 & 0x3;
    this.nalUnitType = this.header & 0x1F;
};

NALUnit.prototype.dump = function () {
    return Buffer.concat([this.start, Buffer.from([this.header]), this.data]);
}

async function runFFmpeg(inFileNames, outFileName, extraInFlags, extraOutFlags) {
    extraOutFlags.push(..."-c copy".split(' '));
    extraInFlags.push("-y");
    if (quietFFmpeg)
        extraInFlags.push(..."-loglevel quiet".split(' '));

    const args = [
        extraInFlags,
        inFileNames.map(e => [ "-i", e ]),
        extraOutFlags,
        outFileName,
    ].flat(2);
    const ffmpegProcess = child_process.spawn("ffmpeg", args, { stdio: "inherit" });

    const [code, signal] = await events.once(ffmpegProcess, "exit");
    if (code) {
        console.error("Error occurred while running ffmpeg.");
        process.exit(1);
    }
}

function getNaluPos(buf) {
    let start, prev = 0, off = 0;
    const ret = [];

    while ((start = buf.indexOf(Buffer.from("0000", "hex"), off + 2)) !== -1) {
        switch (buf[start + 2]) {
            case 0:
                if (buf[start + 3] === 1) {
                    ret.push([prev, start]);
                    prev = start;
                }
                break;
            case 1:
                ret.push([prev, start]);
                prev = start;
                break;
        }
        off = start;
    }

    ret.push([prev, buf.length]);

    return ret;
}

async function mainDecrypter(CNTVH5PlayerModule) {
    let curDate = Date.now().toString();
    const MemoryExtend = 2048;
    let vmpTag = '';

    function _common(o) {
        const memory = CNTVH5PlayerModule._jsmalloc(curDate.length + MemoryExtend);

        CNTVH5PlayerModule.HEAP8.fill(0, memory, memory + curDate.length + MemoryExtend);
        CNTVH5PlayerModule.HEAP8.set(Array.from(curDate, e => e.charCodeAt(0)), memory);

        let ret;
        switch (o) {
            case "InitPlayer":
                ret = CNTVH5PlayerModule._CNTV_InitPlayer(memory);
                break;
            case "UnInitPlayer":
                ret = CNTVH5PlayerModule._CNTV_UnInitPlayer(memory);
                break;
            case "UpdatePlayer":
                vmpTag = CNTVH5PlayerModule._CNTV_UpdatePlayer(memory).toString(16);
                vmpTag = ['0'.repeat(8 - vmpTag.length), vmpTag].join('');
                ret = 0;
                break;
        }

        CNTVH5PlayerModule._jsfree(memory);
        return ret;
    }

    function InitPlayer() { return _common("InitPlayer"); }
    function UnInitPlayer() { return _common("UnInitPlayer"); }
    function UpdatePlayer() { return _common("UpdatePlayer"); }

    function decrypt(buf) {
        const pageHost = "https://tv.cctv.com";
        const addr = CNTVH5PlayerModule._jsmalloc(buf.length + MemoryExtend);
        const StaticCallModuleVod = {
            H264NalSet: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD7(t, i, n, r);
            },
            H265NalData: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD6(t, i, n, r);
            },
            AVS1AudioKey: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD5(t, i, n, r);
            },
            HEVC2AAC: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD4(t, i, n, r);
            },
            HASHMap: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD3(t, i, n, r);
            },
            BASE64Dec: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD2(t, i, n, r);
            },
            MediaSession: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD1(t, i, n, r);
            },
            Mp4fragment: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD0(t, i, n, r);
            },
            MpegAudio: function (e, t, i, n, r) {
                return e._CNTV_jsdecVOD8(t, i, n, r);
            },
            AACDemuxer: function (e, t, i, n, r) {
                return e._jsdecVOD(i, n, r);
            }
        };
        function StaticCallModuleVodAPI(e, t, i, n, r, a) {
            return StaticCallModuleVod[a](e, t, i, n, r);
        }

        CNTVH5PlayerModule.HEAP8.set(buf, addr);
        CNTVH5PlayerModule.HEAP8.set(
            Array.from(pageHost, e => e.charCodeAt(0)), addr + buf.length
        );
        const addr2 = CNTVH5PlayerModule._jsmalloc(curDate.length);
        CNTVH5PlayerModule.HEAP8.set(Array.from(curDate, e => e.charCodeAt(0)), addr2);

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
        // c == buf.length
        // l == pageHost.length
        for (const i in vmpTag)
            if ("0123456".includes(vmpTag[i]))
                StaticCallModuleVodAPI(
                    CNTVH5PlayerModule,
                    addr2,
                    addr,
                    buf.length,
                    pageHost.length,
                    Object.keys(StaticCallModuleVod)[i]
                );

        const decRet = StaticCallModuleVodAPI(
            CNTVH5PlayerModule,
            addr2,
            addr,
            buf.length,
            pageHost.length,
            Object.keys(StaticCallModuleVod)[8]
        );
        const retBuffer = Buffer.from(CNTVH5PlayerModule.HEAP8.subarray(addr, addr + decRet));

        CNTVH5PlayerModule._jsfree(addr);
        CNTVH5PlayerModule._jsfree(addr2);

        return retBuffer;
    }

    const tmpdir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "node-"));
    const concatVideoListFileName = path.join(tmpdir, "concat_video"),
          concatAudioListFileName = path.join(tmpdir, "concat_audio");
    await Promise.all([
        fsPromises.writeFile(concatVideoListFileName, "ffconcat version 1.0\n"),
        fsPromises.writeFile(concatAudioListFileName, "ffconcat version 1.0\n")
    ]);

    // demux bitstreams from container
    let ffmpegDemuxTasks = [];
    for (let inFileNameIndex = 2; inFileNameIndex < process.argv.length - 1; inFileNameIndex++) {
        console.log(`demuxing segment ${inFileNameIndex - 1}...`);
        const rawH264FileName = path.join(tmpdir, `raw${inFileNameIndex}.264`),
              rawAACFileName = path.join(tmpdir, `raw${inFileNameIndex}.m4a`),
              decryptedRawH264FileName = path.join(tmpdir, `out${inFileNameIndex}.264`);

        if (ffmpegDemuxTasks.length == THREAD_NUMBER) {
            await Promise.all(ffmpegDemuxTasks);
            ffmpegDemuxTasks = [];
        }

        ffmpegDemuxTasks.push(
            runFFmpeg([process.argv[inFileNameIndex]], rawH264FileName, [], "-map 0 -an".split(' ')),
            runFFmpeg([process.argv[inFileNameIndex]], rawAACFileName, [], "-map 0 -vn".split(' '))
        );
    }
    await Promise.all(ffmpegDemuxTasks);

    // start decrypt
    for (let inFileNameIndex = 2; inFileNameIndex < process.argv.length - 1; inFileNameIndex++) {
        console.log(`decrypting segment ${inFileNameIndex - 1}...`);
        const rawH264FileName = path.join(tmpdir, `raw${inFileNameIndex}.264`),
              rawAACFileName = path.join(tmpdir, `raw${inFileNameIndex}.m4a`),
              decryptedRawH264FileName = path.join(tmpdir, `out${inFileNameIndex}.264`);

        const rawH264Buffer = await fsPromises.readFile(rawH264FileName);
        const naluPos = getNaluPos(rawH264Buffer),
              nalus = naluPos.map(([from, to]) => new NALUnit(rawH264Buffer.subarray(from, to)));
        const outFile = fs.createWriteStream(decryptedRawH264FileName);

        let shouldDecrypt = false;
        curDate = Date.now().toString();
        InitPlayer();
        for (const nalu of nalus) {
            UpdatePlayer();

            let newBuffer = Buffer.concat([Buffer.from([nalu.header]), nalu.data]);
            if (nalu.nalUnitType === 25) {
                shouldDecrypt = nalu.data[0] === 1;

                newBuffer = decrypt(newBuffer);
                nalu.reload(newBuffer);
            } else if ((nalu.nalUnitType === 1 || nalu.nalUnitType === 5) && shouldDecrypt) {
                newBuffer = decrypt(newBuffer);
                nalu.reload(newBuffer);
            }
        }
        UnInitPlayer();

        console.log(`writing segment ${inFileNameIndex - 1}...`);
        let currentNALIndex = 0;
        function writeNALUs() {
            if (currentNALIndex >= nalus.length) {
                outFile.end();
                return;
            }

            // type-25 NAL units are CCTV's decryption markers; strip ALL of
            // them (not just a leading run) so the output is clean H.264.
            while (currentNALIndex < nalus.length) {
                if (nalus[currentNALIndex].nalUnitType === 25) {
                    currentNALIndex++;
                    continue;
                }
                if (!outFile.write(nalus[currentNALIndex++].dump())) {
                    outFile.once("drain", writeNALUs)
                    break;
                }
            }

            if (currentNALIndex >= nalus.length)
                outFile.end();
        }

        writeNALUs();
        await events.once(outFile, "finish");
    }

    // remux into container
    console.log("remuxing...");
    const concatVideoListFileList = [], concatAudioListFileList = [];

    for (let inFileNameIndex = 2; inFileNameIndex < process.argv.length - 1; inFileNameIndex++)
        concatVideoListFileList.push(`file ${path.join('.', `out${inFileNameIndex}.264`)}`);

    await fsPromises.writeFile(
        concatVideoListFileName,
        concatVideoListFileList.join('\n'),
        { flag: 'a' }
    );
    for (let inFileNameIndex = 2; inFileNameIndex < process.argv.length - 1; inFileNameIndex++)
        concatAudioListFileList.push(`file ${path.join('.', `raw${inFileNameIndex}.m4a`)}`);

    await fsPromises.writeFile(
        concatAudioListFileName,
        concatAudioListFileList.join('\n'),
        { flag: 'a' }
    );

    // First concatenate the per-segment elementary streams.
    const concatVideoFile = path.join(tmpdir, "video.264"),
          concatAudioFile = path.join(tmpdir, "audio.m4a");
    await runFFmpeg([ concatVideoListFileName ], concatVideoFile, [], "-map 0".split(' '));
    await runFFmpeg([ concatAudioListFileName ], concatAudioFile, [], "-map 0".split(' '));

    // Mux with MP4Box, not ffmpeg: ffmpeg's raw-H.264 demuxer does not
    // reconstruct composition order from POC, so it writes every frame with
    // pts==dts. Players that trust container timestamps (QuickTime, browsers,
    // NLEs) then show B-frames in decode order -> visible back-and-forth
    // judder. MP4Box rebuilds the composition-time table (ctts) from POC.
    const mp4boxProcess = child_process.spawn(
        "MP4Box",
        [ "-add", concatVideoFile, "-add", concatAudioFile, "-new", process.argv.at(-1) ],
        { stdio: "inherit" }
    );
    const [mp4boxCode] = await events.once(mp4boxProcess, "exit");
    if (mp4boxCode) {
        console.error("Error occurred while running MP4Box.");
        process.exit(1);
    }
    await fsPromises.rm(tmpdir, { force: true, recursive: true });
    console.log("finished.");
}

async function main() {
    if (process.argv.length <= 2 || process.argv[2] == "--help") {
        console.error("usage: main.js [--quiet-ffmpeg] <in file>... <out file>");
        process.exit(1);
    }

    if (process.argv[2] == "--quiet-ffmpeg") {
        quietFFmpeg = true;
        process.argv.splice(2, 1);
    }

    if (process.argv.length <= 3 || process.argv[2] == "--help") {
        console.error("usage: main.js [--quiet-ffmpeg] <in file>... <outfile>");
        process.exit(1);
    }

    const CNTVH5PlayerModule = (await import("./cctv.worker.new.js")).default();
    CNTVH5PlayerModule.onRuntimeInitialized = () => mainDecrypter(CNTVH5PlayerModule);
}

main();
