// Voice mode — speech-to-text for inbound voice memos, text-to-speech for
// spoken replies.
//
// WHY A THIRD-PARTY PROVIDER: Claude's API is text+vision only — it does not
// accept audio input or produce audio output. So voice genuinely requires a
// separate STT/TTS provider; there's no way to do this with the Anthropic key
// alone. Default is OpenAI because one key covers both directions (Whisper
// for STT, tts-1 for TTS), but the two functions below are the only
// integration points — swap them for Deepgram/ElevenLabs/AssemblyAI by
// rewriting just these.
//
// Voice mode is entirely optional: with no VOICE_API_KEY set, ECHO keeps
// working exactly as before (inbound voice memos are acknowledged with a
// note rather than transcribed, and replies stay text-only). It never
// silently half-works.

const VOICE_API_KEY = process.env.VOICE_API_KEY;
const STT_MODEL = process.env.VOICE_STT_MODEL ?? "whisper-1";
const TTS_MODEL = process.env.VOICE_TTS_MODEL ?? "tts-1";
const TTS_VOICE = process.env.VOICE_TTS_VOICE ?? "nova";
const OPENAI_BASE = "https://api.openai.com/v1";

export function isVoiceEnabled(): boolean {
  return Boolean(VOICE_API_KEY);
}

/**
 * Transcribes an inbound iMessage voice memo. iMessage voice memos arrive as
 * a normal `attachment` content arm with an `audio/*` mimeType (confirmed in
 * docs.photon.codes "Events"), so the bytes come from the same
 * `im.getAttachment(id, phone).read()` path images use.
 */
export async function transcribe(audio: Buffer, filename = "memo.m4a", mimeType = "audio/mp4"): Promise<string | null> {
  if (!VOICE_API_KEY) return null;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append("model", STT_MODEL);

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VOICE_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    console.error("STT failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json()) as { text?: string };
  return json.text?.trim() || null;
}

export interface SpokenReply {
  audio: Buffer;
  mimeType: string;
  /** Rough duration estimate in seconds — Spectrum uses it for the waveform UI. */
  duration: number;
}

/**
 * Renders a reply as speech. The text passed here should already be stripped
 * of markdown/emoji formatting (see `speakable()` below) — TTS reading
 * "asterisk asterisk URGENT asterisk asterisk" out loud is the classic way
 * this feature ends up feeling broken.
 */
export async function synthesize(spokenText: string): Promise<SpokenReply | null> {
  if (!VOICE_API_KEY) return null;

  const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VOICE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: spokenText.slice(0, 4000), response_format: "aac" }),
  });

  if (!res.ok) {
    console.error("TTS failed:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const audio = Buffer.from(await res.arrayBuffer());
  // ~150 wpm is normal speech; good enough for a waveform hint.
  const duration = Math.max(1, Math.round((spokenText.split(/\s+/).length / 150) * 60));
  return { audio, mimeType: "audio/aac", duration };
}

/**
 * Strips the markdown/emoji formatting that makes a brief readable on screen
 * but unlistenable out loud, and compresses it into something that works as
 * spoken audio.
 */
export function speakable(markdownText: string): string {
  return (
    markdownText
      .replace(/\*\*(.+?)\*\*/g, "$1") // bold
      .replace(/_(.+?)_/g, "$1") // italic
      .replace(/`(.+?)`/g, "$1") // code
      .replace(/^[•\-]\s*/gm, "") // bullets
      .replace(/^#+\s*/gm, "") // headings
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "") // emoji + variation selectors
      // Symbols TTS engines read out literally ("at-sign", "em-dash").
      .replace(/\s+@\s+/g, " at ")
      .replace(/\s+[—–]\s+/g, ", ")
      .replace(/\n{2,}/g, ". ") // paragraph breaks become sentence breaks
      .replace(/\n/g, ", ")
      .replace(/\s{2,}/g, " ")
      // A heading already ending in ':' shouldn't gain a '.' from the line
      // join above — "things stand:." reads as an audible stumble.
      .replace(/:\s*\./g, ":")
      .replace(/([.,])\s*[.,]/g, "$1") // collapse doubled punctuation
      .trim()
  );
}
