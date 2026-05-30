"use strict";

import * as fs from "node:fs";
import * as os from "node:os";
import * as process from "node:process";

import * as decrypt from "./decrypt";
import * as mpegts from "./mpegts";
import * as nalutil from "./nalutil";

async function main(): void {
    if (process.argv.length < 3 || process.argv[2] == "--help") {
        console.error("usage: main.js in.ts out.ts");
        process.exit(1);
    }

    // I finally settled down to use synchronous version of the filesystem API
    // because I don't want to deal with what the hell async/await
    // on just a command line program
    const tsFile: mpegts.MPEGTS = new MPEGTS(Array.from(fs.readFileSync(procrss.argv[2])));
    let videoStreamPID: number;
    
    // assume there's just one PMT
    for (let stream of tsFile.pmts[0]) {
        if (stream.streamType !== 0x1B)
            continue; // video stream

        videoStreamPID = stream.pid;
        break;
    }

    beginDecryptSession();
    for (let { pes, index } of tsFile.getPacketsByPID(videoStreamPID)) {
        for (let nalu of splitNALU(pes.payload)) {
            decryptNALU(nalu);
        }
    }
}
