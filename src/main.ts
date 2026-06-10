"use strict";

import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as util from "./util.js";
import * as mpegts from "./mpegts.js";

function usage(): never {
    console.error("usage: main.js [--get-m3u8] {in.ts | m3u8 url} out.ts");
    process.exit(1);
}

async function main(): Promise<void> {
    let getM3U8: boolean = false;

    if (process.argv.length >= 3 && process.argv[2] === "--get-m3u8") {
        getM3U8 = true;
        process.argv.splice(2, 1);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--help")
        usage();

    if (process.argv.length !== 4)
        usage();

    let tsBuffer: buffer.Buffer | Uint8Array | undefined;
    if (getM3U8) {
        const m3u8Content: string = await util.getURLAsText(process.argv[2]);
        const buffers: Uint8Array[] = [];

        for (const line of m3u8Content.split("\n")) {
            if (!line || line.match(/^#/))
                continue;

            buffers.push(await util.getURLAsUint8Array(new URL(line, process.argv[2])));
        }

        tsBuffer = util.concatUint8ArraysArr(buffers);
    } else
        tsBuffer = await fsPromises.readFile(process.argv[2]);

    await fsPromises.writeFile(process.argv[3], await decrypt.decryptTsBuffer(tsBuffer));
}
main();
