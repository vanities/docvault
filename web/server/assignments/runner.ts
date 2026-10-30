// Runs one assignment check-in: claim it, build a fresh prompt, run an unattended Claude turn,
// apply finish_check_in, record everything, and email the owner when the run calls for it.
import type { SDKRateLimitInfo, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { readBrainContent } from '../brain.js';
import {
  DATA_DIR,
  getChatMode,
  getEmailConfig,
  loadConfig,
  loadSettings,
  type EntityConfig,
} from '../data.js';
import { firstRecipient } from '../alerts.js';
import { sendEmail } from '../email.js';
import { createLogger } from '../logger.js';
import {
  buildSystemPrompt,
  resolveClaudeAgent,
  runClaudeTurn,
  skillsNoteFor,
  WRITE_TOOL_NAMES,
  type ClaudeAgent,
  type ClaudeTurnOptions,
  type ClaudeTurnResult,
  type ToolContext,
} from '../routes/chat.js';
import { renderSafeMarkdown, escapeHtml } from '../safe-html.js';
import { ensureSkillsPluginDir, type SkillsPlugin } from '../skills.js';
import { getConfiguredTimezone } from '../tz.js';
import { createWriteLock } from '../write-lock.js';
import { applyFinish, FINISH_TOOL_NAME, makeFinishTool, type FinishInput } from './finish.js';
import { buildCheckInPrompt, buildRepairPrompt, formatLocal, localDate } from './prompt.js';
import {
  appendEntries,
  appendRunLog,
  loadTranscript,
  newId,
  readRunLog,
  updateIndex,
} from './store.js';
import { LIMITS, type Assignment, type RunTrigger, type ToolUse } from './types.js';

const log = createLogger('Assignments');

export interface RunnerContext {
  brain: string;
  skillsPlugin: SkillsPlugin | null;
  config: { entities: EntityConfig[] };
  timeZone: string;
}

export interface RunnerDeps {
  dataDir: string;
  now: () => Date;
  runTurn: (opts: ClaudeTurnOptions) => Promise<ClaudeTurnResult>;
  resolveAgent: () => Promise<ClaudeAgent | { error: string }>;
  loadContext: () => Promise<RunnerContext>;
  recipient: () => Promise<string | null>;
  sendEmail: typeof sendEmail;
}

export function defaultRunnerDeps(): RunnerDeps {
  return {
    dataDir: DATA_DIR,
    now: () => new Date(),
    runTurn: runClaudeTurn,
    resolveAgent: async () => resolveClaudeAgent(await getChatMode()),
    loadContext: async () => ({
      brain: await readBrainContent(),
      skillsPlugin: await ensureSkillsPluginDir(),
      config: await loadConfig(),
      timeZone: getConfiguredTimezone(await loadSettings()),
    }),
    recipient: async () => firstRecipient((await getEmailConfig()).toEmail),
    sendEmail,
  };
}

export type RunOutcome =
  | {
      status: 'ok' | 'failed' | 'rate-limited' | 'account' | 'refused';
      runId: string;
      error: string | null;
    }
  | { status: 'skipped'; reason: string };

// Errors no retry will fix until the owner acts (sign-in, billing, a removed model).
const ACCOUNT_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'model_not_found',
  'cloud_credential_error',
]);

// One run at a time across all assignments: each is a full agent turn on the owner's subscription.
const runSlot = createWriteLock();
const inFlight = new Set<string>();

export function isRunInFlight(id: string): boolean {
  return inFlight.has(id);
}

/**
 * Queues a run behind whatever is running. Owner-requested runs are marked pending first so the
 * page can show "queued" while they wait for the slot.
 */
export async function requestRun(
  id: string,
  trigger: RunTrigger,
  deps: RunnerDeps = defaultRunnerDeps()
): Promise<RunOutcome> {
  if (trigger !== 'scheduled') {
    await updateIndex((index) => {
      const a = index.assignments[id];
      if (a) a.pendingRun = a.pendingRun ?? trigger;
    }, deps.dataDir);
  }
  return runSlot(() => runAssignment(id, trigger, deps));
}

function minutesFrom(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Epoch seconds or milliseconds → ISO; the SDK reports seconds. */
function resetIso(resetsAt: number | undefined): string | null {
  if (!resetsAt || !Number.isFinite(resetsAt)) return null;
  return new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();
}

function describeResult(result: SDKResultMessage): string {
  switch (result.subtype) {
    case 'error_max_turns':
      return `Stopped at the ${LIMITS.maxTurns}-turn limit`;
    case 'error_max_budget_usd':
      return `Stopped at the $${LIMITS.maxBudgetUsd} budget limit`;
    case 'success':
      return result.result?.slice(0, 300) || 'The model reported an error';
    default:
      return result.errors?.join('; ').slice(0, 300) || 'Error during the run';
  }
}

/** API errors span lines and carry backticks, so inline code would break them up. */
function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function summarizeInput(input: unknown): string {
  try {
    const text = JSON.stringify(input);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return '';
  }
}

/** Writes an interrupted previous run already made, so this run doesn't repeat them. */
async function interruptedWrites(id: string, dataDir: string): Promise<string[]> {
  const lines = await readRunLog(id, dataDir);
  const lastEnd = [...lines].reverse().find((l) => l.event === 'end');
  if (!lastEnd || lastEnd.event !== 'end' || lastEnd.outcome !== 'interrupted') return [];
  return lines.flatMap((l) =>
    l.event === 'tool' && l.runId === lastEnd.runId && l.write
      ? [`${l.name} ${l.input ?? ''}`.trim()]
      : []
  );
}

interface EmailPlan {
  subject: string;
  markdown: string;
  changes: ToolUse[];
  nextCheckAt: string | null;
  assignmentId: string;
}

function emailHtml(plan: EmailPlan, timeZone: string): { html: string; text: string } {
  const writes = plan.changes.filter((t) => t.write);
  const changesHtml = writes.length
    ? `<p style="margin:16px 0 4px;font-weight:600">Changes made</p><ul>${writes.map((t) => `<li>${escapeHtml(t.name)}${t.ok === false ? ' (failed)' : ''}</li>`).join('')}</ul>`
    : '';
  const next = plan.nextCheckAt
    ? `Next check: ${escapeHtml(formatLocal(plan.nextCheckAt, timeZone))}.`
    : 'No more check-ins are scheduled.';
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:640px">${renderSafeMarkdown(plan.markdown)}${changesHtml}<p style="margin-top:20px;color:#6b7280;font-size:13px">${next} Reply, pause or close it in DocVault → Assignments.</p></div>`;
  const text = [
    plan.markdown,
    writes.length ? `Changes made:\n${writes.map((t) => `- ${t.name}`).join('\n')}` : '',
    `${plan.nextCheckAt ? `Next check: ${formatLocal(plan.nextCheckAt, timeZone)}.` : 'No more check-ins are scheduled.'} Reply, pause or close it in DocVault → Assignments.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}

async function deliver(
  deps: RunnerDeps,
  plan: EmailPlan,
  timeZone: string
): Promise<string | null> {
  const t0 = performance.now();
  const to = await deps.recipient();
  if (!to) {
    log.warn(`[email] skipped assignment=${plan.assignmentId}: no recipient configured`);
    return 'No email recipient configured';
  }
  const { html, text } = emailHtml(plan, timeZone);
  const res = await deps.sendEmail({
    purpose: 'news',
    to,
    cc: '',
    subject: plan.subject,
    html,
    text,
    ref: `assignment:${plan.assignmentId}`,
  });
  log.info(
    `[email] assignment=${plan.assignmentId} ok=${res.ok} in ${(performance.now() - t0).toFixed(0)}ms`
  );
  return res.ok ? null : (res.error ?? 'Send failed');
}

type Claim = { assignment: Assignment; pausedAll: boolean } | { skip: string };

/** Runs one check-in now. Callers outside tests go through requestRun, which holds the run slot. */
export async function runAssignment(
  id: string,
  trigger: RunTrigger,
  deps: RunnerDeps = defaultRunnerDeps()
): Promise<RunOutcome> {
  const t0 = performance.now();
  const startedAt = deps.now();
  const runId = newId();
  const context = await deps.loadContext();
  const today = localDate(startedAt, context.timeZone);

  const claim: Claim = await updateIndex((index) => {
    const a = index.assignments[id];
    if (!a) return { skip: 'deleted' };
    if (a.running) return { skip: 'already running' };
    if (trigger === 'scheduled') {
      if (index.pausedAll) return { skip: 'all assignments are paused' };
      if (a.status !== 'active') return { skip: `status is ${a.status}` };
    }
    if (a.counters.day !== today) a.counters = { day: today, runs: 0, emails: 0 };
    if (trigger === 'scheduled' && a.counters.runs >= LIMITS.runsPerDay) {
      a.nextCheckAt = minutesFrom(startedAt, LIMITS.defaultIntervalMinutes);
      return { skip: `daily limit of ${LIMITS.runsPerDay} runs` };
    }
    a.counters.runs += 1;
    a.running = { runId, trigger, startedAt: startedAt.toISOString() };
    a.pendingRun = null;
    a.updatedAt = startedAt.toISOString();
    return { assignment: structuredClone(a), pausedAll: index.pausedAll };
  }, deps.dataDir);
  if ('skip' in claim) {
    log.info(`[run] skip assignment=${id} trigger=${trigger}: ${claim.skip}`);
    return { status: 'skipped', reason: claim.skip };
  }

  const a = claim.assignment;
  inFlight.add(id);
  try {
    log.info(`[run] start assignment=${id} run=${runId} trigger=${trigger}`);
    await appendRunLog(
      id,
      { runId, at: startedAt.toISOString(), event: 'start', trigger },
      deps.dataDir
    );

    const tools = new Map<string, ToolUse>();
    const assistantErrors: string[] = [];
    const warnings: string[] = [];
    // Filled in by the turn's event and tool callbacks.
    const live: {
      replyText: string;
      rateLimit: SDKRateLimitInfo | null;
      finish: FinishInput | null;
    } = { replyText: '', rateLimit: null, finish: null };
    let turn: ClaudeTurnResult = { result: null, error: null, aborted: false };

    try {
      const agent = await deps.resolveAgent();
      if ('error' in agent) {
        assistantErrors.push('authentication_failed');
        turn = { result: null, error: agent.error, aborted: false };
      } else {
        const transcript = await loadTranscript(id, deps.dataDir);
        const prompt = buildCheckInPrompt({
          assignment: a,
          trigger,
          now: startedAt,
          timeZone: context.timeZone,
          transcript,
          lastRunAt: a.lastRun?.at ?? null,
          interruptedWrites: await interruptedWrites(id, deps.dataDir),
        });
        const systemPrompt =
          buildSystemPrompt(undefined, context.brain, 'claude', {
            policy: 'unattended',
            today,
          }) + skillsNoteFor(context.skillsPlugin);
        const finishTool = makeFinishTool(deps.now, (input) => {
          live.finish = input;
        });
        const allowlist = a.toolAllowlist;
        const isToolAllowed = allowlist
          ? (sdkName: string) => {
              const name = sdkName.replace(/^mcp__docvault__/, '');
              return name === FINISH_TOOL_NAME || allowlist.includes(name);
            }
          : undefined;
        const toolContext = (signal: AbortSignal): ToolContext => ({
          config: context.config,
          signal,
          assignment: { id, title: a.title, deepResearchStarts: 0 },
        });

        const controller = new AbortController();
        const watchdog = setTimeout(() => {
          log.warn(`[run] watchdog abort assignment=${id} run=${runId}`);
          controller.abort();
        }, LIMITS.runTimeoutMs);
        try {
          turn = await deps.runTurn({
            prompt,
            systemPrompt,
            agent,
            toolContext: toolContext(controller.signal),
            skillsPlugin: context.skillsPlugin,
            policy: 'unattended',
            extraTools: [finishTool],
            isToolAllowed,
            maxTurns: LIMITS.maxTurns,
            maxBudgetUsd: LIMITS.maxBudgetUsd,
            persistSession: false,
            signal: controller.signal,
            purpose: 'assignment',
            send: (raw: object) => {
              const event = raw as Record<string, unknown>;
              switch (event.type) {
                case 'text':
                  live.replyText += String(event.text ?? '');
                  break;
                case 'tool_call': {
                  const name = String(event.toolName ?? '');
                  if (name === FINISH_TOOL_NAME) break;
                  const write = WRITE_TOOL_NAMES.includes(name);
                  tools.set(String(event.id), { name, write, ok: null });
                  void appendRunLog(
                    id,
                    {
                      runId,
                      at: deps.now().toISOString(),
                      event: 'tool',
                      name,
                      write,
                      input: summarizeInput(event.input),
                    },
                    deps.dataDir
                  );
                  break;
                }
                case 'tool_result': {
                  const use = tools.get(String(event.toolUseId));
                  if (use) use.ok = !event.isError;
                  break;
                }
                case 'assistant_error':
                  assistantErrors.push(String(event.error));
                  break;
                case 'rate_limit':
                  live.rateLimit =
                    (event.payload as { rate_limit_info?: SDKRateLimitInfo })?.rate_limit_info ??
                    null;
                  break;
              }
            },
          });
        } finally {
          clearTimeout(watchdog);
        }

        const turnCompleted = !turn.aborted && !turn.error && turn.result?.subtype === 'success';
        if (!live.finish && turnCompleted) {
          warnings.push('finish_check_in was not called; ran a repair turn');
          const repair = new AbortController();
          const repairTimer = setTimeout(() => repair.abort(), 2 * 60_000);
          try {
            await deps.runTurn({
              prompt: buildRepairPrompt(
                { assignment: a, now: deps.now(), timeZone: context.timeZone },
                live.replyText
              ),
              systemPrompt,
              agent,
              toolContext: toolContext(repair.signal),
              skillsPlugin: null,
              policy: 'unattended',
              extraTools: [finishTool],
              isToolAllowed: (n) => n === `mcp__docvault__${FINISH_TOOL_NAME}`,
              maxTurns: 3,
              maxBudgetUsd: 0.5,
              persistSession: false,
              signal: repair.signal,
              purpose: 'assignment-repair',
              send: () => {},
            });
          } finally {
            clearTimeout(repairTimer);
          }
          if (!live.finish) {
            warnings.push('repair turn did not call finish_check_in; defaults applied');
          }
        }
      }
    } catch (err) {
      turn = { result: turn.result, error: (err as Error).message, aborted: false };
      log.error(`[run] threw assignment=${id} run=${runId}: ${(err as Error).message}`);
    }

    // Classify. Account problems stop every assignment; a usage limit waits for its reset; a
    // refused request pauses its assignment; everything else is a failure with backoff.
    const accountError = assistantErrors.find((e) => ACCOUNT_ERRORS.has(e));
    const limitInfo = live.rateLimit;
    const rateLimited = assistantErrors.includes('rate_limit') || limitInfo?.status === 'rejected';
    // invalid_request means the API turned the request itself down; a safeguard refusal arrives
    // this way. The next check-in sends nearly the same request, so a retry only repeats it, and a
    // repeated refusal is another flagged request on the owner's account.
    const refused = assistantErrors.includes('invalid_request');
    let outcome: 'ok' | 'failed' | 'rate-limited' | 'account' | 'refused';
    let error: string | null = null;
    if (accountError) {
      outcome = 'account';
      error = turn.error ? `${accountError}: ${turn.error}` : accountError;
    } else if (rateLimited) {
      outcome = 'rate-limited';
      error = 'Claude usage limit reached';
    } else if (refused) {
      outcome = 'refused';
      error = turn.error ?? 'invalid_request';
    } else if (turn.aborted) {
      outcome = 'failed';
      error = `Stopped after ${LIMITS.runTimeoutMs / 60_000} minutes`;
    } else if (turn.error) {
      outcome = 'failed';
      error = turn.error;
    } else if (live.finish) {
      outcome = 'ok';
      if (turn.result && turn.result.subtype !== 'success')
        warnings.push(describeResult(turn.result));
    } else if (turn.result?.subtype === 'success' && !turn.result.is_error) {
      outcome = 'ok';
    } else {
      outcome = 'failed';
      error = turn.result ? describeResult(turn.result) : 'The run ended without a result';
    }

    const now = deps.now();
    const nowIso = now.toISOString();
    const applied =
      outcome === 'ok' && live.finish ? applyFinish(a, live.finish, { now, trigger }) : null;
    const replyText = live.replyText;
    if (applied) warnings.push(...applied.warnings);
    const toolList = [...tools.values()];
    const emails: EmailPlan[] = [];
    let entryNextCheck: string | null = null;
    let pausedByRefusal = false;

    // `running` stays set until the thread and run log are written (it is released last, below), so
    // anything that sees the run finished sees all of it, and a delete can't race the last writes.
    await updateIndex((index) => {
      const cur = index.assignments[id];
      if (!cur) return;
      cur.updatedAt = nowIso;
      // Only run-owned fields change here; a pause, close or brief edit made mid-run wins.
      if (outcome === 'ok') {
        cur.consecutiveFailures = 0;
        cur.failureEmailedAt = null;
        let next = applied?.nextCheckAt ?? minutesFrom(now, cur.cadenceMinutes);
        if (applied) {
          cur.notes = applied.notes;
          cur.cadenceMinutes = applied.cadenceMinutes;
        }
        if (limitInfo?.status === 'allowed_warning') {
          const later = minutesFrom(now, LIMITS.quotaWarningDelayMinutes);
          if (later > next) {
            next = later;
            warnings.push('subscription near its limit; next check pushed back');
          }
        }
        if (cur.status === 'active') cur.nextCheckAt = next;
        const closing = applied?.closeOutcome && cur.status !== 'closed';
        if (closing) {
          cur.status = 'closed';
          cur.outcome = applied!.closeOutcome;
          cur.closedAt = nowIso;
          cur.nextCheckAt = null;
        }
        entryNextCheck = cur.nextCheckAt;
        if (applied?.notify && cur.counters.emails < LIMITS.emailsPerDay) {
          cur.counters.emails += 1;
          cur.unread += 1;
          emails.push({
            subject: `${cur.title}: ${applied.notify.subject}`,
            markdown: applied.notify.body,
            changes: toolList,
            nextCheckAt: cur.nextCheckAt,
            assignmentId: id,
          });
        } else if (applied?.notify) {
          warnings.push(`email skipped: daily limit of ${LIMITS.emailsPerDay}`);
        }
        if (closing) {
          cur.unread += 1;
          emails.push({
            subject: `${cur.title}: closed`,
            markdown: `**Assignment closed.** ${applied!.closeOutcome}\n\n${replyText.trim()}`,
            changes: toolList,
            nextCheckAt: null,
            assignmentId: id,
          });
        }
      } else if (outcome === 'rate-limited') {
        const reset = resetIso(limitInfo?.resetsAt);
        if (cur.status === 'active') {
          cur.nextCheckAt =
            reset && reset > nowIso ? reset : minutesFrom(now, LIMITS.minIntervalMinutes);
        }
        entryNextCheck = cur.nextCheckAt;
      } else if (outcome === 'account') {
        const newlyPaused = !index.pausedAll;
        index.pausedAll = true;
        index.pausedAllReason = `Claude account problem: ${error}`;
        entryNextCheck = cur.nextCheckAt;
        if (newlyPaused) {
          emails.push({
            subject: 'Assignments paused: Claude account problem',
            markdown: `Every assignment is paused because a check-in for **${cur.title}** failed with \`${error}\`. Fix the Claude sign-in or billing in Settings, then press **Resume all** on the Assignments page.`,
            changes: [],
            nextCheckAt: null,
            assignmentId: id,
          });
        }
      } else if (outcome === 'refused') {
        cur.consecutiveFailures += 1;
        // The pause is what stops the retries. A pause or close made mid-run stands, and a refused
        // Run now on an already-paused assignment has no new pause to report.
        pausedByRefusal = cur.status === 'active';
        if (pausedByRefusal) {
          cur.status = 'paused';
          cur.nextCheckAt = null;
          cur.unread += 1;
          emails.push({
            subject: `${cur.title}: paused, Anthropic refused the check-in`,
            markdown: `Anthropic's API refused a check-in, so the assignment is paused instead of retrying: the next check-in would send nearly the same request.\n\n${quoted(error ?? '')}\n\nIf the error has a request ID, Anthropic support can look the request up by it. Resume the assignment in DocVault once the cause is fixed.`,
            changes: [],
            nextCheckAt: null,
            assignmentId: id,
          });
        }
        entryNextCheck = cur.nextCheckAt;
      } else {
        cur.consecutiveFailures += 1;
        const backoff =
          LIMITS.failureBackoffMinutes[
            Math.min(cur.consecutiveFailures, LIMITS.failureBackoffMinutes.length) - 1
          ];
        if (cur.status === 'active') cur.nextCheckAt = minutesFrom(now, backoff);
        entryNextCheck = cur.nextCheckAt;
        if (cur.consecutiveFailures >= LIMITS.failureEmailAfter && !cur.failureEmailedAt) {
          cur.failureEmailedAt = nowIso;
          cur.unread += 1;
          emails.push({
            subject: `${cur.title}: can't run`,
            markdown: `The last ${cur.consecutiveFailures} check-ins failed. Latest error: \`${error}\`. It keeps retrying on a longer delay; open it in DocVault to see the details.`,
            changes: [],
            nextCheckAt: cur.nextCheckAt,
            assignmentId: id,
          });
        }
      }
      cur.lastRun = {
        runId,
        at: nowIso,
        trigger,
        ok: outcome === 'ok',
        headline: applied?.headline ?? null,
        emailed: emails.length > 0,
        error,
      };
    }, deps.dataDir);
    if (outcome === 'refused') {
      log.warn(
        `[run] refused assignment=${id} run=${runId}: ${pausedByRefusal ? 'paused, no retry' : 'already paused or closed'}`
      );
    }

    // Send before recording, so "emailed" in the thread and the run log means it actually went out.
    let delivered = 0;
    for (const plan of emails) {
      const failure = await deliver(deps, plan, context.timeZone);
      if (failure) warnings.push(`email failed: ${failure}`);
      else delivered += 1;
    }

    const nextLabel = entryNextCheck
      ? `Next check ${formatLocal(entryNextCheck, context.timeZone)}.`
      : '';
    await appendEntries(
      id,
      [
        outcome === 'ok'
          ? {
              id: newId(),
              at: nowIso,
              kind: trigger === 'message' ? 'reply' : 'check-in',
              markdown: replyText.trim() || applied?.headline || '(no reply text)',
              runId,
              trigger,
              tools: toolList,
              headline: applied?.headline,
              emailed: delivered > 0,
              nextCheckAt: entryNextCheck,
            }
          : {
              id: newId(),
              at: nowIso,
              kind: 'system',
              markdown:
                outcome === 'rate-limited'
                  ? `Skipped: the Claude usage limit was reached. ${nextLabel}`
                  : outcome === 'account'
                    ? `Failed: ${error}. Every assignment is paused until you fix the Claude account in Settings and press Resume all.`
                    : outcome === 'refused'
                      ? `Anthropic's API refused this check-in, so it won't be retried on its own: the next check-in would send nearly the same request. Resume the assignment once the cause is fixed.\n\n${quoted(error ?? '')}`
                      : `Check-in failed: ${error}. ${nextLabel}`,
              runId,
              trigger,
              tools: toolList,
              nextCheckAt: entryNextCheck,
            },
      ],
      deps.dataDir
    );

    const durationMs = Math.round(performance.now() - t0);
    await appendRunLog(
      id,
      {
        runId,
        at: deps.now().toISOString(),
        event: 'end',
        outcome,
        durationMs,
        costUsd: turn.result?.total_cost_usd ?? null,
        emailed: delivered > 0,
        headline: applied?.headline ?? null,
        warnings,
        error,
      },
      deps.dataDir
    );
    await updateIndex((index) => {
      const cur = index.assignments[id];
      if (!cur) return;
      if (cur.running?.runId === runId) cur.running = null;
      if (cur.lastRun?.runId === runId && emails.length > 0 && delivered === 0) {
        cur.lastRun.emailed = false;
      }
    }, deps.dataDir);
    log.info(
      `[run] end assignment=${id} run=${runId} outcome=${outcome} tools=${toolList.length} emails=${delivered}/${emails.length} warnings=${warnings.length} in ${durationMs}ms`
    );
    return { status: outcome, runId, error };
  } finally {
    // Always released, so the tick sweep can recover a run that threw mid-way.
    inFlight.delete(id);
  }
}

/**
 * A run marked running with no process behind it (the server restarted mid-run). The next run is
 * told which writes it already made; the retry floor keeps a crash loop from burning quota.
 */
export async function recoverInterruptedRuns(
  deps: Pick<RunnerDeps, 'dataDir' | 'now'> = defaultRunnerDeps()
): Promise<number> {
  const now = deps.now();
  const stale: { id: string; runId: string; trigger: RunTrigger }[] = [];
  await updateIndex((index) => {
    for (const a of Object.values(index.assignments)) {
      if (!a.running || inFlight.has(a.id)) continue;
      const { runId, trigger } = a.running;
      stale.push({ id: a.id, runId, trigger });
      a.running = null;
      if (a.status === 'active') a.nextCheckAt = minutesFrom(now, LIMITS.retryFloorMinutes);
      a.lastRun = {
        runId,
        at: now.toISOString(),
        trigger,
        ok: false,
        headline: null,
        emailed: false,
        error: 'Interrupted by a server restart',
      };
      a.updatedAt = now.toISOString();
    }
  }, deps.dataDir);
  for (const s of stale) {
    await appendRunLog(
      s.id,
      {
        runId: s.runId,
        at: now.toISOString(),
        event: 'end',
        outcome: 'interrupted',
        durationMs: 0,
        costUsd: null,
        emailed: false,
        headline: null,
        warnings: [],
        error: 'Interrupted by a server restart',
      },
      deps.dataDir
    );
    await appendEntries(
      s.id,
      [
        {
          id: newId(),
          at: now.toISOString(),
          kind: 'system',
          markdown:
            'A check-in was interrupted by a server restart. The next one picks up where it left off and is told what it already changed.',
          runId: s.runId,
          trigger: s.trigger,
        },
      ],
      deps.dataDir
    );
    log.warn(`[recover] interrupted run=${s.runId} assignment=${s.id}`);
  }
  return stale.length;
}
