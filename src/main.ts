"use strict";

import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as mpegts from "./mpegts.js";
import * as nalutil from "./nalutil.js";
import * as util from "./util.js";

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

    const decrypter: decrypt.Decrypter = new decrypt.Decrypter();
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

    await decrypter.loadFinished;
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

    await fsPromises.writeFile(process.argv[3], tsFile.dump());
}

main();
