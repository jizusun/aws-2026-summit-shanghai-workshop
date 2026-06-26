# 2.6 部署并验证

## 目标

把配置好的 Harness 部署到 AWS 上运行,并启用跨会话 Memory。部署完成后,你就有一个可对话的企业 HR Agent 了。

### Step 1: 配置部署目标

```bash
# 确保在项目目录(2.5 创建的 Harness 项目)
cd ~/workshop/hrassistant

# 路径 B 用户从一键脚本切回手动时,$REGION 可能未 export,这里兜底
export REGION="${REGION:-us-west-2}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > agentcore/aws-targets.json << EOF
[
  {
    "name": "default",
    "region": "$REGION",
    "account": "$ACCOUNT_ID"
  }
]
EOF

cat agentcore/aws-targets.json
```

### Step 2: 部署

```bash
agentcore deploy --yes
```

部署大约需要 3-5 分钟。此次部署将创建 Credential、Memory 等资源,并接入 Gateway 工具。

!!! info "等待期间：System Prompt 的两条设计原则"
    - **"所有外部数据必须通过 hr-tools"**——配合 `allowedTools` 限制,防止 Agent 直接调外部 API 绕过 Gateway。Gateway 是唯一的受控出口,后续评估"工具调用正确性"这个指标才有意义。
    
    - **"主动应用已知上下文"**——引导 Agent 利用 Memory 检索到的用户偏好,而不是每次都重新问"你是哪个部门的"。这直接影响 decision-first 里"认知卸载"这个维度:用户感受到的是"它记得我",而不是每次从头来。

## 配置 Memory 检索

部署时 `--memory longAndShortTerm` 已经创建了 Memory 存储——Agent 对话时会自动把用户偏好**写**进去。但光能写不够,还需要告诉 Harness **每次对话时自动读取**那个用户之前积累的偏好和事实,注入到上下文里。这就是 setup-memory.sh 做的事。

配好之后,同一个 actorId 的多次对话之间 Agent 就有"记忆"了——第一次你告诉它你在工程部、偏好中文,下次再来它直接用中文回答、结合你部门的规则作答,不再重新问。

### Step 3: 启用跨会话 Memory 检索

```bash
bash ~/workshop/setup-memory.sh
```

!!! info
    **具体做了什么?** 脚本调用 AgentCore 控制面 API,配置 Harness 的 retrievalConfig:每次 invoke 时根据 actorId 从 Memory 检索最多 20 条用户偏好 + 10 条事实记录。同时给相关 IAM 角色加权限,确保 Harness 能读写 Memory。

### Step 4: 验证部署

```bash
agentcore status
```

应看到:

- Harness: `hrassistant` — **READY**

- Memory: `hrassistantMemory` — 已部署(SEMANTIC, USER_PREFERENCE, SUMMARIZATION, EPISODIC)

- Gateway: `hrgateway` — 已部署(1 个 target)

![](/images/placeholder-deploy-status.png)

!!! warning
    如果 Harness 状态显示 CREATING 或 UPDATING,等待 1-2 分钟后重试。

!!! success
    Agent 上线了! 但它答得好不好,现在还只是"感觉"——Phase 3 我们先看它的裸表现,再用评估把"感觉"变成度量。
