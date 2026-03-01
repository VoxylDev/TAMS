/**
 * Supported log levels, ordered by severity.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric priority for each log level. Higher = more severe. */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

/**
 * Simple structured logger for TAMS.
 *
 * Outputs timestamped, prefixed log messages to stdout/stderr.
 * Supports configurable minimum log level filtering.
 */
class Log {
    /** The minimum log level to output. Messages below this level are suppressed. */
    private minLevel: LogLevel = 'info';

    /**
     * Sets the minimum log level.
     * @param level - The minimum level to output.
     */
    public setLevel(level: LogLevel): void {
        this.minLevel = level;
    }

    /**
     * Logs a debug message. Used for development and troubleshooting.
     * @param message - The log message.
     * @param args - Additional data to log.
     */
    public debug(message: string, ...args: unknown[]): void {
        this.log('debug', message, ...args);
    }

    /**
     * Logs an informational message.
     * @param message - The log message.
     * @param args - Additional data to log.
     */
    public info(message: string, ...args: unknown[]): void {
        this.log('info', message, ...args);
    }

    /**
     * Logs a warning message.
     * @param message - The log message.
     * @param args - Additional data to log.
     */
    public warn(message: string, ...args: unknown[]): void {
        this.log('warn', message, ...args);
    }

    /**
     * Logs an error message.
     * @param message - The log message.
     * @param args - Additional data to log.
     */
    public error(message: string, ...args: unknown[]): void {
        this.log('error', message, ...args);
    }

    /**
     * Internal log method that handles level filtering and formatting.
     * @param level - The severity level of this message.
     * @param message - The log message.
     * @param args - Additional data to log.
     */
    private log(level: LogLevel, message: string, ...args: unknown[]): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

        const timestamp = new Date().toISOString(),
            prefix = `[${timestamp}] [TAMS] [${level.toUpperCase()}]`;

        // Always write to stderr to avoid polluting the MCP STDIO protocol on stdout.
        if (args.length > 0) console.error(prefix, message, ...args);
        else console.error(prefix, message);
    }
}

/**
 * Singleton logger instance used throughout the TAMS system.
 */
export default new Log();
