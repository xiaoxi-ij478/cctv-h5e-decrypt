import * as util from "../util.js";

export {
    WorkerMessageType,
    WorkerMessagePayload,
    WorkerMessage,
    isNode
};

// polyfills for node and browser
const isNode = typeof process === "object" && typeof process.versions === "object" && typeof process.versions.node === "string";

enum WorkerMessageType {
    WANT_DECRYPT, // to worker
    CAN_PUSH_ENCRYPTED_BUFFER, // to worker
    PUSH_WORKER_ENCRYPTED_BUFFER, // to worker
    PUSH_MAIN_THREAD_DECRYPTED_BUFFER, // to browser
    FINISH_DECRYPT, // to worker
    FINISH_DESTROYING, // to worker
    INIT_ERROR, // to main thread
    DECRYPT_ERROR, // to main thread
};

// invoke steps: (-> means to main thread, <- means to worker)
//     <- WANT_DECRYPT
//     -> CAN_PUSH_ENCRYPTED_BUFFER
//     <- PUSH_WORKER_ENCRYPTED_BUFFER
//     -> PUSH_MAIN_THREAD_DECRYPTED_BUFFER
//     <- PUSH_WORKER_ENCRYPTED_BUFFER
//     -> PUSH_MAIN_THREAD_DECRYPTED_BUFFER
//     <- ...
//     <- FINISH_DECRYPT
//     -> FINISH_DESTROYING

type WorkerMessage = {
    type:
        WorkerMessageType.WANT_DECRYPT |
        WorkerMessageType.FINISH_DECRYPT |
        WorkerMessageType.FINISH_DESTROYING |
        WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER;
    payload: undefined;
} | {
    type:
        WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER |
        WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER;
    payload: { buffer: Uint8Array<ArrayBuffer>, isNALU: boolean };
        // for PUSH_WORKER_ENCRYPTED_BUFFER, the buffer to decrypt
        // for PUSH_MAIN_THREAD_DECRYPTED_BUFFER, the decrypted buffer
} | {
    type: WorkerMessageType.DECRYPT_ERROR;
    payload: { message: any };
};

type WorkerMessagePayload = WorkerMessage["payload"];
