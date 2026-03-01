/**
 * Authentication and user types for the TAMS memory system.
 *
 * TAMS uses token-based authentication where each user has one or more
 * API tokens. Tokens are stored as SHA-256 hashes in the database —
 * the plaintext is shown exactly once at creation time.
 */

/**
 * A registered TAMS user.
 *
 * Each user has their own isolated memory tree. All memory nodes are
 * scoped to a user via the `user_id` column.
 */
export interface TAMSUser {
    /** Unique identifier (UUID). */
    id: string;

    /** Display name. */
    name: string;

    /** Optional email address. Unique if provided. */
    email: string | null;

    /** When this user was registered. */
    createdAt: Date;
}

/**
 * An authentication token belonging to a user.
 *
 * The actual token string is never stored — only its SHA-256 hash.
 * The plaintext is returned exactly once when the token is created.
 */
export interface AuthToken {
    /** Unique identifier (UUID). */
    id: string;

    /** The user this token authenticates. */
    userId: string;

    /** A human-readable label (e.g. "MacBook", "iOS", "CI"). */
    label: string;

    /** When this token was last used to authenticate. Null if never used. */
    lastUsed: Date | null;

    /** When this token was created. */
    createdAt: Date;
}

/**
 * Parameters for creating a new TAMS user.
 */
export interface CreateUserParams {
    /** Display name. */
    name: string;

    /** Optional email address. Must be unique if provided. */
    email?: string;

    /** Optional fixed UUID. If omitted, the database generates one. */
    id?: string;
}

/**
 * The result of creating a new auth token.
 *
 * Contains the plaintext token (shown once) alongside the persisted
 * token metadata. The caller must save the plaintext — it cannot
 * be retrieved again.
 */
export interface CreateTokenResult {
    /** The plaintext token string (prefix: `tams_`). Save this — it cannot be retrieved again. */
    token: string;

    /** The persisted token metadata. */
    record: AuthToken;
}
