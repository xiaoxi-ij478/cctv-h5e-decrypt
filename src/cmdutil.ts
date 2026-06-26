export {
    LogType,
    setLogFunc,
    getLogFunc,
    setNoLog,
    getNoLog,
    debug,
    log,
    warn,
    error
};

enum LogType {
    DEBUG,
    LOG,
    WARN,
    ERROR
};

type LogFuncType = (type: LogType, content: any) => void;

let logFunc: LogFuncType = (type, content) => {
    switch (type) {
        case LogType.DEBUG:
            console.debug(content);
            break;

        case LogType.LOG:
            console.log(content);
            break;

        case LogType.WARN:
            console.warn(content);
            break;

        case LogType.ERROR:
            console.error(content);
            break;
        }
};

let noLog: boolean = false;

function setLogFunc(f: LogFuncType): void {
    logFunc = f;
}

function getLogFunc(): LogFuncType {
    return logFunc;
}

function setNoLog(v: boolean): void {
    noLog = v;
}

function getNoLog(): boolean {
    return noLog;
}

function debug(content: any): void {
    if (noLog)
        return;

    logFunc(LogType.DEBUG, content);
}

function log(content: any): void {
    if (noLog)
        return;

    logFunc(LogType.LOG, content);
}

function warn(content: any): void {
    if (noLog)
        return;

    logFunc(LogType.WARN, content);
}

function error(content: any): void {
    if (noLog)
        return;

    logFunc(LogType.ERROR, content);
}

