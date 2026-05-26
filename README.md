# CCTV h5e 视频解密器

本项目用于解密 CCTV 上使用 h5e 加密的视频。

这个脚本本意用于命令行交互，但是稍作修改也可以用于 JS 模块。

我不是专业 JS 开发，所以没做那么细致。

## 使用方法

我用的是 Linux 系统，所以我只能说 Linux 下怎么用。Windows 下需要你自己想办法了

首先，获取你想要的视频的 **h5e m3u8 链接**，并下载所有的切片，方法在网上有，我找了一个：<https://zhuanlan.zhihu.com/p/672745032>

注意！如果链接里面没有 `/asp/h5e/hls`，那么把 `/asp/.../hls` 改成 `/asp/h5e/hls`，因为我的脚本只能解密 h5e 加密的视频。

接下来，建一个文件夹，把下载好的视频的切片和仓库里的 js 复制到里面

然后

```bash
node main.js $(ls -v *.ts) out.mp4
```

解密后的文件就是 out.mp4 了。

### 参数

main.js 后可以跟 `--quiet-ffmpeg` 不显示 ffmpeg 的输出，然后跟的是视频切片。

注意！切片会按照你给定的顺序进行拼接，所以要注意不要弄串了。

最后一个参数就是输出文件。

## Misc.

[Videodl](https://github.com/CharlesPikachu/videodl) 是一个多功能视频下载器，其集成了我的脚本以便可以下载 CCTV 上的视频。
