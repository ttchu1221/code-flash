export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCall[]
  timestamp: number
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  activity?: string
  status: 'pending' | 'executing' | 'done' | 'denied'
  result?: string
  isError?: boolean
}

export interface PermissionRequest {
  id: string
  toolName: string
  input: Record<string, unknown>
}

export interface SessionMeta {
  session_id: string
  created_at: string
  cwd: string
  model: string
}

export type WSEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown>; activity?: string }
  | { type: 'tool_executing'; name: string; input: Record<string, unknown>; activity?: string }
  | { type: 'tool_result'; name: string; input: Record<string, unknown>; content: string; is_error: boolean }
  | { type: 'waiting' }
  | { type: 'error'; content: string }
  | { type: 'system'; content: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number }
  | { type: 'done' }
  | { type: 'permission_request'; id: string; tool_name: string; input: Record<string, unknown> }
