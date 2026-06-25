import * as decrypt from "./decrypt.js";
import * as cmdutil from "./cmdutil.js";
import * as util from "./util.js";

export { cmdutil, decryptBuffer, decryptURL };

async function decryptBuffer(buffer: Uint8Array): Promise<Uint8Array> {
    const decrypter = new decrypt.Decrypter;

    await decrypter.beginDecryptSession();
    buffer = decrypter.decryptTsBufferUint8Array(buffer);
    decrypter.endDecryptSession();

    return buffer;
}

async function decryptURL(url: string, guidResolution: number): Promise<Uint8Array> {
    const decrypter = new decrypt.Decrypter;
    // TSs can be very large, so allocate at least 100 MiB first
    let buffer: Uint8Array = new Uint8Array(100 * (1 << 20));

    await decrypter.beginDecryptSession();
    for await (const tsBuffer of util.getTsFromM3U8(await util.getM3U8FromWebPage(url, guidResolution)))
        buffer = util.appendUint8Array(buffer, decrypter.decryptTsBufferUint8Array(tsBuffer));

    decrypter.endDecryptSession();
    return buffer;
}
