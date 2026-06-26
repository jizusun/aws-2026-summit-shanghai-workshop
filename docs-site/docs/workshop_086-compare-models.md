# A. 多模型对比 (可选)

## 目标

用数据回答 CXO 最爱问的一句:**"换个更便宜的模型,质量还过得去吗?"** 把同一套 golden 问题在另一个模型上重跑、用同一个 THELMA 打分,再和 Phase 4 的基线并排比——把"换模型"这种决定从拍脑袋变成看数据。这正是评估的终极价值:它让模型选型变成一个可量化的工程决策。

!!! info
    **为什么这样设计**：Harness 的模型是部署时定下的,换模型 = 改配置 → 重新部署 → 重跑 → 重新评估。脚本**非破坏性**地完成这一整套——只在 `harness.json` 里替换模型 ID 再 `deploy`(**不会删掉你建好的评估器**),并在结束时用 trap 把模型**还原**回基线。整个过程约 10-15 分钟(含两次重新部署:换模型 + 还原)。

!!! warning
    **首次在 test 环境跑请先确认**:脚本假设模型 ID 写在 `app/hrassistant/harness.json` 里(它会先检查,找不到就报错退出、不静默空跑)。若你这套 CLI 把模型存在别处,按脚本报错提示把替换目标改成对应文件。

### Step 1: 跑对比脚本

默认拿一个**更大的同家模型**(Nova Pro)和基线(Nova 2 Lite)比——这是经典的"小模型省钱、大模型质量好"trade-off。在 EC2 的 SSM 终端里:

```bash
1
2
cd ~/workshop
bash 12-compare-models.sh
```

想指定别的对比模型:

```bash
1
2
bash 12-compare-models.sh us.amazon.nova-pro-v1:0      # 等价默认值
bash 12-compare-models.sh us.anthropic.claude-haiku-4-5-20251001-v1:0  # 想试别家也行
```

脚本会依次:切换 Harness 到对比模型 → 重新部署 → 重跑 3 个 golden 问题 → 跑 THELMA + Mind the Goal → 算成本/延迟 → **自动还原回基线模型**。

!!! warning "为什么不默认用 Nova Micro 这种小模型"
    你可能想拿 **Nova Micro / Haiku** 这一档"再便宜一点"的模型对比——直觉上"基线 Lite,再下一档应该更省"。但实测它们在 **Strands Agents 的 ToolUse 严格协议**下经常报:
    
    `Error: Model produced invalid sequence as part of ToolUse`这是小模型的通病:写文章可以,但严格的 tool-use 协议(`` 之后必须产出合规 tool_use JSON)它们经常乱序、闭合错误、Bedrock 流式校验直接拒。三次对话全失败 → 没有 trace → 评估器没东西可评 → 演示价值 = 0。
    
    **这本身也是一种评估结论:某个模型搭不上你当前的 Agent 拓扑**——不只是"分数低",是**根本跑不起来**。生产里换模型前先用 golden set 跑一遍,这种"格式不兼容"的雷在小流量上就能炸出来,不会等到上线才发现。Nova Pro / Claude Sonnet / Haiku 这一档及以上 tool-use 普遍稳,适合直接拿来比。

![](/images/placeholder-compare-models.png)

### Step 2: 和基线并排比

把脚本输出的对比模型分数,和 Phase 4(content 4.2)那张基线表(Nova 2 Lite)放一起看:

| 维度 | 基线 (Nova 2 Lite) | 对比 (Nova Pro) | 怎么判断 |
| --- | --- | --- | --- |
| 质量(THELMA Pass 率 / GR) | 你的 Phase 4 数 | 本次脚本数 | 涨/掉多少 |
| 成本(每次回答 $) | — | 本次脚本数 | 贵多少 |
| 延迟(s) | — | 本次脚本数 | 慢/快多少 |

典型结论形如：Pro 把 GR 推到 0.92,但每次 token 成本是 Lite 的 ~5 倍——值不值,看你的业务能容忍多少 hallucination。这是分数说话,不是拍脑袋。

!!! success
    **这就是用数据做模型选型**:质量基本不掉、成本明显下降 → 换便宜模型划算;质量明显下滑 → 贵模型的钱花得值;**直接报错跑不通 → 这个模型与当前拓扑不兼容**(刚才那条 ToolUse 报错就是)。无论哪种结论,你都是拿分数(或拿失败模式)说话,而不是靠感觉。

!!! warning
    对比模型的 token 单价和基线不同,`11-cost-latency.sh` 默认用的是 Nova 2 Lite 单价。要精确比成本,用 `PRICE_IN=... PRICE_OUT=... bash 11-cost-latency.sh` 传对比模型的单价(以 Bedrock 定价  为准)。
