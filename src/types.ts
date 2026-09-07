export interface Person {
  id: string;
  name: string;
  /** Phone number or email — iMessage addresses users by either. */
  address: string;
  first_seen: string;
  last_seen: string;
}

export type ThreadKind = "dm" | "group";

export interface Thread {
  id: string; // Spectrum space id
  kind: ThreadKind;
  title: string;
}

export type ContentType = "text" | "attachment" | "poll_option" | "reaction" | "other";

export interface StoredMessage {
  id: string;
  thread_id: string;
  sender_person_id: string | null;
  direction: "inbound" | "outbound";
  content_type: ContentType;
  text: string | null;
  created_at: string;
}

export type CommitmentOwner = "me" | string; // "me" or a person_id (they owe it)
export type CommitmentStatus = "open" | "done" | "overdue";

export interface Commitment {
  id: number;
  message_id: string | null;
  thread_id: string;
  owner: CommitmentOwner;
  description: string;
  due_at: string | null;
  status: CommitmentStatus;
  source_excerpt: string | null;
  urgency: number | null; // 1-5, see urgency_reason — nullable because not every write path scores (e.g. cleanup edits don't re-score)
  urgency_reason: string | null;
  confidence: number | null; // 1-5
  created_at: string;
  resolved_at: string | null;
}

export interface LifeEvent {
  id: number;
  message_id: string | null;
  thread_id: string | null;
  title: string;
  starts_at: string | null;
  location: string | null;
  source: "text" | "screenshot";
  importance: number | null; // 1-5, see importance_reason
  importance_reason: string | null;
  created_at: string;
}

export interface Decision {
  id: number;
  topic: string;
  decision_text: string;
  rationale: string | null;
  thread_id: string;
  created_at: string;
}

export type QuestionStatus = "open" | "answered";

export interface OpenQuestion {
  id: number;
  question_text: string;
  asked_by: string | null; // person_id
  thread_id: string;
  status: QuestionStatus;
  created_at: string;
  answered_at: string | null;
}

export interface Opportunity {
  id: number;
  message_id: string | null;
  thread_id: string;
  description: string;
  confidence: number | null;
  confidence_reason: string | null;
  created_at: string;
}

export type WatchStatus = "pending" | "fired" | "cancelled";

export interface Watch {
  id: number;
  requester_person_id: string;
  target_thread_id: string;
  target_person_id: string | null;
  instruction: string;
  status: WatchStatus;
  created_at: string;
  fired_at: string | null;
}

/** Structured output the extraction engine produces for one message. */
export interface ExtractionResult {
  commitments: Array<{
    owner: "me" | "them";
    description: string;
    due_at: string | null;
    urgency: number; // 1-5, explainable — see urgency_reason
    urgency_reason: string;
    confidence: number; // 1-5, how sure the extractor is this is a real commitment
  }>;
  events: Array<{
    title: string;
    starts_at: string | null;
    location: string | null;
    importance: number; // 1-5
    importance_reason: string;
  }>;
  decisions: Array<{
    topic: string;
    decision_text: string;
    rationale: string | null;
  }>;
  open_questions: Array<{
    question_text: string;
  }>;
  opportunities: Array<{
    description: string;
    confidence: number; // 1-5 — how likely this is a genuine opportunity, not a stretch
    confidence_reason: string;
  }>;
}
