import * as util from "./util.js";

export { WorkerMessageType, WorkerMessagePayload, WorkerMessage, util };

enum WorkerMessageType {
    WANT_DECRYPT_BUFFER, // to worker
    WANT_DECRYPT_GUID, // to worker
    CAN_PUSH_ENCRYPTED_BUFFER, // to worker
    PUSH_WORKER_ENCRYPTED_BUFFER, // to worker
    PUSH_BROWSER_DECRYPTED_BUFFER, // to browser
    FINISH_DECRYPT_BUFFER, // to browser (means guid decrypt has done) / worker (means all buffer has been pushed)
    DECRYPT_ERROR, // to browser
    REPORT_DEBUG, // to browser
    REPORT_LOG, // to browser
    REPORT_WARN, // to browser
    REPORT_ERROR // to browser
};

// invoke steps: (-> means to browser, <- means to worker)
//   decrypt guid:
//     <- WANT_DECRYPT_GUID
//     -> PUSH_BROWSER_DECRYPTED_BUFFER
//     -> ...
//     -> FINISH_DECRYPT_BUFFER
//   decrypt buffer:
//     <- WANT_DECRYPT_BUFFER
//     -> CAN_PUSH_ENCRYPTED_BUFFER
//     <- PUSH_WORKER_ENCRYPTED_BUFFER
//     -> PUSH_BROWSER_DECRYPTED_BUFFER
//     <- PUSH_WORKER_ENCRYPTED_BUFFER
//     -> PUSH_BROWSER_DECRYPTED_BUFFER
//     <- ...
//     <- FINISH_DECRYPT_BUFFER

type WorkerMessagePayload =
    undefined | // for WANT_DECRYPT_BUFFER, FINISH_DECRYPT_BUFFER, CAN_PUSH_ENCRYPTED_BUFFER
    { guid: string, resolution: number } | // for WANT_DECRYPT_GUID, the guid to decrypt
    { buffer: Uint8Array } |
        // for PUSH_WORKER_ENCRYPTED_BUFFER, the buffer to decrypt
        // for PUSH_BROWSER_DECRYPTED_BUFFER, the decrypted buffer
    { buffer: Uint8Array, totalSlice: number } |
        // for PUSH_BROWSER_DECRYPTED_BUFFER in GUID mode, with total slices added
    { message: any } // for REPORT_*, DECRYPT_ERROR
;

type WorkerMessage = {
    type: WorkerMessageType;
    payload: WorkerMessagePayload;
};
