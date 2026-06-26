# 5.1 优化 System Prompt

## 目标

把 Phase 4 诊断出来的修复方向真正落地：给 System Prompt 加上抗幻觉约束、重新部署、用相同的三个问题重新生成对话——为 5.2 的"前后对比"准备好数据。Phase 4 的诊断 `SQC↓ RQC↑ GR↓ → Prompt` 和 `RP↓` 指向同一件事：对于检索质量好但回答不受控的问题，根因在 Prompt 缺少约束。这一步就动手把约束补上。

### Step 1: 写入优化后的 Prompt

直接运行下面这条命令，把加了抗幻觉约束的 Prompt 写入文件——核心就一句：**严格基于检索内容回答，不许用常识编造**。

```bash
cd ~/workshop/hrassistant
cat > app/hrassistant/system-prompt.md << 'PROMPT'
你是一位专业的企业HR助手。你的职责是帮助员工解答人力资源相关问题并协助处理HR事务。

## 能力范围
- 解答HR政策问题（年假、病假、调休、薪资结构、福利等）
- 协助休假申请流程
- 解释薪资结构和福利制度
- 指导入职/离职流程
- 解答绩效评估相关问题

## 工具使用
- 通过 hr-tools 查询知识库获取政策文档
- 通过 hr-tools 执行HR操作（查询余额、提交申请等）

## 输出格式
每次回答应包含：
- 清晰的结构化答案
- 引用具体的政策条款和文档来源
- 如涉及流程，给出步骤化指引
- 如涉及计算，展示计算过程

## 重要原则
- **严格基于检索内容回答**：你的回答必须完全来自 hr-tools 检索到的政策文档。
- **不要使用你自己的常识或训练知识编造政策细节**（如具体天数、流程步骤、审批层级）。
- 如果检索结果中**没有**与问题相关的内容，明确告知"知识库中暂无相关政策"，并建议联系 HR，**不要猜测或编造**。
- 检索结果中如混有与当前问题**无关**的内容，忽略它们，只引用真正相关的部分。
- 回答应**简洁聚焦**：只包含直接回答问题所需的内容，避免堆砌无关政策或冗余信息。
- 如果你了解员工的部门、职级等上下文，必须结合具体情况作答
- 如果你记得员工之前的偏好或查询历史，主动应用而非重新询问
- 始终引用答案来自哪份政策文档
- 涉及敏感信息（薪资、绩效）时，确认 actorId 隔离
PROMPT
```

这条命令相比原 Prompt，**只在 `## 重要原则` 一节新增了前 5 条抗幻觉约束**（其余内容不变），分别针对 Phase 4 的低分信号：

- 前三条 → 提升 **Groundedness（GR）**，减少幻觉

- 第四条 → 应对检索噪音（忽略无关 chunk）

- 第五条 → 提升 **Response Precision（RP）**，去冗余

### Step 2: 重新部署

```bash
agentcore deploy --yes
```

Prompt 是 Harness 配置的一部分，`deploy` 会用新 Prompt 更新已部署的 Agent（约 3-5 分钟）。

!!! warning "如果报 'CDK synth failed: ... uv install failed ... exit code null'"
    SSM session 超时重连之后,新 shell 的 PATH 没把 `~/.local/bin` 带上,而 `uv`(打包 evaluator Lambda 用)就装在那里——deploy 找不到 uv 就崩。一句话修好:
    
    `1
    2
    3
    `export PATH="$HOME/.local/bin:$PATH"
    which uv && uv --version    # 确认能找到
    agentcore deploy --yes      # 重跑修一次只对当前 shell 有效。如果你后面又重连了 SSM,记得再 export 一次,或写进 `~/.bashrc` 一劳永逸:`echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc`。

### Step 3: 重新生成对话

用**与 Phase 4 完全相同的问题**重新对话，生成新 trace（这样才能对比优化前后）。下面这段会依次问完三个问题、每个用独立 session，并**自动生成合规的 session-id**（必须 ≥ 33 字符），你直接整段运行即可，无需自己填写。注意先 `cd` 到项目目录，`agentcore` 从本地项目配置读取 runtime（与脚本一致，无需 `--runtime`）：

```bash
cd ~/workshop/hrassistant

ask() {
  local sid="v2-$(cat /proc/sys/kernel/random/uuid)-$(date +%s)"
  agentcore invoke \
    --session-id "$sid" \
    --actor-id "user-emp-v2" \
    --stream \
    "$1"
  sleep 2
}

ask "Can you explain the performance review process and the scoring criteria used?"
ask "How do I enroll in benefits, and what is the benefits enrollment process?"
ask "Do I need a medical certificate for sick leave, and what is the process?"
```

![](/images/placeholder-reinvoke-v2.png)

!!! warning
    `--actor-id` 必填（Harness 用它读取该用户的 Memory）。取值要符合 `[a-zA-Z0-9][a-zA-Z0-9-_/]*`——别用冒号，否则底层 `ListEvents` 调用会校验失败。

!!! info
    保持问题文本一致是公平对比的前提——只改了 Prompt 这一个变量，才能把分数变化归因到 Prompt 优化。这就是受控实验的思路。

!!! info
    **一键完成整个 Phase 5**：`10-optimize-prompt.sh` 把本节（写优化 Prompt → 部署 → 重新跑三个问题）和 5.2（重新评估）打包好了——写入抗幻觉 Prompt、重新部署、用相同三个问题重对话、再评估并打印分数，整段自动跑完。下面的命令用于手动理解每一步在做什么。
    
    `1
    `./10-optimize-prompt.sh

下一步：重新评估，看分数是否提升。

## 先肉眼读一下:这次回答有没有变好

不用等 5.2 的分数,**对着上面三条 v2 回答和 Phase 4 那三条原回答比一下,改动好不好你直接能看出来**。重点盯三处:

- **福利问题** —— Phase 4 的回答里凭空冒出 *"你的联系方式偏好是 Social Media"*(这是从知识库脏 FAQ 编出来的幻觉,根本不存在这种用户档案)。**v2 的回答里这句应该消失了**。这就是 Prompt 改动里"忽略检索到的无关内容"那条直接生效——脏 FAQ 还在被检索,但模型不再引用它。

- **病假问题** —— 这条 Phase 4 大段编造("7 步流程"、"提前 2 周"、"持照机构"),v2 应该明显**收敛**:要么明确说"知识库里只有 X 部分",要么把不可溯源的细节去掉。但**它不会变成 Pass**——这条根因在检索/KB(`SP2≈0`),Prompt 救不了,5.2 会用数据印证这一点。

- **整体长度** —— v2 回答整体应该更短、更聚焦,少了堆砌的无关政策段落。这是"约束回答简洁"那条生效的样子。

如果这三处变化你都看到了,说明 Prompt 改对了——但**这只是定性判断**。光靠肉眼读,你说不出"福利问题的接地度提升了多少"、"响应精度涨了 0.X"。下一节就是用同一套 THELMA 评估器,把这种"读起来更靠谱了"翻译成精确的 7 维分数变化,既给老板交代用,也证明改动真的对所有维度都有改进、没有偷偷拉低别的指标。

!!! success
    新 Prompt 已部署，三个问题也用相同文本重新跑了一遍，新 trace 已经生成。你现在手里有"优化前"和"优化后"两套数据——下一节用同一套评估器对比分数，看改动到底有没有用。
