export const MAX_QUESTION_CHARS = 500;

export type InputCheck =
  | { ok: true; question: string }
  | { ok: false; reason: string; userMessage: string };

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|rules|prompts?|guidelines|system)\b/i,
  /\b(reveal|show|print|repeat|output)\b.{0,30}\b(system prompt|instructions|your prompt|hidden prompt)\b/i,
  /\byou are now\b/i,
  /\b(jailbreak|DAN mode|developer mode)\b/i,
  /<\/?(system|assistant|im_start|im_end)>/i,
];

const OTHER_PATIENT_PATTERNS: RegExp[] = [
  /\b(another|other|different|second)\s+patient\b/i,
  /\bpatient\s*(id|uhid|no\.?|number|file)\s*[:#]?\s*[A-Za-z.]*\d{4,}/i,
  /\bpatient\s*[:#]?\s*\d{4,}\b/i,
  /\buhid\s*[:#]?\s*[A-Za-z.]*\d{4,}/i,
  // Saudi national ID / iqama format (10 digits starting with 1 or 2).
  /\b[12]\d{9}\b/,
];

const OTHER_PATIENT_MESSAGE = 'This assistant only answers questions about the currently selected patient.';

/**
 * Cheap, deterministic checks before any LLM call.
 * Off-topic questions are handled by the system prompt, not here.
 */
export function checkInput(raw: string): InputCheck {
  const question = raw.replace(/\s+/g, ' ').trim();

  if (question.length === 0) {
    return { ok: false, reason: 'empty', userMessage: 'Please enter a question.' };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      reason: 'too_long',
      userMessage: `Please keep the question under ${MAX_QUESTION_CHARS} characters.`,
    };
  }
  if (INJECTION_PATTERNS.some((p) => p.test(question))) {
    return {
      ok: false,
      reason: 'prompt_injection',
      userMessage: 'This question cannot be processed. Please ask about the patient\'s history.',
    };
  }
  if (OTHER_PATIENT_PATTERNS.some((p) => p.test(question))) {
    return { ok: false, reason: 'other_patient', userMessage: OTHER_PATIENT_MESSAGE };
  }
  return { ok: true, question };
}
