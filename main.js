/**
 * Electron 主进程 - 全合一版本
 * 包含：窗口管理、系统托盘、嵌入式 Express Rerank 服务器
 * 无需任何外部模块文件
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');

// ============================================================
// Rerank 服务器类（直接内嵌，无外部依赖文件）
// ============================================================
class RerankServer {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || 11435;
    this.ollamaBaseUrl = config.ollamaBaseUrl || 'http://localhost:11434';
    this.defaultModel = config.model || 'dengcao/Qwen3-Reranker-8B:Q5_K_M';
    this.server = null;
    this.requestLogs = [];
    this.maxLogs = 200;
    this.onRequestLog = null;
    this._setupMiddleware();
    this._setupRoutes();
    console.log('[RerankServer] 初始化完成');
  }

  _setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use((req, res, next) => {
      this._logRequest('info', req.method + ' ' + req.path);
      next();
    });
  }

  _setupRoutes() {
    this.app.post('/api/rerank', async (req, res) => {
      const startTime = Date.now();
      const logId = this._logRequest('rerank', '收到 Rerank 请求', {
        query: (req.body.query || '').substring(0, 80),
        docCount: (req.body.documents || []).length,
        topN: req.body.top_n,
        model: req.body.model || this.defaultModel,
      });
      try {
        const { query, documents, top_n, model } = req.body;
        if (!query) {
          this._updateLog(logId, 'error', '缺少 query 参数');
          return res.status(400).json({ error: 'Missing required parameter: query' });
        }
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
          this._updateLog(logId, 'error', '缺少 documents 参数');
          return res.status(400).json({ error: 'Missing or invalid parameter: documents' });
        }
        const rerankModel = model || this.defaultModel;
        this._updateLog(logId, 'processing', '正在处理 ' + documents.length + ' 个文档...');
        const scoredDocuments = await Promise.all(
          documents.map(async (doc, index) => {
            let docText;
            if (typeof doc === 'string') {
              docText = doc;
            } else if (typeof doc.text === 'string') {
              docText = doc.text;
            } else if (typeof doc.text === 'object' && doc.text.text) {
              docText = doc.text.text;
            } else {
              docText = JSON.stringify(doc);
            }
            const relevanceScore = await this._scoreDocument(query, docText, rerankModel);
            return { index, relevance_score: relevanceScore, text: docText };
          })
        );
        scoredDocuments.sort((a, b) => b.relevance_score - a.relevance_score);
        const results = top_n ? scoredDocuments.slice(0, top_n) : scoredDocuments;
        const elapsed = Date.now() - startTime;
        this._updateLog(logId, 'success', '完成，耗时 ' + elapsed + 'ms，最高分 ' + (results[0] ? results[0].relevance_score.toFixed(4) : 'N/A'), { elapsed, resultsCount: results.length });
        res.json({ results, model: rerankModel, usage: { total_tokens: documents.length + 1 } });
      } catch (error) {
        const elapsed = Date.now() - startTime;
        this._updateLog(logId, 'error', '处理失败: ' + error.message, { elapsed });
        res.status(500).json({ error: 'Internal server error', message: error.message });
      }
    });

    this.app.post('/v1/rerank', async (req, res) => {
      req.url = '/api/rerank';
      this.app._router.handle(req, res);
    });

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'Ollama Rerank Adapter', ollama_url: this.ollamaBaseUrl, default_model: this.defaultModel });
    });

    this.app.get('/', (req, res) => {
      res.json({ service: 'Ollama Rerank Adapter', version: '1.0.0', status: 'running', endpoints: { rerank: '/api/rerank', health: '/health', models: '/api/models' } });
    });

    this.app.get('/api/models', (req, res) => {
      res.json({ models: [{ id: this.defaultModel, name: this.defaultModel, type: 'rerank' }] });
    });
  }

  async _scoreDocument(query, document, model) {
    const prompt = 'Query: ' + query + '\nDocument: ' + document + '\nRelevance score:';
    const response = await fetch(this.ollamaBaseUrl + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model, prompt: prompt, stream: false, options: { temperature: 0, num_predict: 10 } }),
    });
    if (!response.ok) throw new Error('Ollama API error: ' + response.status + ' ' + response.statusText);
    const data = await response.json();
    const responseText = data.response.trim();
    const scoreMatch = responseText.match(/(\d+\.?\d*)/);
    if (scoreMatch) {
      const score = parseFloat(scoreMatch[1]);
      return Math.min(Math.max(score / 10, 0), 1);
    }
    return 0.5;
  }

  _logRequest(type, message, data) {
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8), type: type, status: type === 'info' ? 'info' : 'pending', message: message, data: data || {}, timestamp: new Date().toLocaleString('zh-CN', { hour12: false }) };
    this.requestLogs.unshift(entry);
    if (this.requestLogs.length > this.maxLogs) this.requestLogs = this.requestLogs.slice(0, this.maxLogs);
    if (this.onRequestLog) this.onRequestLog(entry);
    return entry.id;
  }

  _updateLog(id, status, message, data) {
    const log = this.requestLogs.find(function (l) { return l.id === id; });
    if (log) {
      log.status = status;
      log.message = message;
      if (data) Object.assign(log.data, data);
      if (this.onRequestLog) this.onRequestLog(log);
    }
  }

  start() {
    var self = this;
    return new Promise(function (resolve, reject) {
      self.server = self.app.listen(self.port, '0.0.0.0', function () {
        self._logRequest('system', 'Rerank 适配器服务已启动，端口: ' + self.port);
        console.log('[RerankServer] 服务已启动，端口: ' + self.port);
        resolve(self.port);
      });
      self.server.on('error', function (err) {
        console.error('[RerankServer] 启动失败:', err.message);
        reject(err);
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this._logRequest('system', '服务已停止');
    }
  }

  updateConfig(config) {
    if (config.port) this.port = config.port;
    if (config.ollamaBaseUrl) this.ollamaBaseUrl = config.ollamaBaseUrl;
    if (config.model) this.defaultModel = config.model;
  }

  getLogs() { return this.requestLogs; }
}

// ============================================================
// Electron 应用逻辑
// ============================================================
let server = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;

function createTrayIcon() {
  const size = 16;
  return nativeImage.createFromBuffer(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="8" cy="8" r="7" fill="#10B981" stroke="#065F46" stroke-width="1"/>' +
      '<text x="8" y="12" font-size="10" fill="white" text-anchor="middle" font-weight="bold">R</text>' +
      '</svg>'
    ),
    { width: size, height: size }
  );
}

let trayContextMenu = null;

function buildTrayMenu(statusText) {
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: function () { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: statusText || '服务状态: 检查中...', enabled: false },
    { type: 'separator' },
    {
      label: '重启服务', click: async function () {
        if (server) {
          server.stop();
          await server.start();
          if (mainWindow) mainWindow.webContents.send('server-status', { running: true, port: server.port });
          updateTrayStatus(true);
        }
      }
    },
    { label: '退出', click: function () { isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Dify Ollama Rerank Adapter');
  trayContextMenu = buildTrayMenu('服务状态: 启动中...');
  tray.setContextMenu(trayContextMenu);
  tray.on('click', function () {
    if (mainWindow) { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); }
  });
}

function updateTrayStatus(running) {
  if (!tray) return;
  var statusText = running ? '服务运行中 - 端口 ' + (server ? server.port : 11435) : '服务未运行';
  trayContextMenu = buildTrayMenu(statusText);
  tray.setContextMenu(trayContextMenu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 750,
    minHeight: 550,
    title: 'Dify Ollama Rerank Adapter',
    icon: createTrayIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();

  mainWindow.on('close', function (event) {
    if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.on('show', function () {
    if (server) mainWindow.webContents.send('logs-data', server.getLogs());
  });
}

// 通用 fetch 辅助函数（兼容旧版 Electron）
function fetchWithTimeout(url, options, timeoutMs) {
  options = options || {};
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 10000);
  options.signal = controller.signal;
  return fetch(url, options).then(function (response) {
    clearTimeout(timer);
    return response;
  }).catch(function (err) {
    clearTimeout(timer);
    throw err;
  });
}

function setupIPC() {
  ipcMain.handle('get-config', function () {
    if (!server) return {};
    return { port: server.port, ollamaBaseUrl: server.ollamaBaseUrl, model: server.defaultModel };
  });

  ipcMain.handle('update-config', async function (_, config) {
    if (!server) return { success: false, error: '服务器未初始化' };
    try {
      server.stop();
      server.updateConfig(config);
      var port = await server.start();
      updateTrayStatus(true);
      if (mainWindow) mainWindow.webContents.send('server-status', { running: true, port: port });
      return { success: true, port: port };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('check-ollama', async function (_, ollamaUrl) {
    var targetUrl = ollamaUrl || (server ? server.ollamaBaseUrl : 'http://localhost:11434');
    console.log('[主进程] 检测 Ollama 连接: ' + targetUrl);
    try {
      var response = await fetchWithTimeout(targetUrl + '/api/tags', {}, 5000);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      var allModels = data.models || [];
      var rerankModels = allModels.filter(function (m) {
        return m.name.toLowerCase().indexOf('rerank') !== -1;
      });
      console.log('[主进程] Ollama 连接成功，rerank 模型: ' + rerankModels.map(function(m){return m.name;}).join(', '));
      return { connected: true, models: allModels, rerankModels: rerankModels };
    } catch (error) {
      var errMsg = error.name === 'AbortError' ? '连接超时(5秒)' : error.message;
      console.error('[主进程] Ollama 连接失败: ' + errMsg);
      return { connected: false, error: errMsg };
    }
  });

  ipcMain.handle('get-ollama-models', async function () {
    var targetUrl = server ? server.ollamaBaseUrl : 'http://localhost:11434';
    console.log('[主进程] 获取 Ollama 模型列表: ' + targetUrl);
    try {
      var response = await fetchWithTimeout(targetUrl + '/api/tags', {}, 10000);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      var allModels = data.models || [];
      // 只保留 rerank 相关模型
      var rerankModels = allModels.filter(function (m) {
        return m.name.toLowerCase().indexOf('rerank') !== -1;
      });
      return { success: true, models: rerankModels };
    } catch (error) {
      var errMsg = error.name === 'AbortError' ? '连接超时(10秒)' : error.message;
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle('pull-model', async function (_, modelName) {
    var targetUrl = server ? server.ollamaBaseUrl : 'http://localhost:11434';
    console.log('[主进程] 拉取模型: ' + modelName + ' 从 ' + targetUrl);
    try {
      var response = await fetchWithTimeout(targetUrl + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false }),
      }, 600000);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      return { success: true, data: data };
    } catch (error) {
      var errMsg = error.name === 'AbortError' ? '拉取超时(10分钟)' : error.message;
      return { success: false, error: errMsg };
    }
  });

  ipcMain.handle('get-logs', function () {
    return server ? server.getLogs() : [];
  });

  ipcMain.handle('clear-logs', function () {
    if (server) {
      server.requestLogs = [];
      if (mainWindow) mainWindow.webContents.send('logs-data', []);
    }
  });

  ipcMain.handle('open-external', function (_, url) {
    shell.openExternal(url);
  });

  ipcMain.handle('get-status', function () {
    return { running: !!(server && server.server), port: server ? server.port : 11435 };
  });
}

// ============================================================
// 应用启动
// ============================================================
app.whenReady().then(async function () {
  console.log('[主进程] 应用启动中...');

  try {
    createTray();
    createWindow();
    setupIPC();
    console.log('[主进程] 窗口和 IPC 初始化完成');
  } catch (err) {
    console.error('[主进程] 初始化失败:', err);
  }

  try {
    console.log('[主进程] 正在创建 Rerank 服务器...');
    server = new RerankServer();

    server.onRequestLog = function (log) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-log', log);
      }
    };

    var port = await server.start();
    updateTrayStatus(true);
    if (mainWindow) mainWindow.webContents.send('server-status', { running: true, port: port });
    console.log('[主进程] ====== 全部启动成功 ======');
  } catch (error) {
    console.error('[主进程] ====== 服务器启动失败 ======');
    console.error('[主进程] 错误:', error.message);
    console.error('[主进程] 堆栈:', error.stack);
    if (mainWindow) mainWindow.webContents.send('server-status', { running: false, error: error.message });
  }
});

app.on('window-all-closed', function () {
  // 不退出，保持在托盘运行
});

app.on('before-quit', function () {
  isQuitting = true;
  if (server) server.stop();
});
