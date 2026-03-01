import { TemporalLevel, TEMPORAL_ORDER } from '../enums/temporal.js';

/**
 * Parsed representation of a temporal ltree path.
 *
 * Paths follow the format: year.YYYY.month.MM.week.WW.day.DD.conv.ID
 * Each segment is optional — a path can stop at any temporal level.
 */
export interface ParsedPath {
    /** The deepest temporal level present in this path. */
    level: TemporalLevel;

    /** Year component (e.g. 2026). Always present. */
    year: number;

    /** Month component (1-12). Present if level is month or deeper. */
    month?: number;

    /** Week-of-month component (1-5). Present if level is week or deeper. */
    week?: number;

    /** Day component (1-31). Present if level is day or deeper. */
    day?: number;

    /** Conversation ID. Present if level is conversation. */
    conversationId?: string;
}

/**
 * Calculates the week-of-month for a given date (1-5).
 *
 * Uses simple 7-day bucketing: days 1-7 = week 1, 8-14 = week 2, etc.
 * This keeps weeks deterministically nested within their parent month.
 *
 * @param date - The date to calculate the week for.
 * @returns The week number within the month (1-5).
 */
export function weekOfMonth(date: Date): number {
    return Math.ceil(date.getDate() / 7);
}

/**
 * Generates a unique conversation ID for use in ltree paths.
 *
 * Format: 8-character lowercase alphanumeric string prefixed with
 * a Unix timestamp in base-36 for natural chronological ordering.
 *
 * @returns A unique conversation identifier.
 */
export function generateConversationId(): string {
    const timestamp = Math.floor(Date.now() / 1000).toString(36),
        random = Math.random().toString(36).slice(2, 8);

    return `${timestamp}${random}`;
}

/**
 * Builds an ltree path string from temporal components.
 *
 * @param year - The year (e.g. 2026).
 * @param month - Optional month (1-12).
 * @param week - Optional week-of-month (1-5).
 * @param day - Optional day (1-31).
 * @param conversationId - Optional conversation ID.
 * @returns The ltree-formatted path string.
 *
 * @example
 * buildPath(2026) // "year.2026"
 * buildPath(2026, 2) // "year.2026.month.02"
 * buildPath(2026, 2, 4) // "year.2026.month.02.week.04"
 * buildPath(2026, 2, 4, 28) // "year.2026.month.02.week.04.day.28"
 * buildPath(2026, 2, 4, 28, 'abc123') // "year.2026.month.02.week.04.day.28.conv.abc123"
 */
export function buildPath(
    year: number,
    month?: number,
    week?: number,
    day?: number,
    conversationId?: string
): string {
    let path = `year.${year}`;

    if (month !== undefined) {
        path += `.month.${String(month).padStart(2, '0')}`;

        if (week !== undefined) {
            path += `.week.${String(week).padStart(2, '0')}`;

            if (day !== undefined) {
                path += `.day.${String(day).padStart(2, '0')}`;

                if (conversationId !== undefined) path += `.conv.${conversationId}`;
            }
        }
    }

    return path;
}

/**
 * Builds an ltree path from a Date object at the specified temporal level.
 *
 * Cannot build Conversation-level paths — conversations are episodic,
 * not derived from clock time. Use {@link generateConversationId} and
 * {@link buildPath} directly for conversation paths.
 *
 * @param date - The date to build a path from.
 * @param level - How deep to go in the temporal hierarchy.
 * @returns The ltree-formatted path string.
 * @throws If called with TemporalLevel.Conversation.
 */
export function buildPathFromDate(date: Date, level: TemporalLevel): string {
    const year = date.getFullYear(),
        month = date.getMonth() + 1,
        week = weekOfMonth(date),
        day = date.getDate();

    switch (level) {
        case TemporalLevel.Year:
            return buildPath(year);
        case TemporalLevel.Month:
            return buildPath(year, month);
        case TemporalLevel.Week:
            return buildPath(year, month, week);
        case TemporalLevel.Day:
            return buildPath(year, month, week, day);
        case TemporalLevel.Conversation:
            return buildPath(year, month, week, day, generateConversationId());
    }
}

/**
 * Parses an ltree path string into its temporal components.
 *
 * @param path - The ltree path to parse (e.g. "year.2026.month.02.week.04.day.28").
 * @returns Parsed path components, or null if the path is malformed.
 */
export function parsePath(path: string): ParsedPath | null {
    const segments = path.split('.');

    if (segments.length < 2 || segments[0] !== 'year') return null;

    const year = Number.parseInt(segments[1], 10);

    if (Number.isNaN(year)) return null;

    const result: ParsedPath = { level: TemporalLevel.Year, year };

    if (segments.length >= 4 && segments[2] === 'month') {
        const month = Number.parseInt(segments[3], 10);

        if (Number.isNaN(month) || month < 1 || month > 12) return null;

        result.level = TemporalLevel.Month;
        result.month = month;
    }

    if (segments.length >= 6 && segments[4] === 'week') {
        const week = Number.parseInt(segments[5], 10);

        if (Number.isNaN(week) || week < 1 || week > 5) return null;

        result.level = TemporalLevel.Week;
        result.week = week;
    }

    if (segments.length >= 8 && segments[6] === 'day') {
        const day = Number.parseInt(segments[7], 10);

        if (Number.isNaN(day) || day < 1 || day > 31) return null;

        result.level = TemporalLevel.Day;
        result.day = day;
    }

    if (segments.length >= 10 && segments[8] === 'conv') {
        if (!segments[9]) return null;

        result.level = TemporalLevel.Conversation;
        result.conversationId = segments[9];
    }

    return result;
}

/**
 * Gets the parent path by trimming the last two segments (level.value).
 *
 * @param path - The ltree path to get the parent of.
 * @returns The parent path, or null if this is already a root (year) path.
 */
export function getParentPath(path: string): string | null {
    const segments = path.split('.');

    if (segments.length <= 2) return null;

    return segments.slice(0, -2).join('.');
}

/**
 * Determines the temporal level of an ltree path by counting its segments.
 *
 * @param path - The ltree path to analyze.
 * @returns The temporal level, or null if the path is malformed.
 */
export function getPathLevel(path: string): TemporalLevel | null {
    const segments = path.split('.');
    const depth = Math.floor(segments.length / 2);

    if (depth < 1 || depth > TEMPORAL_ORDER.length) return null;

    return TEMPORAL_ORDER[depth - 1];
}

/**
 * Builds the "current" path for the current moment in time at each
 * non-episodic temporal level (Year through Day).
 *
 * Conversation is excluded because conversations are episodic —
 * they don't map deterministically from clock time.
 *
 * @param now - The reference time. Defaults to current time.
 * @returns An object mapping Year, Month, Week, and Day to their current paths.
 */
export function getCurrentPaths(
    now: Date = new Date()
): Record<Exclude<TemporalLevel, TemporalLevel.Conversation>, string> {
    return {
        [TemporalLevel.Year]: buildPathFromDate(now, TemporalLevel.Year),
        [TemporalLevel.Month]: buildPathFromDate(now, TemporalLevel.Month),
        [TemporalLevel.Week]: buildPathFromDate(now, TemporalLevel.Week),
        [TemporalLevel.Day]: buildPathFromDate(now, TemporalLevel.Day)
    };
}
