# Changelog

## v0.17.0 (2026-08-03) — 279 个上游提交合并

### 🌟 亮点

**🛡️ 核心稳定性**
- **`credential_pool` 锁竞态修复**（4 commits）——令牌刷新不再卡死主线程，`next_available_at` 多线程安全
- **`minimax-oauth` 流式错误修复**——代理认证失败不再静默挂死
- **`Agent` 空响应重试改进**——中断感知 + 抖动退避，不再无限循环
- **`feishu` 延迟 `lark_oapi` 导入**——修复启动路径未安装 SDK 时崩溃

**🖥️ Desktop 体验**
- **实时流渲染翻修**（6 commits）——`inflight` 转储不覆盖结构化行、历史追赶不重复渲染、同轮回复不丢失
- **`ChatView` 组件 memo 化**——停用 idle 聊天时消除全量重渲染
- **Gateway WebSocket 全抖动退避 + 按耗时升级重连**

**⚡ 性能**
- Dashboard `/assets` 输出不可变缓存头（`Cache-Control: immutable`）
- `InsightsEngine` 按需加载（`/api/analytics/usage` 不跑全量引擎）
- 懒工具目录开销收缩 + `zai` 端点探测并行化
- `COUNT(*)` → `LIMIT` 存在性检查，批量 tip-row 按 900 ID 分块
- Cron 空闲调度跳过配置加载
- Desktop `ChatView` 减少 idle 状态重渲染

**🧪 测试覆盖**
- 假时钟 backoff 测试（不再 busy-spin 7.5s）
- 插件缓存失效/刷新、桌面 wire reference 归一化、zai 并行探测全量覆盖

### 🔧 本地修复

| Commit | 内容 |
|--------|------|
| `14ce33187` | **`history` 变量作用域修复**——`run_after_agent_ready` 闭包引用的 `history` 在非 truncate 路径未定义，导致 desktop 启动崩溃 |
| `6c1c423fa` | **CJK UTF-8 二进制误判修复**——`read_file` 对 1000B 截断的 CJK 文本误判为 binary，增加 77 种文本扩展名白名单 + 嗅探窗口 1000→4096 |
| `926c32a53` | QQBot: 恢复 GROUP_MESSAGE_CREATE 支持 + 用户级 ACL + 响应抑制 |
| `38a1ed2c7` | QQBot: 修复 `AttributeError self.app_id` |
| `a997bdc0b` | QQBot: `_suppress_response` 不 `pop()`——支持多次 `send()` |
| `b6c2b6289` | QQBot: 群组消息添加时间戳 + sender id |
| `b797703d3` | QQBot: Context-only 前缀显示昵称 |
| `7fff91ded` | QQBot: 支持 hex 32 位 target + dict source 的 slash 命令 |
| `e4bfd44fa` | `search_files` Windows 路径处理 |
| `f853e4fb5` | Browser: 检测 `agent-browser.cmd` 在 `HERMES_HOME/node` 中 |
| `ec62c17fb` | llm-wiki: 三层强制入口协议 + v2.3.0 |
| `48dc4deed` | Telegram: 持久化 typing indicator |
| `a13d35697` | 清理上游合并后残留的 model-favorites 导入 |