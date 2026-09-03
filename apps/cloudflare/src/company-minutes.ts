// The same fields are validated at save and consumed by the form/preview/export.
export const minutesFieldDefaults = {
  author: '', authorDepartment: '클레임센터', authorPosition: '',
  clientName: '', reportingDepartment: '클레임센터', referenceDepartments: '모든 부서',
  clientParticipants: '', attachmentName: '', meetingStartTime: '', meetingEndTime: '',
  participants: '', meetingTitle: ''
};
export type MinutesFields = typeof minutesFieldDefaults;

export function normalizeMinutesFields(value: unknown): MinutesFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(minutesFieldDefaults, key))) return null;
  const result = { ...minutesFieldDefaults };
  for (const key of Object.keys(result) as Array<keyof MinutesFields>) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || input[key].length > 2000) return null;
    result[key] = input[key].trim();
  }
  for (const key of ['meetingStartTime', 'meetingEndTime'] as const) {
    if (result[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result[key])) return null;
  }
  result.referenceDepartments ||= '모든 부서';
  return result;
}

export function minutesContent(rawNotes: string, savedNotes: string | undefined, summary: string | undefined): string {
  return rawNotes.trim() !== (savedNotes ?? '').trim() ? rawNotes : summary || rawNotes;
}
