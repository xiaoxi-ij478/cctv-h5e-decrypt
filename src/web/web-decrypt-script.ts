"use strict";

import { WorkerMessageType, WorkerMessagePayload, WorkerMessage } from "./decrypt-worker-type.js";
import * as util from "../util.js";
import * as cmdutil from "../cmdutil.js";

// 1 GiB per ts chunk (anything larger will cause firefox to choke on download)
const MAX_TS_CHUNK_SIZE = 1073741824; 
const MAX_TS_FILE_SIZE = 2147483647; 

let decrypting = false;
let decryptBuffers: Uint8Array[] = [];
let inputBuffer: Uint8Array | null = null;
let newURL: string | null = null;
let filename: string | null = null;
let canDecrypt = true;
let currentSlice: number | null = null, totalSlice: number | null = null;
let estimatedPerSliceSize: number | null = null;
let tsBufferIterator: AsyncGenerator<util.TsBufferIterator> | null = null;
const inputFile = document.getElementById("input-file") as HTMLInputElement;
const inputGUID = document.getElementById("input-guid") as HTMLInputElement;
const form = document.getElementById("form") as HTMLFormElement;
const logs = document.getElementById("logs") as HTMLElement;
const failure = document.getElementById("failure") as HTMLElement;
const success = document.getElementById("success") as HTMLElement;
const failureReason = document.getElementById("failure-reason") as HTMLElement;
const successFileLink = document.getElementById("success-file-link") as HTMLAnchorElement;
const decryptWorker = new Worker("js/web/web-decrypt-worker.js", { type: "module" });

function appendLogEntry(message: string) {
    logs.textContent = message;
}

function clearLogEntry() {
    logs.textContent = "";
}

function pushNextBuffer(): void {
    tsBufferIterator.next().then(r => {
        if (r.done) {
            sendMessage(WorkerMessageType.FINISH_DECRYPT);
            newURL = URL.createObjectURL(new Blob(decryptBuffers.map(e => e.buffer as ArrayBuffer)));
            setSuccess(newURL, filename!);
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
    decryptBuffers = [];
    filename = null;
    inputBuffer = null;
    tsBufferIterator = null;
    estimatedPerSliceSize = -1;
}

function setSuccess(filelink: string, filename: string): void {
    success.classList.remove("nodisplay");
    failure.classList.add("nodisplay");
    successFileLink.href = newURL;
    successFileLink.download = `${filename}.ts`;
    resetStatus();
}

function setFailure(reason: string): void {
    failure.classList.remove("nodisplay");
    success.classList.add("nodisplay");
    failureReason.textContent = reason;
    resetStatus();
}

function reset(): void {
    clearLogEntry();
    failure.classList.add("nodisplay");
    success.classList.add("nodisplay");
    resetStatus();
}

function sendMessage(type: WorkerMessageType, payload?: WorkerMessagePayload, transferArr: Transferable[] = []): void {
    decryptWorker.postMessage({ type, payload }, transferArr);
}

decryptWorker.addEventListener("error", () => {
    alert("Worker 初始化时发生错误");
    canDecrypt = false;
});

decryptWorker.addEventListener("message", (e: MessageEvent): void => {
    const d = e.data as WorkerMessage;

    switch (d.type) {
        case WorkerMessageType.WANT_DECRYPT:
        case WorkerMessageType.PUSH_WORKER_ENCRYPTED_BUFFER:
        case WorkerMessageType.FINISH_DECRYPT:
            cmdutil.error("this message is not intended to be sent to the browser");
            break;

        case WorkerMessageType.CAN_PUSH_ENCRYPTED_BUFFER:
            appendLogEntry("提示：decrypting...");
            pushNextBuffer();
            break;

        case WorkerMessageType.PUSH_MAIN_THREAD_DECRYPTED_BUFFER: {
            const p = d.payload as { buffer: Uint8Array };

            // two situations to allocate new buffer:
            // 1. at start, preallocate buffer to prevent from reallocation
            // use the first slice's size as reference
            // 2. when the last buffer is going to overflow, allocate new one
            // and put the decrypted ts into the new buffer
            if (!decryptBuffers.length || decryptBuffers.at(-1)!.byteLength + p.buffer.byteLength > MAX_TS_CHUNK_SIZE) {
                const size = p.buffer.byteLength;
                let allocSize = Math.min(size, MAX_TS_CHUNK_SIZE);
                if (totalSlice !== null && currentSlice !== null) {
                    if (!decryptBuffers.length)
                        estimatedPerSliceSize = p.buffer.byteLength;

                    allocSize = Math.min(estimatedPerSliceSize * (totalSlice - currentSlice), MAX_TS_CHUNK_SIZE);
                }

                while (size > MAX_TS_CHUNK_SIZE) {
                    const buf = util.allocUint8Array(allocSize);
                    util.appendUint8Array(buf, p.buffer, true);
                    decryptBuffers.push(buf);
                    size -= allocSize;
                }
            } else
                decryptBuffers[decryptBuffers.length - 1]! = util.appendUint8Array(decryptBuffers.at(-1)!, p.buffer);

            pushNextBuffer();
            break;
        }

        case WorkerMessageType.DECRYPT_ERROR:
            setFailure((d.payload as { message: any }).message);
            break;

        case WorkerMessageType.REPORT_DEBUG:
            break;

        case WorkerMessageType.REPORT_LOG:
            appendLogEntry(`提示：${(d.payload as { message: any }).message}`);
            break;

        case WorkerMessageType.REPORT_WARN:
            appendLogEntry(`警告：${(d.payload as { message: any }).message}`);
            break;

        case WorkerMessageType.REPORT_ERROR:
            appendLogEntry(`错误：${(d.payload as { message: any }).message}`);
            break;
    }
});

form.addEventListener("submit", e => {
    e.preventDefault();

    if (!canDecrypt) {
        alert("Worker 不可用，无法进行解密");
        return;
    }

    if (decryptStatus !== DecryptStatus.NOT_DECRYPTING) {
        alert("已有一个解密任务！");
        return;
    }

    file = inputFile.files?.[0] ?? null;
    guid = inputGUID.value;
    if (!file && !guid) {
        alert("必须指定文件或者 GUID！");
        return;
    }

    if (newURL) {
        URL.revokeObjectURL(newURL);
        newURL = null;
    }

    decrypting = true;
    if (guid) {
        util.getM3U8FromWebPage(
            guid,
            Number(new FormData(form).get("resolution"))
        ).then(link => {
            tsBufferIterator = util.getTsFromM3U8(link);
            filename = `${guid}.ts`;
            sendMessage(WorkerMessageType.WANT_DECRYPT);
        }).catch(e => {
            sendMessage(WorkerMessageType.FINISH_DECRYPT);
            setFailure(e);
        });
    } else if (file) {
        if (file.size >= MAX_TS_FILE_SIZE) {
            alert("不可解密大于 2 GiB 的视频！请使用 GUID 解密模式！");
            return;
        }
        file.bytes().then(f => {
            filename = `${file.name}.ts`;
            tsBufferIterator = (async function *() { yield { buffer: f }; })();
            sendMessage(WorkerMessageType.WANT_DECRYPT);
        });
    }
});
