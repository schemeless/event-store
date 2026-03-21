# Migration Guide

## v3 → v4

v4 的外部 API 变化。**所有 v3 代码无需修改即可运行**（旧 API 被标记为 deprecated，v5 移除）。

### 新增：`submit()` API（推荐）

v3 的 `receive` 是三层柯里化：

```ts
// v3
const [event] = await eventStore.receive(MyFlow)({ payload: { ... } });
```

v4 改为单次调用：

```ts
// v4+（推荐）
const [event] = await eventStore.submit(MyFlow, { payload: { ... } });
```

`receive` 继续可用，但已标记 `@deprecated`。

### 新增：`on()` 事件通知（推荐）

v3 订阅事件需要 RxJS：

```ts
// v3（需要 RxJS 知识）
eventStore.output$.subscribe((output) => {
  if (output.state === EventOutputState.success) {
    console.log(output.event);
  }
});
```

v4 改为普通函数：

```ts
// v4+（推荐）
const unsubscribe = eventStore.on('processed', (output) => {
  console.log(output.event, output.state);
});

// 不再需要时取消订阅
unsubscribe();
```

`output$` 继续可用，但已标记 `@deprecated`。

### 新增：结构化错误类型

v3 所有错误都是 `Error`，只能通过字符串判断：

```ts
// v3
try {
  await eventStore.submit(MyFlow, input);
} catch (e) {
  if (e.message.includes('Validation')) { ... }
}
```

v4 引入了专用错误类，可从 `@schemeless/event-store-types` 导入：

```ts
// v4+
import {
  ValidationError,
  FlowNotFoundError,
  AggregateError,
  ShutdownTimeoutError,
  RevertError,
  ConcurrencyError,
} from '@schemeless/event-store-types';

try {
  await eventStore.submit(MyFlow, input);
} catch (e) {
  if (e instanceof ValidationError) {
    console.log(e.flow.domain, e.flow.type, e.eventId);
  }
  if (e instanceof AggregateError) {
    console.log(e.flow, e.reason); // 'no_identifier' | 'no_loader' | 'apply_must_return_state' | 'capability_missing'
  }
}
```

### 新增：`kind` 判别字段（推荐）

为 EventFlow 加上 `kind` 字段后，TypeScript 可以自动 narrow 类型，AI 工具可以正确推断字段约束：

```ts
// v3（无 kind，validate/apply 的参数语义隐式）
const OrderFlow: AggregateEventFlow<Payload, State> = {
  domain: 'orders',
  type: 'OrderPlaced',
  aggregate: { ... },
  validate: (event, state) => { ... },  // state 类型不明确
  apply: (event, state) => { ... },     // 必须返回 State，但编译器不强制
};

// v4+（有 kind，类型系统强制约束）
const OrderFlow = {
  kind: 'aggregate' as const,
  domain: 'orders',
  type: 'OrderPlaced',
  aggregate: { ... },
  validate: (event, state: State) => { ... },  // state 类型自动 narrow
  apply: (event, state: State): State => { ... }, // 返回值类型被检查
} satisfies AggregateEventFlow<Payload, State>;
```

`kind` 在 v4 是可选字段，不加也不会报错。

---

## v4 → v5

v5 是内部架构重写（删除 RxJS 处理管道、消除全局 aggregate state cache）。**外部 API 无变化**，但有一个破坏性变化：

### 破坏性变化：`mainQueue` 和 `sideEffectQueue` 返回 `null`

v4 的 `EventStore` 上暴露了内部队列对象（已标记 deprecated）。v5 中这两个属性返回 `null`：

```ts
// v4（deprecated 但可用）
eventStore.mainQueue.push(rawEvent);

// v5（已移除，返回 null，访问会报运行时错误）
eventStore.mainQueue; // null
```

**如果你直接操作了 `mainQueue` 或 `sideEffectQueue`，需要迁移到 `submit()`。**

### 其他已废弃 API 的状态

| API | v3 | v4 | v5 |
|-----|----|----|-----|
| `receive(flow)(input)` | ✅ 主要 API | ⚠️ deprecated | ✅ 仍可用（委托给 submit） |
| `output$` | ✅ 主要 API | ⚠️ deprecated | ✅ 仍可用（Subject 桥接） |
| `mainQueue` | ✅ 内部暴露 | ⚠️ deprecated | ❌ 返回 null |
| `sideEffectQueue` | ✅ 内部暴露 | ⚠️ deprecated | ❌ 返回 null |
| `submit(flow, input)` | ❌ | ✅ 新增 | ✅ 主要 API |
| `on('processed', fn)` | ❌ | ✅ 新增 | ✅ 主要 API |

---

## 版本对照

| 版本 | 变化范围 | 是否破坏性 |
|------|---------|-----------|
| v3 → v4 | 外部 API 新增，旧 API deprecated | 否（错误类型 catch 逻辑除外） |
| v4 → v5 | 内部重写，`mainQueue`/`sideEffectQueue` 移除 | 仅限直接访问内部队列的代码 |
