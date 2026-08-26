# codearts-multica-runtime

将 CodeArts Agent（华为云码道代码智能体）接入 Multica 多智能体协作平台的运行时桥接程序。

## 架构

```
Multica Daemon (JSONL stdio)
        │
        ▼
codearts-multica-runtime (opencode 协议适配)
  ├─ stdin: 纯文本 prompt → 提取用户消息
  ├─ stdout: 内部帧 → opencode JSONL 格式
  ├─ POST /cag/session?directory=...  创建 kernel 会话
  ├─ POST /session/{id}/prompt_async  提交任务
  └─ GET  /event (SSE)                接收流式响应
        │
        ▼
CodeArts Kernel (localhost, 自动发现端口)
  ├─ inferhub-provider   (华为云内置模型)
  └─ openai-9716a4a24ed8902d  (自定义模型 → opengw.cloudcreator.club)
```

## 前置条件

- Node.js ≥ 18
- CodeArts Agent 已安装并运行（kernel 进程自动随 IDE 启动）
- Multica CLI 已登录

## 快速开始

```bash
cd codearts-multica-runtime
npm install
npm run build          # 编译到 dist/
npm test               # 15 单元测试
```

## CLI 模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 探活 | `node dist/src/index.js --probe` | 返回 runtime 版本信息 |
| 模型列表 | `node dist/src/index.js --list-models` | 返回可用模型列表 |
| 任务执行 | `node dist/src/index.js --stdio` | 接收 stdin JSONL 命令 |
| 任务执行 (opencode) | `node dist/src/index.js run` | opencode 协议族模式 |

### 手动测试

```powershell
$env:OPENCODE_SERVER_USERNAME = "codearts"
$env:OPENCODE_SERVER_PASSWORD = "<kernel-password>"

# 探活
node dist/src/index.js --probe

# 模型列表
node dist/src/index.js --list-models

# 执行任务 (JSONL stdin)
'{"v":1,"type":"execute","request_id":"test","cwd":"C:/codeartsproject","prompt":"reply only: OK"}' | node dist/src/index.js --stdio
```

## Multica 注册

### 1. 环境变量（永久）

```powershell
[Environment]::SetEnvironmentVariable("OPENCODE_SERVER_USERNAME", "codearts", "User")
[Environment]::SetEnvironmentVariable("OPENCODE_SERVER_PASSWORD", "<kernel-password>", "User")
```

> Kernel 密码获取见下方 [密码获取](#密码获取)。

### 2. 创建 runtime profile + 绑定本地路径

```bash
# Step 1: 创建 profile（记下返回的 id）
multica runtime profile create \
  --display-name "CodeArts" \
  --command-name "node" \
  --protocol-family "opencode" \
  --output json
```

```bash
# Step 2: 通过 API 设置 fixed_args，把脚本路径作为 node 的第一个参数
curl -X PATCH \
  "https://multica.clouddeveloper.club/api/workspaces/<workspace-id>/runtime-profiles/<profile-id>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"fixed_args":["C:\\path\\to\\codearts-multica-runtime\\dist\\src\\index.js"]}'
```

> **为什么需要 Step 2？** opencode 协议族按 `node run --format ...` 调用，`fixed_args` 确保 `node` 的第一个参数是我们的脚本路径，最终执行为 `node dist/src/index.js run --format ...`。

### 3. 重启 daemon

```bash
multica daemon restart
```

### 4. 创建 Agent 并绑定

在 Multica 页面创建 agent，选择 `CodeArts` runtime。

## 模型配置

默认使用自定义模型 `deepseek-v4-pro`，通过 `opengw.cloudcreator.club` 网关：

```typescript
// src/execute.ts
{ id: 'deepseek-v4-pro', provider_id: 'openai-9716a4a24ed8902d' }
```

如需切换模型，修改 `src/execute.ts` 中 `sendPrompt` 调用的 model 参数。

## 端口自动发现

Runtime 自动从 `~/.codeartsdoer/CodeArts_Agent/*/server_config.properties` 读取 kernel 端口。无需配置 `CODEARTS_KERNEL_PORT`。

## 密码获取

Kernel 密码存储在 `~/.codeartsdoer/codearts-data/custom-dir/data`（AES-256-GCM 加密）。可通过以下脚本解密：

```javascript
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const d = path.join(require('os').homedir(), '.codeartsdoer', 'codearts-data');
const k = Buffer.from(fs.readFileSync(path.join(d, '4', 'data'), 'utf8').trim(), 'base64').toString('utf8');
const c = JSON.parse(fs.readFileSync(path.join(d, 'custom-dir', 'data'), 'utf8'));
const s = JSON.parse(fs.readFileSync(path.join(d, '2', 'data'), 'utf8'));
const iv = JSON.parse(fs.readFileSync(path.join(d, '3', 'data'), 'utf8'));
const key = crypto.scryptSync(k, Buffer.from(s, 'base64'), 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
dec.setAuthTag(Buffer.from(c.authTag, 'base64'));
console.log(Buffer.concat([dec.update(Buffer.from(c.ciphertext, 'base64')), dec.final()]).toString('utf8'));
```

## 项目结构

```
codearts-multica-runtime/
├── src/
│   ├── index.ts            CLI 入口
│   ├── protocol.ts         Multica v=1 JSONL 协议
│   ├── client.ts           Kernel HTTP 客户端
│   ├── sse.ts              SSE 事件流解析
│   ├── env.ts              环境变量/端口/密码
│   ├── execute.ts          任务执行引擎
│   ├── probe.ts            --probe 模式
│   ├── models.ts           --list-models 模式
│   └── opencode-format.ts  opencode → v=1 帧转换
├── tests/
│   ├── protocol.test.ts
│   └── env.test.ts
├── codearts-runtime.cmd    Windows 启动包装
├── package.json
└── tsconfig.json
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `OPENCODE_SERVER_PASSWORD is not set` | 环境变量缺失 | 设置永久环境变量后重启 daemon |
| `Model not found` | session directory 未对齐 | 确保 createSession 使用 `?directory=C:/codeartsproject` |
| `并发会话数已达上限` | kernel 限制 3 个并发 session | 重启 kernel 清除旧 session |
| agent 跑偏/超时 | 正常 agent 行为 | daemon 超时 kill，重试即可 |