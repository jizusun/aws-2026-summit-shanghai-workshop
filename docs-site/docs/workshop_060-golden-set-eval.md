# Phase 4: Golden Set 批量评估

**形式**: 动手实验 | **时长**: 30 分钟

![](/images/progress-p4.zh.png)

---

## 这一步在做什么

Phase 3 你试了一次对话，回答看起来不错。但"看起来不错"恰恰是最危险的状态——它正是从 Demo 到生产那道鸿沟的起点。

"跑通一次"不等于可以上线。能力（capability）与一致性（consistency）之间存在根本张力。

你要回答的不是"它能不能答对"，而是决策者真正在意的**决策质量**：在不同类型的问题上，质量有多稳定？低分时低在哪里？该往什么方向改？

这就是 Evaluation 的价值。本阶段引入的评估器，**精髓不是"打个分"，而是从分数组合里自动诊断"该去修哪里"**——这直接决定 Phase 5 往哪儿优化。

## 为什么用自定义评估器

AgentCore 提供内置评估器（`Builtin.Correctness` / `Builtin.Faithfulness` 等），适合快速验证。但 BP4 强调：**评估标准是核心资产，应由团队自行定义和拥有。**

本阶段演示如何将自研的评估方法接入 AgentCore 作为原生评估器运行——这是企业级落地的常见路径。

## 本阶段构建什么

两个互补的自定义 **code-based evaluator**：

| 评估器 | 级别 | 评什么 | 核心指标 |
| --- | --- | --- | --- |
| **THELMA** | TRACE（单轮） | RAG 检索与回答质量 | 7 维分数,主分 Groundedness(防幻觉) |
| **Mind the Goal** | SESSION（多轮） | 用户目标是否达成 | 目标达成率 GSR + 失败归因 RCOF |

两者结合：THELMA 发现"单轮回答有没有幻觉、检索准不准"；Mind the Goal 发现"整个会话用户的目标有没有完成"。

## 评估方法论

### THELMA —— 单轮 RAG 质量评估

THELMA 将一次问答拆解为 `(用户问题, 检索到的源文档, Agent 回答)` 三元组,用 LLM-as-Judge 逐句核对,输出 7 个 0-1 分数:

| 指标 | 全称 | 含义 | 低分说明 |
| --- | --- | --- | --- |
| **SP1** | Source Precision (chunk-level) | 召回的 chunk 整体相关吗 | 检索捞了无关 chunk |
| **SP2** | Source Precision (fact-level) | chunk 里的原子事实有多少真正相关 | chunk 名义对题、内容夹带脏数据 |
| **SQC** | Source Query Coverage | 源文档是否覆盖了问题的各方面 | 知识库中没有答案 |
| **RP** | Response Precision | 回答中切题内容的占比 | 回答冗余、跑题 |
| **RQC** | Response Query Coverage | 问题的各方面是否都答到了 | 答漏了、不完整 |
| **SD** | Self-Distinctness | 回答内部是否有重复 | 同一信息反复出现 |
| **GR** | **Groundedness** | **回答的每句话是否有源文档支撑** | **存在幻觉** |

**GR（Groundedness）是最关键的指标**——它直接回答"这个回答是否有据可查"。在 HR、法务、合规等场景，GR 低意味着 Agent 在用训练知识编造政策细节，而非基于检索结果。

THELMA 的核心价值在于**诊断能力**——它能根据分数组合自动判定问题根因:

- `SQC低 + RQC高 + GR低` → 检索未覆盖,但模型仍然给出了回答,且无源支撑 → **诊断:模型在编造,建议改 Prompt**

- `SQC低 + RQC低` → 检索未覆盖,回答也不完整 → **诊断:检索失效或知识库缺内容,建议改检索/补文档**

- `SP1高 + SP2低`(chunk 对题、事实多数无关) → KB 混入脏数据/分块策略问题 → **诊断:清洗源文档,调整分块**

- `RP低 + SP1高` → 检索质量好,但回答夹带无关内容 → **诊断:回答不聚焦,建议改 Prompt 约束输出结构**

评估不仅告诉你"分数低"，还告诉你"低在哪、往什么方向改"。

### Mind the Goal —— 多轮会话目标达成评估

真实对话往往是多轮的。THELMA 看单次回答质量，Mind the Goal 看：**整场对话下来，用户最初想办的事，到底办成了没有？**

评估分三步：

- **切分目标**：逐轮分析对话，将连续围绕同一件事的若干轮合并为一个"目标（Goal）"

- **判定成败**：对每个目标判定成功/失败——只要目标中有任何一轮失败，整个目标算失败

- **计算 GSR + 归因 RCOF**：

**GSR（Goal Success Rate）** = 成功目标数 / 总目标数

- **RCOF（Root Cause of Failure）**：对每个失败目标归因到 7 类根因之一

## 步骤概览

| 步骤 | 操作 | 目的 |
| --- | --- | --- |
| 4.0 | 准备评估环境 | 安装 uv + 启用 CloudWatch Transaction Search |
| 4.1 | 创建自定义评估器 | 将 THELMA 和 Mind the Goal 注册为 AgentCore 原生评估器 |
| 4.2 | 运行批量评估 | 对已有对话执行评估,观察分数、诊断、定位系统性问题 |

## 下一步

从 [4.0 准备评估环境](/event/dashboard/zh-CN/workshop/060-golden-set-eval/061_eval_env/) 开始,先把 evaluator 跑得起来的几样前置(uv、Transaction Search)装好,再到 4.1 把两个评估器注册进去,4.2 跑一轮批量评估并解读分数。本阶段产出的诊断结论,会在 Phase 5 直接驱动改 Prompt。
