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
    Queue
};

function arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
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
function concatUint8Arrays(arr: Uint8Array[], toBuffer?: ArrayBuffer, noRealloc = false): Uint8Array {
    const totalLength = arr.reduce((a, e) => a + e.byteLength, 0);
    let reallocated = false;

    if (toBuffer && toBuffer.byteLength < totalLength) {
        if (noRealloc)
            throw new Error("buffer size is insufficient and reallocation is disallowed");

        reallocated = true;
        toBuffer = new ArrayBuffer(totalLength);
    }

    const newArr: Uint8Array = new Uint8Array(
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
function appendUint8Array(dst: Uint8Array, src: Uint8Array, noRealloc = false): Uint8Array {
    return concatUint8Arrays([dst, src], dst.buffer, noRealloc);
}

function allocUint8Array(size: number): Uint8Array {
    return new Uint8Array(new ArrayBuffer(allocSize), 0, 0);
}

async function getURLAsUint8Array(url: string | URL, fetchOptions?: RequestInit): Promise<Uint8Array> {
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

        guid = line.replace(/.*(["'])(.*)\1.*/, "$2");
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
    // return ret;
    return `https://dh5wswx02.v.cntv.cn/asp/h5e/hls/${resolution}/0303000a/3/default/${guid}/${resolution}.m3u8`;
}

class Queue<T> {
    private arr: T[] = [];
    private getPromiseResolves: ((e: void) => void)[] = [];
    private putPromiseResolves: ((e: void) => void)[] = [];
    readonly maxSize: number;

    constructor(maxSize: number = 10) {
        this.maxSize = maxSize;
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
    buffer: Uint8Array;
};

interface TsBufferCountIterator extends TsBufferIterator {
    currentSlice: number;
    totalSlice: number;
};

async function *getTsFromM3U8(url: string, fetchOptions?: RequestInit): AsyncGenerator<TsBufferCountIterator> {
    async function backgroundFetcher(urls: URL[], queue: Queue<Uint8Array>): Promise<void> {
        for (const i of urls)
            await queue.put(await getURLAsUint8Array(i));
    }

    const m3u8Content = await getURLAsText(url, fetchOptions);
    const queue = new Queue<Uint8Array>;
    const urls = m3u8Content.split(/\n/).filter(l => l && !l.match(/^#/)).map(e => new URL(e, url));
    backgroundFetcher(urls, queue);

    for (let i = 0; i < urls.length; i++)
        yield [await queue.get(), i, urls.length];
}
