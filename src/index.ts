/**
 * 运维助手 Skill 实现 (v2.0)
 * 
 * 本模块提供运维检查功能，供 AI 助手调用
 * 
 * 主要改进：
 * - 使用ssh2库替代child_process.exec
 * - 添加连接池管理
 * - 增强安全性（移除StrictHostKeyChecking=no）
 * - 添加重试机制和错误处理
 * - 添加审计日志
 * - 支持SFTP文件传输
 * - 添加并发控制
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

import { 
  getSSHPool, 
  closeGlobalPool, 
  type ConnectionConfig 
} from './utils/ssh-pool.js'
import { 
  getSFTPManager, 
  type SFTPManager 
} from './utils/sftp-client.js'
import { 
  getAuditLogger, 
  type AuditLogger 
} from './utils/audit-logger.js'

const execAsync = promisify(exec)

/**
 * SSH 配置
 */
export interface SSHConfig {
  host: string
  port?: number
  user?: string
  keyFile?: string
  password?: string
  name?: string
  tags?: string[]
}

/**
 * 服务器集群配置
 */
export interface ClusterConfig {
  name: string
  servers: SSHConfig[]
}

/**
 * 服务器列表配置文件路径
 */
function getServersConfigPath(): string {
  return join(process.env.HOME || '~', '.config/ops-maintenance/servers.json')
}

/**
 * 默认服务器配置目录
 */
function getConfigDir(): string {
  return join(process.env.HOME || '~', '.config/ops-maintenance')
}

/**
 * 保存服务器列表
 */
export async function saveServers(servers: SSHConfig[]): Promise<void> {
  const configDir = getConfigDir()
  const configPath = getServersConfigPath()
  
  // 确保目录存在
  if (!existsSync(configDir)) {
    await execAsync(`mkdir -p "${configDir}"`)
  }
  
  await writeFile(configPath, JSON.stringify(servers, null, 2))
}

/**
 * 加载服务器列表
 */
export async function loadServers(): Promise<SSHConfig[]> {
  const configPath = getServersConfigPath()
  
  try {
    const content = await readFile(configPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    // 返回空列表
    return []
  }
}

/**
 * 添加服务器
 */
export async function addServer(config: SSHConfig): Promise<void> {
  const servers = await loadServers()
  
  // 检查是否已存在
  const existing = servers.findIndex(s => s.host === config.host)
  if (existing >= 0) {
    servers[existing] = { ...servers[existing], ...config }
  } else {
    servers.push(config)
  }
  
  await saveServers(servers)
}

/**
 * 移除服务器
 */
export async function removeServer(host: string): Promise<void> {
  const servers = await loadServers()
  const filtered = servers.filter(s => s.host !== host)
  await saveServers(filtered)
}

/**
 * 按标签筛选服务器
 */
export async function getServersByTag(tag: string): Promise<SSHConfig[]> {
  const servers = await loadServers()
  return servers.filter(s => s.tags?.includes(tag))
}

/**
 * 批量检查所有服务器健康状态
 */
export async function checkAllServersHealth(
  tags?: string[]
): Promise<{ server: string; status: string; details: string }[]> {
  const servers = tags 
    ? await Promise.all(tags.map(getServersByTag)).then(arr => arr.flat())
    : await loadServers()
  
  const results: { server: string; status: string; details: string }[] = []
  const pool = getSSHPool()
  const audit = getAuditLogger()
  
  // 并发控制：最多同时检查5台服务器
  const concurrency = 5
  for (let i = 0; i < servers.length; i += concurrency) {
    const batch = servers.slice(i, i + concurrency)
    
    await Promise.all(batch.map(async (config) => {
      const name = config.name || config.host
      const startTime = Date.now()
      
      try {
        // 并行执行多个检查
        const [load, mem, disk] = await Promise.all([
          pool.executeCommand(config, 'uptime'),
          pool.executeCommand(config, 'free -h 2>/dev/null || echo "N/A"'),
          pool.executeCommand(config, 'df -h / | tail -1 | awk \'{print $5}\'')
        ])
        
        // 解析磁盘使用率
        const diskUsage = disk.stdout.includes('%') 
          ? disk.stdout.match(/(\d+)%/)?.[1] || 'N/A' 
          : 'N/A'
        const isHealthy = parseInt(diskUsage) < 90
        
        results.push({
          server: name,
          status: isHealthy ? '✅ 健康' : '⚠️ 磁盘 ' + diskUsage,
          details: `负载: ${load.stdout.split('load averages:')[1]?.trim() || 'N/A'}`
        })
        
        const duration = Date.now() - startTime
        audit.logSuccess('health_check', name, 'uptime && free && df', duration)
      } catch (error: any) {
        results.push({
          server: name,
          status: '❌ 离线',
          details: error.message.substring(0, 50)
        })
        
        audit.logFailure('health_check', name, error.message)
      }
    }))
  }
  
  return results
}

/**
 * 批量执行命令到所有服务器
 */
export async function executeOnAllServers(
  command: string,
  tags?: string[]
): Promise<{ server: string; output: string }[]> {
  const servers = tags 
    ? await Promise.all(tags.map(getServersByTag)).then(arr => arr.flat())
    : await loadServers()
  
  const results: { server: string; output: string }[] = []
  const pool = getSSHPool()
  const audit = getAuditLogger()
  
  // 并发控制
  const concurrency = 5
  for (let i = 0; i < servers.length; i += concurrency) {
    const batch = servers.slice(i, i + concurrency)
    
    await Promise.all(batch.map(async (config) => {
      const name = config.name || config.host
      const startTime = Date.now()
      
      try {
        const result = await pool.executeCommand(config, command)
        results.push({ 
          server: name, 
          output: result.stdout || result.stderr || '(无输出)' 
        })
        
        const duration = Date.now() - startTime
        audit.logSuccess('execute_command', name, command, duration)
      } catch (error: any) {
        results.push({ server: name, output: `错误: ${error.message}` })
        audit.logFailure('execute_command', name, error.message, command)
      }
    }))
  }
  
  return results
}

/**
 * 批量添加服务器 (支持 IP:Port 格式)
 */
export async function batchAddServers(servers: string[]): Promise<{ success: number; failed: number; details: string[] }> {
  const results: string[] = []
  let success = 0
  let failed = 0

  // 解析每个服务器字符串
  for (const serverStr of servers) {
    try {
      const config = parseServerString(serverStr)
      await addServer(config)
      success++
      results.push(`✅ ${config.name || config.host}:${config.port || 22} - 已添加`)
    } catch (error: any) {
      failed++
      results.push(`❌ ${serverStr} - ${error.message}`)
    }
  }

  return { success, failed, details: results }
}

/**
 * 从 CSV/JSON 批量导入
 */
export async function importServersFromText(text: string): Promise<{ success: number; failed: number; servers: SSHConfig[] }> {
  const servers: SSHConfig[] = []
  let failed = 0

  // 尝试解析为 JSON
  try {
    const parsed = JSON.parse(text)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of arr) {
      if (item.host) {
        servers.push({
          host: item.host,
          port: item.port || 22,
          user: item.user,
          name: item.name,
          tags: item.tags
        })
      }
    }
    if (servers.length > 0) {
      await saveServers([...await loadServers(), ...servers])
      return { success: servers.length, failed: 0, servers }
    }
  } catch {
    // 不是 JSON，尝试 CSV
  }

  // CSV 解析
  const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim())
    if (parts[0]) {
      const hostPort = parts[0].split(':')
      servers.push({
        host: hostPort[0],
        port: hostPort[1] ? parseInt(hostPort[1]) : 22,
        user: parts[2] || undefined,
        name: parts[3] || undefined,
        tags: parts[4] ? parts[4].split(';') : undefined
      })
    }
  }

  // 保存
  const existing = await loadServers()
  await saveServers([...existing, ...servers])

  return { success: servers.length, failed, servers }
}

/**
 * 解析服务器字符串为配置
 */
function parseServerString(serverStr: string): SSHConfig {
  let host = serverStr
  let user: string | undefined
  let port: number | undefined

  // 提取用户
  if (host.includes('@')) {
    const parts = host.split('@')
    user = parts[0]
    host = parts[1]
  }

  // 提取端口
  if (host.includes(':')) {
    const parts = host.split(':')
    host = parts[0]
    port = parseInt(parts[1])
  }

  // 生成友好名称
  const name = `server-${host.replace(/\./g, '-')}`

  return { host, port: port || 22, user, name }
}

/**
 * 服务器状态摘要
 */
export async function getClusterSummary(): Promise<string> {
  const servers = await loadServers()
  const results = await checkAllServersHealth()
  
  const online = results.filter(r => r.status.includes('健康')).length
  const warning = results.filter(r => r.status.includes('⚠️')).length
  const offline = results.filter(r => r.status.includes('❌')).length
  
  const lines: string[] = []
  lines.push('### 🖥️ 服务器集群状态\n')
  lines.push(`**总计**: ${servers.length} 台 | ✅ ${online} | ⚠️ ${warning} | ❌ ${offline}\n`)
  
  for (const r of results) {
    lines.push(`- **${r.server}**: ${r.status}`)
    if (r.details !== r.status) {
      lines.push(`  - ${r.details}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * 通过 SSH 执行远程命令
 */
export async function runRemoteCommand(
  config: SSHConfig, 
  command: string
): Promise<string> {
  const pool = getSSHPool()
  const audit = getAuditLogger()
  const startTime = Date.now()
  
  try {
    const result = await pool.executeCommand(config, command)
    const duration = Date.now() - startTime
    
    audit.logSuccess('remote_command', config.host, command, duration)
    
    return result.stdout || result.stderr || '(无输出)'
  } catch (error: any) {
    audit.logFailure('remote_command', config.host, error.message, command)
    return `SSH 连接失败: ${error.message}`
  }
}

/**
 * 执行系统命令并返回结果
 */
export async function runCommand(cmd: string, timeout: number = 10000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout, shell: '/bin/zsh' })
    return stdout || stderr || '(无输出)'
  } catch (error: any) {
    return `命令执行失败: ${error.message}`
  }
}

/**
 * 系统健康检查
 */
export async function checkHealth(): Promise<string> {
  const results: string[] = []
  
  results.push('### 🩺 系统健康检查\n')
  
  // 负载
  results.push('**负载:**')
  results.push('```\n' + await runCommand('uptime') + '```\n')
  
  // 内存
  results.push('**内存:**')
  results.push('```\n' + await runCommand('vm_stat | head -10') + '```\n')
  
  // 磁盘
  results.push('**磁盘:**')
  results.push('```\n' + await runCommand('df -h | grep -E "^/dev"') + '```\n')
  
  // 核心服务状态
  const services = ['nginx', 'docker', 'postgresql', 'redis-server']
  results.push('**服务状态:**')
  for (const svc of services) {
    const status = await runCommand(`pgrep -f "${svc}" > /dev/null && echo "运行中" || echo "已停止"`)
    const emoji = status.includes('运行中') ? '✅' : '❌'
    results.push(`- ${svc}: ${emoji} ${status.trim()}`)
  }
  
  return results.join('\n')
}

/**
 * 日志分析
 */
export async function analyzeLogs(pattern: string = 'error', lines: number = 30): Promise<string> {
  const results: string[] = []
  results.push(`### 📋 日志分析 (搜索: "${pattern}")\n`)
  
  const logPaths = [
    '/var/log/system.log',
    `${process.env.HOME}/.npm/_logs/*.log`,
  ]
  
  for (const logPath of logPaths) {
    try {
      const output = await runCommand(`grep -i "${pattern}" "${logPath}" 2>/dev/null | tail -${lines}`)
      if (output && !output.includes('命令执行失败')) {
        results.push(`**${logPath}:**`)
        results.push('```\n' + output + '```')
      }
    } catch {
      // 跳过不存在的日志
    }
  }
  
  return results.join('\n') || '未找到匹配的日志'
}

/**
 * 性能监控
 */
export async function checkPerformance(): Promise<string> {
  const results: string[] = []
  results.push('### 📊 性能监控\n')
  
  // CPU
  results.push('**CPU:**')
  results.push('```\n' + await runCommand('sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "N/A"') + '```\n')
  
  // 内存和 CPU 使用
  results.push('**实时状态:**')
  results.push('```\n' + await runCommand('top -l 1 -n 0 | grep -E "PhysMem|CPU"') + '```\n')
  
  // 磁盘 I/O
  results.push('**磁盘 I/O:**')
  results.push('```\n' + await runCommand('iostat -d 2 2>/dev/null | tail -5 || echo "iostat 不可用"') + '```\n')
  
  return results.join('\n')
}

/**
 * 端口检查
 */
export async function checkPort(port?: number): Promise<string> {
  if (port) {
    return `### 🔌 端口 ${port}\n\`\`\`\n${await runCommand(`lsof -i :${port} 2>/dev/null || echo "端口未占用"`)}\n\`\`\``
  }
  
  return `### 🔌 监听端口\n\`\`\`\n${await runCommand('lsof -i -P | grep LISTEN | head -20')}\n\`\`\``
}

/**
 * 进程检查
 */
export async function checkProcess(name?: string): Promise<string> {
  if (name) {
    const output = await runCommand(`ps aux | grep -i "${name}" | grep -v grep | head -10`)
    const count = await runCommand(`pgrep -fc "${name}" 2>/dev/null || echo 0`)
    
    return `### ⚙️ 进程 "${name}"\n**运行实例: ${count.trim()}**\n\`\`\`\n${output || '未找到'}\n\`\`\``
  }
  
  // macOS的ps命令不支持--sort，使用不同的方法
  return `### ⚙️ Top 进程 (按 CPU)\n\`\`\`\n${await runCommand('ps aux | sort -nr -k 3 | head -15')}\n\`\`\``
}

/**
 * 磁盘使用
 */
export async function checkDisk(): Promise<string> {
  const home = process.env.HOME || '~'
  
  const results: string[] = []
  results.push('### 💾 磁盘使用\n')
  
  results.push('**分区使用:**')
  results.push('```\n' + await runCommand('df -h') + '```\n')
  
  results.push('**大目录 (Home):**')
  results.push('```\n' + await runCommand(`du -sh "${home}"/* 2>/dev/null | sort -hr | head -10`) + '```')
  
  return results.join('\n')
}

/**
 * 远程服务器健康检查
 */
export async function checkRemoteHealth(
  config: SSHConfig,
  services: string[] = ['nginx', 'docker', 'postgresql', 'redis-server']
): Promise<string> {
  const results: string[] = []
  results.push(`### 🩺 远程服务器健康检查 (${config.host})\n`)
  
  // 系统信息
  results.push('**系统:**')  
  results.push('```\n' + await runRemoteCommand(config, 'uptime && free -h && df -h') + '```\n')
  
  // 服务状态
  results.push('**服务状态:**')
  for (const svc of services) {
    const status = await runRemoteCommand(
      config, 
      `systemctl is-active ${svc} 2>/dev/null || pgrep -f "${svc}" >/dev/null && echo "running" || echo "stopped"`
    )
    const emoji = status.trim() === 'active' || status.trim() === 'running' ? '✅' : '❌'
    results.push(`- ${svc}: ${emoji} ${status.trim()}`)
  }
  
  return results.join('\n')
}

/**
 * 远程服务器端口检查
 */
export async function checkRemotePort(config: SSHConfig, port?: number): Promise<string> {
  if (port) {
    return `### 🔌 端口 ${port} (${config.host})\n\`\`\`\n${await runRemoteCommand(config, `lsof -i :${port} 2>/dev/null || netstat -tlnp | grep :${port}`)}\n\`\`\``
  }
  
  return `### 🔌 监听端口 (${config.host})\n\`\`\`\n${await runRemoteCommand(config, 'lsof -i -P | grep LISTEN | head -20')}\n\`\`\``
}

/**
 * 远程服务器进程检查
 */
export async function checkRemoteProcess(config: SSHConfig, name?: string): Promise<string> {
  if (name) {
    const output = await runRemoteCommand(config, `ps aux | grep -i "${name}" | grep -v grep | head -10`)
    return `### ⚙️ 进程 "${name}" (${config.host})\n\`\`\`\n${output}\n\`\`\``
  }
  
  return `### ⚙️ Top 进程 (${config.host})\n\`\`\`\n${await runRemoteCommand(config, 'ps aux --sort=-%cpu | head -15')}\n\`\`\``
}

/**
 * 远程服务器磁盘检查
 */
export async function checkRemoteDisk(config: SSHConfig): Promise<string> {
  const results: string[] = []
  results.push(`### 💾 磁盘使用 (${config.host})\n`)
  
  results.push('**分区:**')
  results.push('\`\`\`' + await runRemoteCommand(config, 'df -h') + '\`\`\`')
  
  results.push('**大目录:**')
  results.push('\`\`\`' + await runRemoteCommand(config, 'du -sh /* 2>/dev/null | sort -hr | head -10') + '\`\`\`')
  
  return results.join('\n')
}

/**
 * 远程服务器日志检查
 */
export async function checkRemoteLogs(
  config: SSHConfig, 
  pattern: string = 'error',
  lines: number = 30
): Promise<string> {
  const results: string[] = []
  results.push(`### 📋 远程日志 (${config.host}, 搜索: "${pattern}")\n`)
  
  // 常见日志路径
  const logPaths = [
    '/var/log/syslog',
    '/var/log/nginx/error.log',
    '/var/log/apache2/error.log',
    '~/.npm/_logs/*.log'
  ]
  
  for (const logPath of logPaths) {
    const output = await runRemoteCommand(config, `grep -i "${pattern}" ${logPath} 2>/dev/null | tail -${lines}`)
    if (output && !output.includes('失败')) {
      results.push(`**${logPath}:**`)
      results.push('\`\`\`' + output + '\`\`\`')
    }
  }
  
  return results.join('\n') || '未找到匹配的日志'
}

/**
 * 运维操作执行入口
 */
export type OpsAction = 'health' | 'logs' | 'perf' | 'ports' | 'process' | 'disk'

/**
 * 本地运维操作
 */
export async function executeOp(action: string, arg?: string): Promise<string> {
  switch (action.toLowerCase()) {
    case 'health':
    case 'check':
      return checkHealth()
    case 'logs':
    case 'log':
      return analyzeLogs(arg || 'error')
    case 'perf':
    case 'performance':
      return checkPerformance()
    case 'ports':
    case 'port':
      return checkPort(arg ? parseInt(arg) : undefined)
    case 'process':
    case 'proc':
      return checkProcess(arg)
    case 'disk':
    case 'space':
      return checkDisk()
    default:
      return `未知操作: ${action}\n\n可用操作: health, logs, perf, ports, process, disk`
  }
}

/**
 * 远程运维操作
 */
export async function executeRemoteOp(
  action: string, 
  config: SSHConfig,
  arg?: string
): Promise<string> {
  switch (action.toLowerCase()) {
    case 'health':
    case 'check':
      return checkRemoteHealth(config)
    case 'logs':
    case 'log':
      return checkRemoteLogs(config, arg || 'error')
    case 'ports':
    case 'port':
      return checkRemotePort(config, arg ? parseInt(arg) : undefined)
    case 'process':
    case 'proc':
      return checkRemoteProcess(config, arg)
    case 'disk':
      return checkRemoteDisk(config)
    default:
      return `未知操作: ${action}`
  }
}

/**
 * SFTP文件操作
 */
export async function uploadFile(
  config: SSHConfig,
  localPath: string,
  remotePath: string
): Promise<string> {
  const sftp = getSFTPManager()
  const audit = getAuditLogger()
  const startTime = Date.now()
  
  try {
    await sftp.uploadFile(config, localPath, remotePath)
    const duration = Date.now() - startTime
    audit.logSuccess('upload_file', config.host, `${localPath} -> ${remotePath}`, duration)
    return `✅ 文件上传成功: ${localPath} -> ${remotePath}`
  } catch (error: any) {
    audit.logFailure('upload_file', config.host, error.message, `${localPath} -> ${remotePath}`)
    return `❌ 文件上传失败: ${error.message}`
  }
}

export async function downloadFile(
  config: SSHConfig,
  remotePath: string,
  localPath: string
): Promise<string> {
  const sftp = getSFTPManager()
  const audit = getAuditLogger()
  const startTime = Date.now()
  
  try {
    await sftp.downloadFile(config, remotePath, localPath)
    const duration = Date.now() - startTime
    audit.logSuccess('download_file', config.host, `${remotePath} -> ${localPath}`, duration)
    return `✅ 文件下载成功: ${remotePath} -> ${localPath}`
  } catch (error: any) {
    audit.logFailure('download_file', config.host, error.message, `${remotePath} -> ${localPath}`)
    return `❌ 文件下载失败: ${error.message}`
  }
}

export async function listRemoteDirectory(
  config: SSHConfig,
  remotePath: string
): Promise<string> {
  const sftp = getSFTPManager()
  
  try {
    const files = await sftp.listDirectory(config, remotePath)
    const output = files.map(f => `${f.type === 'd' ? '📁' : '📄'} ${f.name} (${f.size || 0} bytes)`).join('\n')
    return `### 📁 目录: ${remotePath}\n\`\`\`\n${output}\n\`\`\``
  } catch (error: any) {
    return `❌ 列出目录失败: ${error.message}`
  }
}

/**
 * 获取审计日志统计
 */
export async function getAuditStats(): Promise<string> {
  const audit = getAuditLogger()
  const stats = audit.getStats()
  
  const lines: string[] = []
  lines.push('### 📊 审计日志统计\n')
  lines.push(`**总计**: ${stats.total} 次操作\n`)
  lines.push(`**成功**: ${stats.success} | **失败**: ${stats.failure} | **部分**: ${stats.partial}\n`)
  
  if (Object.keys(stats.byOperation).length > 0) {
    lines.push('**按操作类型:**')
    for (const [op, count] of Object.entries(stats.byOperation)) {
      lines.push(`- ${op}: ${count}`)
    }
    lines.push('')
  }
  
  if (Object.keys(stats.byServer).length > 0) {
    lines.push('**按服务器:**')
    for (const [server, count] of Object.entries(stats.byServer)) {
      lines.push(`- ${server}: ${count}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * 清理资源
 */
export async function cleanup(): Promise<void> {
  await closeGlobalPool()
}
