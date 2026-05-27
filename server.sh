#!/bin/bash
# code-flash 服务器管理脚本
# 用法:
#   ./server.sh start   - 启动服务
#   ./server.sh stop    - 停止服务
#   ./server.sh restart - 重启服务
#   ./server.sh status  - 查看状态
#   ./server.sh log     - 查看日志

set -e

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJ_DIR/web/backend"
PID_FILE="/tmp/code-flash-server.pid"
LOG_FILE="/tmp/code-flash-server.log"
PORT=8765

_start() {
    if _is_running; then
        echo "⚠️  服务已在运行 (PID: $(cat $PID_FILE), 端口: $PORT)"
        return 0
    fi
    cd "$BACKEND_DIR"
    nohup python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT > "$LOG_FILE" 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"
    sleep 1
    if kill -0 $pid 2>/dev/null; then
        echo "✅ 服务已启动 (PID: $pid)"
        echo ""
        echo "   🌐 浏览器打开: http://localhost:$PORT"
        echo "   📄 日志: $LOG_FILE"
    else
        echo "❌ 启动失败，查看日志: $LOG_FILE"
        cat "$LOG_FILE" | tail -20
        rm -f "$PID_FILE"
        return 1
    fi
}

_stop() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 $pid 2>/dev/null; then
            kill $pid
            sleep 1
            if kill -0 $pid 2>/dev/null; then
                kill -9 $pid 2>/dev/null
            fi
            echo "✅ 服务已停止 (PID: $pid)"
        else
            echo "⚠️  进程已不存在"
        fi
        rm -f "$PID_FILE"
    else
        # fallback: 尝试 pkill
        if pkill -f "uvicorn main:app.*$PORT" 2>/dev/null; then
            sleep 1
            echo "✅ 服务已停止 (通过 pkill)"
        else
            echo "⚠️  没有找到运行中的服务"
        fi
    fi
}

_is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 $pid 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

_status() {
    if _is_running; then
        local pid=$(cat "$PID_FILE")
        echo "✅ 服务运行中 (PID: $pid, 端口: $PORT)"
        # 显示内存占用
        ps -o pid,rss,pcpu,etime -p $pid 2>/dev/null | tail -1 | awk '{printf "   内存: %s MB | CPU: %s%% | 运行: %s\n", $2/1024, $3, $4}'
    else
        echo "⏹  服务未运行"
    fi
}

case "${1:-status}" in
    start)   _start ;;
    stop)    _stop ;;
    restart) _stop; sleep 1; _start ;;
    status)  _status ;;
    log)     tail -f "$LOG_FILE" ;;
    *)       echo "用法: $0 {start|stop|restart|status|log}" ;;
esac
