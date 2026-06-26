# Phase 1.5: 了解 Managed Harness

**形式**: 讲解 + 演示 | **时长**: 10 分钟

![](/images/progress-p1.zh.png)

---

## 为什么用 Managed Harness

上一节我们建立了两个认知:一是 Agent 开发需要以 Evaluation 为驱动力;二是 80% 的性能提升来自 Harness 层(Prompt、工具、检索配置),而非更换模型。

这就引出一个实际问题:**用什么工具来构建这个 Harness 层?**

Managed Harness 是 AgentCore 提供的一种"按配置定义、按配置运行"的 Agent 构建方式——一次 API 调用指定模型、System Prompt、工具、记忆、Skills,**不需要你写编排代码**。这听起来像普通的"封装好",但工程意义很具体:**改 Harness 配置 → 重新部署 → 重新评估 → 看分数变化**——这一整圈迭代以分钟计。这正是评估驱动开发能不能真正落地的关键:迭代慢,飞轮就转不起来。

## 核心组件

在本实验中，各组件的分工如下：

| 组件 | 作用 | 对应 BP |
| --- | --- | --- |
| System Prompt | 定义 HR 助手的角色和行为规范 | BP8 |
| Gateway (Lambda target) | 连接 Bedrock Knowledge Base 和 HR 操作工具 | BP3 |
| Memory | 跨会话记住员工上下文（部门、角色、偏好） | BP2 |
| Skills | 按需加载详细的政策分析和假期计算指令 | BP5 |
| Observability | 完整记录每一步推理过程，作为评估的数据来源 | BP2 |

## 工作原理

一次员工提问会依次流经检索、工具、记忆、推理四条能力通道,沿途每一步都向 Observability emit 一条 Trace;评估闭环再从这些 Trace 读取数据评分,并把诊断结果回灌成下一轮 Harness 配置改动——这就是分钟级的 Eval 飞轮。

![](/images/harness-dataflow.png)

注意图中那条橙色回路:**Trace 是评估的数据基础。** 没有完整的 Trace，评估器就无法知道 Agent 做了什么、检索了什么、回答基于什么。这就是 BP2 强调"从第一天就埋好可观测性"的原因。

!!! info
    本训练营覆盖完整的 ADLC 闭环：构建与部署（Phase 2-3）、评估与优化飞轮（Phase 4-5）、可观测性与治理（Phase 6）。

## 下一步

理解了用什么搭、各组件分工怎么落,下一段就动手建出来。Phase 2 用纯配置(改 `harness.json`,不写编排代码),30 分钟产出一个部署在 VPC 内的 HR Agent。第一站从 [2.1 连接并验证环境](/event/dashboard/zh-CN/workshop/040_create_deploy/041_connect/) 开始。
