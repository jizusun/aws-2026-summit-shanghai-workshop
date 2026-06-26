# 总结

# 训练营总结

## 回顾

![](/images/progress-done.zh.png)

你刚刚走完了一轮完整的 ADLC 闭环。

回顾 Phase 3 中 Agent 给出的通用回答，再对比 Phase 5 优化后的评分变化：Groundedness 从 Fail 变为 Pass。你没有更换模型、没有写一行编排代码——只改了一段 System Prompt 配置，并用评估数据客观验证了改进确实发生。这就是"改 Harness，不改模型"的全部含义。

## 构建成果

一个使用 Amazon Bedrock AgentCore Managed Harness 的企业级 HR Agent：

| 能力 | AgentCore 组件 | 对应 BP |
| --- | --- | --- |
| HR 知识访问 | Gateway + Lambda + Bedrock KB | BP3: 清晰的工具策略 |
| 员工上下文记忆 | Memory (user-preference) | BP2: 可观测性基础 |
| 深度政策分析 | Skills (BYO Filesystem) | BP5: 工具替代内部推理 |
| 全链路审计 | Observability (Traces) | BP2: Eval 的数据来源 |
| 数据隔离 | actorId | BP7: 安全从外部强制 |
| 质量评估 | 自定义 Evaluators (THELMA + Mind the Goal) | BP4: 自动化评估 |
| 数据驱动优化 | Eval → 诊断 → 优化 → 再评估 | BP8: 持续测试与改进 |

## 核心收获

- **Agent 与传统软件本质不同**——非确定性、自然语言即源代码、依赖会自己动——传统 QA 方法论不再适用

- **Evaluation 承担四重角色**——规格说明 / 质量门控 / 生产监控 / 改进驱动力

- **80% 的提升来自 Harness 层**——改 Prompt、工具配置、检索策略，而非更换基础模型

- **评估不只打分，还能诊断**——THELMA 精准区分"该改 Prompt"还是"该改检索"，让优化有的放矢

- **可观测性是 Evaluation 的数据基础**——没有 Trace，在线评估无从采样

- **ADLC 是飞轮，不是流水线**——生产不是终点，而是飞轮最富价值的输入

## 后续方向

本训练营完成了飞轮的第一圈。在实际生产中，这个飞轮持续转动：

- 扩充 Golden Set 测试集，覆盖更多场景与边界用例

- 针对检索失效类问题（如本训练营中的病假案例）做知识库工程：清洗源文档、优化分块策略、增加 metadata 过滤

- 添加 Cedar Policies 实现细粒度访问控制

- 用 Config Bundles 做 A/B 测试，对比不同配置的评估表现

- 通过 AgentCore 控制台配置在线评估，将评估接入生产监控与告警

## 参考阅读

本训练营是以下系列的动手实现：

- 企业 Agentic 之旅——为什么 Evaluation 是一切的起点

- 企业级 Agent 评测实践——从原型验证到生产就绪

- 用 Amazon Bedrock AgentCore 做 Agent Evaluation

- Agent Evaluation 企业落地案例（本训练营）

## 清理资源

请继续前往下一页清理所有 Workshop 资源。
