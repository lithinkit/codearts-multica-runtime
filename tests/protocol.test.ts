import { describe, expect, it } from 'vitest'
import {
  encodeFrame,
  parseInboundCommand,
  PROTOCOL_VERSION,
} from '../src/protocol.js'

describe('parseInboundCommand', () => {
  it('parses a minimal execute command without model or MCP servers', () => {
    expect(parseInboundCommand(JSON.stringify({
      v: 1,
      type: 'execute',
      request_id: 'request-1',
      cwd: '/work',
      prompt: 'run tests',
    }))).toEqual({
      v: PROTOCOL_VERSION,
      type: 'execute',
      request_id: 'request-1',
      cwd: '/work',
      prompt: 'run tests',
      mcp_servers: [],
    })
  })

  it('parses an execute command with model', () => {
    expect(parseInboundCommand(JSON.stringify({
      v: 1,
      type: 'execute',
      request_id: 'request-1',
      cwd: '/work',
      prompt: 'run tests',
      model: { provider: 'openai-9716a4a24ed8902d', id: 'deepseek-v4-pro' },
    }))).toEqual({
      v: PROTOCOL_VERSION,
      type: 'execute',
      request_id: 'request-1',
      cwd: '/work',
      prompt: 'run tests',
      model: { provider: 'openai-9716a4a24ed8902d', id: 'deepseek-v4-pro' },
      mcp_servers: [],
    })
  })

  it('parses a cancel command', () => {
    expect(parseInboundCommand(JSON.stringify({
      v: 1,
      type: 'cancel',
      request_id: 'request-1',
    }))).toEqual({
      v: PROTOCOL_VERSION,
      type: 'cancel',
      request_id: 'request-1',
    })
  })

  it('rejects unknown fields in commands', () => {
    expect(() => parseInboundCommand(JSON.stringify({
      v: 1,
      type: 'cancel',
      request_id: 'request-1',
      secret: true,
    }))).toThrow('unsupported field')
  })

  it('rejects unsupported protocol versions', () => {
    expect(() => parseInboundCommand(JSON.stringify({
      v: 2,
      type: 'cancel',
      request_id: 'request-1',
    }))).toThrow('unsupported protocol version')
  })

  it('rejects unknown command types', () => {
    expect(() => parseInboundCommand(JSON.stringify({
      v: 1,
      type: 'unknown',
    }))).toThrow('unsupported protocol command type')
  })

  it('rejects non-JSON input', () => {
    expect(() => parseInboundCommand('not json')).toThrow('not valid JSON')
  })
})

describe('encodeFrame', () => {
  it('encodes exactly one JSON line', () => {
    const line = encodeFrame({
      v: 1,
      type: 'protocol_error',
      code: 'BAD_INPUT',
      message: 'bad input',
    })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
  })

  it('round-trips a ready frame', () => {
    const frame = {
      v: PROTOCOL_VERSION as 1,
      type: 'ready' as const,
      runtime: 'codearts' as const,
      plugin_version: '1.0.0',
      capabilities: {
        resume: false as false,
        cancel: false,
        models: true,
        thinking: true,
        usage: true,
        tools: true,
        mcp: [] as [],
      },
    }
    const line = encodeFrame(frame)
    expect(() => JSON.parse(line.slice(0, -1))).not.toThrow()
    const parsed = JSON.parse(line.slice(0, -1))
    expect(parsed.type).toBe('ready')
    expect(parsed.runtime).toBe('codearts')
  })
})