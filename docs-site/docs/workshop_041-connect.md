# 2.1 连接并验证环境

在动手之前，先确认实验环境就绪。

!!! info "重要：所有命令在哪里跑"
    本 workshop 的所有 bash 命令都在 **EC2 实例的 SSM Session Manager 终端**中执行——不是你的本地电脑,不是 CloudShell,也不是 AWS 控制台。下面的步骤会带你连上这个终端。

## 连接步骤

### Step 1: 打开 AWS 控制台

点击页面左侧的 **Open AWS console (us-west-2)** 进入 AWS 控制台（不要自己在浏览器输 console 地址,那样会要求登录）。

![](/images/placeholder-open-console.png)

### Step 2: 进入 EC2 并选中实例

- 在控制台顶部搜索栏输入 **EC2**,点击进入 EC2 服务

- 在左侧导航点击 **Instances**,找到名为 `workshop-agentcore-ec2` 的实例并选中

- 点击右上角 **Connect** 按钮

![](/images/placeholder-ec2-instance.png)

### Step 3: 用 SSM Session Manager 连接

- 在 Connect 页面选择 **SSM Session Manager** 选项卡（注意是 SSM Session Manager,不是 EC2 Instance Connect,不是 SSH client）

- 点击底部 **Connect** 按钮

![](/images/placeholder-session-manager-tab.png)

连接成功后,浏览器会打开一个黑色终端窗口,这就是你后续执行所有命令的地方:

![](/images/placeholder-ssm-terminal.png)

!!! warning
    如果 Connect 按钮为灰色不可点击，说明实例仍在初始化中（UserData 脚本大约需要 2-3 分钟完成）。等到实例 Status Check 显示 2/2 passed 后再重试。

## 验证环境

连接后（默认用户为 `ssm-user`），在终端中逐行粘贴以下命令确认工具已就绪：

```bash
cd ~/workshop
agentcore --version
# 应输出 >= 1.0.0-preview.8

node --version
# 应输出 v22.x

aws --version
# 应输出 aws-cli/2.x

aws configure get region
# 应输出 us-west-2
```

!!! warning "如果报 agentcore 或脚本找不到"
    说明 EC2 的初始化脚本还没跑完（通常需要 2-3 分钟）。等一两分钟后再试,或查看安装日志：
    
    `1
    `sudo tail -20 /var/log/workshop-setup.log如果日志最后一行显示 "Workshop EC2 setup complete" 但 agentcore 还是找不到,跑一下 `source /etc/profile.d/workshop.sh` 刷新 PATH。

!!! info
    SSM Session Manager 连接不会超时（不像 CloudShell）。即使断开后重新连接，所有文件和安装内容都保存在 EC2 的 30GB 磁盘上。

四条命令都符合预期,环境就绪。接下来你有两条路可选:

!!! info "选择你的路径"
    **路径 A:逐步手动操作（推荐,约 30 分钟）**
    
    按 2.2 → 2.3 → 2.4 → 2.5 → 2.6 的顺序逐步执行。你会亲手创建知识库、配置 Gateway、挂载 Skills、编写 System Prompt、部署 Harness——理解每个组件的作用和它们怎么拼在一起。适合想深入理解 AgentCore 架构的人。
    
    **路径 B:一键脚本（约 10 分钟）**
    
    直接运行下面的命令,脚本会自动完成 Phase 2 的全部操作。你会跳过手动配置的过程,直接得到一个部署好的 Agent,然后从 Phase 3（首次对话）开始体验评估飞轮。适合时间有限或只想聚焦评估方法论的人。
    
    `1
    2
    `cd ~/workshop
    bash 01-create-kb.sh && bash 02-create-gateway.sh && bash 03-configure-skills.sh && bash 04-deploy.sh && bash 05-setup-memory.sh跑完后直接跳到 **Phase 3: 首次对话**。

选好了就往下走——路径 A 从下一页 2.2 开始。
