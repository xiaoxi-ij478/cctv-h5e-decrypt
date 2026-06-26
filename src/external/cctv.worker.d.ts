export { CNTVjsdecFuncType, CNTVModule, CNTVModuleType };

type CNTVjsdecFuncType = (
    mediaTagIDAddr: number,
    dataAndPageHostAddr: number,
    dataLength: number,
    pageHostLength: number
) => number;

// note: they may be inaccurate, because i'm just guessing them...
type CNTVModuleType = {
    [key: `_CNTV_jsdecVOD${number}`]: any;

    HEAP8: Int8Array;

    _CNTV_InitPlayer: (mediaTagIDAddr: number) => number;
    _CNTV_UnInitPlayer: (mediaTagIDAddr: number) => number;
    _CNTV_UpdatePlayer: (mediaTagIDAddr: number) => number;
    _CNTV_jsdecVOD0: CNTVjsdecFuncType;
    _CNTV_jsdecVOD1: CNTVjsdecFuncType;
    _CNTV_jsdecVOD2: CNTVjsdecFuncType;
    _CNTV_jsdecVOD3: CNTVjsdecFuncType;
    _CNTV_jsdecVOD4: CNTVjsdecFuncType;
    _CNTV_jsdecVOD5: CNTVjsdecFuncType;
    _CNTV_jsdecVOD6: CNTVjsdecFuncType;
    _CNTV_jsdecVOD7: CNTVjsdecFuncType;
    _CNTV_jsdecVOD8: CNTVjsdecFuncType;

    _jsmalloc: (size: number) => number;
    _jsfree: (addr: number) => void;

    onRuntimeInitialized: () => void;
};

let CNTVModule: () => CNTVModuleType;
