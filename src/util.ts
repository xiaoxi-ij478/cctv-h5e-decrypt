"use strict";

export { arrayEquals, checkNumberEqual, checkNumberNotEqual };

function arrayEquals(a: number[], b: number[]): boolean {
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
