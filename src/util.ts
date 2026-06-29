"use strict";

import * as cmdutil from "./cmdutil.js";

export {
    arrayEquals,
    checkNumberEqual,
    checkNumberNotEqual,
    concatUint8Arrays,
    appendUint8Array,
    allocUint8Array,
    getURLAsUint8Array,
    getURLAsJSON,
    getURLAsText,
    getM3U8FromWebPage,
    getM3U8FromGUID,
    getTsFromM3U8,
    TsBufferIterator,
    TsBufferCountIterator,
    QueueStatus,
    Queue
};

function arrayEquals(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): boolean {
    return (
        a.length === b.length &&
        a.every((el, idx) => el === b.at(idx))
    );
}

function checkNumberEqual(
    val: number,
    expected: number,
    errorMsg: string = "value mismatch",
    raiseError: boolean = true
): void {
    if (val !== expected) {
        if (raiseError)
            throw new Error(errorMsg);
        else
            cmdutil.warn(errorMsg);
    }
}

function checkNumberNotEqual(
    val: number,
    unexpected: number,
    errorMsg: string = "value unexpected",
    raiseError: boolean = true
): void {
    if (val === unexpected) {
        if (raiseError)
            throw new Error(errorMsg);
        else
            cmdutil.warn(errorMsg);
    }
}

// concat uint8array
// arr: arrays to concat
// toBuffer: if provided, the existing arraybuffer to append
//    but if the provided buffer is too small, we'll allocate a new buffer
function concatUint8Arrays(
    arr: Uint8Array<ArrayBuffer>[],
    toBuffer?: ArrayBuffer,
    noRealloc = false
): Uint8Array<ArrayBuffer> {
    const totalLength = arr.reduce((a, e) => a + e.byteLength, 0);
    let reallocated = false;

    if (toBuffer && toBuffer.byteLength < totalLength) {
        if (noRealloc)
            throw new Error("buffer size is insufficient and reallocation is disallowed");

        reallocated = true;
        toBuffer = new ArrayBuffer(totalLength);
    }

    const newArr: Uint8Array<ArrayBuffer> = new Uint8Array(
        toBuffer ?? new ArrayBuffer(totalLength),
        0,
        totalLength
    );
    arr.reduce(
        (a, e) => { newArr.set(e, a); return a + e.byteLength; },
        0
    );

    return newArr;
}

// a special case for concatUint8Arrays
// append to dst's underlying arraybuffer
// this may cause a reallocation if dst's arraybuffer is not large enough,
// so we return the array in case it reallocates
function appendUint8Array(
    dst: Uint8Array<ArrayBuffer>,
    src: Uint8Array<ArrayBuffer>,
    noRealloc = false
): Uint8Array<ArrayBuffer> {
    return concatUint8Arrays([dst, src], dst.buffer, noRealloc);
}

function allocUint8Array(size: number): Uint8Array<ArrayBuffer> {
    return new Uint8Array(new ArrayBuffer(size), 0, 0);
}

async function getURLAsUint8Array(url: string | URL, fetchOptions?: RequestInit): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(url, fetchOptions);
    if (!response.ok)
        throw new Error(`URL returned error: ${response.status} ${response.statusText}`);

    return new Uint8Array(await response.arrayBuffer());
}

async function getURLAsText(url: string | URL, fetchOptions?: RequestInit): Promise<string> {
    const response = await fetch(url, fetchOptions);
    if (!response.ok)
        throw new Error(`URL returned error: ${response.status} ${response.statusText}`);

    return await response.text();
}

async function getURLAsJSON(url: string | URL, fetchOptions?: RequestInit): Promise<object> {
    const response = await fetch(url, fetchOptions);
    if (!response.ok)
        throw new Error(`URL returned error: ${response.status} ${response.statusText}`);

    return await response.json();
}

async function getM3U8FromWebPage(url: string, resolution: number, fetchOptions?: RequestInit): Promise<string> {
    if (!Number.isInteger(resolution))
        throw new Error("resolution not integer");

    const webpageContent = await getURLAsText(url, fetchOptions);
    let guid: string | undefined;
    for (const line of webpageContent.split("\n")) {
        if (!line.match(/var\s+(?:video_)?guid\s*=/))
            continue;

        guid = line.replace(/.*(["'])(.*)\1.*/, "$2").trim();
        break;
    }

    if (!guid)
        throw new Error("no guid found in webpage provided");

    return await getM3U8FromGUID(guid, resolution, fetchOptions);
}

async function getM3U8FromGUID(guid: string, resolution: number, fetchOptions?: RequestInit): Promise<string> {
    if (!Number.isInteger(resolution))
        throw new Error("resolution not integer");

    cmdutil.log(`got guid "${guid}"`);
    const videoInfo = await getURLAsJSON(
        `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`,
        fetchOptions
    ) as { manifest: { hls_h5e_url: string }, ack: string };

    if (videoInfo.ack === "no")
        throw new Error(`invalid guid "${guid}"`);

    const ret = videoInfo.manifest.hls_h5e_url.replace(/main/g, resolution.toString()).replace(/\?.*/, "");
    cmdutil.log(`got link "${ret}"`);
    return ret;
}

class Queue<T> {
    private arr: T[] = [];
    private getPromiseResolves: ((e: void) => void)[] = [];
    private putPromiseResolves: ((e: void) => void)[] = [];
    readonly maxSize: number;

    constructor(maxSize: number = 10) {
        this.maxSize = maxSize;
    }

    get currentSize(): number {
        return this.arr.length;
    }

    async get(): Promise<T> {
        if (!this.arr.length)
            await new Promise(
                resolve => this.getPromiseResolves.push(resolve)
            );

        this.putPromiseResolves.shift()?.();
        return this.arr.shift()!;
    }

    async put(el: T): Promise<void> {
        if (this.arr.length >= this.maxSize)
            await new Promise(
                resolve => this.putPromiseResolves.push(resolve)
            );

        this.getPromiseResolves.shift()?.();
        this.arr.push(el);
    }
}

interface TsBufferIterator {
    buffer: Uint8Array<ArrayBuffer>;
};

interface TsBufferCountIterator extends TsBufferIterator {
    currentSlice: number;
    totalSlice: number;
};

interface QueueStatus {
    currentSlice: number | null;
    currentSize: number;
    maxSize: number;
}

async function *getTsFromM3U8(
    url: string,
    queueCallback?: (e: QueueStatus) => void,
    maxCache: number = 10,
    fetchOptions?: RequestInit
): AsyncGenerator<TsBufferCountIterator> {
    async function backgroundFetcher(urls: URL[], queue: Queue<Uint8Array<ArrayBuffer>>): Promise<void> {
        for (const i in urls) {
            await queue.put(await getURLAsUint8Array(urls[i]));

            queueCallback?.({
                currentSlice: Number(i),
                currentSize: queue.currentSize,
                maxSize: queue.maxSize
            });
        }
    }

    const m3u8Content = await getURLAsText(url, fetchOptions);
    const queue = new Queue<Uint8Array<ArrayBuffer>>(maxCache);
    const urls =
        m3u8Content
        .split(/\n/)
        .filter(l => l && !l.startsWith("#"))
        .map(e => new URL(e, url));
    backgroundFetcher(urls, queue);

    for (const i in urls) {
        yield {
            buffer: await queue.get(),
            currentSlice: Number(i),
            totalSlice: urls.length
        };

        queueCallback?.({
            currentSlice: null,
            currentSize: queue.currentSize,
            maxSize: queue.maxSize
        });
    }
}
