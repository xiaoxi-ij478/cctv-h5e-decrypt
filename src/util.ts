"use strict";

import * as cmdutil from "./cmdutil.js";

export {
    arrayEquals,
    checkNumberEqual,
    checkNumberNotEqual,
    concatUint8Arrays,
    appendUint8Array,
    getURLAsUint8Array,
    getURLAsJSON,
    getURLAsText,
    getM3U8FromWebPage,
    getTsFromM3U8
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
function concatUint8Arrays(arr: Uint8Array[], toBuffer?: ArrayBufferLike): Uint8Array {
    const totalLength: number = arr.reduce((a, e) => a + e.byteLength, 0);
    let reallocated: boolean = false;

    if (toBuffer && toBuffer.byteLength < totalLength) {
        reallocated = true;
        toBuffer = new ArrayBuffer(totalLength);
    }

    const newArr: Uint8Array = new Uint8Array(
        toBuffer ?? new ArrayBuffer(totalLength),
        0,
        totalLength
    );
    if (toBuffer && !reallocated)
        arr.slice(1).reduce(
            (a, e) => { newArr.set(e, a); return a + e.byteLength; }, arr[0].byteLength
        );
    else
        arr.reduce(
            (a, e) => { newArr.set(e, a); return a + e.byteLength; }, 0
        );

    return newArr;
}

// a special case for concatUint8Arrays
// append to dst's underlying arraybuffer
// this may cause a reallocation if dst's arraybuffer is not large enough,
// so we return the array in case it reallocates
function appendUint8Array(dst: Uint8Array, src: Uint8Array): Uint8Array {
    return concatUint8Arrays([dst, src], dst.buffer);
}

async function getURLAsUint8Array(url: string | URL): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`URL returned error: ${response.status} ${response.statusText}`);

    return new Uint8Array(await response.arrayBuffer());
}

async function getURLAsText(url: string | URL): Promise<string> {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`URL returned error: ${response.status} ${response.statusText}`);

    return await response.text();
}

async function getURLAsJSON(url: string | URL): Promise<object> {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`URL returned error: ${response.status} ${response.statusText}`);

    return await response.json();
}

async function getM3U8FromWebPage(url: string, resolution: number): Promise<string> {
    if (!Number.isInteger(resolution))
        throw new Error("resolution not integer");

    cmdutil.log(`decrypting from video page link "${url}" with resolution "${resolution}"...`);
    const webpageContent: string = await getURLAsText(url);
    let guid: string | undefined;
    for (const line of webpageContent.split("\n")) {
        if (!line.match(/var (?:video_)?guid\s*=/))
            continue;

        guid = line.replace(/.*(["'])(.*)\1.*/, "$2");
        break;
    }

    if (!guid)
        throw new Error("no guid found in webpage provided");

    cmdutil.log(`got guid "${guid}"`);
    type VideoInfoType = { manifest: { hls_h5e_url: string }, ack: string };
    const videoInfo: VideoInfoType =
        await getURLAsJSON(`https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`) as VideoInfoType;

    if (videoInfo.ack === "no")
        throw new Error(`invalid guid "${guid}"`);

    const ret: string = videoInfo.manifest.hls_h5e_url.replace(/main/g, resolution.toString()).replace(/\?.*/, "");
    cmdutil.log(`got link "${ret}"`);
    return ret;
}

async function *getTsFromM3U8(url: string): AsyncGenerator<Uint8Array> {
    cmdutil.log(`decrypting from m3u8 direct link "${url}"...`);
    const m3u8Content: string = await getURLAsText(url);
    const buffers: Uint8Array[] = [];

    for (const line of m3u8Content.split("\n")) {
        if (!line || line.match(/^#/))
            continue;

        cmdutil.log(`decrypting slice "${line}"...`);
        yield await getURLAsUint8Array(new URL(line, url));
    }

    cmdutil.log("done");
}
