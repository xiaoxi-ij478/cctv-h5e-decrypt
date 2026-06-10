"use strict";

import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as util from "./util.js";
import * as mpegts from "./mpegts.js";

function usage(): never {
    console.error("usage: main.js [--get-m3u8] [--get-guid <resolution>] {in.ts | m3u8 url} out.ts");
    process.exit(1);
}

async function getM3U8FromWebPage(url: string, resolution: number): Promise<string> {
    const webpageContent: string = await util.getURLAsText(url);
    let guid: string | undefined;
    for (const line of webpageContent.split("\n")) {
        if (!line.match(/var guid =/))
            continue;

        guid = line.replace(/.*"(.*)".*/, "$1");
        break;
    }

    if (!guid)
        throw new Error("no guid found in webpage provided");

    type VideoInfoType = { manifest: { hls_h5e_url: string }, ack: string };
    const videoInfo: VideoInfoType =
        await util.getURLAsJSON(`https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`) as VideoInfoType;

    if (videoInfo.ack === "no")
        throw new Error(`invalid guid ${guid}`);

    return videoInfo.manifest.hls_h5e_url.replace(/main/g, resolution.toString());
}

async function getTsFromM3U8(url: string): Promise<Uint8Array> {
    const m3u8Content: string = await util.getURLAsText(url);
    const buffers: Uint8Array[] = [];

    for (const line of m3u8Content.split("\n")) {
        if (!line || line.match(/^#/))
            continue;

        buffers.push(await util.getURLAsUint8Array(new URL(line, url)));
    }

    return util.concatUint8ArraysArr(buffers);
}

async function main(): Promise<void> {
    let getM3U8: boolean = false;
    let getGUID: boolean = false;
    let guidResolution: number = 2000;

    if (process.argv.length >= 3 && process.argv[2] === "--get-m3u8") {
        getM3U8 = true;
        process.argv.splice(2, 1);
    }

    if (process.argv.length >= 4 && process.argv[2] === "--get-guid") {
        getGUID = true;
        guidResolution = process.argv[3];
        process.argv.splice(2, 2);
    }

    if (getM3U8 && getGUID) {
        console.error("do not use --get-m3u8 and --get-guid together");
        process.exit(1);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--help")
        usage();

    if (process.argv.length !== 4)
        usage();

    let tsBuffer: buffer.Buffer | Uint8Array | undefined;
    if (getM3U8)
        tsBuffer = await getTsFromM3U8(process.argv[2]);
    else if (getGUID)
        tsBuffer = await getTsFromM3U8(await getM3U8FromWebPage(process.argv[2], guidResolution));
    else
        tsBuffer = await fsPromises.readFile(process.argv[2]);

    await fsPromises.writeFile(
        process.argv[3],
        await decrypt.decryptTsBuffer(Uint8Array.from(tsBuffer))
    );
}
main();
