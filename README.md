# CCTV h5e 视频解密器

## 项目说明

本项目用于解密使用 CCTV h5e 法加密的视频。

但 www.docuchina.cn 经测试，两分钟后会出现无法解码的错误。

这个项目已在 node 和 firefox 中测试，可以使用。其余平台（如 bun 等）未做测试。

~~（而且以前我一直以为可以并行下载和解密，但发现其实不用 Worker 根本做不到）~~

## 网页版

现在已经有一个简便的网页版可用了：<https://cctv-decrypt.xiaoxi-ij478.com>

网页版支持直接解密和 GUID 解密法。

## 使用方法

**注意！解密大于 2 GiB 的视频不能使用命令行版以及网页版的文件解密模式！**

首先，安装 node 运行时环境，参见 "[Node.js — 下载 Node.js®](https://nodejs.org/zh-cn/download)"。

因为现在的版本要求 Worker 是一个独立脚本，所以

然后下载仓库，可选择以下几种方式执行：

- `npx tsx <仓库路径>/src/main.ts --local-m3u8 <*本地* m3u8 文件> <解密后文件>.ts`
- `npx tsx <仓库路径>/src/main.ts --get-guid <码率> <视频网页链接> <解密后文件>.ts`
- `npx tsx <仓库路径>/src/main.ts --get-m3u8 <m3u8 链接> <解密后文件>.ts`
- `npx tsx <仓库路径>/src/main.ts <ts 文件> <解密后文件>.ts`

就可以解密了。

### 参数

目前 main.ts 支持四种模式：

- 文件解密
- m3u8 链接解密
- 视频网页解密
- 本地 m3u8 解密

其中：

- 视频网页解密方式需要你选择码率。除了央视 4K 频道以外，所有使用央视加密方法的网站几乎都有四种码率（分辨率均为 720p）

  - 450
  - 850
  - 1200
  - 2000

  而 4K 频道只有两种码率：2000（720p）

  - 2000（720p）
  - 4000（1080p）

- m3u8 链接解密需要手动获取 m3u8 链接，可以用 https://github.com/WeaponJang/get-cntv-guid 的脚本。

- 本地 m3u8 解密适用于超大 ts 解密。如果直接解密大 ts，解析将会花费超级长的时间。所以可以事先下载 m3u8 和分片后再解密。具体方法见下。

- 文件解密很简单，就是解密给定的 ts。这种方法适用于小型 ts (<= 100 MiB)。

### 如何制作本地 m3u8

建立一个文件夹，然后获取 m3u8 链接，下载 m3u8 文件本身和它所指定的所有切片。网上有很多的教程。

**不过不要合并切片！只需要下载分片即可！**

然后执行 `npx tsx <仓库路径>/src/main.ts --local-m3u8 <*本地* m3u8 文件> <解密后文件>.ts` 即可解密。

## 作为库使用

（npm 上发布包还要启用 2FA，我不想为此买个什么安全密钥，等我搞定了以后再说）

这个示例程序下载命令行给定的所有视频，码率选定为 2000。

```ts
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

import * as workerWrapper from "cctv-h5e-decrypt/worker/wrapper";
import * as decryptUtil from "cctv-h5e-decrypt/util";

async function main() {
    const decrypter = new workerWrapper.DecryptWorkerWrapper;

    await decrypter.startDecrypt();
    for (const url of process.argv.slice(2))
        for await (
            const {
                buffer, // ts 缓冲区
                currentSlice, // 当前获取的切片号（0 开始）
                totalSlice // 总计切片数量
            } of decryptUtil.getTsFromM3U8(
                await decryptUtil.getM3U8FromWebPage(url, 2000),
                e => {
                    // e.currentSlice -> 当前下载的切片号（0 开始）
                    // e.currentSize -> 当前缓冲区大小
                    // e.maxSize -> 缓冲区最大大小
                },
                10 // 缓冲区最大大小
            )
        )
            await fsPromises.writeFile(
                `${path.basename(url)}.ts`,
                await decrypter.decryptTsBuffer(buffer),
                { flag: 'a' }
            );

    await decrypter.endDecrypt();
    await decrypter.terminate(); // 若解密器不再使用，务必要执行 terminate()，否则残留的 worker 会造成 node 无法退出
}

main();
```

## misc.

这种解密方式相对于另一种解密方式（cbox.exe）非常慢，但是那种方法没有 Linux 版（忽略 wine），且不开源。如果你介意速度，那就用 cbox（[cctv视频下载解密 - 吾爱破解 - 52pojie.cn](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2052017)）。

@WeaponJang 开发了一个使用这个项目的网页解密器，如果你觉得我的 html 比较丑 ~~（肯定会）~~ 可以用这个，参见 https://github.com/WeaponJang/cctv-video-guid

[videodl](https://github.com/CharlesPikachu/videodl) 是一个多功能视频下载器，集成了这个项目（其实是早期单脚本的版本）。

### 参考

[如何用 tsx 运行 Worker threads](https://gist.github.com/pcan/b5125c95529705169d37bbf353ce53a1)

### 压力测试

为了测试本项目解密超大视频的能力，以下是一些长视频的链接，可供使用：

- [《CCTV空中剧院》 20260411 京剧《宋士杰》](https://tv.cctv.com/2026/04/11/VIDEOgcuDyCs76oQ9oOUBDOO260411.shtml)（02:50:20，c93c7996af53415e9e1412521e131a7a）
- [《CCTV空中剧院》 20260618 京剧《龙凤呈祥》](https://tv.cctv.com/2026/06/18/VIDEhb0EDRgXPa9cVcrp3fLV260618.shtml)（02:36:20，1629bae302304ca9b6467ae1931f425a）
- [《CCTV空中剧院》 20260621 越剧《春香传》](https://tv.cctv.com/2026/06/21/VIDElmVzKgjHSGS493QFV4JV260621.shtml)（02:17:50，043732250b304099a3e8ee245400bc89）
