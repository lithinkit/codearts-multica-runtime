import { afterEach, describe, expect, it } from 'vitest'
import * as env from '../src/env.js'

describe('env', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getBasicAuth', () => {
    it('returns base64 encoded credentials', () => {
      process.env.OPENCODE_SERVER_USERNAME = 'codearts'
      process.env.OPENCODE_SERVER_PASSWORD = 'test-pass-123'
      const auth = env.getBasicAuth()
      const decoded = Buffer.from(auth, 'base64').toString('utf8')
      expect(decoded).toBe('codearts:test-pass-123')
    })

    it('uses default username when not set', () => {
      delete process.env.OPENCODE_SERVER_USERNAME
      process.env.OPENCODE_SERVER_PASSWORD = 'test-pass-123'
      const auth = env.getBasicAuth()
      const decoded = Buffer.from(auth, 'base64').toString('utf8')
      expect(decoded).toBe('codearts:test-pass-123')
    })

    it('throws when password is not set', () => {
      delete process.env.OPENCODE_SERVER_USERNAME
      delete process.env.OPENCODE_SERVER_PASSWORD
      expect(() => env.getBasicAuth()).toThrow('OPENCODE_SERVER_PASSWORD')
    })
  })

  describe('getKernelPort', () => {
    it('env var overrides everything', () => {
      process.env.CODEARTS_KERNEL_PORT = '49042'
      expect(env.getKernelPort()).toBe(49042)
    })

    it('returns a valid port number when not set via env', () => {
      delete process.env.CODEARTS_KERNEL_PORT
      const port = env.getKernelPort()
      expect(Number.isInteger(port)).toBe(true)
      expect(port).toBeGreaterThan(0)
      expect(port).toBeLessThanOrEqual(65535)
    })

    it('throws on invalid port in env', () => {
      process.env.CODEARTS_KERNEL_PORT = '99999'
      expect(() => env.getKernelPort()).toThrow('CODEARTS_KERNEL_PORT')
    })
  })
})