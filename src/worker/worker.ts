"use strict";

import * as decrypter from "../decrypter.js";
import * as mpegts from "../mpegts.js";
import * as nalutil from "../nalutil.js";
import * as workerType from "../worker/worker-type.js";

enum DecryptStatus {
    NOT_DECRYPTING,
    DECRYPTING_INITIALIZING,
    DECRYPTING_CAN_PUSH
};

let decryptStatus = DecryptStatus.NOT_DECRYPTING;
let decrypterObject: decrypter.Decrypter | null = null;

let workerThreads: typeof import("node:worker_threads");
if (workerType.isNode) {
    // node.js
    workerThreads = await import("node:worker_threads");
    workerThreads.parentPort?.on("message", onMessageReceived);
} else
    // browser
    (self as any).addEventListener("message", onMessageReceived);

function sendMessage(
    type: workerType.WorkerMessageType,
    payload?: workerType.WorkerMessagePayload,
    transferArr: ArrayBuffer[] = []
): void {
    if (workerType.isNode)
        workerThreads.parentPort?.postMessage({ type, payload }, transferArr);
    else
        (self as any).postMessage({ type, payload }, transferArr);
}

function onMessageReceived(e: any): void {
    const d = (workerType.isNode ? e : e.data) as workerType.WorkerMessage;

    switch (d.type) {
        case workerType.WorkerMessageType.WANT_DECRYPT:
            if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
                sendMessage(
                    workerType.WorkerMessageType.DECRYPT_ERROR,
                    { message: "already decrypting" }
                );
                break;
            }

            decryptStatus = DecryptStatus.DECRYPTING_INITIALIZING;
            decrypterObject = new decrypter.Decrypter;
            decrypterObject.beginDecryptSession().then(() => {
                decryptStatus = DecryptStatus.DECRYPTING_CAN_PUSH;
                sendMessage(workerType.WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER);
            }).catch(e => {
                decrypterObject = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
                sendMessage(workerType.WorkerMessageType.DECRYPT_ERROR, { message: e });
            });
            break;

        case workerType.WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER:
            if (decryptStatus !== DecryptStatus.DECRYPTING_CAN_PUSH) {
                sendMessage(
                    workerType.WorkerMessageType.DECRYPT_ERROR,
                    { message: "decrypter has not initialized" }
                );
                break;
            }

            try {
                let buffer: Uint8Array<ArrayBuffer>;

                if (d.payload.isNALU) {
                    const nalu = new nalutil.NALU(d.payload.buffer);
                    buffer = decrypterObject!.decryptNALU(nalu).dump();

                } else {
                    const tsFile = new mpegts.MPEGTS(d.payload.buffer);
                    buffer = decrypterObject!.decryptTsBuffer(tsFile).dump();
                }

                sendMessage(
                    workerType.WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER,
                    { buffer, isNALU: d.payload.isNALU },
                    [buffer.buffer]
                );

            } catch (e) {
                sendMessage(workerType.WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypterObject = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            }
            break;
        
        case workerType.WorkerMessageType.FINISH_DECRYPT:
            if (decryptStatus !== DecryptStatus.DECRYPTING_CAN_PUSH) {
                sendMessage(
                    workerType.WorkerMessageType.DECRYPT_ERROR,
                    { message: "decrypter has not initialized" }
                );
                break;
            }
            
            decrypterObject!.endDecryptSession();
            decrypterObject = null;
            decryptStatus = DecryptStatus.NOT_DECRYPTING;
            sendMessage(workerType.WorkerMessageType.FINISH_DESTROYING);
            break;
        
        case workerType.WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER:
        case workerType.WorkerMessageType.DECRYPT_ERROR:
        case workerType.WorkerMessageType.FINISH_DESTROYING:
            sendMessage(
                workerType.WorkerMessageType.DECRYPT_ERROR,
                { message: "this message is not intended to be sent to the worker" }
            );
            break;
    }
}
