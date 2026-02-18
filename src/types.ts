/**
 * Represents a single network request with its lifecycle data
 */
export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
}

/**
 * Configuration options for the NetworkDebugger
 */
export interface NetworkDebuggerOptions {
  /** Log request/response headers to console (default: false) */
  logHeaders?: boolean;
  /** Log request body to console (default: true) */
  logBody?: boolean;
  /** Log response body to console (default: true) */
  logResponse?: boolean;
  /** Only log requests matching these URL patterns */
  filterUrls?: string[];
  /** Exclude requests matching these URL patterns */
  excludeUrls?: string[];
  /** Maximum body length to log (default: 5000) */
  maxBodyLength?: number;
  /** Use ANSI colors in console output (default: true) */
  colorize?: boolean;
}

/**
 * Message types sent from client to monitor
 */
export interface RequestMessage {
  type: 'request';
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  startTime: number;
}

export interface ResponseMessage {
  type: 'response';
  id: string;
  status: number;
  statusText?: string;
  duration: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

export interface ErrorMessage {
  type: 'error';
  id: string;
  error: string;
  duration?: number;
}

export type MonitorMessage = RequestMessage | ResponseMessage | ErrorMessage;

/**
 * Default configuration for NetworkDebugger
 */
export const DEFAULT_OPTIONS: NetworkDebuggerOptions = {
  logHeaders: false,
  logBody: true,
  logResponse: true,
  filterUrls: [],
  excludeUrls: ['symbolicate', 'hot-update', 'debugger-ui', '.js.map', 'localhost:8973'],
  maxBodyLength: 5000,
  colorize: true,
};

/**
 * Default WebSocket port for monitor communication
 */
export const DEFAULT_MONITOR_PORT = 8973;
