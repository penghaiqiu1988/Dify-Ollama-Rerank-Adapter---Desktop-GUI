/**
 * Preload 脚本 - IPC 桥接
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 配置管理
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),

  // Ollama 交互
  checkOllama: (url) => ipcRenderer.invoke('check-ollama', url),
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  pullModel: (modelName) => ipcRenderer.invoke('pull-model', modelName),

  // 日志
  getLogs: () => ipcRenderer.invoke('get-logs'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  onNewLog: (callback) => ipcRenderer.on('new-log', (_, log) => callback(log)),
  onLogsData: (callback) => ipcRenderer.on('logs-data', (_, logs) => callback(logs)),

  // 服务状态
  getStatus: () => ipcRenderer.invoke('get-status'),
  onServerStatus: (callback) => ipcRenderer.on('server-status', (_, status) => callback(status)),

  // 工具
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
