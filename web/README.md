# code-flash Web

基于 code-flash 核心引擎的 Web 版 AI 编程助手。

## 架构

```
┌─────────────────────────────────────────────┐
│  Browser (React + TypeScript + Tailwind)    │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Sidebar  │  │  Chat    │  │ Settings  │  │
│  │ Sessions │  │ Messages │  │ Provider  │  │
│  │ Mode     │  │ Tools    │  │ Model     │  │
│  └─────────┘  └────┬─────┘  └───────────┘  │
│                     │ WebSocket              │
└─────────────────────┼───────────────────────┘
                      │
┌─────────────────────┼───────────────────────┐
│  FastAPI Backend     │                       │
│  ┌──────────────────┴──────────────────┐    │
│  │  WebSocket Handler                  │    │
│  │  ┌──────────┐  ┌────────────────┐   │    │
│  │  │ Session  │  │ WebPermission  │   │    │
│  │  │ Manager  │  │ Checker        │   │    │
│  │  └────┬─────┘  └────────┬───────┘   │    │
│  │       │                 │            │    │
│  │  ┌────┴─────────────────┴────────┐  │    │
│  │  │  code-flash Engine (reused)   │  │    │
│  │  │  LLM · Tools · Permissions    │  │    │
│  │  └───────────────────────────────┘  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## 快速开始

### 方式一：一键启动（生产模式）

```bash
cd web
chmod +x start.sh
./start.sh
```

浏览器打开 http://localhost:8765

### 方式二：开发模式（热重载）

```bash
cd web
chmod +x dev.sh
./dev.sh
```

前端: http://localhost:5173 (自动代理到后端 8765)

### 方式三：手动启动

```bash
# 1. 安装后端依赖
pip install -r web/backend/requirements.txt

# 2. 安装前端依赖 & 构建
cd web/frontend
npm install
npm run build

# 3. 启动后端（会自动 serve 前端静态文件）
cd ../backend
uvicorn main:app --host 0.0.0.0 --port 8765
```

## 环境变量

Web 版复用 code-flash 的环境变量配置：

```bash
# Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# 或 OpenAI 兼容
export CODE_FLASH_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://your-gateway.example.com/v1
export CODE_FLASH_MODEL=gpt-4o
```

也可以在 Web 界面的设置面板中配置。

## 功能

| 功能 | 状态 |
|------|------|
| 流式聊天 | ✅ |
| Markdown 渲染 + 代码高亮 | ✅ |
| 工具调用可视化 | ✅ |
| 权限确认弹窗 | ✅ |
| 会话管理 | ✅ |
| 权限模式切换 | ✅ |
| 设置面板（Provider/Model/API Key）| ✅ |
| 斜杠命令 (/clear, /model, /compact) | ✅ |
| 停止生成 | ✅ |
| 自动滚动 | ✅ |

## 文件结构

```
web/
├── start.sh              # 生产模式启动
├── dev.sh                # 开发模式启动
├── README.md
├── backend/
│   ├── main.py           # FastAPI 应用
│   ├── session_manager.py # 会话管理
│   ├── permission.py     # WebSocket 权限检查器
│   └── requirements.txt
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── index.css
        ├── types/
        │   └── index.ts
        ├── hooks/
        │   └── useWebSocket.ts
        └── components/
            ├── Chat.tsx
            ├── MessageBubble.tsx
            ├── ToolCallCard.tsx
            ├── PermissionModal.tsx
            ├── CodeBlock.tsx
            └── Sidebar.tsx
```
