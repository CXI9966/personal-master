# 桌宠接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Butler 通过 dsh-pet 的本机 HTTP 接口，让桌宠反映状态、提供右键菜单、说管家台词（模型写、限频）。

**Architecture:** 新目录 `src/main/pet/`：`client.ts`（HTTP 封装，永不抛错）、`summary.ts`（今日摘要比较）、`lines.ts`（模板台词和限频）、`bridge.ts`（把事件变成对桌宠的调用）。设置存 `config.json`，经 `pet:get`、`pet:save`、`pet:test` 三个通道给设置页。设计见 [2026-10-23-pet-bridge-design.md](../specs/2026-10-23-pet-bridge-design.md)。

**Tech Stack:** Electron、TypeScript、React 19、Node 内置 `fetch`。不加新依赖。

**验证方式：** 用户要求仓库不放测试。每个任务改完跑 `npm run typecheck`，最后 `npm run build`，再用仓库外的一次性脚本（假桌宠服务器加真实 Electron）验证。代码直接写进文件，本计划只列任务、文件和检查点，不重复贴代码。

---

### Task 1: 蓝鲸桌宠人格

- [ ] `src/shared/persona.ts`：`PersonaId` 加 `'whale'`，`PERSONA_CHOICES` 加一项
- [ ] `src/main/init/personas.ts`：`PERSONA_PRESETS` 加 `whale` 的四栏内容
- [ ] `src/main/ipc/schemas.ts`：`persona` 的枚举加 `'whale'`
- [ ] `npm run typecheck`；提交 `feat(persona): add whale desktop-pet persona`

### Task 2: 用量名下加“桌宠台词”

- [ ] `src/shared/ai.ts`：新增 `UsageFeatureName = AiScene | 'pet'`，`UsageSummary.byFeature` 改用它
- [ ] `src/shared/schema.ts`：`UsageFeature` 枚举加 `'pet'`
- [ ] `src/shared/usageText.ts`：`FEATURE_NAMES` 加 `pet: '桌宠台词'`
- [ ] `src/main/ai/usage.ts`：`logUsage` 的 `feature` 类型改为 `UsageFeatureName`
- [ ] `npm run typecheck`

### Task 3: 设置、配置合并、IPC

- [ ] 新增 `src/shared/pet.ts`：`PetSettings`、默认值、`parsePetSettings`（宽松读取）、`validatePetSettings`（保存时严格校验，地址必须是本机）、`PetTestResult`
- [ ] `src/main/app/context.ts`、`config.ts`：`AppConfig` 加 `pet`；`ConfigStore.write` 改成合并写，避免 `workspaceRoot` 和 `pet` 互相覆盖
- [ ] `src/shared/ipc.ts`：加 `pet:get`、`pet:save`、`pet:test` 三个通道
- [ ] `src/main/ipc/index.ts`：`createHandlers` 加第四个参数 `pet: PetControl`
- [ ] `npm run typecheck`

### Task 4: 桌宠客户端和纯逻辑

- [ ] `src/main/pet/client.ts`：`createPetClient`，方法 `config`、`state`、`setWorkStatus`、`clearWorkStatus`、`broadcast`、`acquireLock`、`releaseLock`、`registerMenu`、`clearMenu`、`pollMenu`；全部返回 `{ ok, ... }`，不抛错
- [ ] `src/main/pet/summary.ts`：`summarize`、`diffSummary`
- [ ] `src/main/pet/lines.ts`：五套模板、`voiceOf`、`pickLine`、`createLineLimiter`
- [ ] `src/main/ai/service.ts`、`weeklyComment.ts` 同目录新增 `petLine.ts`：`AiService.petLine`，用管家人格写一句，记用量
- [ ] `npm run typecheck`

### Task 5: 桥接和接线

- [ ] `src/main/pet/bridge.ts`：`createPetBridge`，含常驻状态、台词队列、右键菜单长轮询、探活、清理
- [ ] `src/main/app/ticker.ts`、`context.ts`：`showReminder` 带上提醒种类
- [ ] `src/main/ai/service.ts`：`createAiService` 加可选的 `onRunStart`
- [ ] `src/main/index.ts`：创建桥接，接到 `notifyDataChanged`、`showReminder`、`notifyAi`、`onRunStart`、退出清理，启动时按配置开始
- [ ] `npm run typecheck && npm run build`；提交 `feat(pet): bridge to dsh-pet`

### Task 6: 设置页

- [ ] 新增 `src/renderer/src/components/PetSettings.tsx`，放进 `Settings.tsx`
- [ ] `npm run typecheck && npm run build`；提交 `feat(ui): pet settings`

### Task 7: 假服务器验证

- [ ] 在系统临时目录写一次性脚本：假桌宠服务器加真实 Electron，覆盖状态、台词（模板和模型两条路）、菜单点击、限频、断开重连、关闭
- [ ] 运行，有 FAIL 就修；跑完删脚本

### Task 8: 文档和收尾

- [ ] `README.md`：新增“桌宠”一节；人格列表加蓝鲸桌宠；说明桌宠台词会按限频调用模型
- [ ] 提交；问用户是否做真机验证、是否推送、是否重新打包
