/**
 * index.ts — AgentXP Plugin v3 entry point.
 *
 * Clean 6-phase initialization:
 * Phase 1: Resolve config
 * Phase 2: Create DB
 * Phase 3: Run onboarding (if first time)
 * Phase 4: Register memory supplements
 * Phase 5: Register lifecycle hooks
 * Phase 6: Register background service
 *
 * Architecture: plugin-v3/docs/plans/plugin-v3/06-entry-onboarding.md
 *
 * Tech stack: TypeScript ESM, strict mode, OpenClaw Plugin SDK.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi, OpenClawPluginServiceContext, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import path from "node:path";

import type { Db } from './db.js';
import { createDb } from './db.js';
import { runOnboarding } from './onboarding.js';
import { createCorpusSupplement } from './memory-corpus.js';
import { createPromptBuilder } from './memory-prompt.js';
import {
  createSessionStartHook,
  createSessionEndHook,
  createMessageSendingHook,
  createBeforeToolCallHook,
  createAfterToolCallHook,
  createAgentEndHook,
} from './hooks/index.js';
import { tick, type ServiceOptions } from './service/index.js';

// ─── Config types ──────────────────────────────────────────────────────────

interface PluginConfig {
  relayUrl?: string;
  operatorPubkey?: string;
  agentKey?: string;
  visibilityDefault?: 'public' | 'private' | 'auto';
  /**
   * Where the onboarding panel should be delivered after first install.
   * If omitted, panel delivery is skipped silently.
   */
  deliveryTarget?: {
    channel?: 'telegram';
    target?: string;
    accountId?: string;
  };
}

// ─── Panel delivery helpers ────────────────────────────────────────────

/** Chunk a long panel string into pieces safe for Telegram (<4096). */
function splitPanel(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function deliverPanelToTelegram(params: {
  api: OpenClawPluginApi;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
  target: string;
  accountId?: string;
  panel: string;
}): Promise<boolean> {
  const { api, logger, target, accountId, panel } = params;
  try {
    const runtime = (api as any).runtime;
    const loadAdapter = runtime?.channel?.outbound?.loadAdapter;
    if (typeof loadAdapter !== 'function') {
      logger.warn('[agentxp-v3] channel.outbound.loadAdapter unavailable, cannot deliver panel');
      return false;
    }
    const adapter = await loadAdapter('telegram');
    const send = adapter?.sendText;
    if (!send) {
      logger.warn('[agentxp-v3] telegram outbound adapter unavailable, cannot deliver panel');
      return false;
    }

    // Wrap in triple-backtick code block so Telegram preserves the box-drawing layout.
    const wrap = (body: string) => '```\n' + body + '\n```';
    const rawChunks = splitPanel(panel, 3800);
    const chunks = rawChunks.map(wrap);

    for (const chunk of chunks) {
      await send({
        cfg: api.config,
        to: target,
        text: chunk,
        ...(accountId ? { accountId } : {}),
      });
      await new Promise((r) => setTimeout(r, 500));
    }
    logger.info(`[agentxp-v3] delivered onboarding panel to telegram:${target} (${chunks.length} chunk(s))`);
    return true;
  } catch (err) {
    logger.warn(`[agentxp-v3] panel delivery failed: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

// ─── Plugin entry ──────────────────────────────────────────────────────────

export default definePluginEntry({
  id: 'agentxp',
  name: 'AgentXP',
  description: 'Agent experience learning — every agent learns from mistakes',

  register(api: OpenClawPluginApi): void {
    // Create safe logger that handles undefined api.logger
    const baseLogger = api.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    
    // Wrap logger to ensure all methods are always available
    const logger = {
      info: (msg: string) => baseLogger.info(msg),
      warn: (msg: string) => baseLogger.warn(msg),
      error: (msg: string) => baseLogger.error(msg),
      debug: (msg: string) => (baseLogger.debug ?? baseLogger.info)(msg),
    };

    // ── Phase 1: Resolve config ────────────────────────────────────────────
    const rawConfig = (api.pluginConfig ?? {}) as PluginConfig;
    const config = {
      relayUrl: rawConfig.relayUrl ?? 'wss://relay.agentxp.io',
      operatorPubkey: rawConfig.operatorPubkey ?? '',
      agentKey: rawConfig.agentKey ?? '',
      visibilityDefault: rawConfig.visibilityDefault ?? 'private',
      deliveryTarget: rawConfig.deliveryTarget,
    };

    // ── Phase 2: Create DB ─────────────────────────────────────────────────
    let dbPath = ':memory:';
    
    // Try to get persistent state directory
    if (api.runtime?.state?.resolveStateDir) {
      try {
        const stateDir = api.runtime.state.resolveStateDir();
        if (stateDir && stateDir !== ':memory:') {
          dbPath = path.join(stateDir, 'agentxp-v3.db');
        }
      } catch (err) {
        logger.warn(`[agentxp-v3] could not resolve state dir: ${err}`);
      }
    }

    const db: Db = createDb(dbPath);
    logger.info(`[agentxp-v3] database initialized: ${dbPath}`);

    // ── Phase 3: Run onboarding (if first time) ────────────────────────────
    // Run onboarding asynchronously (fire-and-forget for Tier 2 LLM extraction)
    (async () => {
      try {
        // Get workspace directory from config or resolvePath
        const workspaceDir = api.config?.agents?.defaults?.workspace ?? api.resolvePath?.('.') ?? '';
        
        if (workspaceDir) {
          const result = await runOnboarding(db, workspaceDir, api);
          if (!result.skipped) {
            logger.info(`[agentxp-v3] onboarding complete:\n${result.fullPanel}`);

            // Deliver panel to user via Telegram (best-effort, fail-safe).
            const delivery = config.deliveryTarget;
            const target = delivery?.target;
            const channel = delivery?.channel ?? 'telegram';
            if (target && channel === 'telegram') {
              await deliverPanelToTelegram({
                api,
                logger,
                target,
                accountId: delivery?.accountId,
                panel: result.fullPanel,
              });
            } else {
              logger.info('[agentxp-v3] no deliveryTarget configured — skipping panel delivery');
            }
          }
        } else {
          logger.warn('[agentxp-v3] no workspace directory found, skipping onboarding');
        }
      } catch (err) {
        logger.warn(`[agentxp-v3] onboarding failed: ${err}`);
      }
    })();

    // ── Phase 4: Register memory supplements ───────────────────────────────
    if (api.registerMemoryCorpusSupplement) {
      api.registerMemoryCorpusSupplement(createCorpusSupplement(db, { mode: 'network' }));
      logger.debug('[agentxp-v3] memory corpus supplement registered');
    }

    if (api.registerMemoryPromptSupplement) {
      api.registerMemoryPromptSupplement(createPromptBuilder(db, {}));
      logger.debug('[agentxp-v3] memory prompt supplement registered');
    }

    // ── Phase 5: Register lifecycle hooks ──────────────────────────────────
    // Use type assertion since hook signature details vary by hook type
    const apiWithHooks = api as any;
    if (apiWithHooks.on) {
      apiWithHooks.on('session_start', createSessionStartHook(db), { name: 'agentxp-session-start' });
      apiWithHooks.on('session_end', createSessionEndHook(db), { name: 'agentxp-session-end' });
      apiWithHooks.on('message_sending', createMessageSendingHook(db), { name: 'agentxp-message-sending' });
      apiWithHooks.on('before_tool_call', createBeforeToolCallHook(db), { name: 'agentxp-before-tool' });
      apiWithHooks.on('after_tool_call', createAfterToolCallHook(db), { name: 'agentxp-after-tool' });
      apiWithHooks.on('agent_end', createAgentEndHook(db), { name: 'agentxp-agent-end' });
      logger.debug('[agentxp-v3] lifecycle hooks registered');
    }

    // ── Phase 6: Register background service ───────────────────────────────
    // OpenClaw services use start/stop pattern, not interval/tick
    // We'll implement a long-running service with internal timer
    if (api.registerService) {
      let intervalHandle: NodeJS.Timeout | null = null;
      
      api.registerService({
        id: 'agentxp-evolve',
        async start(context: OpenClawPluginServiceContext) {
          const baseServiceLogger = context.logger ?? logger;
          // Wrap service logger to ensure debug is always callable
          const serviceLogger = {
            info: (msg: string) => baseServiceLogger.info(msg),
            warn: (msg: string) => baseServiceLogger.warn(msg),
            error: (msg: string) => baseServiceLogger.error(msg),
            debug: (msg: string) => (baseServiceLogger.debug ?? baseServiceLogger.info)(msg),
          };
          
          serviceLogger.info('[agentxp-v3] evolution service starting');
          
          const runTick = async () => {
            const opts: ServiceOptions = {
              config,
              skipPublish: !config.operatorPubkey || !config.agentKey,
            };
            
            try {
              const result = await tick(db, opts);
              serviceLogger.debug(
                `[agentxp-v3] evolve tick: distilled=${result.distilled} milestones=${result.milestones} alerts=${result.alerts} scored=${result.scored} published=${result.published}`
              );
            } catch (err) {
              serviceLogger.error(`[agentxp-v3] evolve tick failed: ${err}`);
            }
          };
          
          // Run immediately once
          await runTick();
          
          // Then run every 5 minutes
          intervalHandle = setInterval(runTick, 5 * 60 * 1000);
        },
        async stop(context: OpenClawPluginServiceContext) {
          const baseStopLogger = context.logger ?? logger;
          const serviceLogger = {
            info: (msg: string) => baseStopLogger.info(msg),
            warn: (msg: string) => baseStopLogger.warn(msg),
            error: (msg: string) => baseStopLogger.error(msg),
            debug: (msg: string) => (baseStopLogger.debug ?? baseStopLogger.info)(msg),
          };
          if (intervalHandle) {
            clearInterval(intervalHandle);
            intervalHandle = null;
            serviceLogger.info('[agentxp-v3] evolution service stopped');
          }
        },
      });
      logger.debug('[agentxp-v3] background service registered');
    }
  },
});
