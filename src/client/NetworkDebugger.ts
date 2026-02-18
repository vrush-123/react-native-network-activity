/**
 * NetworkDebugger - Network monitoring client for React Native
 *
 * Intercepts fetch and XMLHttpRequest calls and sends them to the terminal monitor.
 *
 * @example
 * // In your React Native app (App.tsx or index.js)
 * import { NetworkDebugger } from 'react-native-network-activity';
 *
 * if (__DEV__) {
 *   NetworkDebugger.enableRemote();
 * }
 */

import {
  NetworkRequest,
  NetworkDebuggerOptions,
  DEFAULT_OPTIONS,
  DEFAULT_MONITOR_PORT,
  MonitorMessage,
} from '../types';

// Try to get Platform from react-native, but don't fail if not available
let Platform: { OS: string } | null = null;
try {
  Platform = require('react-native').Platform;
} catch {
  // Not in React Native environment
}

class NetworkDebuggerClass {
  private enabled = false;
  private remoteEnabled = false;
  private options: NetworkDebuggerOptions = { ...DEFAULT_OPTIONS };
  private requests: Map<string, NetworkRequest> = new Map();
  private originalFetch: typeof fetch | null = null;
  private requestId = 0;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: MonitorMessage[] = [];
  private wsConnected = false;

  /**
   * Enable network debugging with console logging
   */
  enable(options: NetworkDebuggerOptions = {}): void {
    if (this.enabled) {
      return;
    }

    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.enabled = true;
    this.interceptFetch();
    this.interceptXHR();
  }

  /**
   * Disable network debugging
   */
  disable(): void {
    if (!this.enabled) return;

    if (this.originalFetch) {
      (global as any).fetch = this.originalFetch;
      this.originalFetch = null;
    }

    this.enabled = false;
    this.requests.clear();
    this.disconnectRemote();
  }

  /**
   * Enable remote monitoring - sends network events to the terminal monitor
   *
   * @param host - Host to connect to. Auto-detected if not provided:
   *               - iOS Simulator: localhost
   *               - Android Emulator: 10.0.2.2
   *               - Physical device: Pass your computer's IP address
   * @param port - Port number (default: 8973)
   *
   * @example
   * // Auto-detect host (works for simulators/emulators)
   * NetworkDebugger.enableRemote();
   *
   * // Physical device - use your computer's IP
   * NetworkDebugger.enableRemote('192.168.1.100');
   *
   * // Custom port
   * NetworkDebugger.enableRemote('localhost', 9000);
   */
  enableRemote(host?: string, port: number = DEFAULT_MONITOR_PORT): void {
    if (this.remoteEnabled) {
      return;
    }

    // Validate port range
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.warn(
        '[NetworkDebugger] Invalid port number. Port must be between 1 and 65535. Using default port.',
      );
      port = DEFAULT_MONITOR_PORT;
    }

    // Auto-detect host based on platform if not provided
    let resolvedHost = host;
    if (!resolvedHost) {
      if (Platform?.OS === 'android') {
        // Android emulator uses 10.0.2.2 to reach host machine
        resolvedHost = '10.0.2.2';
      } else {
        // iOS simulator or default
        resolvedHost = 'localhost';
      }
    }

    // Basic host validation (prevent obvious injection)
    if (typeof resolvedHost !== 'string' || resolvedHost.length > 253) {
      console.warn('[NetworkDebugger] Invalid host. Using localhost.');
      resolvedHost = 'localhost';
    }

    // Security warning for production use
    // Note: __DEV__ is a React Native global, check if it exists and is false
    if (typeof (global as any).__DEV__ !== 'undefined' && !(global as any).__DEV__) {
      console.warn(
        '[NetworkDebugger] WARNING: Network monitoring should only be enabled in development mode. ' +
          'Disabling remote monitoring to prevent security risks.',
      );
      return;
    }

    // Enable the main debugger if not already enabled (remote-only mode)
    if (!this.enabled) {
      this.enable({ logHeaders: false, logBody: false, logResponse: false });
    }

    this.remoteEnabled = true;
    this.connectToRemote(resolvedHost, port);
  }

  /**
   * Disable remote monitoring only (keeps local debugging if enabled)
   */
  disableRemote(): void {
    this.disconnectRemote();
  }

  private connectToRemote(host: string, port: number): void {
    try {
      const wsUrl = `ws://${host}:${port}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.wsConnected = true;

        // Flush any queued messages
        if (this.messageQueue.length > 0) {
          for (const msg of this.messageQueue) {
            this.sendToRemote(msg);
          }
          this.messageQueue = [];
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.wsConnected = false;

        // Attempt reconnect if still enabled
        if (this.remoteEnabled) {
          this.wsReconnectTimer = setTimeout(() => {
            this.connectToRemote(host, port);
          }, 3000);
        }
      };

      this.ws.onerror = () => {
        // Errors handled by onclose
      };
    } catch {
      // Connection failed, will retry
    }
  }

  private disconnectRemote(): void {
    this.remoteEnabled = false;
    this.wsConnected = false;
    this.messageQueue = [];
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private sendToRemote(data: MonitorMessage): void {
    // Queue message if not connected yet
    if (!this.wsConnected || !this.ws) {
      if (this.remoteEnabled && this.messageQueue.length < 100) {
        this.messageQueue.push(data);
      }
      return;
    }

    try {
      // WebSocket.OPEN = 1
      if (this.ws.readyState === 1) {
        const message = JSON.stringify(data);
        // Limit message size to prevent memory issues (10MB max)
        const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;
        if (message.length > MAX_MESSAGE_SIZE) {
          console.warn('[NetworkDebugger] Message too large, truncating body');
          // Truncate response body if present
          if ('responseBody' in data && data.responseBody) {
            const truncated = data.responseBody.substring(0, MAX_MESSAGE_SIZE - message.length + data.responseBody.length);
            data.responseBody = truncated + '... [truncated]';
          }
        }
        this.ws.send(JSON.stringify(data));
      }
    } catch (error) {
      // Send failed - silently fail to avoid disrupting app
      // Only log in development mode if __DEV__ is available
      if (typeof (global as any).__DEV__ !== 'undefined' && (global as any).__DEV__) {
        console.warn('[NetworkDebugger] Failed to send message to monitor:', error);
      }
    }
  }

  private generateId(): string {
    return `req_${++this.requestId}_${Date.now()}`;
  }

  private shouldLog(url: string): boolean {
    // Check exclusions first
    if (this.options.excludeUrls?.length) {
      for (const pattern of this.options.excludeUrls) {
        if (url.toLowerCase().includes(pattern.toLowerCase())) {
          return false;
        }
      }
    }

    // If filter list is empty, log all
    if (!this.options.filterUrls?.length) {
      return true;
    }

    // Check if URL matches any filter
    for (const pattern of this.options.filterUrls) {
      if (url.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  private truncateBody(body: string | undefined): string {
    if (!body) return '[empty]';
    const maxLen = this.options.maxBodyLength || 5000;
    if (body.length > maxLen) {
      return body.substring(0, maxLen) + `... [truncated, ${body.length} total chars]`;
    }
    return body;
  }

  private parseBody(body: any): string {
    if (!body) return '[empty]';
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return body;
      }
    }
    if (typeof body === 'object') {
      try {
        return JSON.stringify(body, null, 2);
      } catch {
        return '[Object]';
      }
    }
    return String(body);
  }

  private getMethodColor(method: string): string {
    const colors: Record<string, string> = {
      GET: '\x1b[32m',
      POST: '\x1b[33m',
      PUT: '\x1b[34m',
      PATCH: '\x1b[35m',
      DELETE: '\x1b[31m',
    };
    return colors[method.toUpperCase()] || '\x1b[37m';
  }

  private logRequest(request: NetworkRequest): void {
    // Send to remote monitor
    this.sendToRemote({
      type: 'request',
      id: request.id,
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      startTime: request.startTime,
    });

    // Skip console logging if remote-only mode
    if (!this.options.logBody && !this.options.logResponse && !this.options.logHeaders) {
      return;
    }

    const methodColor = this.options.colorize ? this.getMethodColor(request.method) : '';
    const reset = this.options.colorize ? '\x1b[0m' : '';

    console.log(`\n${methodColor}[${request.method}]${reset} ${request.url}`);

    if (this.options.logBody && request.body) {
      const bodyLines = this.truncateBody(this.parseBody(request.body)).split('\n');
      bodyLines.forEach(line => console.log(`   ${line}`));
    }
  }

  private logResponse(request: NetworkRequest): void {
    // Send to remote monitor
    this.sendToRemote({
      type: 'response',
      id: request.id,
      status: request.status!,
      statusText: request.statusText,
      duration: request.duration!,
      responseHeaders: request.responseHeaders,
      responseBody: request.responseBody,
    });

    // Skip console logging if remote-only mode
    if (!this.options.logBody && !this.options.logResponse && !this.options.logHeaders) {
      return;
    }

    const statusColor = this.options.colorize
      ? (request.status && request.status >= 400 ? '\x1b[31m' : '\x1b[32m')
      : '';
    const reset = this.options.colorize ? '\x1b[0m' : '';

    console.log(`${statusColor}[${request.status}]${reset} ${request.duration}ms`);

    if (this.options.logResponse && request.responseBody) {
      const bodyLines = this.truncateBody(this.parseBody(request.responseBody)).split('\n');
      bodyLines.forEach(line => console.log(`   ${line}`));
    }
  }

  private logError(request: NetworkRequest): void {
    // Send to remote monitor
    this.sendToRemote({
      type: 'error',
      id: request.id,
      error: request.error!,
      duration: request.duration,
    });

    // Skip console logging if remote-only mode
    if (!this.options.logBody && !this.options.logResponse && !this.options.logHeaders) {
      return;
    }

    console.log(`\x1b[31m[ERROR]\x1b[0m ${request.error}`);
  }

  private interceptFetch(): void {
    this.originalFetch = (global as any).fetch;
    const self = this;

    (global as any).fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

      if (!self.shouldLog(url)) {
        return self.originalFetch!(input, init);
      }

      const requestId = self.generateId();
      const method = init?.method || 'GET';
      const headers: Record<string, string> = {};

      // Extract headers
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const request: NetworkRequest = {
        id: requestId,
        method: method.toUpperCase(),
        url,
        headers,
        body: init?.body as string,
        startTime: Date.now(),
      };

      self.requests.set(requestId, request);
      self.logRequest(request);

      try {
        const response = await self.originalFetch!(input, init);
        const endTime = Date.now();

        // Clone response to read body without consuming it
        const clonedResponse = response.clone();

        // Extract response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        let responseBody = '';
        try {
          responseBody = await clonedResponse.text();
        } catch {
          responseBody = '[Unable to read response body]';
        }

        request.endTime = endTime;
        request.duration = endTime - request.startTime;
        request.status = response.status;
        request.statusText = response.statusText;
        request.responseHeaders = responseHeaders;
        request.responseBody = responseBody;

        self.logResponse(request);

        return response;
      } catch (error) {
        const endTime = Date.now();
        request.endTime = endTime;
        request.duration = endTime - request.startTime;
        request.error = error instanceof Error ? error.message : String(error);

        self.logError(request);

        throw error;
      }
    };
  }

  private interceptXHR(): void {
    const self = this;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null,
    ): void {
      const urlStr = typeof url === 'string' ? url : url.href;
      (this as any)._networkDebugger = {
        id: self.generateId(),
        method: method.toUpperCase(),
        url: urlStr,
        headers: {} as Record<string, string>,
        startTime: 0,
      };
      return originalOpen.call(this, method, url, async, username, password);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (
      name: string,
      value: string,
    ): void {
      if ((this as any)._networkDebugger) {
        (this as any)._networkDebugger.headers[name] = value;
      }
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
      const debugInfo = (this as any)._networkDebugger;

      if (!debugInfo || !self.shouldLog(debugInfo.url)) {
        return originalSend.call(this, body);
      }

      debugInfo.startTime = Date.now();
      debugInfo.body = body;

      const request: NetworkRequest = {
        id: debugInfo.id,
        method: debugInfo.method,
        url: debugInfo.url,
        headers: debugInfo.headers,
        body: typeof body === 'string' ? body : body ? '[Binary/FormData]' : undefined,
        startTime: debugInfo.startTime,
      };

      self.requests.set(debugInfo.id, request);
      self.logRequest(request);

      this.addEventListener('load', function () {
        const endTime = Date.now();
        request.endTime = endTime;
        request.duration = endTime - request.startTime;
        request.status = this.status;
        request.statusText = this.statusText;

        try {
          if (this.responseType === '' || this.responseType === 'text') {
            request.responseBody = this.responseText;
          } else if (this.responseType === 'json') {
            request.responseBody = JSON.stringify(this.response);
          } else {
            request.responseBody = `[${this.responseType} response]`;
          }
        } catch {
          request.responseBody = '[Unable to read response]';
        }

        // Get response headers
        const responseHeaders: Record<string, string> = {};
        const allHeaders = this.getAllResponseHeaders();
        if (allHeaders) {
          allHeaders.split('\r\n').forEach(line => {
            const parts = line.split(': ');
            if (parts.length === 2) {
              responseHeaders[parts[0]] = parts[1];
            }
          });
        }
        request.responseHeaders = responseHeaders;

        self.logResponse(request);
      });

      this.addEventListener('error', function () {
        const endTime = Date.now();
        request.endTime = endTime;
        request.duration = endTime - request.startTime;
        request.error = 'Network Error';

        self.logError(request);
      });

      this.addEventListener('timeout', function () {
        const endTime = Date.now();
        request.endTime = endTime;
        request.duration = endTime - request.startTime;
        request.error = 'Request Timeout';

        self.logError(request);
      });

      return originalSend.call(this, body);
    };
  }

  /**
   * Get all logged requests
   */
  getRequests(): NetworkRequest[] {
    return Array.from(this.requests.values());
  }

  /**
   * Clear all logged requests
   */
  clearRequests(): void {
    this.requests.clear();
  }
}

export const NetworkDebugger = new NetworkDebuggerClass();

// Convenience functions
export const enableNetworkDebugging = (options?: NetworkDebuggerOptions): void => {
  NetworkDebugger.enable(options);
};

export const disableNetworkDebugging = (): void => {
  NetworkDebugger.disable();
};

export const enableRemoteNetworkMonitor = (host?: string, port?: number): void => {
  NetworkDebugger.enableRemote(host, port);
};
