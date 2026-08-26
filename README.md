# codearts-multica-runtime

将 CodeArts Agent（华为云码道代码智能体）接入 Multica 多智能体协作平台的运行时桥接程序。

支持两种模式：Chat 对话（代码编写/调试）和 Issue 编排（从 issue 取任务 → agent 执行 → 结果自动贴回 issue）。

## 架构

```
Multica Daemon (JSONL stdio / text)
        │
        ▼
codearts-multica-runtime
  ├─ stdin adapter   纯文本/openCode JSONL → 统一 prompt
  ├─ orchestrator    Issue: 取正文 → 执行 → 贴结果 → (设 in_review)
  ├─ opencode-format 内部帧 → openCode JSONL 输出
  ├─ POST /cag/session?directory=...     创建 kernel 会话
  ├─ POST /session/{id}/prompt_async     提交任务
  └─ GET  /event (SSE)                   接收流式响应
        │
        ▼
CodeArts Kernel (localhost, 自动发现端口)
  ├─ inferhub-provider         (华为云内置模型)
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

## 两种工作模式

### Chat 模式

在 Multica 页面直接对话，agent 接收用户消息并执行任务（代码编写、文件操作、安装工具等）。

用于日常编码辅助，和 IDE 对话体验一致。

### Issue 编排模式

创建 issue 并分配给 agent，runtime 自动完成闭环：

```
Issue (todo)
    │
    ▼  runtime 检测到 issue 任务
├─ 取方式: 1. 提子取 issue 正文 (multica issue get)
├─ 状态检查: in_review/done → 跳过；todo/in_progress → 执行
├─ 拼 Chat prompt: 将 issue 描述转换为 agent 可执行的指令
├─ 发送给 CodeArts kernel → agent 执行（读文档、装工具、跑测试等）
├─ 获取结果: agent 文本输出
├─ 贴评论: multica issue comment add --content-file result.md
└─ 设状态: multica issue status <id> in_review
```

重复执行保护：issue 已 in_review 时自动跳过，不重复执行。

## CLI 模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 探活 | `node dist/src/index.js --probe` | 返回 runtime 版本信息 |
| 模型列表 | `node dist/src/index.js --list-models` | 返回可用模型列表 |
| 任务执行 | `node dist/src/index.js --stdio` | 接收 stdin JSONL 命令 |
| 任务执行 (opencode) | `node dist/src/index.js run` | openCode 协议族模式 |

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

### 2. 创建 runtime profile

```bash
multica runtime profile create \
  --display-name "CodeArts" \
  --command-name "node" \
  --protocol-family "opencode" \
  --output json
```

### 3. 设置 fixed_args（通过 API）

```bash
curl -X PATCH \
  "https://multica.clouddeveloper.club/api/workspaces/<workspace-id>/runtime-profiles/<profile-id>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"fixed_args":["C:\\path\\to\\codearts-multica-runtime\\dist\\src\\index.js"]}'
```

> openCode 协议族按 `node run --format ...` 调用，`fixed_args` 插入脚本路径。

### 4. 创建 Agent 并绑定

Multica 页面 → 创建 agent → 选择 `CodeArts` runtime。

### 5. 重启 daemon

```bash
multica daemon restart
```

## 模型配置

默认调用自定义模型 `deepseek-v4-pro`，直连 `opengw.cloudcreator.club`：

```typescript
// src/execute.ts
{ id: 'deepseek-v4-pro', provider_id: 'openai-9716a4a24ed8902d', agent: 'build' }
```

切换模型：修改 `src/execute.ts` → `sendPrompt` 调用的 model 参数。

## 端口自动发现

Runtime 从 `~/.codeartsdoer/CodeArts_Agent/*/server_config.properties` 自动读取 kernel 端口。

## 密码获取

Kernel 密码存储在 `~/.codeartsdoer/codearts-data/custom-dir/data`（AES-256-GCM 加密）：

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
│   ├── index.ts             CLI 入口
│   ├── protocol.ts          Multica v=1 JSONL 协议
│   ├── client.ts            Kernel HTTP 客户端 (session + prompt)
│   ├── sse.ts               SSE 事件流解析
│   ├── env.ts               环境变量/端口自动发现/密码
│   ├── execute.ts           任务执行 + Issue 编排器
│   ├── probe.ts             --probe 探活模式
│   ├── models.ts            --list-models 模型列表
│   └── opencode-format.ts   openCode JSONL 帧转换
├── tests/
│   ├── protocol.test.ts
│   └── env.test.ts
├── codearts-runtime.cmd     Windows 启动包装
├── package.json
└── tsconfig.json
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `OPENCODE_SERVER_PASSWORD is not set` | 环境变量缺失 | 设置永久环境变量后重启 daemon |
| `Model not found` | session directory 未对齐 | 确保 createSession 使用 `?directory=C:/codeartsproject` |
| `并发会话数已达上限` | kernel 限制 3 个并发 session | 重启 kernel (`taskkill /F /IM AgentKernel*`) |
| agent 跑偏/超时 | 正常 agent 行为 | daemon 超时 kill，重试即可 |
| Issue 重复执行 | in_review 触发新任务 | 编排器内置状态去重，自动跳过 |
| kernel 重启后 `Model not found` | IDE 扩展未自动重推配置 | 见下方 [kernel 重启恢复](#kernel-重启恢复) |

### kernel 重启恢复

执行 `taskkill /F /IM AgentKernel*` 后，IDE 会自动拉起新 kernel，但**不会同步自定义模型**。需手动注入：

```powershell
$port = (Select-String -Path "$env:USERPROFILE\.codeartsdoer\CodeArts_Agent\*\server_config.properties" -Pattern 'port=(\d+)').Matches.Groups[1].Value
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("codearts:${env:OPENCODE_SERVER_PASSWORD}"))

# 注册自定义模型
$body = '{"source_type":"custom","provider":"inferhub-provider","model_name":"deepseek-v4-pro","model_id":"deepseek-v4-pro","model_url":"https://opengw.cloudcreator.club/v1","api_format":"openai","is_custom_model":true,"context_window":200000,"display_enabled":true}'
Invoke-RestMethod -Uri "http://localhost:$port/cag/model/init" -Method POST -Headers @{Authorization="Basic $auth";"Content-Type"="application/json"} -Body $body

# 更新全局 provider 配置
$body = '{"provider":{"inferhub-provider":{"name":"inferhub-provider","models":{"deepseek-v4-pro":{"id":"deepseek-v4-pro","reasoning":true,"limit":{"context":200000,"output":16000,"input":184000}}}}}}'
Invoke-RestMethod -Uri "http://localhost:$port/cag/global/config" -Method PATCH -Headers @{Authorization="Basic $auth";"Content-Type"="application/json"} -Body $body

multica daemon restart
```