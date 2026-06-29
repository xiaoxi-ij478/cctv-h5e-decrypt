"use strict";

import * as util from "../util.js";
import * as cmdutil from "../cmdutil.js";
import * as workerWrapper from "../worker/wrapper.js";
import * as workerType from "../worker/worker-type.js";

// 1 GiB per ts chunk (anything larger will cause firefox to choke on download)
const MAX_TS_CHUNK_SIZE = 1073741824;
const MAX_TS_FILE_SIZE = 2147483647;

let newURL: string | null = null;
let canDecrypt = true;
const inputFile = document.getElementById("input-file") as HTMLInputElement;
const inputGUID = document.getElementById("input-guid") as HTMLInputElement;
const maxBufferSlice = document.getElementById("max-buffer-slices") as HTMLInputElement;
const form = document.getElementById("form") as HTMLFormElement;
const logs = document.getElementById("logs") as HTMLElement;
const tsBufferStatus = document.getElementById("tsbuffer-status") as HTMLProgressElement;
const decryptStatus = document.getElementById("decrypt-status") as HTMLProgressElement;
const tsBufferStatusText = document.getElementById("tsbuffer-status-text") as HTMLElement;
const decryptStatusText = document.getElementById("decrypt-status-text") as HTMLElement;
const failure = document.getElementById("failure") as HTMLElement;
const success = document.getElementById("success") as HTMLElement;
const failureReason = document.getElementById("failure-reason") as HTMLElement;
const successFileLink = document.getElementById("success-file-link") as HTMLAnchorElement;
const decryptWorkerWrapper = new workerWrapper.DecryptWorkerWrapper(
    e => {
        console.error(e);
        alert("Worker 出现错误");
        canDecrypt = false;
    }
);

function setLogEntry(message: string): void {
    logs.textContent = message;
}

function clearLogEntry(): void {
    logs.textContent = "";
}

function setBufferStatus(current: number, total: number): void {
    tsBufferStatus.value = current;
    tsBufferStatus.max = total;
    tsBufferStatusText.textContent = `${current} / ${total}`;
}

function clearBufferStatus(): void {
    tsBufferStatus.value = 0;
    tsBufferStatus.max = 1;
    tsBufferStatusText.textContent = "";
}

function setDecryptStatus(current: number, total: number): void {
    decryptStatus.value = current;
    decryptStatus.max = total;
    decryptStatusText.textContent = `${current} / ${total}`;
}

function clearDecryptStatus(): void {
    decryptStatus.value = 0;
    decryptStatus.max = 1;
    decryptStatusText.textContent = "";
}

function resetStatus(): void {
    // newURL is set only when success,
    // and will be reset (and revoked) before every decrypt session
}

function setSuccess(filelink: string, filename: string): void {
    success.classList.remove("nodisplay");
    failure.classList.add("nodisplay");
    successFileLink.href = newURL = filelink;
    successFileLink.download = filename;
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
    clearBufferStatus();
    clearDecryptStatus();
    failure.classList.add("nodisplay");
    success.classList.add("nodisplay");
    resetStatus();
}

cmdutil.setLogFunc((type, message) => {
    switch (type) {
        case cmdutil.LogType.DEBUG:
            break;

        case cmdutil.LogType.LOG:
            setLogEntry(`提示：${message}`);
            break;

        case cmdutil.LogType.WARN:
            setLogEntry(`警告：${message}`);
            break;

        case cmdutil.LogType.ERROR:
            setLogEntry(`错误：${message}`);
            break;
    }
});

form.addEventListener("submit", async e => {
    e.preventDefault();

    if (!canDecrypt) {
        alert("Worker 不可用，无法进行解密");
        return;
    }

    const file = inputFile.files?.[0] ?? null;
    const guid = inputGUID.value;
    if (!file && !guid) {
        alert("必须指定文件或者 GUID！");
        return;
    }

    if (newURL) {
        URL.revokeObjectURL(newURL);
        newURL = null;
    }

    try {
        await decryptWorkerWrapper.startDecrypt();
    } catch (e) {
        alert(e);
        return;
    }

    reset();
    if (guid) {
        let estimatedPerSliceSize: number | null = null;
        let decryptBuffers: Uint8Array<ArrayBuffer>[] = [];

        try {
            for await (
                const { buffer, currentSlice, totalSlice } of
                util.getTsFromM3U8(
                    await util.getM3U8FromGUID(
                        guid,
                        Number(new FormData(form).get("resolution"))
                    ),
                    e => {
                        setBufferStatus(e.currentSize, e.maxSize);

                        if (e.currentSlice !== null)
                            cmdutil.log(`downloading slice ${e.currentSlice}.ts...`);
                    },
                    Number(maxBufferSlice.value) ?? 10
                )
            ) {
                setDecryptStatus(currentSlice + 1, totalSlice);
                cmdutil.log(`decrypting slice ${currentSlice}.ts...`);

                let decBuf = await decryptWorkerWrapper.decryptTsBuffer(buffer);

                if (
                    !decryptBuffers.length ||
                    decryptBuffers.at(-1)!.byteLength + decBuf.byteLength > MAX_TS_CHUNK_SIZE
                ) {
                    // either this is the first slice, or the buffer is going to overflow
                    let size = decBuf.byteLength;
                    if (estimatedPerSliceSize === null) // this is the first slice, set per slice size
                        estimatedPerSliceSize = size;

                    // calculate the buffer size:
                    // we preallocate the buffer for all the remaining slices,
                    // unless the buffer is too large, which we will limit its size then
                    let allocSize = Math.min(
                        estimatedPerSliceSize * (totalSlice - currentSlice),
                        MAX_TS_CHUNK_SIZE
                    );

                    // reduce fragmentnation by filling the last buffer
                    if (decryptBuffers.length) {
                        const lastBuf = decryptBuffers.at(-1)!;
                        const lastBufRemainSize = lastBuf.buffer.byteLength - lastBuf.byteLength;

                        decryptBuffers[decryptBuffers.length - 1]! =
                            util.appendUint8Array(lastBuf, decBuf.subarray(0, lastBufRemainSize), true);
                        decBuf = decBuf.subarray(lastBufRemainSize);
                        size -= lastBufRemainSize;
                    }

                    while (size) {
                        let buf = util.allocUint8Array(allocSize);
                        buf = util.appendUint8Array(buf, decBuf, true);
                        decryptBuffers.push(buf);
                        size -= Math.min(size, allocSize);
                    }

                } else
                    decryptBuffers[decryptBuffers.length - 1]! =
                        util.appendUint8Array(decryptBuffers.at(-1)!, decBuf);
            }

            setSuccess(URL.createObjectURL(new Blob(decryptBuffers)), `${guid}.ts`);

        } catch (e) {
            setFailure(e as string);
            await decryptWorkerWrapper.endDecrypt();
            return;
        }

    } else if (file) {
        if (file.size >= MAX_TS_FILE_SIZE) {
            alert("不可解密大于 2 GiB 的视频！请使用 GUID 解密模式！");
            return;
        }

        cmdutil.log("decrypting...");
        try {
            let decBuf = await decryptWorkerWrapper.decryptTsBuffer(await file.bytes());
            setSuccess(URL.createObjectURL(new Blob([decBuf])), file.name);

        } catch (e) {
            setFailure(e as string);
            await decryptWorkerWrapper.endDecrypt();
            return;
        }

    }

    await decryptWorkerWrapper.endDecrypt();
});
