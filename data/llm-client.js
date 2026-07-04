// @ts-check
// LLM plumbing: Claude primary, local Ollama fallback. Extracted from server.js
// unchanged; the factory closes over the data dir so getApiKey can read config.json.
'use strict';
const fs = require('fs');
const path = require('path');

const LOCAL_MODEL = 'llama3.1:8b';
const OLLAMA_BASE = 'http://localhost:11434';

module.exports = function createLlmClient(dataDir) {
  const configPath = path.join(dataDir, 'config.json');

  // Read API key: config file first, then environment variable
  function getApiKey() {
    try {
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg.apiKey) return cfg.apiKey;
      }
    } catch {}
    return process.env.ANTHROPIC_API_KEY || null;
  }

  async function callClaude(apiKey, system, userPrompt, maxTokens, model) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userPrompt }] })
    });
    if (!response.ok) {
      const err = await response.text();
      throw Object.assign(new Error(err), { httpStatus: response.status });
    }
    const data = await response.json();
    return data.content[0].text;
  }

  async function callOllama(system, userPrompt, maxTokens) {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: LOCAL_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
        stream: false,
        options: { num_predict: maxTokens }
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama error ${response.status}: ${err}`);
    }
    const data = await response.json();
    return data.message.content;
  }

  async function callLLM(system, userPrompt, maxTokens, claudeModel = 'claude-sonnet-4-6') {
    const apiKey = getApiKey();
    if (apiKey) {
      try {
        return await callClaude(apiKey, system, userPrompt, maxTokens, claudeModel);
      } catch (err) {
        console.warn(`  ⚠  Claude failed (${err.httpStatus || err.message}), trying local model`);
      }
    }
    return callOllama(system, userPrompt, maxTokens);
  }

  return { getApiKey, callClaude, callOllama, callLLM, configPath, LOCAL_MODEL, OLLAMA_BASE };
};
