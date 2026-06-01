"use strict";

import * as fs from "node:fs";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as mpegts from "./mpegts.js";
import * as nalutil from "./nalutil.js";

async function main(): void {
    if (process.argv.length < 3 || process.argv[2] == "--help") {
        console.error("usage: main.js in.ts out.ts");
        process.exit(1);
    }

    // I finally settled down to use synchronous version of the filesystem API
    // because I don't want to deal with what the hell async/await
    // on just a command line program
    const tsBuffer: buffer.Buffer = fs.readFileSync(process.argv[2]);
    const tsFile: mpegts.MPEGTS = new mpegts.MPEGTS(new Uint8Array(tsBuffer.buffer, tsBuffer.byteOffset, tsBuffer.length));
    const decrypter: decrypt.Decrypter = new decrypt.Decrypter;
    let videoStreamPID: number = -1;
    
    await decrypter.loadFinished;
    // assume there's just one PMT
    for (const stream of tsFile.pmts[0].pmt.streams) {
        if (stream.streamType !== 0x1B)
            continue; // video stream

        videoStreamPID = stream.pid;
        break;
    }

    if (videoStreamPID === -1)
        throw new Error("video stream not found");

    decrypter.beginDecryptSession();
    for (const { pes, indexes } of (tsFile.getPacketsByPID(videoStreamPID) as mpegts.MPEGTSPESPacketWithIndex[])) {
        const nalus: nalutil.NALU[] = nalutil.splitNALU(pes.payload);

        for (const nalu of nalus)
            decrypter.decryptNALU(nalu, pes.dts || pes.pts);

        const newNALU: number[] = nalutil.joinNALU(nalus);
        for (const index of indexes)
            tsFile.packets[index].payload = newNALU.splice(0, tsFile.packets[index].payload!.length);
    }
    decrypter.endDecryptSession();
    fs.writeFileSync(process.argv[3], Uint8Array.from(tsFile.dump()));
}

main();
