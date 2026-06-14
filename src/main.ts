"use strict";

import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as util from "./util.js";

let noLog: boolean = false;

const cmdutil = {
    log(...arg: any[]): void {
        if (!noLog)
            console.log(...arg);
    },

    warn(...arg: any[]): void {
        if (!noLog)
            console.warn(...arg);
    },

    error(...arg: any[]): void {
        if (!noLog)
            console.error(...arg);
    }
};

function usage(): never {
    cmdutil.error("usage: main.js [--quiet] [--get-m3u8] [--get-guid <resolution>] {in.ts | url} out.ts");
    process.exit(1);
}

async function getM3U8FromWebPage(url: string, resolution: number): Promise<string> {
    if (!Number.isInteger(resolution))
        throw new Error("resolution not integer");

    cmdutil.log(`decrypting from video page link "${url}" with resolution "${resolution}"...`);
    const webpageContent: string = await util.getURLAsText(url);
    let guid: string | undefined;
    for (const line of webpageContent.split("\n")) {
        if (!line.match(/var (?:video_)?guid\s*=/))
            continue;

        guid = line.replace(/.*(["'])(.*)\1.*/, "$2");
        break;
    }

    if (!guid)
        throw new Error("no guid found in webpage provided");

    cmdutil.log(`got guid "${guid}"`);
    type VideoInfoType = { manifest: { hls_h5e_url: string }, ack: string };
    const videoInfo: VideoInfoType =
        await util.getURLAsJSON(`https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`) as VideoInfoType;

    if (videoInfo.ack === "no")
        throw new Error(`invalid guid "${guid}"`);

    const ret: string = videoInfo.manifest.hls_h5e_url.replace(/main/g, resolution.toString()).replace(/\?.*/, "");
    cmdutil.log(`got link "${ret}"`);
    return ret;
}

async function *getTsFromM3U8(url: string): AsyncGenerator<Uint8Array> {
    cmdutil.log(`decrypting from m3u8 direct link "${url}"...`);
    const m3u8Content: string = await util.getURLAsText(url);
    const buffers: Uint8Array[] = [];

    for (const line of m3u8Content.split("\n")) {
        if (!line || line.match(/^#/))
            continue;

        cmdutil.log(`decrypting slice "${line}"...`);
        yield await util.getURLAsUint8Array(new URL(line, url));
    }

    cmdutil.log("done");
}

async function main(): Promise<void> {
    const decrypter: decrypt.Decrypter = new decrypt.Decrypter;
    let getM3U8: boolean = false;
    let getGUID: boolean = false;
    let guidResolution: number = 2000;

    if (process.argv.length >= 3 && process.argv[2] === "--quiet")
        noLog = true;

    if (process.argv.length >= 3 && process.argv[2] === "--get-m3u8") {
        getM3U8 = true;
        process.argv.splice(2, 1);
    }

    if (process.argv.length >= 4 && process.argv[2] === "--get-guid") {
        getGUID = true;
        guidResolution = Number(process.argv[3]);
        process.argv.splice(2, 2);
    }

    if (getM3U8 && getGUID) {
        cmdutil.error("do not use --get-m3u8 and --get-guid together");
        process.exit(1);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--help")
        usage();

    if (process.argv.length !== 4)
        usage();

    await fsPromises.rm(process.argv[3], { force: true });

    await decrypter.beginDecryptSession();
    if (getM3U8) {
        for await (const tsBuffer of getTsFromM3U8(process.argv[2]))
            await fsPromises.writeFile(
                process.argv[3],
                decrypter.decryptTsBufferUint8Array(tsBuffer),
                { flag: 'a' }
            );
    } else if (getGUID) {
        for await (const tsBuffer of getTsFromM3U8(await getM3U8FromWebPage(process.argv[2], guidResolution)))
            await fsPromises.writeFile(
                process.argv[3],
                decrypter.decryptTsBufferUint8Array(tsBuffer),
                { flag: 'a' }
            );
    } else {
        cmdutil.log(`decrypting from file ${process.argv[2]}`);
        let tsBuffer = await fsPromises.readFile(process.argv[2]);

        await fsPromises.writeFile(
            process.argv[3],
            decrypter.decryptTsBufferUint8Array(Uint8Array.from(tsBuffer)),
            { flag: 'a' }
        );
    }

    decrypter.endDecryptSession();
}
main();
