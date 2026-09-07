import "./db"; // schema init side-effect
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Spectrum, markdown, poll, edit, voice, app as appCard } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

import { upsertPerson, upsertThread, addThreadMember, normalizeAddress } from "./people";
import { alreadyProcessed, markProcessed, recordMessage, ingestTextMessage } from "./ingest";
import { checkAndFireWatches, registerWatch } from "./watches";
import { extractEventFromImage } from "./extract";
import { assessRisk, formatRiskAssessment, draftReplies, formatDrafts } from "./agents";
import { rememberFor, listMemories, pinMemory, forgetMemory, forgetThread, forgetEverythingFor, formatMemories } from "./memory";
import { logActivity, recentActivity, formatActivity } from "./activity";
import { getSettings, setAutonomyLevel, setPaused, isPaused } from "./settings";
import { echoSearch } from "./search";
import { transcribe, synthesize, speakable, isVoiceEnabled } from "./voice";
import {
  routeCommand,
  isCatchMeUpCommand,
  isWatchRegistration,
  isRememberCommand,
  isWhatDoYouRememberCommand,
  isPinMemoryCommand,
  isForgetConversationCommand,
  isForgetMemoryCommand,
  isDeleteEverythingCommand,
  isWhatHaveYouDoneCommand,
  isRiskCheckCommand,
  isReplyDraftCommand,
  isSearchCommand,
  isSetAutonomyCommand,
  isPauseCommand,
  isResumeCommand,
  isExportCommand,
  isSpeakCommand,
  looksLikeSharedConversation,
  formatConversationAnalysis,
  type Action,
} from "./router";
import {
  catchMeUp,
  prioritizeMyDay,
  openLoops,
  weeklyReview,
  knowledgeGraph,
  allDecisions,
  allPeopleWithStats,
  allThreads,
  recentOpportunities,
  exportDataFor,
  cleanupCandidates,
  stagePendingCleanup,
  resolvePendingCleanup,
  resolveAllPendingCleanup,
  stagePendingScreenshotEvent,
  confirmPendingScreenshotEvent,
  lastInboundText,
} from "./queries";
import { renderGraphCard } from "./cards/graph";
import { renderBriefCard } from "./cards/brief";
import { renderOrbCard, type OrbState } from "./cards/orb";
import { renderExportCard } from "./cards/export";
import { renderDashboard } from "./dashboard";
import { formatCatchMeUp, formatWeeklyReview } from "./format";

const PORT = Number(process.env.PORT ?? 3000);
const TOLERANCE_SEC = 5 * 60;

// Photon's dashboard and its docs disagree on prefixes (SPECTRUM_PROJECT_ID
// vs PROJECT_ID), so accept either rather than failing on a copy-paste.
const PROJECT_ID = process.env.SPECTRUM_PROJECT_ID ?? process.env.PROJECT_ID;
const PROJECT_SECRET = process.env.SPECTRUM_PROJECT_SECRET ?? process.env.PROJECT_SECRET;
const SIGNING_SECRET = process.env.SPECTRUM_SIGNING_SECRET;
// iMessage identifies people by phone number OR email — accept either, and
// accept the older PRIMARY_USER_PHONE name so existing .env files keep working.
const PRIMARY_USER_ADDRESS = process.env.PRIMARY_USER_ADDRESS ?? process.env.PRIMARY_USER_PHONE;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

// Fail loudly and specifically at boot rather than with a null-deref deep in
// a webhook handler an hour into the demo.
const missing = [
  !PROJECT_ID && "SPECTRUM_PROJECT_ID",
  !PROJECT_SECRET && "SPECTRUM_PROJECT_SECRET",
  !SIGNING_SECRET && "SPECTRUM_SIGNING_SECRET (register the webhook first — see README)",
  !process.env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
  !PRIMARY_USER_ADDRESS && "PRIMARY_USER_ADDRESS (your iMessage phone number or Apple ID email)",
].filter(Boolean);

function fatal(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (missing.length) {
  fatal("Missing required env vars in .env:\n" + missing.map((m) => `    - ${m}`).join("\n"));
}
// Accept E.164 (+14155551234) or an email (Apple ID) — iMessage supports both.
const isE164 = /^\+[1-9]\d{6,14}$/.test(PRIMARY_USER_ADDRESS!);
const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(PRIMARY_USER_ADDRESS!);
if (!isE164 && !isEmail) {
  fatal(
    `PRIMARY_USER_ADDRESS must be an E.164 phone number (+14155551234) or an email ` +
      `(you@example.com) — got "${PRIMARY_USER_ADDRESS}"`,
  );
}

// Past the guards above these are guaranteed present; the non-null assertions
// are what let the rest of the file treat them as plain strings.
const signingSecret: string = SIGNING_SECRET!;
const primaryUserAddress: string = normalizeAddress(PRIMARY_USER_ADDRESS!);
if (!process.env.PUBLIC_BASE_URL) {
  console.warn("  PUBLIC_BASE_URL not set — live cards will point at localhost and won't load on your phone.");
}

// ---- long-lived outbound Spectrum instance (see docs.photon.codes Quickstart) ----
const spectrum = await Spectrum({
  projectId: PROJECT_ID!,
  projectSecret: PROJECT_SECRET!,
  providers: [imessage.config()],
});
const im = imessage(spectrum);

// Resolved once — settings/pause are keyed to the primary user's person_id
// regardless of which thread a message arrives in.
const primaryUser = upsertPerson(primaryUserAddress, "You");

// Render's free filesystem is ephemeral — a restart wipes the SQLite file.
// Auto-seed when the DB comes up empty so a mid-demo restart self-heals
// instead of showing a blank ECHO. Set AUTO_SEED=false to disable.
if (process.env.AUTO_SEED !== "false") {
  const { isSeeded, seedDemoData } = await import("./seed");
  if (!isSeeded()) {
    console.log("Empty database detected — seeding demo data...");
    await seedDemoData();
  }
}

async function sendTo(address: string, actions: Action[]) {
  const user = await im.user(address);
  const space = await im.space.create(user);
  await sendActions(space, actions);
}

async function sendActions(space: Awaited<ReturnType<typeof im.space.create>>, actions: Action[]) {
  for (const action of actions) {
    if (action.kind === "markdown") {
      await space.send(markdown(action.markdown));
    } else if (action.kind === "card") {
      await space.send(appCard(`${PUBLIC_BASE_URL}${action.path}`, { live: true }));
    } else if (action.kind === "poll") {
      await space.send(poll(action.title, action.options));
    } else if (action.kind === "spoken") {
      // Text first so there's always a readable record, then the voice note.
      await space.send(markdown(action.markdown));
      const spoken = await synthesize(speakable(action.markdown));
      if (spoken) {
        await space.send(voice(spoken.audio, { mimeType: spoken.mimeType, name: "echo.aac", duration: spoken.duration }));
      }
    }
  }
}

function verifySignature(rawBody: string, timestamp: string | undefined, signature: string | undefined) {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- webhook ----
const web = new Hono();

web.post("/spectrum-webhook", async (c) => {
  const rawBody = await c.req.text();
  const eventHeader = c.req.header("X-Spectrum-Event");
  const timestamp = c.req.header("X-Spectrum-Timestamp");
  const signature = c.req.header("X-Spectrum-Signature");

  if (!eventHeader) return c.text("missing headers", 400);
  if (!verifySignature(rawBody, timestamp, signature)) return c.text("bad signature", 401);

  const payload = JSON.parse(rawBody);
  if (eventHeader !== "messages" && payload.event !== "messages") {
    return c.text("ok", 200); // forward-compatible: ignore event types we don't know yet
  }

  const messageId: string = payload.message.id;
  if (alreadyProcessed(messageId)) return c.text("ok", 200);
  markProcessed(messageId);

  // Ack fast, do the (slower) LLM + reply work after — see docs.photon.codes
  // Quickstart: the worker retries a slow-to-ack webhook as a timeout.
  void handleInbound(payload).catch((err) => console.error("handleInbound failed:", err));
  return c.text("ok", 200);
});

async function handleInbound(payload: any) {
  const space = payload.space;
  const message = payload.message;
  const senderAddress: string = message.sender.id;
  const content = message.content;

  const threadTitle = await resolveThreadTitle(space);
  const thread = upsertThread(space.id, space.type === "group" ? "group" : "dm", threadTitle);
  const sender = upsertPerson(senderAddress);
  addThreadMember(thread.id, sender.id);

  const isPrimaryUser = normalizeAddress(senderAddress) === primaryUserAddress;
  const isCommandChannel = isPrimaryUser && space.type === "dm";

  // Privacy Center: while paused, ECHO does nothing at all — no passive
  // extraction, no command replies — except recognize "resume" from the
  // primary user's own DM. Pausing is global, not per-thread: "pause ECHO"
  // means stop watching, not stop watching in this one conversation.
  if (isPaused(primaryUser.id)) {
    if (isCommandChannel && content.type === "text" && isResumeCommand(content.text)) {
      setPaused(primaryUser.id, false);
      logActivity("Resumed at your request", sender.id, "Orchestrator");
      await sendTo(sender.address, [{ kind: "markdown", markdown: "Resumed — back to normal." }]);
    }
    return;
  }

  switch (content.type) {
    case "text":
      await handleText(thread.id, threadTitle, sender, isCommandChannel, content.text);
      break;
    case "attachment":
      if (content.mimeType?.startsWith("image/")) {
        await handleImage(thread, sender, isCommandChannel, content, space.phone);
      } else if (content.mimeType?.startsWith("audio/")) {
        // iMessage voice memos arrive here, not as a distinct content arm —
        // confirmed in docs.photon.codes "Events".
        await handleAudio(thread, threadTitle, sender, isCommandChannel, content, space.phone);
      } else {
        recordMessage({ id: message.id, threadId: thread.id, senderPersonId: sender.id, direction: "inbound", contentType: "attachment", text: `[${content.name}]` });
      }
      break;
    case "poll_option":
      await handlePollOption(sender, content);
      break;
    default:
      // reaction, group, contact, richlink, or a future arm — ingested minimally, not commanded.
      recordMessage({ id: message.id, threadId: thread.id, senderPersonId: sender.id, direction: "inbound", contentType: "other", text: null });
      break;
  }
}

async function resolveThreadTitle(space: any): Promise<string> {
  try {
    const name = await im.getDisplayName(space);
    if (name) return name;
  } catch {
    // best-effort — falls through to a generic label
  }
  return space.type === "group" ? "Group chat" : `DM with ${space.phone ?? "unknown"}`;
}

async function handleText(
  threadId: string,
  threadTitle: string,
  sender: Awaited<ReturnType<typeof upsertPerson>>,
  isCommandChannel: boolean,
  textBody: string,
  /** True when this text came from a transcribed voice memo — ECHO answers
   *  in kind, so asking out loud gets you a spoken reply back. */
  replyWithVoice = false,
) {
  recordMessage({ id: crypto.randomUUID(), threadId, senderPersonId: sender.id, direction: "inbound", contentType: "text", text: textBody });

  // When the question arrived as speech, every text reply below is upgraded
  // to a spoken one at send time.
  const say = (m: string): Action => (replyWithVoice ? { kind: "spoken", markdown: m } : { kind: "markdown", markdown: m });

  // Commands needing the resolved sender's person_id (watch registration,
  // memory, privacy, risk/reply-draft) are handled directly here since the
  // pure router module doesn't have DB/person context — routeCommand()
  // covers everything that's a stateless query over existing data.
  if (isCommandChannel) {
    // "speak <command>" re-enters this same function with voice replies on.
    // Guarded against a "speak speak ..." loop by only unwrapping once.
    const spokenRequest = !replyWithVoice ? isSpeakCommand(textBody) : null;
    if (spokenRequest) {
      if (!isVoiceEnabled()) {
        await sendTo(sender.address, [{ kind: "markdown", markdown: "Voice mode isn't configured — set `VOICE_API_KEY` and I'll be able to talk back." }]);
        return;
      }
      await handleText(threadId, threadTitle, sender, isCommandChannel, spokenRequest, true);
      return;
    }

    // "Catch me up" gets the signature treatment: an instant orb card that
    // morphs in place into the real brief via Spectrum's verified edit()
    // API, rather than a static card sent cold.
    if (isCatchMeUpCommand(textBody)) {
      const user = await im.user(sender.address);
      const s = await im.space.create(user);
      const orbCard = await s.send(appCard(`${PUBLIC_BASE_URL}/card/orb?state=thinking`, { live: true }));
      await new Promise((resolve) => setTimeout(resolve, 900)); // deliberate reveal beat, not covering real latency — see README
      await s.send(edit(appCard(`${PUBLIC_BASE_URL}/card/brief`, { live: true }), orbCard));
      await sendActions(s, [say(formatCatchMeUp(catchMeUp()))]);
      logActivity("Generated the daily brief", sender.id, "Orchestrator");
      return;
    }

    const watchReq = isWatchRegistration(textBody);
    if (watchReq) {
      const result = registerWatch(sender.id, watchReq.name, watchReq.instruction);
      if (result.ok) {
        logActivity(`Registered a watch on ${result.threadTitle} for ${watchReq.name}'s next reply`, sender.id, "Follow-up Agent");
        await sendTo(sender.address, [say(`Got it — I'll watch **${result.threadTitle}** and let you know the moment ${watchReq.name} replies.`)]);
      } else if (result.reason === "person_not_found") {
        await sendTo(sender.address, [say(`I don't know anyone named "${watchReq.name}" yet — I only know people from threads I'm already part of.`)]);
      } else {
        await sendTo(sender.address, [say(`I'm not in a shared conversation with ${watchReq.name} yet — add me to a group with them first.`)]);
      }
      return;
    }

    const rememberContent = isRememberCommand(textBody);
    if (rememberContent) {
      const mem = rememberFor(sender.id, rememberContent);
      logActivity(`Remembered: ${rememberContent}`, sender.id, "Memory Agent");
      await sendTo(sender.address, [say(`Noted, filed under **${mem.category}**.`)]);
      return;
    }

    if (isWhatDoYouRememberCommand(textBody)) {
      await sendTo(sender.address, [say(formatMemories(listMemories(sender.id)))]);
      return;
    }

    const pinTarget = isPinMemoryCommand(textBody);
    if (pinTarget) {
      const ok = pinMemory(sender.id, pinTarget);
      await sendTo(sender.address, [say(ok ? "Pinned." : `Couldn't find a memory matching "${pinTarget}".`)]);
      return;
    }

    if (isForgetConversationCommand(textBody)) {
      forgetThread(threadId);
      logActivity(`Forgot everything from "${threadTitle}" at your request`, sender.id, "Memory Agent");
      await sendTo(sender.address, [say(`Forgotten — I've deleted everything I'd captured from **${threadTitle}**.`)]);
      return;
    }

    if (isDeleteEverythingCommand(textBody)) {
      forgetEverythingFor(sender.id);
      logActivity("Deleted everything at your request", sender.id, "Memory Agent");
      await sendTo(sender.address, [say("Done — your memories, commitments, and watches are deleted.")]);
      return;
    }

    const forgetTarget = isForgetMemoryCommand(textBody);
    if (forgetTarget) {
      const ok = forgetMemory(sender.id, forgetTarget);
      await sendTo(sender.address, [say(ok ? "Forgotten." : `Couldn't find a memory matching "${forgetTarget}".`)]);
      return;
    }

    if (isWhatHaveYouDoneCommand(textBody)) {
      await sendTo(sender.address, [say(formatActivity(recentActivity()))]);
      return;
    }

    const riskInline = isRiskCheckCommand(textBody);
    if (riskInline !== null) {
      const target = riskInline || lastInboundText(threadId) || "";
      if (!target) {
        await sendTo(sender.address, [say("Paste the message you want me to check, or forward it to me first.")]);
        return;
      }
      const assessment = await assessRisk(target);
      logActivity(`Ran a risk check (${assessment.risk_level})`, sender.id, "Risk Agent");
      await sendTo(sender.address, [say(formatRiskAssessment(assessment))]);
      return;
    }

    const replyReq = isReplyDraftCommand(textBody);
    if (replyReq) {
      const context = lastInboundText(threadId);
      if (!context) {
        await sendTo(sender.address, [say("I don't have a recent message to draft a reply to — forward one to me first.")]);
        return;
      }
      const drafts = await draftReplies({ context, tone: replyReq.tone });
      await sendTo(sender.address, [say(formatDrafts(drafts, replyReq.tone))]);
      return;
    }

    const searchQuestion = isSearchCommand(textBody);
    if (searchQuestion) {
      const orbCard = await sendOrbTo(sender.address, "thinking", "Searching what I know...");
      const answer = await echoSearch(searchQuestion);
      logActivity(`Answered a search: "${searchQuestion}"`, sender.id, "Orchestrator");
      await editOrbTo(sender.address, orbCard, "completed");
      await sendTo(sender.address, [say(answer)]);
      return;
    }

    const autonomyLevel = isSetAutonomyCommand(textBody);
    if (autonomyLevel) {
      setAutonomyLevel(sender.id, autonomyLevel);
      const labels = { 1: "Suggest only — I'll never write anything without asking.", 2: "Ask before acting — I'll confirm writes via a poll (this is the default).", 3: "Act automatically — low-risk writes happen immediately; check `what have you done` any time." };
      logActivity(`Autonomy level set to ${autonomyLevel}`, sender.id, "Orchestrator");
      await sendTo(sender.address, [say(`**Autonomy level ${autonomyLevel}.** ${labels[autonomyLevel]}`)]);
      return;
    }

    if (isPauseCommand(textBody)) {
      setPaused(sender.id, true);
      logActivity("Paused at your request", sender.id, "Orchestrator");
      await sendTo(sender.address, [say("Paused — I won't process or reply to anything until you say **resume**.")]);
      return;
    }

    if (isExportCommand(textBody)) {
      logActivity("Exported data at your request", sender.id, "Memory Agent");
      await sendTo(sender.address, [{ kind: "card", path: `/card/export?person=${encodeURIComponent(sender.id)}` }]);
      return;
    }

    const commandActions = await routeCommand(textBody);
    if (commandActions) {
      const level = getSettings(sender.id).autonomy_level;
      const isCleanup = commandActions.some((a) => a.kind === "poll" && a.title === "Mark these resolved?");

      // Same three-tier rule as the screenshot flow — level 1 never writes,
      // level 2 confirms via poll, level 3 applies immediately.
      if (isCleanup && level === 1) {
        const described = commandActions.filter((a) => a.kind !== "poll");
        await sendTo(sender.address, [
          ...described,
          { kind: "markdown", markdown: `_Autonomy level 1 — I'm not changing anything. Say "autonomy 2" to let me confirm-and-clean._` },
        ]);
        return;
      }

      if (isCleanup && level === 3) {
        stagePendingCleanup(sender.id, cleanupCandidates());
        const total = resolveAllPendingCleanup(sender.id);
        logActivity(`Auto-resolved ${total} stale item(s) (autonomy level 3)`, sender.id, "Commitment Agent");
        await sendTo(sender.address, [say(`Cleaned up ${total} stale item${total === 1 ? "" : "s"} automatically (autonomy level 3). ✨`)]);
        return;
      }

      if (isCleanup) stagePendingCleanup(sender.id, cleanupCandidates());
      const user = await im.user(sender.address);
      const s = await im.space.create(user);
      await sendActions(s, commandActions);
      return;
    }
  }

  // Every text message ECHO sees gets run through the extraction engine —
  // this is the continuous "life context" ingestion, real whether it's a
  // command channel or a group thread ECHO silently listens in.
  const result = await ingestTextMessage({ messageId: crypto.randomUUID(), threadId, threadTitle, senderName: sender.name, senderPersonId: sender.id, text: textBody });

  if (isCommandChannel && looksLikeSharedConversation(textBody)) {
    const analysis = formatConversationAnalysis(result);
    if (analysis) await sendTo(sender.address, [say(analysis)]);
  }

  // Fire any watch waiting on this sender in this thread — proactively DMs
  // the requester, who may be in a completely different conversation.
  const fired = await checkAndFireWatches({ threadId, senderPersonId: sender.id, messageText: textBody, threadTitle });
  for (const f of fired) {
    logActivity(`${sender.name} replied in "${threadTitle}" — fired a watch and briefed the requester`, sender.id, "Follow-up Agent");
    await sendTo(f.requesterAddress, [say(`**${threadTitle} update:**\n${f.briefing}`)]);
  }
}

/**
 * Voice mode, inbound half. A voice memo is transcribed and then routed
 * through the exact same command pipeline a typed message uses — so every
 * command works spoken with no per-command work, and the reply comes back
 * as speech too (`replyWithVoice`).
 */
async function handleAudio(
  thread: { id: string },
  threadTitle: string,
  sender: Awaited<ReturnType<typeof upsertPerson>>,
  isCommandChannel: boolean,
  content: any,
  spacePhone: string,
) {
  if (!isVoiceEnabled()) {
    recordMessage({ id: crypto.randomUUID(), threadId: thread.id, senderPersonId: sender.id, direction: "inbound", contentType: "attachment", text: `[voice memo: ${content.name}]` });
    if (isCommandChannel) {
      await sendTo(sender.address, [{ kind: "markdown", markdown: "I got your voice memo, but voice mode isn't configured — set `VOICE_API_KEY` and I'll be able to listen." }]);
    }
    return;
  }

  const orbCard = isCommandChannel ? await sendOrbTo(sender.address, "listening", "Listening to your voice memo...") : null;

  const file = await im.getAttachment(content.id, spacePhone);
  if (!file) {
    if (orbCard) await editOrbTo(sender.address, orbCard, "alert");
    if (isCommandChannel) await sendTo(sender.address, [{ kind: "markdown", markdown: "I couldn't fetch that voice memo — can you resend it?" }]);
    return;
  }

  const transcript = await transcribe(await file.read(), content.name ?? "memo.m4a", content.mimeType);
  if (!transcript) {
    if (orbCard) await editOrbTo(sender.address, orbCard, "alert");
    if (isCommandChannel) await sendTo(sender.address, [{ kind: "markdown", markdown: "I couldn't make out that voice memo — mind trying again?" }]);
    return;
  }

  logActivity(`Transcribed a voice memo: "${transcript.slice(0, 60)}${transcript.length > 60 ? "…" : ""}"`, sender.id, "Extraction Agent");
  if (orbCard) await editOrbTo(sender.address, orbCard, "thinking");

  // Route the transcript exactly as if it had been typed, and answer aloud.
  await handleText(thread.id, threadTitle, sender, isCommandChannel, transcript, true);
}

async function handleImage(thread: { id: string }, sender: Awaited<ReturnType<typeof upsertPerson>>, isCommandChannel: boolean, content: any, spacePhone: string) {
  recordMessage({ id: crypto.randomUUID(), threadId: thread.id, senderPersonId: sender.id, direction: "inbound", contentType: "attachment", text: `[image: ${content.name}]` });
  if (!isCommandChannel) return; // screenshot→event only runs in the command channel

  const orbCard = await sendOrbTo(sender.address, "working", "Reading the image...");

  const file = await im.getAttachment(content.id, spacePhone);
  if (!file) {
    await editOrbTo(sender.address, orbCard, "alert");
    await sendTo(sender.address, [{ kind: "markdown", markdown: "I couldn't fetch that image — can you resend it?" }]);
    return;
  }
  const bytes = await file.read();
  const found = await extractEventFromImage({ imageBase64: bytes.toString("base64"), mimeType: content.mimeType, now: new Date().toISOString() });

  if (!found.found) {
    await editOrbTo(sender.address, orbCard, "alert");
    await sendTo(sender.address, [{ kind: "markdown", markdown: "I looked at that image but couldn't find a clear event in it." }]);
    return;
  }

  logActivity(`Extracted an event from a screenshot: ${found.title}`, sender.id, "Screenshot Agent");
  await editOrbTo(sender.address, orbCard, "completed");

  const summary = `**Found an event:** ${found.title}${found.starts_at ? `\n${new Date(found.starts_at).toLocaleString()}` : ""}${found.location ? `\n📍 ${found.location}` : ""}`;
  const level = getSettings(sender.id).autonomy_level;

  // Autonomy level genuinely changes what happens here, it isn't a label:
  //   1 — describe the finding, write nothing, don't even offer
  //   2 — stage it and confirm via a real poll (default)
  //   3 — write it immediately; the activity log is the receipt
  if (level === 1) {
    await sendTo(sender.address, [
      { kind: "markdown", markdown: `${summary}\n\n_Autonomy level 1 — I'm not saving this. Say "autonomy 2" if you'd like me to start asking._` },
    ]);
    return;
  }

  if (level === 3) {
    stagePendingScreenshotEvent(sender.id, found);
    confirmPendingScreenshotEvent(sender.id);
    logActivity("Auto-added a screenshot-detected event (autonomy level 3)", sender.id, "Screenshot Agent");
    await sendTo(sender.address, [{ kind: "markdown", markdown: `${summary}\n\n_Added automatically (autonomy level 3)._` }]);
    return;
  }

  stagePendingScreenshotEvent(sender.id, found);
  await sendTo(sender.address, [
    { kind: "markdown", markdown: summary },
    { kind: "poll", title: "Add this to your schedule?", options: ["Yes, add it", "No, ignore"] },
  ]);
}

async function handlePollOption(sender: Awaited<ReturnType<typeof upsertPerson>>, content: any) {
  const optionTitle: string = content.option?.title ?? content.title;
  const pollTitle: string = content.poll?.title ?? "";

  if (pollTitle === "Mark these resolved?") {
    if (optionTitle !== "None of these") {
      resolvePendingCleanup(sender.id, optionTitle);
      logActivity(`Marked resolved (cleanup): ${optionTitle}`, sender.id, "Commitment Agent");
    }
    await sendTo(sender.address, [{ kind: "markdown", markdown: "Cleaned up. ✨" }]);
    return;
  }

  if (pollTitle === "Add this to your schedule?") {
    if (optionTitle === "Yes, add it") {
      confirmPendingScreenshotEvent(sender.id);
      logActivity("Added a screenshot-detected event to the schedule", sender.id, "Screenshot Agent");
      await sendTo(sender.address, [{ kind: "markdown", markdown: "Added to your schedule. I'll surface it in your daily brief." }]);
    }
    return;
  }
}

// ---- orb helpers (send-then-edit-in-place, shared by the "catch me up",
// search, and screenshot flows) ----
async function sendOrbTo(address: string, state: OrbState, message?: string) {
  const user = await im.user(address);
  const s = await im.space.create(user);
  return s.send(appCard(`${PUBLIC_BASE_URL}/card/orb?state=${state}${message ? `&message=${encodeURIComponent(message)}` : ""}`, { live: true }));
}
async function editOrbTo(address: string, card: Awaited<ReturnType<typeof sendOrbTo>>, state: OrbState) {
  const user = await im.user(address);
  const s = await im.space.create(user);
  await s.send(edit(appCard(`${PUBLIC_BASE_URL}/card/orb?state=${state}`, { live: true }), card));
}

// ---- live iMessage App cards ----
web.get("/card/graph", (c) => {
  const { nodes, edges } = knowledgeGraph();
  return c.html(renderGraphCard(nodes, edges));
});

web.get("/card/brief", (c) => c.html(renderBriefCard(catchMeUp())));

web.get("/card/orb", (c) => {
  const state = (c.req.query("state") as OrbState) || "thinking";
  const message = c.req.query("message");
  return c.html(renderOrbCard(state, message));
});

web.get("/card/export", (c) => {
  const personId = c.req.query("person");
  if (!personId) return c.text("missing person", 400);
  return c.html(renderExportCard(exportDataFor(personId)));
});

// ---- ECHO Command Center (real, reads the same live DB — see src/dashboard.ts) ----
web.get("/dashboard", (c) => {
  const hour = new Date().getHours();
  const greeting = (hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.") + " Here's everything.";
  const loops = openLoops();
  const review = weeklyReview();
  return c.html(
    renderDashboard({
      greeting,
      today: prioritizeMyDay(),
      memories: listMemories(primaryUser.id),
      openCommitments: loops.commitments,
      openQuestions: loops.questions,
      people: allPeopleWithStats(),
      threads: allThreads(),
      opportunities: recentOpportunities(),
      decisions: allDecisions(),
      activity: recentActivity(30),
      stats: { completed: review.completed.length, stillOpen: review.stillOpen.length, overdue: review.overdue.length, decisionsMade: review.decisionsMade.length },
    }),
  );
});

web.get("/", (c) => c.text("echo is running"));

// Bun serves via `export default { port, fetch }`; Node needs an explicit
// server. Supporting both keeps `bun run dev` working locally while letting
// this deploy to Node-only hosts (Render has no Bun runtime).
if (typeof (globalThis as any).Bun === "undefined") {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: web.fetch, port: PORT });
}

console.log(`echo listening on :${PORT}`);
console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
console.log(`Dashboard: ${PUBLIC_BASE_URL}/dashboard`);

export default { port: PORT, fetch: web.fetch };
