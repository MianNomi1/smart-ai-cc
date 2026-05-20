type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogContext {
  contactId?: string;
  service?: string;
  [key: string]: unknown;
}

class Logger {
  private context: LogContext = {};

  setContext(ctx: LogContext): void {
    this.context = { ...this.context, ...ctx };
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("DEBUG", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("INFO", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("WARN", message, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log("ERROR", message, {
      ...data,
      errorName: error?.name,
      errorMessage: error?.message,
      stackTrace: error?.stack,
    });
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };
    const output = JSON.stringify(entry);

    switch (level) {
      case "ERROR":
        console.error(output);
        break;
      case "WARN":
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }
}

export const logger = new Logger();
