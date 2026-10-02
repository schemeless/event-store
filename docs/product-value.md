# 产品价值说明

## 一句话定位

Schemeless Event Store 是一个面向 TypeScript 应用的 Event Sourcing 工具箱，提供事件日志、聚合运行时、共享类型、存储适配器和补偿式回滚能力。

## 用户与业务价值

- 为需要审计、回放、迁移和重建读模型的产品提供可复用事件存储基础设施，减少每个业务系统重复实现事件日志的成本。
- 通过 core 与 aggregate 分层，让应用既能直接操作事件日志，也能用聚合定义表达领域命令、precondition、decide 和 evolve。
- PostgreSQL 与 Expo SQLite 适配器覆盖服务端多实例部署和移动端 offline-first 两类场景，适合从本地优先产品走向云端同步架构。
- export/import、scan 和 rebuildReadModels 支持备份、恢复、调试、适配器迁移和读模型重建。

## 产品成熟度

**Prototype / 可用原型。**

仓库已拆成多个公开 npm 包并标记为 `6.0.0-rc.6`，具备核心 API、适配器、迁移文档和测试文件；但版本仍是 RC，README 也明确 V6 是 breaking redesign，因此不应包装成稳定 GA 级基础设施。

## AI 技术价值

- 该项目本身不是 AI 产品；核心价值是为 AI Agent、Copilot 或自动化工作流提供可审计、可重放、可恢复的事实日志。
- 事件溯源天然适合“让 AI 解释发生过什么”：事件流比最终状态更容易追踪因果、生成复盘、定位异常和构建上下文摘要。
- 补偿式 revert 与 causation/correlation 结构可以帮助 AI 辅助操作保留撤销路径，但当前仓库没有内置 AI 决策、AI 审核或自然语言接口。

## 非 AI 技术壁垒

- 分层架构：core、aggregate、types、adapters、revert 分离，降低不同运行时和存储后端耦合。
- Stream-level optimistic concurrency control：以 `appendToStream(events, expectedVersion)` 作为并发正确性边界，避免依赖进程内锁。
- Adapter contract：PostgreSQL 与 Expo SQLite 都围绕 `StreamEventStoreAdapter` 实现，清晰区分存储能力与业务逻辑。
- 重建与迁移能力：scan/export/import 使用 storage commit order，并支持分页 AsyncIterable，适合大事件日志处理。
- 补偿式回滚：按 causation 后代 post-order 生成 compensating events，保留事件不可变原则。

## 可对外使用的亮点

- “从移动端本地事件日志到服务端 PostgreSQL 的同一套事件模型。”
- “把 Event Sourcing 的核心机械结构拆成可组合包：core、aggregate、types、adapter、revert。”
- “内置 OCC、读模型重建、事件导入导出和适配器迁移路径。”
- “适合 local-first、可审计账本、工作流历史、可撤销操作等需要保留事实轨迹的产品。”

## 不应夸大的边界

- 不应宣称已是稳定生产版；当前包版本为 `6.0.0-rc.6`，文档明确 V6 是 breaking redesign。
- 不应宣称覆盖所有数据库；当前一等适配器是 PostgreSQL 与 Expo SQLite。
- 不应把它描述成完整 CQRS 平台；它提供事件存储、聚合运行时、适配器和读模型重建入口，业务投影存储与领域逻辑仍由应用负责。
- 不应宣称有云服务、托管控制台或 AI 自动化能力；仓库内容是库和适配器。

## 证据来源

- `README.zh-CN.md`：说明 V6 拆层式 Event Sourcing 工具箱由 `core`、`aggregate`、`types` 与 adapters 组成，并列出 PostgreSQL / Expo SQLite 适配器。
- `package.json`：根仓库是 Yarn workspaces + Lerna，多包发布脚本包括 `publish-all`。
- `packages/event-store-core/package.json`、`packages/event-store-aggregate/package.json`、`packages/event-store-adapter-pg/package.json`、`packages/event-store-adapter-expo-sqlite/package.json`：包版本均为 `6.0.0-rc.6`，并设置 public publish config。
- `docs/architecture.md`：定义 V6 层次、source of truth、commit order、snapshot/cache 边界、identifier 规则和 aggregate/core 入口关系。
- `docs/adapters.md`：列出 adapter 必需能力、行为规则和 PostgreSQL / Expo SQLite 适用场景。
- `docs/occ-and-concurrency.md`：说明 stream-level OCC 规则、失败行为与 `StreamConcurrencyError`。
- `docs/export-import.md`：说明 export/import/scan、备份恢复、设备迁移和 adapter migration 用法。
- `docs/redesign-v6-migration.md`：明确 V6 是 breaking redesign，并说明旧 `@schemeless/event-store` 被拆成新包。
- `packages/event-store-core/src/makeEventStoreCore.ts`、`packages/event-store-aggregate/src/makeAggregateRuntime.ts`、`packages/event-store-revert/src/makeEventStoreRevert.ts`：分别证明 core API、聚合运行时与补偿式回滚实现。
