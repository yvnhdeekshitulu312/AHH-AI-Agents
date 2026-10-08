import type { Tool } from 'ai';
import type { ToolDeps } from '../core/types.js';
import { getDepartmentResults } from './getDepartmentResults.js';
import { getDiagnoses } from './getDiagnoses.js';
import { getLabResults } from './getLabResults.js';
import { getLabValues } from './getLabValues.js';
import { getPatientProfile } from './getPatientProfile.js';
import { getVisits } from './getVisits.js';
import { getVisitsByYear } from './getVisitsByYear.js';

/**
 * Shared tool library. Every agent picks a subset of these by name.
 * To add a tool: create a factory `(deps) => tool({...})` and register it here.
 */
export const toolCatalog = {
  getPatientProfile,
  getVisits,
  getVisitsByYear,
  getDiagnoses,
  getLabResults,
  getLabValues,
  getDepartmentResults,
} satisfies Record<string, (deps: ToolDeps) => Tool>;

export type ToolName = keyof typeof toolCatalog;

/** Short progress text shown in the chat while a tool runs (streaming endpoint). */
const statusLabels: Record<ToolName, string> = {
  getPatientProfile: 'Reading the patient profile',
  getVisits: 'Checking visits',
  getVisitsByYear: 'Counting visits',
  getDiagnoses: 'Checking diagnoses',
  getLabResults: 'Checking lab results',
  getLabValues: 'Reading lab values',
  getDepartmentResults: 'Checking radiology, cardiology and other results',
};

export function toolStatusLabel(name: string): string {
  return isToolName(name) ? statusLabels[name] : 'Checking the records';
}

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(toolCatalog, name);
}

/** Instantiates the agent's allowed tools, bound to the request's patient context. */
export function buildTools(names: readonly ToolName[], deps: ToolDeps): Record<string, Tool> {
  return Object.fromEntries(names.map((name) => [name, toolCatalog[name](deps)]));
}
