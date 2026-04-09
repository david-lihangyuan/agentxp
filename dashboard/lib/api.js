/**
 * AgentXP API client logic — pure functions, no side effects, fully testable
 */

const API_BASE = 'https://agentxp.io';

/**
 * Build search request payload
 */
function buildSearchPayload(query, options = {}) {
  if (!query || typeof query !== 'string') throw new Error('query must be a non-empty string');
  const payload = { query: query.trim() };
  if (options.tags && Array.isArray(options.tags)) payload.tags = options.tags;
  if (options.filters) payload.filters = options.filters;
  if (options.limit) payload.limit = options.limit;
  payload.channels = { precision: true, serendipity: true };
  return payload;
}

/**
 * Build publish request payload
 */
function buildPublishPayload({ what, tried, learned, outcome = 'succeeded', context, outcome_detail, tags = [] }) {
  if (!what || what.length > 100) throw new Error('what is required and must be ≤100 chars');
  if (!tried || tried.length < 20 || tried.length > 500) throw new Error('tried must be 20–500 chars');
  if (!learned || learned.length < 20 || learned.length > 500) throw new Error('learned must be 20–500 chars');
  const validOutcomes = ['succeeded', 'failed', 'partial', 'inconclusive'];
  if (!validOutcomes.includes(outcome)) throw new Error(`outcome must be one of: ${validOutcomes.join(', ')}`);

  const core = { what, tried, outcome, learned };
  if (context) core.context = context;
  if (outcome_detail) core.outcome_detail = outcome_detail;

  return {
    experience: {
      version: 'serendip-experience/0.1',
      core,
      tags,
    }
  };
}

/**
 * Parse and validate search response
 */
function parseSearchResponse(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('Invalid JSON response'); }
  }
  if (data.error) throw new Error(`API error: ${data.error}`);
  return {
    precision: Array.isArray(data.precision) ? data.precision : [],
    serendipity: Array.isArray(data.serendipity) ? data.serendipity : [],
    total: data.total_available || 0,
  };
}

/**
 * Parse profile response
 */
function parseProfileResponse(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('Invalid JSON response'); }
  }
  if (data.error) throw new Error(`API error: ${data.error}`);
  return {
    agent_id: data.agent_id || '',
    tier: data.tier || 'unknown',
    tier_label: data.tier_label || '',
    stats: data.stats || {},
    quota: data.quota || {},
    next_tier: data.next_tier || null,
  };
}

/**
 * Parse stats response
 */
function parseStatsResponse(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('Invalid JSON response'); }
  }
  if (data.error) throw new Error(`API error: ${data.error}`);
  return {
    totals: data.totals || {},
    quality: data.quality || {},
    trust: data.trust || {},
    diversity: data.diversity || {},
    tags: data.tags || {},
  };
}

/**
 * Get outcome badge config
 */
function getOutcomeBadge(outcome) {
  const map = {
    succeeded: { color: '#10b981', label: '✓ 成功' },
    failed:    { color: '#ef4444', label: '✗ 失败' },
    partial:   { color: '#f59e0b', label: '~ 部分' },
    inconclusive: { color: '#6b7280', label: '? 不明' },
  };
  return map[outcome] || { color: '#6b7280', label: outcome };
}

module.exports = {
  API_BASE,
  buildSearchPayload,
  buildPublishPayload,
  parseSearchResponse,
  parseProfileResponse,
  parseStatsResponse,
  getOutcomeBadge,
};
