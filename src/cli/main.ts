"use strict";

import * as fsPromises from "node:fs/promises";
import * as fs from "node:fs";
import * as readline from "node:readline/promises";
import * as path from "node:path";
import * as os from "node:os";

import * as util from "../util.js";
import * as cmdutil from "../cmdutil.js";
import * as workerType from "../worker/worker-type.js";
import * as workerWrapper from "../worker/wrapper.js";

async function *getTsFromM3U8File(
    filename: string,
    queueCallback?: (e: util.QueueStatus) => void,
    maxCache: number = 10
): AsyncGenerator<util.TsBufferCountIterator> {
    async function backgroundFetcher(
        urls: string[],
        queue: util.Queue<Uint8Array<ArrayBuffer>>
    ): Promise<void> {
        for (const i in urls) {
            await queue.put(await fsPromises.readFile(urls[i]));

            queueCallback?.({
                currentSlice: Number(i),
                currentSize: queue.currentSize,
                maxSize: queue.maxSize
            });
        }
    }

    const m3u8Content = await fsPromises.readFile(filename, { encoding: "utf8" });
    const queue = new util.Queue<Uint8Array<ArrayBuffer>>(maxCache);
    const urls =
        m3u8Content
        .split(/\n/)
        .filter(l => l && !l.startsWith("#"))
        .map(e => path.join(path.dirname(filename), e));
    backgroundFetcher(urls, queue);

    for (const i in urls) {
        yield {
            buffer: await queue.get(),
            currentSlice: Number(i),
            totalSlice: urls.length
        };

        queueCallback?.({
            currentSlice: null,
            currentSize: queue.currentSize,
            maxSize: queue.maxSize
        });
    }
}

function usage(): never {
    cmdutil.error("usage: main.js [--quiet] [--version] [--get-m3u8] [--get-guid <resolution>] [--local-m3u8] [--cache-slice <number>] {local.m3u8 | in.ts | url} out.ts");
    process.exit(1);
}

async function main(): Promise<void> {
    let getM3U8 = false;
    let getGUID = false;
    let localM3U8 = false;
    let guidResolution = -1;
    let cacheSlice = 10;

    let decryptWorkerWrapper = new workerWrapper.DecryptWorkerWrapper(
        e => {
            cmdutil.error("Worker 出现错误");
            cmdutil.error(e);
            process.exit(1);
        }
    );

    process.stdin.setEncoding("utf8");

    if (process.argv.length >= 3 && process.argv[2] === "--quiet") {
        cmdutil.setNoLog(true);
        process.argv.splice(2, 1);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--version") {
        cmdutil.log("cctv-h5e-decrypt version 1.1.1");
        process.exit(0);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--get-m3u8") {
        getM3U8 = true;
        process.argv.splice(2, 1);
    }

    if (process.argv.length >= 4 && process.argv[2] === "--get-guid") {
        getGUID = true;
        guidResolution = Number(process.argv[3]);
        process.argv.splice(2, 2);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--local-m3u8") {
        localM3U8 = true;
        process.argv.splice(2, 1);
    }

    if (process.argv.length >= 4 && process.argv[2] === "--cache-slice") {
        cacheSlice = Number(process.argv[3]);
        process.argv.splice(2, 1);
    }

    if (Number(getM3U8) + Number(getGUID) + Number(localM3U8) > 1) {
        cmdutil.error("use only one of --get-m3u8, --get-guid or --local-m3u8");
        process.exit(1);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--help")
        usage();

    if (process.argv.length !== 4)
        usage();

    await Promise.all([
        fsPromises.rm(process.argv[3], { force: true }),
        decryptWorkerWrapper.startDecrypt()
    ]);

    if (cacheSlice < 1 || cacheSlice > 100)
        throw new Error("invalid cache slice size");

    if (getM3U8) {
        cmdutil.log(`decrypting from m3u8 direct link "${process.argv[2]}"...`);

        for await (
            const { buffer, currentSlice, totalSlice } of
            util.getTsFromM3U8(
                process.argv[2],
                e => {
                    if (e.currentSlice !== null)
                        cmdutil.log(`downloading slice ${e.currentSlice}.ts...`)
                },
                cacheSlice
            )
        ) {
            cmdutil.log(`decrypting slice ${currentSlice}.ts...`);

            await fsPromises.writeFile(
                process.argv[3],
                await decryptWorkerWrapper.decryptTsBuffer(buffer),
                { flag: 'a' }
            );
        }

    } else if (getGUID) {
        cmdutil.log(`decrypting from video page link "${process.argv[2]}" with resolution "${guidResolution}"...`);

        for await (
            const { buffer, currentSlice, totalSlice } of
            util.getTsFromM3U8(
                await util.getM3U8FromWebPage(process.argv[2], guidResolution),
                e => {
                    if (e.currentSlice !== null)
                        cmdutil.log(`downloading slice ${e.currentSlice}.ts...`)
                },
                cacheSlice
            )
        ) {
            cmdutil.log(`decrypting slice ${currentSlice}.ts...`);

            await fsPromises.writeFile(
                process.argv[3],
                await decryptWorkerWrapper.decryptTsBuffer(buffer),
                { flag: 'a' }
            );
        }

    } else if (localM3U8) {
        cmdutil.log(`decrypting from local m3u8 ${process.argv[2]}`);

        for await (
            const { buffer, currentSlice, totalSlice } of
            getTsFromM3U8File(
                process.argv[2],
                e => {
                    if (e.currentSlice !== null)
                        cmdutil.log(`downloading slice ${e.currentSlice}.ts...`)
                },
                cacheSlice
            )
        ) {
            cmdutil.log(`decrypting slice ${currentSlice}.ts...`);

            await fsPromises.writeFile(
                process.argv[3],
                await decryptWorkerWrapper.decryptTsBuffer(buffer),
                { flag: 'a' }
            );
        }

    } else {
        cmdutil.log(`decrypting file ${process.argv[2]}...`);
        let b: Buffer;

        try {
            b = await fsPromises.readFile(process.argv[2]);
        } catch (e) {
            if (e instanceof Error && (e as any).code !== "ERR_FS_FILE_TOO_LARGE")
                throw e;

            cmdutil.error("this file is too large to be read by node.js in oneshot, try using local-m3u8 mode.");
            process.exit(1);
        }

        const buffer = new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.length);
        await fsPromises.writeFile(
            process.argv[3],
            await decryptWorkerWrapper.decryptTsBuffer(buffer),
            { flag: 'a' }
        );

    }

    cmdutil.log("done");
    await decryptWorkerWrapper.endDecrypt();
    await decryptWorkerWrapper.terminate();
}

main();
