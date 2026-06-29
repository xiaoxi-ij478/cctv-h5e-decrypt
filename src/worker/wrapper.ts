"use strict";

import * as util from "#/util.js";
import * as cmdutil from "#/cmdutil.js";
import * as workerType from "#/worker/worker-type.js";

export { DecryptWorkerWrapper };

class DecryptWorkerWrapper {
    private worker: InstanceType<typeof workerType.WorkerNamespace.Worker> | null;
    private callbacks: [(...a: any[]) => void, (a: string) => void][] = [];

    constructor(workerFilename: string, errorCallback: (e?: any) => void = e => {}) {
        this.worker = new workerType.WorkerNamespace.Worker(
            workerFilename,
            workerType.isNode ? {} : { type: "module" }
        );

        if (workerType.isNode) {
            (this.worker as import("node:worker_threads").Worker).on("message", e => {
                this.onMessage(e);
            });
            (this.worker as import("node:worker_threads").Worker).on("error", errorCallback);

        } else {
            (this.worker as Worker).addEventListener("message", e => {
                this.onMessage(e);
            });
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
