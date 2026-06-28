"use strict";

import * as fsPromises from "node:fs/promises";
import * as readline from "node:readline/promises";
import * as workerThreads from "node:worker_threads";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";

import * as util from "./util.js";
import * as cmdutil from "./cmdutil.js";
import { WorkerMessageType, WorkerMessagePayload, WorkerMessage } from "./decrypt-worker-type.js";

let decrypting = false;
let outFilename: string | null = null;
let tsBufferIterator: AsyncGenerator<util.TsBufferIterator> | null = null;
const decryptWorker = new workerThreads.Worker("./decrypt-worker.js");

function pushNextBuffer(): void {
    tsBufferIterator.next().then(r => {
        if (r.done) {
            sendMessage(WorkerMessageType.FINISH_DECRYPT);
            return;
        }

        currentSlice = r.value.currentSlice ?? null;
        totalSlice = r.value.totalSlice ?? null;
        if (currentSlice !== null)
            cmdutil.log(`decrypting slice ${currentSlice}.ts...`);

        sendMessage(
            WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER,
            { buffer: r.value.buffer },
            [r.value.buffer.buffer as ArrayBuffer]
        );
    }).catch(e => {
        sendMessage(WorkerMessageType.FINISH_DECRYPT);
        setFailure(e);
    });
}

function resetStatus(): void {
    decryptStatus = DecryptStatus.NOT_DECRYPTING;
    outFilename = null;
    tsBufferIterator = null;
}

function setSuccess(): void {
    cmdutil.log("done");
    process.exit(0);
}

function setFailure(reason: string): void {
    cmdutil.error(reason);
    process.exit(1);
}

function reset(): void {
    resetStatus();
}

function sendMessage(type: WorkerMessageType, payload?: WorkerMessagePayload, transferArr: Transferable[] = []): void {
    decryptWorker.postMessage({ type, payload }, transferArr);
}

function onMessageReceived(e: MessageEvent): void {
    const d = e.data as WorkerMessage;

    switch (d.type) {
        case WorkerMessageType.WANT_DECRYPT:
        case WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER:
        case WorkerMessageType.FINISH_DECRYPT:
            cmdutil.error("this message is not intended to be sent to the main thread");
            break;

        case WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER:
            cmdutil.log("decrypting...");
            pushNextBuffer();
            break;

        case WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER: {
            const b = d.payload as { buffer: Uint8Array };

            fsPromises
            .writeFile(process.argv[3], b.buffer, { flag: 'a' })
            .then(() => {
                pushNextBuffer();
            });
            break;
        }

        case WorkerMessageType.DECRYPT_ERROR:
            setFailure((d.payload as { message: any }).message);
            break;

        case WorkerMessageType.REPORT_DEBUG:
            break;

        // note: in the following blocks, `cmdutil` may not be used because
        // the callback function is set to send REPORT_* message to the main thread
        // and using cmdutil will cause infinite recursion
        case WorkerMessageType.REPORT_LOG:
            console.log((d.payload as { message: any }).message);
            break;

        case WorkerMessageType.REPORT_WARN:
            console.warn((d.payload as { message: any }).message);
            break;

        case WorkerMessageType.REPORT_ERROR:
            console.error((d.payload as { message: any }).message);
            break;
    }
}

async function *getTsFromM3U8File(filename: string, fetchOptions?: RequestInit): AsyncGenerator<[Uint8Array, number]> {
    async function backgroundFetcher(urls: string[], queue: util.Queue<Uint8Array>): Promise<void> {
        for (const i of urls)
            await queue.put(await fsPromises.readFile(i));
    }

    const m3u8Content = await fsPromises.readFile(filename, { encoding: "utf8" });
    const queue = new util.Queue<Uint8Array>;
    const urls: string[] =
        m3u8Content
        .split(/\n/)
        .filter(l => l && !l.match(/^#/))
        .map(e => path.join(path.dirname(filename), e));

    backgroundFetcher(urls, queue);

    for (let i = 0; i < urls.length; i++)
        yield [await queue.get(), urls.length];
}

decryptWorker.on("message", onMessageReceived);
decryptWorker.on("error", () => {
    cmdutil.log("Worker 初始化错误");
    process.exit(1);
});

function usage(): never {
    cmdutil.error("usage: main.js [--quiet] [--version] [--get-m3u8] [--get-guid <resolution>] [--local-m3u8] {local.m3u8 | in.ts | url} out.ts");
    process.exit(1);
}

async function main(): Promise<void> {
    let getM3U8 = false;
    let getGUID = false;
    let localM3U8 = false;
    let guidResolution = -1;

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

    if (Number(getM3U8) + Number(getGUID) + Number(localM3U8) > 1) {
        cmdutil.error("use only one of --get-m3u8, --get-guid or --local-m3u8");
        process.exit(1);
    }

    if (process.argv.length >= 3 && process.argv[2] === "--help")
        usage();

    if (process.argv.length !== 4)
        usage();

    await fsPromises.rm(outFilename = process.argv[3], { force: true });

    if (getM3U8) {
        cmdutil.log(`decrypting from m3u8 direct link "${process.argv[2]}"...`);

        tsBufferIterator = util.getTsFromM3U8(process.argv[2]);
        sendMessage(WorkerMessageType.WANT_DECRYPT);

    } else if (getGUID) {
        cmdutil.log(`decrypting from video page link "${process.argv[2]}" with resolution "${guidResolution}"...`);

        tsBufferIterator = util.getTsFromM3U8(await util.getM3U8FromWebPage(process.argv[2], guidResolution));
        sendMessage(WorkerMessageType.WANT_DECRYPT);

    } else if (localM3U8) {
        cmdutil.log(`decrypting from local m3u8 ${process.argv[2]}`);

        tsBufferIterator = getTsFromM3U8File(process.argv[2]);
        sendMessage(WorkerMessageType.WANT_DECRYPT);

    } else {
        cmdutil.log(`decrypting file ${process.argv[2]}...`);
        tsBufferIterator = (async function *() {
            try {
                tsBuffer = yield await fsPromises.readFile(process.argv[2]);
            } catch (e) {
                if (e instanceof Error && (e as any).code !== "ERR_FS_FILE_TOO_LARGE")
                    throw e;

                cmdutil.error("this file is too large to be read by node.js in oneshot, try using local-m3u8 mode.");
                process.exit(1);
            }
        })();
        sendMessage(WorkerMessageType.WANT_DECRYPT);
    }
}

main();
