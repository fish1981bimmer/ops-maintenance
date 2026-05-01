# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-04-30

### Added
- 密码加密存储功能（AES-256-GCM）
- 命令白名单验证系统
- 命令安全检查模块（`command-validator.ts`）
- 加密工具模块（`crypto.ts`）
- 安全改进文档（`SECURITY_IMPROVEMENTS.md`）

### Changed
- **BREAKING**: 移除默认 root 用户，必须显式指定 SSH 用户
- **BREAKING**: 移除 `runCommand` 的 shell 执行，防止命令注入
- **BREAKING**: 添加命令白名单验证，只允许安全的只读命令
- 更新版本号到 2.1.0
- 更新描述为"安全增强版"

### Security
- 使用 AES-256-GCM 加密存储 SSH 密码
- 密钥文件权限设置为 600
- 配置文件权限设置为 600
- 实现命令白名单，只允许安全的只读命令
- 检测并拒绝危险命令（删除、修改、系统控制等）
- 检测管道、重定向、命令替换等绕过方式
- 移除 shell 执行，防止命令注入

### Fixed
- 修复默认使用 root 用户的安全问题
- 修复明文密码存储的安全问题
- 修复批量命令执行的安全问题
- 修复无验证 shell 命令执行的安全问题

## [2.0.0] - 2026-04-26

### Added
- 使用 ssh2 库替代 child_process.exec
- SSH 连接池管理
- 连接复用和超时管理
- 重试机制（指数退避）
- 审计日志系统
- SFTP 文件传输支持
- 并发控制
- 多服务器集群管理
- 批量操作功能

### Changed
- 重构 SSH 连接管理
- 改进错误处理和分类
- 优化性能和资源使用

### Security
- 移除 StrictHostKeyChecking=no
- 使用 known_hosts 验证
- 支持密钥认证和密码认证
- 连接超时保护

## [1.0.0] - 2026-04-06

### Added
- 初始版本
- 基本的 SSH 远程命令执行
- 本地系统健康检查
- 日志分析功能
- 性能监控
- 端口检查
- 进程检查
- 磁盘使用分析
