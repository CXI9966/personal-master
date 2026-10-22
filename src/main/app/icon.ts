import { deflateSync } from 'node:zlib'

// 程序自己画的图标（托盘、窗口、安装包都用它），不依赖任何图片文件

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** 圆角方块里一个白色圆点。返回 RGBA 的 PNG 数据 */
export function makeIconPng(size = 64): Buffer {
  const radius = size * 0.22
  const dot = size * 0.2
  const half = size / 2
  const raw = Buffer.alloc((size * 4 + 1) * size) // 每行前面有一个过滤方式字节（0）
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    for (let x = 0; x < size; x++) {
      // 圆角方块的有符号距离，用来做边缘抗锯齿
      const dx = Math.abs(x + 0.5 - half) - (half - radius)
      const dy = Math.abs(y + 0.5 - half) - (half - radius)
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
      const alpha = clamp01(0.5 - outside)
      const dotMix = clamp01(0.5 - (Math.hypot(x + 0.5 - half, y + 0.5 - half) - dot))
      const at = row + 1 + x * 4
      raw[at] = Math.round(47 + (255 - 47) * dotMix) // 底色 #2F6F8F，圆点白色
      raw[at + 1] = Math.round(111 + (255 - 111) * dotMix)
      raw[at + 2] = Math.round(143 + (255 - 143) * dotMix)
      raw[at + 3] = Math.round(255 * alpha)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8 位、RGBA、无压缩过滤特殊处理、无隔行
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
