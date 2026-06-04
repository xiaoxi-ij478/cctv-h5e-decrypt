"use strict";

import * as fs from "node:fs";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as mpegts from "./mpegts.js";
import * as nalutil from "./nalutil.js";
import * as util from "./util.js";

function waitForMsec(msec: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, msec));
}

async function main(): Promise<void> {
    // we must inject location into the global namespace to make the script work
    if (process.argv.length < 3 || process.argv[2] == "--help") {
        console.error("usage: main.js in.ts out.ts");
        process.exit(1);
    }

    // I finally settled down to use synchronous version of the filesystem API
    // because I don't want to deal with what the hell async/await
    // on just a command line program
    const decrypter: decrypt.Decrypter = new decrypt.Decrypter();
    await decrypter.loadFinished
    const tsBuffer: buffer.Buffer = fs.readFileSync(process.argv[2]);
    const tsFile: mpegts.MPEGTS = new mpegts.MPEGTS(new Uint8Array(tsBuffer.buffer, tsBuffer.byteOffset, tsBuffer.length));
    let videoStreamPID: number = -1;

    // assume there's just one PMT
    for (const stream of tsFile.pmts[0].pmt.streams) {
        if (stream.streamType !== 0x1B)
            continue; // video stream

        videoStreamPID = stream.pid;
        break;
    }

    if (videoStreamPID === -1)
        throw new Error("video stream not found");

    for (const { pes, indexes } of (tsFile.getPacketsByPID(videoStreamPID) as mpegts.MPEGTSPESPacketWithIndex[])) {
        decrypter.beginDecryptSession();
        const nalus: nalutil.NALU[] = nalutil.splitNALU(pes.payload!);

        for (const nalu of nalus)
            decrypter.decryptNALU(nalu);


        let newNALU: Uint8Array = nalutil.joinNALU(nalus);

        for (const index of indexes) {
            const tsPacket: mpegts.MPEGTSPacket = tsFile.packets[index];
            const offset: number = tsPacket.header.isContinuePacket ? 0 : pes.payloadStartOffset;
            let bytesToCopy: number = tsPacket.payload!.byteLength;

            if (!tsPacket.payload)
                continue;

            if (tsPacket.payload.byteLength - offset > newNALU.byteLength) {
                if (!tsPacket.adaptionField)
                    tsPacket.adaptionField = new mpegts.MPEGTSPacketAdaptionField;

                tsPacket.adaptionField.length = 184 - 1 - offset - newNALU.byteLength;
                tsPacket.adaptionField.payload = util.concatUint8Arrays(
                    Uint8Array.of(0x00),

                    tsPacket.adaptionField.length ?
                        new Uint8Array(tsPacket.adaptionField.length - 1).fill(0xFF) :
                        new Uint8Array()
                );
                bytesToCopy = newNALU.byteLength + offset;
            }

            tsPacket.payload = util.concatUint8Arrays(
                tsPacket.payload.subarray(0, offset),
                newNALU.subarray(0, bytesToCopy - offset)
            );
            newNALU = newNALU.subarray(bytesToCopy - offset);
        }
        decrypter.endDecryptSession();
    }

    fs.writeFileSync(process.argv[3], tsFile.dump());
}

main();
