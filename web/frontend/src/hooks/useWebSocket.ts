import { useCallback, useEffect, useRef, useState } from 'react'
import type { WSEvent, PermissionRequest } from '../types'

type ConnectionState = 'disconnected' | 'connecting' | 'connected'

interface UseWebSocketOptions {
  sessionId: string
  onEvent: (event: WSEvent) => void
  onPermissionRequest?: (req: PermissionRequest) => void
}

export function useWebSocket({ sessionId, onEvent, onPermissionRequest }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<ConnectionState>('disconnected')
  const onEventRef = useRef(onEvent)
  const onPermRef = useRef(onPermissionRequest)
  const connectGenerationRef = useRef(0)  // track which connect() call is current

  onEventRef.current = onEvent
  onPermRef.current = onPermissionRequest

  const connect = useCallback(() => {
    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.onclose = null  // prevent old onclose from interfering
      wsRef.current.close()
      wsRef.current = null
    }

    setState('connecting')
    const gen = ++connectGenerationRef.current
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const ws = new WebSocket(`${protocol}//${host}/ws/chat/${sessionId}`)

    ws.onopen = () => {
      // Only update state if this is still the current connection
      if (gen === connectGenerationRef.current) {
        setState('connected')
      }
    }

    ws.onmessage = (ev) => {
      if (gen !== connectGenerationRef.current) return
      try {
        const data: WSEvent = JSON.parse(ev.data)
        if (data.type === 'permission_request' && onPermRef.current) {
          onPermRef.current({
            id: data.id,
            toolName: data.tool_name,
            input: data.input,
          })
        } else {
          onEventRef.current(data)
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      // Only update state if this is still the current connection
      if (gen === connectGenerationRef.current) {
        setState('disconnected')
        wsRef.current = null
      }
    }

    ws.onerror = () => {
      if (gen === connectGenerationRef.current) {
        setState('disconnected')
      }
    }

    wsRef.current = ws
  }, [sessionId])

  const disconnect = useCallback(() => {
    connectGenerationRef.current++  // invalidate any pending onclose
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setState('disconnected')
  }, [])

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', content }))
      return true
    }
    return false
  }, [])

  const sendPermissionResponse = useCallback((id: string, approved: boolean, always = false) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'permission_response',
        id,
        approved,
        always,
      }))
    }
  }, [])

  const abort = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort' }))
    }
  }, [])

  useEffect(() => {
    return () => {
      connectGenerationRef.current++
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [])

  return {
    state,
    connect,
    disconnect,
    sendMessage,
    sendPermissionResponse,
    abort,
  }
}
