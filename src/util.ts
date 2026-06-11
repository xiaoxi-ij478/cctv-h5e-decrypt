"use strict";

export {
    arrayEquals,
    checkNumberEqual,
    checkNumberNotEqual,
    concatUint8Arrays,
    appendUint8Array,
    getURLAsUint8Array,
    getURLAsJSON,
    getURLAsText
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
            console.warn(errorMsg);
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
            console.warn(errorMsg);
    }
}

// concat uint8array
// arr: arrays to concat
// toBuffer: if provided, the existing arraybuffer to append
//    but if the provided buffer is too small, we'll allocate a new buffer
function concatUint8Arrays(arr: Uint8Array[], toBuffer?: ArrayBuffer): Uint8Array {
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
