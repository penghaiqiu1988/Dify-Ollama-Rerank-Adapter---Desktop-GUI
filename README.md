# Dify Ollama Rerank Adapter - Desktop GUI

将 [dify-ollama-rerank-adapter](https://github.com/jtianling/dify-ollama-rerank-adapter) 封装为 Windows 桌面应用，提供图形化界面管理 Rerank 服务。

## 对新版ollama已失效！

## 功能特性

- **图形化配置** — 可视化设置 Ollama 地址、端口、模型
- **一键模型管理** — 自动获取本地 Ollama 模型列表，支持下拉选择
- **模型拉取** — 直接从界面拉取 Ollama 远程模型
- **实时请求可视化** — 实时显示所有 Rerank 请求的状态、耗时和结果
- **运行统计** — 请求总数、成功/失败数、平均耗时
- **系统托盘** — 最小化到托盘运行，不占用任务栏
- **无命令窗口** — 纯 GUI 界面，无终端黑框

<img width="973" height="970" alt="ScreenShot_2026-05-18_200517_174" src="https://github.com/user-attachments/assets/e22b1b62-10b5-410e-b3fa-3303557a3e49" />


## 前置条件

1. **Node.js** >= 18.0.0 — [下载地址](https://nodejs.org/)
2. **Ollama** — [下载地址](https://ollama.ai/)，安装后确保正在运行

## 快速开始

### 方式一：直接运行（开发模式）

```bash
# 1. 进入项目目录
cd dify-ollama-rerank-gui

# 2. 安装依赖
npm install

# 3. 启动应用
npm start
```

### 方式二：构建为 Windows exe（推荐）

#### 在 Windows 上构建：

```bash
# 双击运行
build.bat

# 或手动执行
npm install
npx electron-builder --win --x64
```

构建完成后在 `dist/` 目录下会生成：
- `Dify Ollama Rerank Adapter Setup.exe` — 安装版（支持自定义安装路径、桌面快捷方式）
- `Dify Ollama Rerank Adapter.exe` — 便携版（免安装，双击直接运行）

#### 在 Linux/macOS 上交叉编译：

```bash
npm install
npx electron-builder --win --x64
```

> 注意：Linux 交叉编译 Windows 可能需要额外安装 `wine`。

## 使用说明

### 1. 启动 Ollama

确保 Ollama 已安装并正在运行：
```bash
ollama serve
```

### 2. 安装 Rerank 模型

推荐使用以下 Rerank 模型之一：

```bash
# Qwen3 Reranker (推荐，中文效果好)
ollama pull dengcao/Qwen3-Reranker-8B:Q5_K_M

# BGE Reranker
ollama pull bge-reranker-v2-m3

# 或通过应用界面的"拉取"按钮下载
```

### 3. 启动本应用

运行 exe 或使用 `npm start` 启动。

### 4. 配置服务

- **Ollama 地址**：默认 `http://localhost:11434`，一般无需修改
- **监听端口**：默认 `11435`，Dify 将连接此端口
- **Rerank 模型**：从下拉列表选择已安装的模型，或手动输入模型名称
- 点击 **"保存配置并重启服务"** 使配置生效

### 5. 在 Dify 中配置

在 Dify 的 **Rerank 模型** 设置中：

| 配置项 | 值 |
|--------|-----|
| API Provider | Custom / 自定义 |
| API Base URL | `http://localhost:11435` |
| API Endpoint | `/api/rerank` |
| API Key | （留空或任意值） |
| Model | 你选择的模型名称 |

> 如果 Dify 运行在 Docker 中，API Base URL 使用 `http://host.docker.internal:11435`

### 6. 查看请求日志

应用右侧面板实时显示所有请求，包括：
- 请求时间和类型
- 查询内容和文档数量
- 处理状态（处理中/成功/失败）
- 耗时和相关性分数
- 错误详情（鼠标悬停查看）

## 项目结构

```
dify-ollama-rerank-gui/
├── main.js              # Electron 主进程（窗口管理 + 系统托盘）
├── preload.js           # IPC 安全桥接
├── index.html           # GUI 界面
├── renderer.js          # GUI 交互逻辑
├── styles.css           # 界面样式（暗色主题）
├── server/
│   └── rerank-server.js # 嵌入式 Express Rerank 服务器
├── package.json         # 项目配置和依赖
├── build.bat            # Windows 一键构建脚本
└── dist/                # 构建输出目录（构建后生成）
```

## 技术架构

```
┌──────────────────────────────────────────────────┐
│              Electron 桌面应用                      │
│  ┌────────────────┐  ┌────────────────────────┐  │
│  │   主进程        │  │   渲染进程 (GUI)         │  │
│  │  - 窗口管理    │  │  - 配置面板             │  │
│  │  - 系统托盘    │◄─┤  - 模型选择/拉取        │  │
│  │  - 托盘菜单    │  │  - 请求日志可视化       │  │
│  └───────┬────────┘  │  - 运行统计             │  │
│          │ IPC       └────────────────────────┘  │
│  ┌───────▼────────┐                              │
│  │ Express Server  │                              │
│  │  :11435         │                              │
│  │  POST /api/rerank ────► Ollama :11434         │
│  │  POST /v1/rerank       /api/generate          │
│  │  GET  /health                                   │
│  └─────────────────┘                              │
└──────────────────────────────────────────────────┘
```

## 常见问题

**Q: 启动后无法连接 Ollama？**
A: 确保 Ollama 正在运行，在终端执行 `ollama list` 验证。

**Q: Rerank 效果不好？**
A: 不同的 Rerank 模型对不同语言效果不同。中文场景推荐 `Qwen3-Reranker-8B`，英文推荐 `bge-reranker-v2-m3`。

**Q: 关闭窗口后服务还在运行吗？**
A: 是的，关闭主窗口后服务继续在后台运行（系统托盘）。右键托盘图标选择"退出"完全关闭。

**Q: 如何卸载安装版？**
A: 在 Windows 设置 → 应用 中卸载，或在安装目录运行 `Uninstall.exe`。

## 许可证

MIT License — 基于 [dify-ollama-rerank-adapter](https://github.com/jtianling/dify-ollama-rerank-adapter) 改造。
