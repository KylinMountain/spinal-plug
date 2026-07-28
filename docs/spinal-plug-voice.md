# SPINAL-PLUG 系统文案规范

Spinal Plug 的界面语气是高压、精密的生物机械控制台。它是原创产品语言，用来表达软件同步、身份装载和上下文投影状态；不借用既有作品的角色、专名或剧情。

## 术语映射

| Spinal Plug 表达 | 实际系统含义 |
| --- | --- |
| 记忆脊椎栓 | 当前 Project Space 与本地记忆缓存的可验证绑定。 |
| 神经链路 | 当前宿主 Session 与 Context Projection 的注入通道。 |
| Mind Capsule | 已编译的身份、角色、Mission、任务图、记忆和 Checkpoint 启动包。 |
| Incarnation Link | 某个 Capsule 在一个 Agent、设备和会话上的运行实例。 |
| Memory Fidelity | 已加载、状态为 active 的持久记忆引用数，而非虚构百分比。 |
| Neural Uplink | WAL Outbox 到 Control Plane 的同步通道。 |

## 状态文案

### 启动与锁定

```text
SPINAL-PLUG // NEURAL MEMORY INITIALIZATION
[01/05] Memory Spinal Plug ....... LOCKED
[02/05] Incarnation Link ......... NEURAL CHANNEL BOUND
[03/05] Mind Capsule ............. PROJECT-SCOPE CONTEXT ENGAGED
[04/05] Memory Fidelity .......... <verified reference count>
[05/05] Neural Uplink ............ STANDBY | <pending signal count>
STATUS: SPINAL PLUG LOCKED // MEMORY CHANNEL ONLINE
```

### 可验证警告

只有对应真实状态时才显示：

```text
CAUTION: PROJECT MEMORY CHAMBER IS UNLINKED.
ACTION: Select an archive, General Space, or an existing Project Space before locking the link.

WARNING: NEURAL UPLINK HAS <n> PENDING SIGNALS.
ACTION: The local WAL is intact. Synchronization will retry on the next eligible lifecycle boundary.

WARNING: MIND CAPSULE IS UNAVAILABLE FOR THIS PROJECT SPACE.
ACTION: Select a Capsule compiled for the current Project Space before instantiating an Incarnation.

ALERT: MEMORY FIDELITY CONFLICT DETECTED.
ACTION: Review disputed canonical memory before applying it to the active context.
```

### 禁止的伪状态

不得把软件状态描述为真实的人体伤害、药物注射、爆炸、血液、免疫排异或神经损毁。系统可以有压迫感，但必须可审计、可恢复，并准确指向 Project Space、WAL、Outbox、Capsule、ACL 或同步状态。
