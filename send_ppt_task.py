#!/usr/bin/env python3
"""Send a message to code-flash via WebSocket with skill content."""
import asyncio
import json
import uuid
import urllib.parse
import httpx
import websockets

BASE = "http://localhost:8765"
WS_BASE = "ws://localhost:8765"

async def main():
    # 1. Get PPT skill content
    skill_id = urllib.parse.quote("生产力与工具/ppt-generation")
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/api/skills/content?id={skill_id}")
        skill_data = resp.json()
    
    if not skill_data.get("success"):
        print(f"❌ 获取技能内容失败: {skill_data.get('error')}")
        return
    
    skill_content = skill_data["content"]
    skill_name = skill_data["name"]
    print(f"✅ 获取技能: {skill_name} ({len(skill_content)} chars)")

    # 2. Build enriched message (same as frontend CommandInput)
    user_msg = "请生成一个今日科技汇报 PPT，包含 AI、芯片、新能源汽车等热门领域"
    enriched = f"""[技能指令 - {skill_name}]
以下是用户选定的技能指令，请严格按照此技能的要求来完成任务。

---
{skill_content}
---

[用户消息]
{user_msg}"""

    # 3. Connect via WebSocket
    session_id = str(uuid.uuid4())
    ws_url = f"{WS_BASE}/ws/chat/{session_id}"
    print(f"🔗 连接: {ws_url}")
    
    async with websockets.connect(ws_url) as ws:
        # Wait for initial messages
        for _ in range(3):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(raw)
                print(f"← {data.get('type')}: {str(data.get('content',''))[:100]}")
            except asyncio.TimeoutError:
                break

        # 4. Send message
        msg = json.dumps({"type": "message", "content": enriched})
        await ws.send(msg)
        print(f"→ 已发送消息 ({len(enriched)} chars)")
        print("⏳ 等待 AI 响应...\n")

        # 5. Receive response
        full_text = ""
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=120)
                data = json.loads(raw)
                t = data.get("type")
                if t == "text":
                    chunk = data.get("content", "")
                    print(chunk, end="", flush=True)
                    full_text += chunk
                elif t == "thinking":
                    print(f"[思考] {data.get('content','')[:200]}...")
                elif t == "tool_use":
                    print(f"\n[工具] {data.get('name','')}({json.dumps(data.get('input',''), ensure_ascii=False)[:100]})")
                elif t == "tool_result":
                    result = data.get("content", "")
                    print(f"[结果] {result[:200]}...")
                elif t == "done":
                    print(f"\n\n✅ 完成！")
                    break
                elif t == "error":
                    print(f"\n❌ 错误: {data.get('content','')}")
                    break
                elif t == "system":
                    print(f"[系统] {data.get('content','')}")
            except asyncio.TimeoutError:
                print("\n⏰ 超时")
                break

asyncio.run(main())
