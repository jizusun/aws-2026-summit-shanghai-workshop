# 2.4 配置 Skills

## 目标

给 Agent 配置**按需加载**的专业能力。并非所有指令都要常驻上下文——Skills 让 Agent 在需要时才加载特定领域的详细指令。对应 BP5(用工具调用替代模型内部推理):把复杂的政策分析逻辑外化成可加载的指令文件,既减轻上下文负担,也让这部分行为更容易被独立评估。

这一步把两个 Skill 文件上传到 S3,稍后会通过 BYO Filesystem 挂载到 Harness。

### Step 1: 查看预置的 Skill 文件

EC2 上预置了两个 Skill 文件,先看看它们长什么样:

```bash
cat ~/workshop/skills/deep-policy-analysis/SKILL.md
cat ~/workshop/skills/leave-calculator/SKILL.md
```

每个 Skill 是一个 Markdown 文件,包含 YAML frontmatter(name + description)和指令正文。运行时 Agent 只能看到 name 和 description;当它判断需要某个 Skill 时,才调用内置的 `skills` 工具加载完整指令。

!!! info "下面这两段只是文件内容,不用你创建或复制"
    这两个 SKILL.md 已经随 EC2 预置好了(就在 `~/workshop/skills/` 下),上面的 `cat` 命令打印的就是它们。下面展开只是让你看清文件长什么样——**你不需要新建、粘贴或编辑任何文件**。真正要你动手执行的是后面的 **Step 2**。

**deep-policy-analysis/SKILL.md**

```markdown
---
name: deep-policy-analysis
description: Provide detailed analysis of HR policies with cross-references, exceptions, and specific examples
---
# Deep Policy Analysis

When user needs detailed policy interpretation, execute these steps:

1. Retrieve the relevant policy document via hr-tools
2. Identify applicable sections and any exceptions
3. Cross-reference with related policies (e.g., leave policy + benefits policy)
4. Provide specific examples relevant to the employee's situation
5. Cite exact policy sections and effective dates
```

**leave-calculator/SKILL.md**

```markdown
---
name: leave-calculator
description: Calculate leave balances, plan optimal leave schedules, and check eligibility for various leave types
---
# Leave Calculator

Help employees plan their leave by:

1. Check current leave balance via hr-tools (check_leave_balance)
2. Calculate remaining days by leave type
3. Suggest optimal scheduling (avoid peak periods, consider team coverage)
4. Verify eligibility for special leave types (marriage, parental, bereavement)
```

### Step 2: 上传 Skill 文件到 S3

**这一步才需要你动手**:执行下面的命令,把上面那两个预置文件上传到 S3(Harness 稍后会从这里挂载它们)。

```bash
DATA_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name workshop-infra \
  --query "Stacks[0].Outputs[?OutputKey=='DataBucketName'].OutputValue" \
  --output text --region us-west-2)

aws s3 cp ~/workshop/skills/deep-policy-analysis/SKILL.md s3://$DATA_BUCKET/skills/deep-policy-analysis/SKILL.md
aws s3 cp ~/workshop/skills/leave-calculator/SKILL.md s3://$DATA_BUCKET/skills/leave-calculator/SKILL.md

# 验证
aws s3 ls s3://$DATA_BUCKET/skills/ --recursive
```

预期输出:

```text
skills/deep-policy-analysis/SKILL.md
skills/leave-calculator/SKILL.md
```

![](/images/placeholder-skills-upload.png)

!!! info "Skills 的工作原理"
    部署后,Agent 的 system prompt 会自动包含可用 skill 列表(仅 name + description)。Agent 根据用户请求自主决定是否加载某个 Skill;加载后完整指令进入上下文,引导它执行特定工作流。

!!! success
    Skills 已上传! 知识库、工具、Skills 都备好了。下一步把它们整合进一个 Harness,定义行为规范并部署上线。
