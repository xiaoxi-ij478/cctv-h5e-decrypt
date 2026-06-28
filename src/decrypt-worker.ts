"use strict";

import * as decrypt from "./decrypt.js";
import * as cmdutil from "./cmdutil.js";
import * as util from "./util.js";
import { WorkerMessageType, WorkerMessagePayload, WorkerMessage } from "./decrypt-worker-type.js";

enum DecryptStatus {
    NOT_DECRYPTING,
    DECRYPTING_INITIALIZING,
    DECRYPTING_CAN_PUSH
};

let decryptStatus = DecryptStatus.NOT_DECRYPTING;
let decrypter: decrypt.Decrypter | null = null;
let workerThreads: any = null;

function sendMessage(type: WorkerMessageType, payload?: WorkerMessagePayload, transferArr?: Transferable[]): void {
    if (workerThreads)
        // provide compatibility with browser
        workerThreads.parentPort?.postMessage(new MessageEvent("message", { data: { type, payload } }), transferArr);
    else
        (self as any).postMessage({ type, payload }, transferArr);
}

function onMessageReceived(e: MessageEvent): void {
    const d = e.data as WorkerMessage;

    switch (d.type) {
        case WorkerMessageType.WANT_DECRYPT:
            if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
                cmdutil.error("already decrypting");
                break;
            }

            decryptStatus = DecryptStatus.DECRYPTING_INITIALIZING;
            decrypter = new decrypt.Decrypter;
            decrypter.beginDecryptSession().then(() => {
                decryptStatus = DecryptStatus.DECRYPTING_CAN_PUSH;
                sendMessage(WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER);
            }).catch(e => {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            });
            break;

        case WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER:
            if (decryptStatus !== DecryptStatus.DECRYPTING_CAN_PUSH) {
                cmdutil.error("decrypter has not initialized");
                break;
            }
            
            try {
                const buffer = decrypter!.decryptTsBufferUint8Array((d.payload as { buffer: Uint8Array }).buffer);
                sendMessage(
                    WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER,
                    { buffer },
                    [buffer.buffer]
                );

            } catch (e) {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            }
            break;
        
        case WorkerMessageType.FINISH_DECRYPT:
            if (decryptStatus !== DecryptStatus.DECRYPTING_CAN_PUSH) {
                cmdutil.error("decrypt has not initialized");
                break;
            }
            
            decrypter!.endDecryptSession();
            decrypter = null;
            decryptStatus = DecryptStatus.NOT_DECRYPTING;
            break;
        
        case WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER:
        case WorkerMessageType.DECRYPT_ERROR:
        case WorkerMessageType.REPORT_DEBUG:
        case WorkerMessageType.REPORT_LOG:
        case WorkerMessageType.REPORT_WARN:
        case WorkerMessageType.REPORT_ERROR:
            cmdutil.error("this message is not intended to be sent to the worker");
            break;
    }
}

cmdutil.setLogFunc((type, message) => {
    switch (type) {
        case cmdutil.LogType.DEBUG:
            sendMessage(WorkerMessageType.REPORT_DEBUG, { message });
            break;

        case cmdutil.LogType.LOG:
            sendMessage(WorkerMessageType.REPORT_LOG, { message });
            break;

        case cmdutil.LogType.WARN:
            sendMessage(WorkerMessageType.REPORT_WARN, { message });
            break;

        case cmdutil.LogType.ERROR:
            sendMessage(WorkerMessageType.REPORT_ERROR, { message });
            break;
    }
});

if (typeof self !== "undefined")
    // browser
    self.addEventListener("message", onMessageReceived);
else
    import("node:worker_threads").then(m => {
        // node.js
        (workerThreads = m).parentPort?.on("message", onMessageReceived);
    });
