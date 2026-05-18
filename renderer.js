/**
 * 渲染进程 - GUI 交互逻辑
 */

const api = window.electronAPI;

// ====== 全局状态 ======
let currentFilter = 'all';
let allLogs = [];

// ====== DOM 引用 ======
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const statusIndicator = $('#status-indicator');
const statusText = $('#status-text');
const logContainer = $('#log-container');
const modelSelect = $('#model-select');
const manualModel = $('#manual-model');

// ====== 日志图标 SVG ======
const logIcons = {
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  rerank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  system: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  processing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`,
};

// ====== 初始化 ======
async function init() {
  setupEventListeners();
  await loadConfig();
  await refreshOllamaModels();

  // 监听实时日志
  api.onNewLog((log) => {
    // 更新已有日志或添加新日志
    const idx = allLogs.findIndex((l) => l.id === log.id);
    if (idx >= 0) {
      allLogs[idx] = log;
    } else {
      allLogs.unshift(log);
      if (allLogs.length > 500) allLogs = allLogs.slice(0, 500);
    }
    renderLogs();
    updateStats();
  });

  // 初始化加载所有日志
  api.onLogsData((logs) => {
    allLogs = logs || [];
    renderLogs();
    updateStats();
  });

  // 监听服务状态
  api.onServerStatus((status) => {
    updateStatusIndicator(status);
  });

  // 检查初始状态
  const status = await api.getStatus();
  updateStatusIndicator(status);
}

// ====== 事件绑定 ======
function setupEventListeners() {
  // 检测 Ollama 连接
  $('#btn-check-ollama').addEventListener('click', checkOllamaConnection);

  // 刷新模型列表
  $('#btn-refresh-models').addEventListener('click', refreshOllamaModels);

  // 拉取模型
  $('#btn-pull-model').addEventListener('click', () => togglePullDialog(true));

  // 保存配置
  $('#btn-save-config').addEventListener('click', saveAndRestart);

  // 清空日志
  $('#btn-clear-logs').addEventListener('click', async () => {
    allLogs = [];
    renderLogs();
    updateStats();
    await api.clearLogs();
  });

  // 过滤器
  $$('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderLogs();
    });
  });

  // 手动输入模型名时自动同步到 select
  manualModel.addEventListener('input', () => {
    const val = manualModel.value.trim();
    const exists = Array.from(modelSelect.options).some((o) => o.value === val);
    if (!exists && val) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val + ' (手动输入)';
      modelSelect.insertBefore(opt, modelSelect.firstChild);
      modelSelect.value = val;
    } else {
      modelSelect.value = val;
    }
  });

  // 拉取对话框
  $('#btn-close-pull-dialog').addEventListener('click', () => togglePullDialog(false));
  $('#btn-cancel-pull').addEventListener('click', () => togglePullDialog(false));
  $('#btn-confirm-pull').addEventListener('click', pullModel);

  // 回车确认拉取
  $('#pull-model-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pullModel();
  });

  // 端口变化时更新 Dify URL
  $('#server-port').addEventListener('input', updateDifyUrl);
}

// ====== 配置加载 ======
async function loadConfig() {
  const config = await api.getConfig();
  if (config.port) {
    $('#server-port').value = config.port;
  }
  if (config.ollamaBaseUrl) {
    $('#ollama-url').value = config.ollamaBaseUrl;
  }
  if (config.model) {
    manualModel.value = config.model;
  }
  updateDifyUrl();
}

// ====== 更新 Dify URL 显示 ======
function updateDifyUrl() {
  const port = $('#server-port').value || 11435;
  $('#dify-api-url').textContent = `http://localhost:${port}/api/rerank`;
}

// ====== 检测 Ollama 连接 ======
async function checkOllamaConnection() {
  const url = $('#ollama-url').value.trim();
  const btn = $('#btn-check-ollama');
  const statusEl = $('#ollama-status');

  btn.disabled = true;
  btn.innerHTML = '<span class="pulling-indicator">检测中</span>';
  statusEl.textContent = '';
  statusEl.className = 'help-text';

  try {
    const result = await api.checkOllama(url);
    if (result.connected) {
      statusEl.textContent = 'Ollama 连接成功' + (result.rerankModels ? ` (${result.rerankModels.length} 个 Rerank 模型)` : '');
      statusEl.className = 'connected';
      showToast('Ollama 连接成功', 'success');
      await refreshOllamaModels();
    } else {
      statusEl.textContent = `连接失败: ${result.error}`;
      statusEl.className = 'disconnected';
      showToast('无法连接到 Ollama: ' + result.error, 'error');
    }
  } catch (error) {
    statusEl.textContent = `检测异常: ${error.message}`;
    statusEl.className = 'disconnected';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>检测`;
  }
}

// ====== 刷新 Ollama 模型列表 ======
async function refreshOllamaModels() {
  const btn = $('#btn-refresh-models');
  btn.disabled = true;

  try {
    const result = await api.getOllamaModels();
    if (result.success) {
      modelSelect.innerHTML = '';

      if (result.models.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '（无可用模型）';
        modelSelect.appendChild(opt);
      } else {
        result.models.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.textContent = `${m.name} (${formatSize(m.size)})`;
          modelSelect.appendChild(opt);
        });

        // 尝试选中当前配置的模型
        const currentModel = manualModel.value.trim();
        const exists = Array.from(modelSelect.options).some((o) => o.value === currentModel);
        if (exists) {
          modelSelect.value = currentModel;
        } else if (currentModel) {
          // 手动添加当前模型
          const opt = document.createElement('option');
          opt.value = currentModel;
          opt.textContent = currentModel + ' (当前配置)';
          modelSelect.insertBefore(opt, modelSelect.firstChild);
          modelSelect.value = currentModel;
        }
      }

      showToast(`已加载 ${result.models.length} 个模型`, 'success');
    } else {
      modelSelect.innerHTML = '<option value="">加载失败</option>';
      showToast('获取模型列表失败: ' + result.error, 'warning');
    }
  } catch (error) {
    modelSelect.innerHTML = '<option value="">加载失败</option>';
  } finally {
    btn.disabled = false;
  }
}

// ====== 保存配置并重启 ======
async function saveAndRestart() {
  const btn = $('#btn-save-config');
  btn.disabled = true;
  btn.textContent = '保存中...';

  const config = {
    ollamaBaseUrl: $('#ollama-url').value.trim(),
    port: parseInt($('#server-port').value, 10) || 11435,
    model: modelSelect.value || manualModel.value.trim(),
  };

  if (!config.model) {
    showToast('请选择或输入模型名称', 'warning');
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 保存配置并重启服务`;
    return;
  }

  try {
    const result = await api.updateConfig(config);
    if (result.success) {
      showToast(`配置已保存，服务已重启 (端口 ${result.port})`, 'success');
      updateDifyUrl();
    } else {
      showToast('保存失败: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('保存异常: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 保存配置并重启服务`;
  }
}

// ====== 拉取模型对话框 ======
function togglePullDialog(show) {
  const dialog = $('#pull-dialog');
  dialog.style.display = show ? 'flex' : 'none';
  if (show) {
    $('#pull-model-name').value = '';
    $('#pull-progress').style.display = 'none';
    $('#btn-confirm-pull').disabled = false;
    $('#pull-model-name').focus();
  }
}

async function pullModel() {
  const modelName = $('#pull-model-name').value.trim();
  if (!modelName) {
    showToast('请输入模型名称', 'warning');
    return;
  }

  const progress = $('#pull-progress');
  const progressBar = $('#pull-progress-bar');
  const progressText = $('#pull-progress-text');

  progress.style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = `正在拉取 ${modelName}...`;
  $('#btn-confirm-pull').disabled = true;

  try {
    const result = await api.pullModel(modelName);
    if (result.success) {
      progressText.textContent = '拉取完成！';
      progressBar.style.animation = 'none';
      progressBar.style.width = '100%';
      showToast(`模型 ${modelName} 拉取成功`, 'success');

      // 刷新模型列表
      await refreshOllamaModels();

      // 自动选中
      manualModel.value = modelName;
      modelSelect.value = modelName;

      setTimeout(() => togglePullDialog(false), 1000);
    } else {
      progressText.textContent = '拉取失败: ' + result.error;
      showToast('拉取失败: ' + result.error, 'error');
      $('#btn-confirm-pull').disabled = false;
    }
  } catch (error) {
    progressText.textContent = '拉取异常: ' + error.message;
    showToast('拉取异常', 'error');
    $('#btn-confirm-pull').disabled = false;
  }
}

// ====== 渲染日志 ======
function renderLogs() {
  const filtered = currentFilter === 'all'
    ? allLogs
    : allLogs.filter((l) => {
        if (currentFilter === 'error') return l.status === 'error';
        return l.type === currentFilter;
      });

  if (filtered.length === 0) {
    logContainer.innerHTML = '<div class="log-empty">暂无匹配的日志记录</div>';
    return;
  }

  // 只渲染前100条避免性能问题
  const display = filtered.slice(0, 100);

  logContainer.innerHTML = display
    .map((log) => {
      const iconClass = log.status === 'success' ? 'success' : log.status === 'error' ? 'error' : log.status === 'processing' ? 'processing' : log.type;
      const icon = logIcons[iconClass] || logIcons.info;
      const detail = log.data ? JSON.stringify(log.data, null, 2) : '';

      return `
        <div class="log-entry" data-type="${log.type}" data-status="${log.status}">
          <div class="log-icon ${iconClass}">${icon}</div>
          <div class="log-content">
            <div class="log-time">${log.timestamp}</div>
            <div class="log-message">${escapeHtml(log.message)}</div>
            ${detail ? `<div class="log-detail">${escapeHtml(detail)}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  // 自动滚动
  if ($('#auto-scroll').checked) {
    logContainer.scrollTop = 0;
  }
}

// ====== 更新统计 ======
function updateStats() {
  const rerankLogs = allLogs.filter((l) => l.type === 'rerank');
  const successLogs = rerankLogs.filter((l) => l.status === 'success');
  const errorLogs = rerankLogs.filter((l) => l.status === 'error');

  $('#stat-total').textContent = rerankLogs.length;
  $('#stat-success').textContent = successLogs.length;
  $('#stat-error').textContent = errorLogs.length;

  // 计算平均耗时
  const times = successLogs
    .map((l) => l.data?.elapsed)
    .filter((t) => t && t > 0);
  if (times.length > 0) {
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    $('#stat-avg-time').textContent = avg + 'ms';
  }
}

// ====== 状态指示器更新 ======
function updateStatusIndicator(status) {
  if (status.running) {
    statusIndicator.className = 'status-badge status-running';
    statusText.textContent = `运行中 - 端口 ${status.port}`;
  } else {
    statusIndicator.className = 'status-badge status-stopped';
    statusText.textContent = '未运行';
    if (status.error) {
      statusText.textContent = `启动失败: ${status.error}`;
    }
  }
}

// ====== Toast 通知 ======
function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
}

// ====== 工具函数 ======
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ====== 启动 ======
init();
