# Phase 6: 可观测性与治理

**形式**：动手实验 + 讲解 | **时长**：20 分钟

![](/images/progress-p6.zh.png)

---

## 这一步在做什么

Agent 质量通过评估得到了保证。但企业级系统还需要回答三个治理问题：

- **Agent 做了什么？** —— 每次回答的推理依据能否追溯？

- **推理过程能否审计？** —— 半年后合规检查时，能否回溯到原始政策引用？

- **不同用户的数据如何隔离？** —— 一位员工的薪资信息是否会泄露给另一位？

这对应两条最佳实践：

- **BP2**：可观测性是 Evaluation 的数据基础——没有 Trace，在线评估无从采样。Phase 4 能运行，正是因为 Phase 2 部署时自动开启了 OpenTelemetry Trace。

- **BP7**：安全从外部强制执行——数据隔离不依赖 Agent 的推理判断，而是架构级别的强制约束。

## 6.1 审计推理过程

列出最近含工具调用的 Trace ID：

```bash
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
aws logs filter-log-events --region us-west-2 --log-group-name "aws/spans" \
  --start-time $(( ($(date +%s) - 7200) * 1000 )) \
  --filter-pattern '"execute_tool hr-tools___retrieve_hr_policy"' \
  --query "events[].message" --output text \
  | tr '\t' '\n' | python3 -c '
import sys, json
seen = {}
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("{"): continue
    try: d = json.loads(line)
    except Exception: continue
    tid = d.get("traceId") or d.get("trace_id")
    if tid: seen[tid] = True
for tid in list(seen)[:5]:
    print(tid)'
```

从上一步输出里挑一条 trace id 赋给 `TRACE_ID`(把下面 `6a30cbce144e3491...` 换成你自己的),查看完整 span 详情(工具调用 + 检索内容 + 推理步骤):

```bash
1
2
3
4
5
6
7
# 注意:把下面的值换成你上一步输出的 trace id
TRACE_ID=6a30cbce144e3491f2b56fe625ab5581

aws logs filter-log-events --region us-west-2 --log-group-name "aws/spans" \
  --start-time $(( ($(date +%s) - 7200) * 1000 )) \
  --filter-pattern "\"$TRACE_ID\"" \
  --query "events[].message" --output text | tr '\t' '\n' | jq -s .
```

在 Trace 中可以看到：

- Agent 调用了哪些 hr-tools（如 `retrieve_hr_policy`、`check_leave_balance`）

- 每次工具调用的输入参数和输出结果

- Knowledge Base 检索返回了哪些政策文档

- 模型的推理步骤和 Token 消耗

- 端到端延迟分解

![](/images/placeholder-trace-detail.png)

## 6.2 多租户隔离：actorId

所有调用中使用的 `--actor-id "employee-001"` 不只是一个标识符——它决定了数据边界：

- 不同 actorId 拥有**独立的 Memory 空间**

- Agent 分别记住每位员工的部门、角色和偏好

- 一位员工的假期余额、薪资信息不会出现在另一位的会话中

- 同一个 Harness 部署，通过 actorId 实现架构级别的强制隔离

这对应 BP7 的原则：安全不依赖 Agent "自己判断"要不要泄露信息——而是无论 Agent 怎么推理，架构上就不可能看到另一个 actorId 的数据。

## 6.3 CloudWatch 集成

```bash
1
2
3
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/bedrock-agentcore" \
  --query "logGroups[*].logGroupName" --output table
```

AgentCore 通过 OpenTelemetry 自动将 Trace 数据导出到 CloudWatch。在生产环境中，可以基于此设置仪表盘和告警——例如：

- Groundedness 分数持续下降 → 知识库可能需要更新

- 工具调用失败率上升 → 后端服务异常

- 响应延迟突增 → 需要扩容或简化 Prompt

这就是 ADLC 飞轮中"生产观测 → 挖掘失败案例 → 回到起点"的阶段。评估不只在上线前运行——生产中持续执行在线评估，用真实流量的分数驱动下一轮迭代。

## 6.4 成本与延迟：兑现"响应速度"

开篇我们给 CXO 立了三个看 Agent 的指标：**决策质量、响应速度、认知卸载**。前面 THELMA / Mind the Goal 把"质量"量化了——但"用户要等几秒""一次回答花多少钱"一个数都还没有。CXO 拍板上线时，这两个数和质量同样关键：先问"跑得起吗"，再谈"跑得好不好"。

好消息是不用新建任何东西。Agent 每次对话的 token 消耗和耗时，**早就记进了 `aws/spans`**（就是 6.1 读的那份数据）。我们只要把它读出来算一下。

直接运行脚本，对最近几次对话算出每次的延迟、token、成本：

```bash
1
2
cd ~/workshop
bash 11-cost-latency.sh
```

脚本会从 `aws/spans` 取最近几条含检索的 trace，逐条算出端到端延迟、输入/输出 token，并按 Nova 2 Lite 单价折算成本，打一张表：

```text
1
2
3
4
5
6
7
8
9
10
  Trace                 延迟(s)     输入token     输出token      成本(USD)
  --------------------------------------------------------------------
  6a2bf4d3dd515126         3.21          1842          412      0.000209
  6a2bf4e8bc636ed1         2.87          1763          388      0.000199
  6a2c01a7b9f4d220         4.05          2032          560      0.000256
  --------------------------------------------------------------------
  均值/合计                3.38          1879          453      0.000664

  ▸ 平均每次回答：延迟 3.38s，成本 $0.000221
  ▸ 3 次合计成本：$0.000664
```

![](/images/placeholder-cost-latency.png)

## 下一步

主线 6 个 Phase 到这里完整。时间允许,可以去 [可选延伸](/event/dashboard/zh-CN/workshop/085_optional_labs/) 看两个进阶实验(多模型对比、judge 稳定性);否则直接进 [总结](/event/dashboard/zh-CN/workshop/090_summary/) 收口。
