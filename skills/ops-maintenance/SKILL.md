---
name: ops-maintenance
description: 运维助手 v2.1 - 支持本地、远程、多服务器集群监控 (安全增强版，密码加密、命令白名单)
userInvocable: true
argumentHint: <health|logs|perf|ports|process|disk|cluster|add-server|remove-server|upload|download|list|audit> [args]
allowedTools:
  - Bash
  - Read
---

# 运维助手 (ops-maintenance) v2.1

专业的运维助手，支持单服务器和多服务器集群监控。

## v2.0 主要改进

- 远程SSH命令使用ssh2库，提升性能和安全性
- 添加SSH连接池，支持连接复用
- 移除StrictHostKeyChecking=no，增强安全性
- 添加重试机制（指数退避）和错误处理
- 添加审计日志，记录所有操作
- 支持SFTP文件传输（上传/下载/目录操作）
- 添加并发控制，避免同时打开过多连接
- 改进错误分类和诊断信息

## v2.1 安全改进

- **移除默认root用户**：必须显式指定SSH用户，不允许默认使用root
- **密码加密存储**：使用AES-256-GCM加密存储SSH密码，密钥文件权限为600
- **命令白名单验证**：只允许执行安全的只读命令，拒绝危险操作
- **增强安全检查**：检测管道、重定向、命令替换等绕过方式
- **内部命令安全**：内置命令（如health check）使用简单命令，避免管道和重定向

## 功能命令

### 健康检查
```
/ops-maintenance health              # 本地
/ops-maintenance user@host health    # 远程 SSH
```

### 日志分析  
```
/ops-maintenance logs [关键词]       # 本地
/ops-maintenance user@host logs error  # 远程
```

### 性能监控 (本地)
```
/ops-maintenance perf
```

### 端口检查
```
/ops-maintenance ports [端口]        # 本地
/ops-maintenance user@host ports 80  # 远程
```

### 进程检查
```
/ops-maintenance process [名称]      # 本地
/ops-maintenance user@host process nginx  # 远程
```

### 磁盘使用
```
/ops-maintenance disk                # 本地
/ops-maintenance user@host disk      # 远程
```

### 文件传输 (新增)
```
/ops-maintenance upload <local> <remote>    # 上传文件
/ops-maintenance download <remote> <local>  # 下载文件
/ops-maintenance list <remote>              # 列出远程目录
```

### 审计日志 (新增)
```
/ops-maintenance audit               # 查看审计统计
```

## 远程服务器配置

### 方式 1: 配置文件 (推荐)
在 `~/.config/ops-maintenance/servers.json` 中配置:
```json
[
  {
    "host": "192.168.1.100",
    "user": "root",
    "port": 22,
    "keyFile": "~/.ssh/id_rsa",
    "name": "web-1",
    "tags": ["production", "web"]
  }
]
```

### 方式 2: 直接指定
```
user@192.168.1.100 health
root@server.com:2222 disk
```

## 支持的远程操作
- health: 系统负载、内存、磁盘、服务状态
- logs: 远程日志搜索
- ports: 端口占用检查
- process: 进程查找
- disk: 磁盘使用分析
- upload: 文件上传
- download: 文件下载
- list: 目录列表

## 输出格式

返回 Markdown 格式结果，包含:
- 标题 (emoji + 操作名 + 服务器)
- 代码块中的命令输出
- 关键发现和建议

## 多服务器集群管理

### 查看集群状态
```
/ops-maintenance cluster              # 查看所有服务器状态
/ops-maintenance cluster @production  # 按标签筛选
```

### 批量添加服务器
```
# 直接添加多个 IP
/ops-maintenance batch-add 192.168.1.100 192.168.1.101 192.168.1.102

# 带端口
/ops-maintenance batch-add 192.168.1.100:2222 192.168.1.101:22

# 带用户
/ops-maintenance batch-add root@192.168.1.100 admin@192.168.1.101

# 完整格式
/ops-maintenance batch-add user@host:port user2@host2:port

# CSV 格式 (多行)
/ops-maintenance import-servers <<EOF
192.168.1.100,22,root,web-1,production;web
192.168.1.101,22,admin,db-1,production;database
EOF

# JSON 格式
/ops-maintenance import-servers [{"host":"192.168.1.100","name":"web-1","tags":["prod"]}]
```

### 添加服务器
```
/ops-maintenance add-server 192.168.1.100 --name web1 --tags production,web
```

### 移除服务器
```
/ops-maintenance remove-server 192.168.1.100
```

### 批量执行命令
```
/ops-maintenance exec "df -h" @production   # 在 production 组执行
/ops-maintenance exec "uptime" all          # 在所有服务器执行
```

### 服务器配置文件
- 位置: `~/.config/ops-maintenance/servers.json`
- 支持字段: host, port, user, keyFile, password, name, tags

### 示例配置
```json
[
  {
    "host": "192.168.1.100",
    "user": "root",
    "name": "web-1",
    "tags": ["production", "web"]
  },
  {
    "host": "192.168.1.101",
    "user": "admin",
    "name": "db-1",
    "tags": ["production", "database"]
  }
]
```

## 安全性说明

### v2.1 安全改进
- **移除默认root用户**：必须显式指定SSH用户，不允许默认使用root
- **密码加密存储**：使用AES-256-GCM加密存储SSH密码，密钥文件权限为600
- **命令白名单验证**：只允许执行安全的只读命令，拒绝危险操作
- **增强安全检查**：检测管道、重定向、命令替换等绕过方式
- **内部命令安全**：内置命令（如health check）使用简单命令，避免管道和重定向

### v2.0 安全改进
- 移除 StrictHostKeyChecking=no，使用known_hosts验证
- 支持密钥认证和密码认证
- 连接超时保护（默认15秒）
- 审计日志记录所有操作
- 配置文件建议加密存储（待实现）

### 命令白名单
只允许执行以下类型的命令：
- 系统信息查看（uptime, free, df, ps等）
- 日志查看（tail, grep, journalctl等）
- 网络检查（netstat, ss, lsof等）
- 进程和服务状态（systemctl status, docker ps等）
- 磁盘和文件查看（ls, du, find等）

禁止执行：
- 文件删除和修改（rm, mv, cp, chmod等）
- 系统控制（shutdown, reboot等）
- 用户管理（useradd, passwd等）
- 包管理（apt, yum, npm等）
- 服务控制（systemctl start/stop等）
- 任何包含管道、重定向、命令替换的命令

### 认证方式
1. 密钥认证（推荐）:
   ```json
   {
     "keyFile": "~/.ssh/id_rsa"
   }
   ```

2. 密码认证（加密存储）:
   ```json
   {
     "password": "***"
   }
   ```
   密码会自动使用AES-256-GCM加密存储

3. 默认密钥:
   自动使用 ~/.ssh/id_rsa

## 审计日志

### 日志位置
- ~/.config/ops-maintenance/logs/audit.log

### 记录内容
- 时间戳
- 操作类型
- 目标服务器
- 执行命令
- 执行状态（成功/失败/部分）
- 执行时长
- 错误信息

### 查看统计
```
/ops-maintenance audit
```

## 性能优化

### 连接池
- 默认最大连接数: 10
- 连接超时: 5分钟
- 自动清理过期连接

### 并发控制
- 批量操作默认并发数: 5
- 避免同时打开过多SSH连接

### 重试机制
- 默认重试次数: 3
- 指数退避策略
- 可配置重试延迟

## 开发说明

### 安装依赖
```bash
cd /Users/a1234/.openclaw/workspace/skills/ops-maintenance
npm install
```

### 运行示例
```bash
npm run dev
npm test
```

### 构建
```bash
npm run build
```

## 技术栈

- Node.js + TypeScript
- ssh2: SSH客户端库
- ssh2-sftp-client: SFTP文件传输
- 审计日志: JSON格式，支持查询和统计

## 常见问题

### Q: 连接失败怎么办？
A: 检查以下几点：
1. SSH密钥或密码是否正确
2. 服务器地址和端口是否正确
3. 防火墙是否允许SSH连接
4. 查看审计日志获取详细错误信息

### Q: 如何提高性能？
A: 
1. 使用连接池（已默认启用）
2. 调整并发控制参数
3. 使用密钥认证而非密码

### Q: 审计日志在哪里？
A: ~/.config/ops-maintenance/logs/audit.log

### Q: 如何清理连接池？
A: 调用 cleanup() 函数或重启应用
