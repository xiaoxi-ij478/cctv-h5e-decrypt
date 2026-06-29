"use strict";

import * as util from "../util.js";
import * as cmdutil from "../cmdutil.js";
import * as workerType from "../worker/worker-type.js";

export { DecryptWorkerWrapper };

let fs: typeof import("node:fs");
let os: typeof import("node:os");
let path: typeof import("node:path");
let workerThreads: typeof import("node:worker_threads");

if (workerType.isNode) {
    fs = await import("node:fs");
    os = await import("node:os");
    path = await import("node:path");
    workerThreads = await import("node:worker_threads");
}

class DecryptWorkerWrapper {
    private worker: InstanceType<typeof workerThreads.Worker> | Worker | null;
    private callbacks: [(...a: any[]) => void, (a: string) => void][] = [];

    constructor(errorCallback: (e?: any) => void = e => {}) {
        if (workerType.isNode) {
            let workerFilename: string | null = null;
            const joiner = (e: string) => path.join(import.meta.dirname, e);

            for (const i of [
                "../worker/worker.ts", // running from repo
                "../worker/worker.js", // running from build
                "./worker.js"          // bundled
            ]) {
                try {
                    fs.accessSync(joiner(i));
                } catch (e) {
                    continue;
                }

                workerFilename = i;
                break;
            }

            if (workerFilename === null)
                throw new Error("Worker file not found; check you've downloaded all required files correctly.");

            const options: any = {};
            if (workerFilename.endsWith(".ts"))
                options.execArgv = "-r tsx".split(/ /);

            this.worker = new workerThreads.Worker(joiner(workerFilename), options);


            (this.worker as InstanceType<typeof workerThreads.Worker>).on("message", e => { this.onMessage(e); });
            (this.worker as InstanceType<typeof workerThreads.Worker>).on("error", errorCallback);

        } else {
            this.worker = new Worker("js/worker/worker.js", { type: "module" });
            (this.worker as Worker).addEventListener("message", e => { this.onMessage(e); });
            (this.worker as Worker).addEventListener("error", errorCallback);

        }
    }

    private sendMessage(
        type: workerType.WorkerMessageType,
        payload?: workerType.WorkerMessagePayload,
        transferArr: ArrayBuffer[] = []
    ): void {
        if (!this.worker)
            throw new Error("Worker has died");

        this.worker.postMessage({ type, payload }, transferArr);
    }

    private onMessage(e: any): void {
        const d = (workerType.isNode ? e : e.data) as workerType.WorkerMessage;

        switch (d.type) {
            case workerType.WorkerMessageType.WANT_DECRYPT:
            case workerType.WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER:
            case workerType.WorkerMessageType.FINISH_DECRYPT:
                cmdutil.error("this message is not intended to be sent to the main thread");
                break;

            case workerType.WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER:
                this.callbacks.shift()?.[0]();
                break;

            case workerType.WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER:
                this.callbacks.shift()?.[0](d.payload.buffer);
                break;

            case workerType.WorkerMessageType.FINISH_DESTROYING:
                this.callbacks.shift()?.[0]();
                break;

            case workerType.WorkerMessageType.DECRYPT_ERROR:
                this.callbacks.shift()?.[1](d.payload.message);
                break;
        }
    }

    startDecrypt(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.callbacks.push([ resolve, reject ]);
            this.sendMessage(workerType.WorkerMessageType.WANT_DECRYPT);
        });
    }

    endDecrypt(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.callbacks.push([ resolve, reject ]);
            this.sendMessage(workerType.WorkerMessageType.FINISH_DECRYPT);
        });
    }

    terminate(): Promise<number | void> {
        if (!this.worker)
            throw new Error("Worker has died");

        const r = this.worker.terminate();
        this.worker = null;
        return Promise.resolve(r);
    }

    decryptTsBuffer(buffer: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
        return new Promise((resolve, reject) => {
            this.callbacks.push([ resolve, reject ]);
            this.sendMessage(
                workerType.WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER,
                { buffer, isNALU: false },
                [buffer.buffer]
            );
        });
    }

    decryptNALU(buffer: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
        return new Promise((resolve, reject) => {
            this.callbacks.push([ resolve, reject ]);
            this.sendMessage(
                workerType.WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER,
                { buffer, isNALU: true },
                [buffer.buffer]
            );
        });
    }
}
