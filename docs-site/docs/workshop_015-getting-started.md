# Getting Started

## 你将构建什么

在接下来的 2 小时里,你将构建一个完整的企业级 HR 问答 Agent,并亲手走通"构建 → 评估 → 优化"的闭环:

- **HR 知识检索 Agent** — 基于 Bedrock Knowledge Base + AgentCore Managed Harness,实时检索 HR 政策文档回答员工问题

- **自定义评估体系** — 用 THELMA + Mind the Goal 两个评估器自动评分,精准诊断"回答好不好、差在哪"

- **数据驱动的优化闭环** — 基于评估诊断改 Prompt,用分数验证改进是否有效

![](/images/architecture.png)

## 你会学到什么

- 用 AgentCore CLI 从零创建并部署 Managed Harness(纯配置,零编排代码)

- 配置 Gateway 让 Agent 通过受控通道调用外部工具(Bedrock KB + HR 操作)

- 理解 Memory 的跨会话记忆机制(自动记住员工偏好)

- 创建自定义 code-based evaluator,对 Agent 做批量质量评估

- 用评估诊断精准定位"该改 Prompt 还是该改检索"

- 通过 Traces 审计 Agent 的完整推理过程

## 前置知识

- 熟悉 AWS 控制台基本操作

- 有基本的命令行使用经验(能粘贴运行 bash 命令)

- 了解大语言模型(LLM)的基本概念(不需要深入)

!!! info
    不需要提前了解 AgentCore、Bedrock Knowledge Base 或评估方法论——这些都会在 workshop 中逐步讲解。

## Workshop 模式

!!! warning "仅限 AWS 活动"
    本 workshop 需要使用 Workshop Studio 提供的临时 AWS 账号。你将通过 Email one-time password (OTP) 登录获取环境。不会对你的个人账号产生任何费用。

下一步:登录 Workshop Studio 获取你的 AWS 环境。
