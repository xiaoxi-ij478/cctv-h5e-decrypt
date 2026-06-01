"use strict";

export { 
    arrayEquals,
    checkNumberEqual,
    checkNumberNotEqual,
    moveSliceUint8Array,
    concatUint8Arrays
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

// like std::move()
function moveSliceUint8Array(arr: Uint8Array, start: number, length?: number): Uint8Array {
    if (length === undefined)
        length = arr.byteLength - start;

    if (start > arr.byteLength)
        throw new Error("requested start point run past original array");

    if (length + start > arr.byteLength)
        throw new Error("requested length larger than original array");

    return new Uint8Array(
        arr.buffer,
        arr.byteOffset + start,
        length
    );
}

function concatUint8Arrays(...arr: Uint8Array[]): Uint8Array {
    const newArr: Uint8Array = new Uint8Array(
        new ArrayBuffer(
            arr.reduce((a, e) => a + e.byteLength, 0)
        )
    );
    arr.reduce(
        (a, e) => { newArr.set(e, a); return a + e.byteLength; }, 0
    );
    return newArr;
}
