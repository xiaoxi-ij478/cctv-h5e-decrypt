import * as util from "./util.js";

export { WorkerMessageType, WorkerMessagePayload, WorkerMessage };

enum WorkerMessageType {
    WANT_DECRYPT, // to worker
    CAN_PUSH_ENCRYPTED_BUFFER, // to worker
    PUSH_WORKER_ENCRYPTED_BUFFER, // to worker
    PUSH_MAIN_THREAD_DECRYPTED_BUFFER, // to browser
    FINISH_DECRYPT, // to worker (means all buffer has been pushed)
    DECRYPT_ERROR, // to main thread
    REPORT_DEBUG, // to main thread
    REPORT_LOG, // to main thread
    REPORT_WARN, // to main thread
    REPORT_ERROR // to main thread
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

type WorkerMessagePayload =
    undefined | // for WANT_DECRYPT, FINISH_DECRYPT, CAN_PUSH_ENCRYPTED_BUFFER
    { buffer: Uint8Array } |
        // for PUSH_WORKER_ENCRYPTED_BUFFER, the buffer to decrypt
        // for PUSH_MAIN_THREAD_DECRYPTED_BUFFER, the decrypted buffer
    { message: any } // for REPORT_*, DECRYPT_ERROR
;

type WorkerMessage = {
    type: WorkerMessageType;
    payload: WorkerMessagePayload;
};
