'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createLlmClient = require('../data/llm-client');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-llm-')); }

test('getApiKey prefers config.json, falls back to env, else null', () => {
  const dir = tmpDir();
  const llm = createLlmClient(dir);
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(llm.getApiKey(), null);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    assert.equal(llm.getApiKey(), 'sk-ant-env');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'sk-ant-file' }));
    assert.equal(llm.getApiKey(), 'sk-ant-file');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('callClaude attaches httpStatus to API errors', async (t) => {
  const llm = createLlmClient(tmpDir());
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(
    () => llm.callClaude('sk-ant-x', 'sys', 'hi', 10, 'claude-sonnet-4-6'),
    (err) => err.httpStatus === 429 && /rate limited/.test(err.message)
  );
});

test('callLLM falls back to Ollama when Claude fails', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'sk-ant-x' }));
  const llm = createLlmClient(dir);
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  global.fetch = async (url) => {
    if (String(url).includes('anthropic.com')) {
      return { ok: false, status: 500, text: async () => 'boom' };
    }
    return { ok: true, json: async () => ({ message: { content: 'local answer' } }) };
  };
  assert.equal(await llm.callLLM('sys', 'hi', 10), 'local answer');
});

test('callLLM uses Claude when the key works', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'sk-ant-x' }));
  const llm = createLlmClient(dir);
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'claude answer' }] }) });
  assert.equal(await llm.callLLM('sys', 'hi', 10), 'claude answer');
});
