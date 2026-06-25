import * as decrypt from "./decrypt.js";
import * as cmdutil from "./cmdutil.js";
import * as util from "./util.js";

export { WorkerMessageType, WorkerMessagePayload, WorkerMessage, util };

enum DecryptStatus {
    NOT_DECRYPTING,
    DECRYPTING_BUFFER_INITIALIZING,
    DECRYPTING_BUFFER_CAN_PUSH,
    DECRYPTING_GUID,
};

enum WorkerMessageType {
    WANT_DECRYPT_BUFFER, // to worker
    WANT_DECRYPT_GUID, // to worker
    PUSH_WORKER_ENCRYPTED_BUFFER, // to worker
    PUSH_BROWSER_DECRYPTED_BUFFER, // to browser
    FINISH_DECRYPT_BUFFER, // to browser (means guid decrypt has done) / worker (means all buffer has been pushed)
    DECRYPT_ERROR, // to browser
    REPORT_DEBUG, // to browser
    REPORT_LOG, // to browser
    REPORT_WARN, // to browser
    REPORT_DEBUG // to browser
};

type WorkerMessagePayload =
    undefined | // for WANT_DECRYPT_BUFFER, FINISH_DECRYPT_BUFFER
    { guid: string, resolution: number } | // for WANT_DECRYPT_GUID, the guid to decrypt
    { buffer: Uint8Array } |
        // for PUSH_WORKER_ENCRYPTED_BUFFER, the buffer to decrypt
        // for PUSH_BROWSER_DECRYPTED_BUFFER, the decrypted buffer
    { message: string | Error } // for REPORT_*, DECRYPT_ERROR
;

type WorkerMessage = {
    type: WorkerMessageType,
    payload: WorkerMessagePayload
};

let decryptStatus: DecryptStatus = DecryptStatus.NOT_DECRYPTING;
let decrypter: decrypt.Decrypter | null = null;

addEventListener("message", (e: MessageEvent): void => {
    const d: WorkerMessage = e.data as WorkerMessage;

    switch (d.type) {
        case WorkerMessageType.WANT_DECRYPT_BUFFER:
            if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
                console.error("already decrypting");
                break;
            }

            decrypting = DecryptStatus.DECRYPTING_BUFFER_INITIALIZING;
            decrypter = new decrypt.Decrypter;
            decrypter.beginDecryptSession().then(() => {
                decrypting = DecryptStatus.DECRYPTING_BUFFER_CAN_PUSH;
            }).catch(e => {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            });
            break;

        case WorkerMessageType.WANT_DECRYPT_GUID:
            if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
                console.error("already decrypting");
                break;
            }

            decrypting = DecryptStatus.DECRYPTING_GUID;
            decrypter = new decrypt.Decrypter;
            const info = d.payload as { guid: string, resolution: number };
            decryptGUID(info.guid, info.resolution).then(() => {
                sendMessage(WorkerMessageType.FINISH_DECRYPT_BUFFER);
                decrypter.endDecryptSession();
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            }).catch(e => {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            });
            break;
        
        case WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER:
            if (decryptStatus !== DecryptStatus.DECRYPTING_BUFFER_CAN_PUSH) {
                console.error("decrypter has not initialized or type is not custom buffer");
                break;
            }
            
            try {
                const buffer = decrypter.decryptTsBufferUint8Array((d.payload as { buffer: Uint8Array }).buffer);
                sendMessage(
                    WorkerMessageType.PUSH_BROWSER_DECRYPTED_BUFFER,
                    { buffer: buffer.buffer },
                    [buffer.buffer]
                );

            } catch (e) {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            }
            break;
        
        case WorkerMessageType.FINISH_DECRYPT_BUFFER:
            if (decryptStatus !== DecryptStatus.DECRYPTING_BUFFER) {
                console.error("decrypt type is not 'user provided buffer'");
                break;
            }
            
            decrypter.endDecryptSession();
            decrypter = null;
            decryptStatus = DecryptStatus.NOT_DECRYPTING;
            break;
        
        case WorkerMessageType.PUSH_BROWSER_DECRYPTED_BUFFER:
        case WorkerMessageType.DECRYPT_ERROR:
        case WorkerMessageType.REPORT_DEBUG:
        case WorkerMessageType.REPORT_LOG:
        case WorkerMessageType.REPORT_WARN:
        case WorkerMessageType.REPORT_DEBUG:
            console.error("this message is not intended to be sent to the worker");
            break;
    }
});

function sendMessage(type: WorkerMessageType, payload?: WorkerMessagePayload, transferArr?: Transferable[]): void {
    postMessage({ type, payload }, transferArr);
}

async function decryptGUID(guid: string, resolution: number): Promise<void> {
    await decrypter.beginDecryptSession();
    for await (
        const tsBuffer of util.getTsFromM3U8(
            await util.getM3U8FromGUID(guid, resolution)
        )
    ) {
        const buffer = decrypter.decryptTsBufferUint8Array(tsBuffer);
        sendMessage(
            WorkerMessageType.PUSH_BROWSER_DECRYPTED_BUFFER,
            { buffer: buffer.buffer },
            [buffer.buffer]
        );
    }
}

cmdutil.setLogFunc((type, message) => {
    switch (type) {
        case decryptLib.cmdutil.LogType.DEBUG:
            sendMessage(WorkerMessageType.REPORT_DEBUG, { message });
            break;

        case decryptLib.cmdutil.LogType.LOG:
            sendMessage(WorkerMessageType.REPORT_LOG, { message });
            break;

        case decryptLib.cmdutil.LogType.WARN:
            sendMessage(WorkerMessageType.REPORT_WARN, { message });
            break;

        case decryptLib.cmdutil.LogType.ERROR:
            sendMessage(WorkerMessageType.REPORT_ERROR, { message });
            break;
    }
});
