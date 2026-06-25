"use strict";

import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as buffer from "node:buffer";
import * as process from "node:process";

import * as decrypt from "./decrypt.js";
import * as util from "./util.js";
import * as cmdutil from "./cmdutil.js";

function usage(): never {
    cmdutil.error("usage: main.js [--quiet] [--get-m3u8] [--get-guid <resolution>] {in.ts | url} out.ts");
    process.exit(1);
}

async function main(): Promise<void> {
    const decrypter: decrypt.Decrypter = new decrypt.Decrypter;
    let getM3U8: boolean = false;
    let getGUID: boolean = false;
    let guidResolution: number = 2000;

    if (process.argv.length >= 3 && process.argv[2] === "--quiet")
        cmdutil.setNoLog(true);

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
        for await (const tsBuffer of util.getTsFromM3U8(process.argv[2]))
            await fsPromises.writeFile(
                process.argv[3],
                decrypter.decryptTsBufferUint8Array(tsBuffer),
                { flag: 'a' }
            );
    } else if (getGUID) {
        for await (const tsBuffer of util.getTsFromM3U8(await util.getM3U8FromWebPage(process.argv[2], guidResolution)))
            await fsPromises.writeFile(
                process.argv[3],
                decrypter.decryptTsBufferUint8Array(tsBuffer),
                { flag: 'a' }
            );
    } else {
        cmdutil.log(`decrypting file ${process.argv[2]}`);
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
