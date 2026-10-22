// 生成安装包和窗口用的图标 build/icon.png（256×256）。图标是程序自己画的，改了 src/main/app/icon.ts 之后重新跑一次：
//   node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { makeIconPng } from '../src/main/app/icon.ts'

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', makeIconPng(256))
console.log('已生成 build/icon.png')
