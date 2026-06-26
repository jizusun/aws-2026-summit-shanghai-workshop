# 4.0 准备评估环境

## 目标

为评估飞轮准备两样硬性前提:用于打包评估器的 `uv`,以及让评估服务能读取 Agent Trace 的 CloudWatch Transaction Search。

Phase 3 的回答看起来不错——但"看起来不错"没有任何工程意义。接下来三步(4.0→4.1→4.2)会把"好不好"变成一个可度量、可诊断的数字。先把环境准备好。

!!! info
    本节所有命令也封装在 `07-setup-eval-env.sh` 里(幂等,可重复运行)。下面是逐步展开,方便理解每步在做什么——嫌麻烦也可以直接 `bash ~/workshop/07-setup-eval-env.sh`。

### Step 1: 安装 uv

自定义 code-based evaluator 是带依赖的 Python Lambda,AgentCore 打包时用 `uv` 为目标平台交叉安装依赖。`uv` 必须在 PATH 中:

```bash
python3 -m pip install --user uv
export PATH="$HOME/.local/bin:$PATH"
uv --version
```

!!! warning
    若缺少 `uv`,后续部署评估器时会报 `uv install failed ... exit code null`——这个报错有误导性,实际原因是 uv 不存在。

### Step 2: 启用 CloudWatch Transaction Search

Agent 的推理过程通过 OpenTelemetry 导出为 trace span,**评估服务从 CloudWatch 读取这些 span**。默认情况下 X-Ray 的 trace 段目标是 `XRay` 而非 `CloudWatchLogs`,导致 span 导出失败、评估读不到数据(`run eval` 会报 `No session spans found`)。

先授权 X-Ray 写入 CloudWatch Logs:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws logs put-resource-policy --region us-west-2 \
  --policy-name TransactionSearchXRayAccess \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"xray.amazonaws.com\"},
      \"Action\": [\"logs:PutLogEvents\", \"logs:CreateLogStream\"],
      \"Resource\": [
        \"arn:aws:logs:us-west-2:${ACCOUNT_ID}:log-group:aws/spans:*\",
        \"arn:aws:logs:us-west-2:${ACCOUNT_ID}:log-group:/aws/application-signals/data:*\"
      ],
      \"Condition\": {
        \"ArnLike\": {\"aws:SourceArn\": \"arn:aws:xray:us-west-2:${ACCOUNT_ID}:*\"},
        \"StringEquals\": {\"aws:SourceAccount\": \"${ACCOUNT_ID}\"}
      }
    }]
  }"
```

把 trace 段目标改为 CloudWatchLogs，并把 span 索引采样率设为 100%：

```bash
aws xray update-trace-segment-destination --region us-west-2 --destination CloudWatchLogs

aws xray update-indexing-rule --region us-west-2 \
  --name Default --rule '{"Probabilistic":{"DesiredSamplingPercentage":100.0}}'
```

### Step 3: 验证

```bash
aws xray get-trace-segment-destination --region us-west-2
```

应看到 `"Destination": "CloudWatchLogs"`、`"Status": "ACTIVE"`(转为 ACTIVE 可能需要 1-2 分钟)。

![](/images/placeholder-eval-env-verify.png)

!!! warning
    **启用 Transaction Search 之前产生的对话 trace 未落库。** 启用后请重新跑一次对话生成新 trace(重复 Phase 3 的 `agentcore invoke`),这样后续评估才有数据可读。

!!! success
    评估环境就绪! 下一步把 THELMA 和 Mind the Goal 两个评估器注册并部署到 AgentCore。
