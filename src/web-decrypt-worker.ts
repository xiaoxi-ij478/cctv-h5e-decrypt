import * as decrypt from "./decrypt.js";
import * as cmdutil from "./cmdutil.js";
import { util, WorkerMessageType, WorkerMessagePayload, WorkerMessage } from "./web-decrypt-worker-type.js";

enum DecryptStatus {
    NOT_DECRYPTING,
    DECRYPTING_BUFFER_INITIALIZING,
    DECRYPTING_BUFFER_CAN_PUSH,
    DECRYPTING_GUID
};

let decryptStatus: DecryptStatus = DecryptStatus.NOT_DECRYPTING;
let decrypter: decrypt.Decrypter | null = null;

self.addEventListener("message", (e: MessageEvent): void => {
    const d: WorkerMessage = e.data as WorkerMessage;

    switch (d.type) {
        case WorkerMessageType.WANT_DECRYPT_BUFFER:
            if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
                cmdutil.error("already decrypting");
                break;
            }

            decryptStatus = DecryptStatus.DECRYPTING_BUFFER_INITIALIZING;
            decrypter = new decrypt.Decrypter;
            decrypter.beginDecryptSession().then(() => {
                decryptStatus = DecryptStatus.DECRYPTING_BUFFER_CAN_PUSH;
                sendMessage(WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER);
            }).catch(e => {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            });
            break;

        case WorkerMessageType.WANT_DECRYPT_GUID:
            if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
                cmdutil.error("already decrypting");
                break;
            }

            decryptStatus = DecryptStatus.DECRYPTING_GUID;
            decrypter = new decrypt.Decrypter;
            const info = d.payload as { guid: string, resolution: number };
            decryptGUID(info.guid, info.resolution).then(() => {
                sendMessage(WorkerMessageType.FINISH_DECRYPT_BUFFER);
                decrypter!.endDecryptSession();
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
                cmdutil.error("decrypter has not initialized or type is not custom buffer");
                break;
            }
            
            try {
                const buffer: Uint8Array = decrypter!.decryptTsBufferUint8Array((d.payload as { buffer: Uint8Array }).buffer);
                sendMessage(
                    WorkerMessageType.PUSH_BROWSER_DECRYPTED_BUFFER,
                    { buffer },
                    [buffer.buffer]
                );

            } catch (e) {
                sendMessage(WorkerMessageType.DECRYPT_ERROR, { message: e });
                decrypter = null;
                decryptStatus = DecryptStatus.NOT_DECRYPTING;
            }
            break;
        
        case WorkerMessageType.FINISH_DECRYPT_BUFFER:
            if (decryptStatus !== DecryptStatus.DECRYPTING_BUFFER_CAN_PUSH) {
                cmdutil.error("decrypt type is not custom buffer");
                break;
            }
            
            decrypter!.endDecryptSession();
            decrypter = null;
            decryptStatus = DecryptStatus.NOT_DECRYPTING;
            break;
        
        case WorkerMessageType.PUSH_BROWSER_DECRYPTED_BUFFER:
        case WorkerMessageType.DECRYPT_ERROR:
        case WorkerMessageType.REPORT_DEBUG:
        case WorkerMessageType.REPORT_LOG:
        case WorkerMessageType.REPORT_WARN:
        case WorkerMessageType.REPORT_ERROR:
            cmdutil.error("this message is not intended to be sent to the worker");
            break;
    }
});

function sendMessage(type: WorkerMessageType, payload?: WorkerMessagePayload, transferArr?: Transferable[]): void {
    (self as any).postMessage({ type, payload }, transferArr);
}

async function decryptGUID(guid: string, resolution: number): Promise<void> {
    await decrypter!.beginDecryptSession();
    let s = 0;

    for await (
        const [tsBuffer, totalSlice] of util.getTsFromM3U8(
            await util.getM3U8FromGUID(guid, resolution)
        )
    ) {
        cmdutil.log(`decrypting slice ${s++}.ts...`);
        const buffer = decrypter!.decryptTsBufferUint8Array(tsBuffer);
        sendMessage(
            WorkerMessageType.PUSH_BROWSER_DECRYPTED_BUFFER,
            { buffer, totalSlice },
            [buffer.buffer]
        );
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
