# CCTV h5e 视频解密器

## 项目说明

本项目用于解密使用 CCTV h5e 法加密的视频。

但 www.docuchina.cn 经测试，两分钟后会出现无法解码的错误。

经过改造以后，这个项目应该可以嵌入到其他项目中作为一个库。
但我还没有什么经验，因此可能需要一些调整才可以使用。

## 网页版

现在已经有一个简便的网页版可用了：<https://cctv-decrypt.xiaoxi-ij478.com>

不过网页版需要手动获取 GUID。

## 使用方法

首先，安装 node 运行时环境，参见 "[Node.js — 下载 Node.js®](https://nodejs.org/zh-cn/download)"。

然后下载仓库，执行

```bash
npx tsx <仓库路径>/src/main.ts --get-m3u8 <你获取到的 m3u8 链接> <解密后文件>.ts
```

或者

```bash
npx tsx <仓库路径>/src/main.ts --get-guid <码率> <视频网页链接> <解密后文件>.ts
```

就可以解密了。

### 参数

为了简化操作流程，main.ts 支持直接提供视频网页链接获取 M3U8 进行解密。这种方法需要添加 `--get-guid` 参数。
也支持直接从 M3U8 直链获取 .ts 文件进行解密。这种方法需要添加 `--get-m3u8` 参数。

其中，guid 方式需要你选择码率。除了央视 4K 频道以外，所有使用央视加密方法的网站几乎都有四种码率（分辨率均为 720p）：

- 450
- 850
- 1200
- 2000

而 4K 频道只有两种码率：

- 2000（720p）
- 4000（1080p）

根据你的需要选择码率。

如果你发现一个奇怪的网站有不同于以上两种情况的码率，使用 <https://zhuanlan.zhihu.com/p/672745032> 的方法手动获取 m3u8 链接，然后使用 `--get-m3u8` 方式下载。

当然，如果你已经下载了 .ts 或者就想自己动手，那么也可以手动传原始 .ts 和解密后 .ts 的文件名进行本地解密。

注意！不要一次性解密过大的 .ts，否则解密速度会超级慢（因为解析 ts 包需要耗费大量内存）。

### 作为库使用

（npm 上发布包还要启用 2FA，我不想为此买个什么安全密钥，等我搞定了以后再说）

这个示例程序下载命令行给定的所有视频，码率选定为 2000。

（对，其实这个就是我写的 main.ts 的一个极简版）

```ts
import * as process from "node:process";
import * as fsPromises from "node:fs/promises";

import * as decrypt from "cctv-h5e-decrypt";
import * as decryptUtil from "cctv-h5e-decrypt/util";

async function main() {
    const decrypter = new decrypt.Decrypter;

    await decrypter.beginDecryptSession();
    for (const url of process.argv.slice(2))
        for await (const tsBuffer of decryptUtil.getTsFromM3U8(await decryptUtil.getM3U8FromWebPage(url, 2000)))
            await fsPromises.writeFile(
                `${new URL(url).toString().split('/').at(-1)}.ts`,
                decrypter.decryptTsBufferUint8Array(tsBuffer),
                { flag: 'a' }
            );

    decrypter.endDecryptSession();
}

main();
```

## misc.

这种解密方式相对于另一种解密方式（cbox.exe）非常慢，但是那种方法没有 Linux 版（忽略 wine），且不开源。如果你介意速度，那就用cbox（[cctv视频下载解密 - 吾爱破解 - 52pojie.cn](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2052017)）。

[videodl](https://github.com/CharlesPikachu/videodl) 是一个多功能视频下载器，集成了我的脚本以下载 CCTV 上的视频。
