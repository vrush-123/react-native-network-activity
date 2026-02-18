#!/usr/bin/env node
/**
 * react-native-network-activity CLI
 *
 * Terminal UI for monitoring React Native network requests
 *
 * Usage:
 *   npx react-native-network-activity
 *   npx react-native-network-activity --port 9000
 *   npx react-native-network-activity --help
 */

const WebSocket = require('ws');
const readline = require('readline');

// Parse CLI arguments
const args = process.argv.slice(2);
let PORT = 8973;

// Validate port range (1-65535)
function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
react-native-network-activity - Network monitoring for React Native

Usage:
  npx react-native-network-activity [options]

Options:
  -p, --port <port>  Port to listen on (default: 8973, range: 1-65535)
  -h, --help         Show this help message

Setup in your React Native app:
  import { NetworkDebugger } from 'react-native-network-activity';

  if (__DEV__) {
    NetworkDebugger.enableRemote();
  }

For physical devices, pass your computer's IP:
  NetworkDebugger.enableRemote('192.168.1.100');
`);
    process.exit(0);
  }
  if (args[i] === '--port' || args[i] === '-p') {
    PORT = parseInt(args[++i], 10);
    if (!isValidPort(PORT)) {
      console.error('Invalid port number. Port must be between 1 and 65535.');
      process.exit(1);
    }
  }
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// Request storage with memory limits
const requests = new Map();
const MAX_REQUESTS = 1000; // Maximum number of requests to store
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB max message size
let requestCounter = 0;
let selectedIndex = 0;
let viewMode = 'list'; // 'list' or 'detail'
let filterText = '';
let showOnlyErrors = false;

// Detail view state
let detailSnapshot = null;
let detailScrollOffset = 0;

// Get method color
function getMethodColor(method) {
  const methodColors = {
    GET: colors.green,
    POST: colors.yellow,
    PUT: colors.blue,
    PATCH: colors.magenta,
    DELETE: colors.red,
  };
  return methodColors[method?.toUpperCase()] || colors.white;
}

// Get status color
function getStatusColor(status) {
  if (!status) return colors.dim;
  if (status >= 200 && status < 300) return colors.green;
  if (status >= 300 && status < 400) return colors.cyan;
  if (status >= 400 && status < 500) return colors.yellow;
  if (status >= 500) return colors.red;
  return colors.white;
}

// Format duration
function formatDuration(ms) {
  if (!ms) return '...';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Truncate URL for display
function truncateUrl(url, maxLen = 60) {
  if (!url) return '';
  url = url.replace(/^https?:\/\//, '');
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}

// Format size
function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Clear screen
function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// Get terminal size
function getTerminalSize() {
  return {
    width: process.stdout.columns || 120,
    height: process.stdout.rows || 30,
  };
}

// Draw header
function drawHeader() {
  const { width } = getTerminalSize();
  const title = ' react-native-network-activity ';
  const padding = Math.max(0, Math.floor((width - title.length) / 2));

  console.log(colors.bgBlue + colors.white + colors.bright);
  console.log(' '.repeat(width));
  console.log(' '.repeat(padding) + title + ' '.repeat(width - padding - title.length));
  console.log(' '.repeat(width) + colors.reset);
  console.log();
}

// Draw status bar
function drawStatusBar() {
  const { width } = getTerminalSize();
  const reqArray = getFilteredRequests();
  const total = reqArray.length;
  const pending = reqArray.filter(r => !r.status && !r.error).length;
  const success = reqArray.filter(r => r.status >= 200 && r.status < 400).length;
  const errors = reqArray.filter(r => r.status >= 400 || r.error).length;

  const stats = `Total: ${total} | Pending: ${pending} | Success: ${success} | Errors: ${errors}`;
  const filter = filterText ? ` | Filter: "${filterText}"` : '';
  const errorFilter = showOnlyErrors ? ' | [Errors Only]' : '';

  console.log(colors.dim + '─'.repeat(width) + colors.reset);
  console.log(colors.cyan + stats + filter + errorFilter + colors.reset);
  console.log(colors.dim + '─'.repeat(width) + colors.reset);
}

// Draw column headers
function drawColumnHeaders() {
  const { width } = getTerminalSize();
  const cols = {
    status: 7,
    method: 8,
    duration: 10,
    size: 10,
  };
  const urlWidth = width - cols.status - cols.method - cols.duration - cols.size - 10;

  const header =
    colors.bright +
    ' ' + 'Status'.padEnd(cols.status) +
    'Method'.padEnd(cols.method) +
    'URL'.padEnd(urlWidth) +
    'Time'.padEnd(cols.duration) +
    'Size'.padEnd(cols.size) +
    colors.reset;

  console.log(header);
  console.log(colors.dim + '─'.repeat(width) + colors.reset);
}

// Get filtered requests
function getFilteredRequests() {
  let reqArray = Array.from(requests.values());

  if (filterText) {
    const lower = filterText.toLowerCase();
    reqArray = reqArray.filter(r =>
      r.url?.toLowerCase().includes(lower) ||
      r.method?.toLowerCase().includes(lower)
    );
  }

  if (showOnlyErrors) {
    reqArray = reqArray.filter(r => r.status >= 400 || r.error);
  }

  return reqArray.sort((a, b) => b.startTime - a.startTime);
}

// Draw request list
function drawRequestList() {
  const { width, height } = getTerminalSize();
  const reqArray = getFilteredRequests();
  const maxRows = height - 12;

  const cols = {
    status: 7,
    method: 8,
    duration: 10,
    size: 10,
  };
  const urlWidth = width - cols.status - cols.method - cols.duration - cols.size - 10;

  if (selectedIndex >= reqArray.length) selectedIndex = Math.max(0, reqArray.length - 1);

  const startIdx = Math.max(0, selectedIndex - Math.floor(maxRows / 2));
  const endIdx = Math.min(reqArray.length, startIdx + maxRows);

  for (let i = startIdx; i < endIdx; i++) {
    const req = reqArray[i];
    const isSelected = i === selectedIndex;
    const bg = isSelected ? '\x1b[47m\x1b[30m' : '';

    let statusStr = '...';
    let statusColor = colors.dim;
    if (req.error) {
      statusStr = 'ERR';
      statusColor = colors.red;
    } else if (req.status) {
      statusStr = String(req.status);
      statusColor = getStatusColor(req.status);
    }

    const row =
      bg +
      ' ' +
      (statusColor + statusStr.padEnd(cols.status) + (isSelected ? '\x1b[47m\x1b[30m' : colors.reset + bg)) +
      (getMethodColor(req.method) + (req.method || '').padEnd(cols.method) + (isSelected ? '\x1b[47m\x1b[30m' : colors.reset + bg)) +
      truncateUrl(req.url, urlWidth).padEnd(urlWidth) +
      formatDuration(req.duration).padEnd(cols.duration) +
      formatSize(req.responseSize).padEnd(cols.size) +
      colors.reset;

    console.log(row);
  }

  for (let i = endIdx - startIdx; i < maxRows; i++) {
    console.log();
  }
}

// Build detail lines
function buildDetailLines(req) {
  const lines = [];

  if (!req) {
    lines.push(colors.dim + 'No request selected' + colors.reset);
    return lines;
  }

  lines.push(colors.bright + '── General ──' + colors.reset);
  lines.push(`URL: ${colors.cyan}${req.url}${colors.reset}`);
  lines.push(`Method: ${getMethodColor(req.method)}${req.method}${colors.reset}`);
  lines.push(`Status: ${getStatusColor(req.status)}${req.status || 'Pending'} ${req.statusText || ''}${colors.reset}`);
  lines.push(`Duration: ${formatDuration(req.duration)}`);
  lines.push(`Size: ${formatSize(req.responseSize)}`);
  lines.push('');

  if (req.headers && Object.keys(req.headers).length > 0) {
    lines.push(colors.bright + '── Request Headers ──' + colors.reset);
    for (const [key, value] of Object.entries(req.headers)) {
      lines.push(`${colors.cyan}${key}:${colors.reset} ${value}`);
    }
    lines.push('');
  }

  if (req.body) {
    lines.push(colors.bright + '── Request Body ──' + colors.reset);
    try {
      const parsed = JSON.parse(req.body);
      const formatted = JSON.stringify(parsed, null, 2).split('\n');
      lines.push(...formatted);
    } catch {
      const bodyLines = req.body.split('\n');
      lines.push(...bodyLines);
    }
    lines.push('');
  }

  if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
    lines.push(colors.bright + '── Response Headers ──' + colors.reset);
    for (const [key, value] of Object.entries(req.responseHeaders)) {
      lines.push(`${colors.cyan}${key}:${colors.reset} ${value}`);
    }
    lines.push('');
  }

  if (req.responseBody) {
    lines.push(colors.bright + '── Response Body ──' + colors.reset);
    try {
      const parsed = JSON.parse(req.responseBody);
      const formatted = JSON.stringify(parsed, null, 2).split('\n');
      lines.push(...formatted);
    } catch {
      const bodyLines = req.responseBody.split('\n');
      lines.push(...bodyLines);
    }
  }

  if (req.error) {
    lines.push('');
    lines.push(colors.bright + colors.red + '── Error ──' + colors.reset);
    lines.push(colors.red + req.error + colors.reset);
  }

  return lines;
}

// Draw request detail
function drawRequestDetail() {
  const { width, height } = getTerminalSize();
  const maxRows = height - 10;

  const lines = buildDetailLines(detailSnapshot);
  const totalLines = lines.length;

  const maxOffset = Math.max(0, totalLines - maxRows);
  if (detailScrollOffset > maxOffset) detailScrollOffset = maxOffset;
  if (detailScrollOffset < 0) detailScrollOffset = 0;

  const scrollInfo = totalLines > maxRows
    ? colors.dim + ` [${detailScrollOffset + 1}-${Math.min(detailScrollOffset + maxRows, totalLines)}/${totalLines}] Use arrows to scroll` + colors.reset
    : '';

  console.log(colors.bright + '── Request Detail ──' + scrollInfo + colors.reset);
  console.log(colors.dim + '─'.repeat(width) + colors.reset);

  const visibleLines = lines.slice(detailScrollOffset, detailScrollOffset + maxRows - 2);
  for (const line of visibleLines) {
    console.log(line);
  }

  for (let i = visibleLines.length; i < maxRows - 2; i++) {
    console.log();
  }
}

// Draw help bar
function drawHelpBar() {
  const { width } = getTerminalSize();
  console.log(colors.dim + '─'.repeat(width) + colors.reset);

  if (viewMode === 'list') {
    console.log(
      colors.dim +
      'arrows: Navigate | Enter: Details | c: Clear | f: Filter | e: Errors | q: Quit' +
      colors.reset
    );
  } else {
    console.log(
      colors.dim +
      'Esc/Backspace: Back | arrows: Scroll | c: Clear | q: Quit' +
      colors.reset
    );
  }
}

// Main render
function render() {
  clearScreen();
  drawHeader();
  drawStatusBar();

  if (viewMode === 'list') {
    drawColumnHeaders();
    drawRequestList();
  } else {
    drawRequestDetail();
  }

  drawHelpBar();
}

// Validate and sanitize message data
function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.type || !['request', 'response', 'error'].includes(msg.type)) return false;
  if (!msg.id || typeof msg.id !== 'string' || msg.id.length > 200) return false;
  
  if (msg.type === 'request') {
    if (typeof msg.method !== 'string' || msg.method.length > 20) return false;
    if (typeof msg.url !== 'string' || msg.url.length > 10000) return false;
    if (msg.headers && (typeof msg.headers !== 'object' || Array.isArray(msg.headers))) return false;
    if (msg.body !== undefined && typeof msg.body !== 'string') return false;
    if (typeof msg.startTime !== 'number' || msg.startTime < 0) return false;
  } else if (msg.type === 'response') {
    if (typeof msg.status !== 'number' || msg.status < 0 || msg.status > 999) return false;
    if (msg.statusText !== undefined && typeof msg.statusText !== 'string') return false;
    if (typeof msg.duration !== 'number' || msg.duration < 0) return false;
    if (msg.responseHeaders && (typeof msg.responseHeaders !== 'object' || Array.isArray(msg.responseHeaders))) return false;
    if (msg.responseBody !== undefined && typeof msg.responseBody !== 'string') return false;
  } else if (msg.type === 'error') {
    if (typeof msg.error !== 'string' || msg.error.length > 5000) return false;
    if (msg.duration !== undefined && (typeof msg.duration !== 'number' || msg.duration < 0)) return false;
  }
  
  return true;
}

// Sanitize string for display (prevent injection)
function sanitizeString(str) {
  if (typeof str !== 'string') return String(str);
  // Remove control characters except newlines and tabs
  return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

// Truncate body to prevent memory exhaustion
function truncateBody(body, maxLength = 100000) {
  if (!body || typeof body !== 'string') return body;
  if (body.length <= maxLength) return body;
  return body.substring(0, maxLength) + `... [truncated, ${body.length} total chars]`;
}

// Handle WebSocket message
function handleMessage(data) {
  try {
    // Check message size
    if (data.length > MAX_MESSAGE_SIZE) {
      console.error('Message too large, ignoring');
      return;
    }

    const msg = JSON.parse(data);
    
    // Validate message structure
    if (!validateMessage(msg)) {
      console.error('Invalid message format, ignoring');
      return;
    }

    // Enforce request limit
    if (requests.size >= MAX_REQUESTS) {
      // Remove oldest request (FIFO)
      const firstKey = requests.keys().next().value;
      requests.delete(firstKey);
    }

    if (msg.type === 'request') {
      requests.set(msg.id, {
        id: sanitizeString(msg.id),
        method: sanitizeString(msg.method),
        url: sanitizeString(msg.url),
        headers: msg.headers || {},
        body: truncateBody(msg.body),
        startTime: msg.startTime,
      });
    } else if (msg.type === 'response') {
      const req = requests.get(msg.id);
      if (req) {
        req.status = msg.status;
        req.statusText = msg.statusText ? sanitizeString(msg.statusText) : undefined;
        req.duration = msg.duration;
        req.responseHeaders = msg.responseHeaders || {};
        req.responseBody = truncateBody(msg.responseBody);
        req.responseSize = req.responseBody?.length || 0;
      }
    } else if (msg.type === 'error') {
      const req = requests.get(msg.id);
      if (req) {
        req.error = sanitizeString(msg.error);
        req.duration = msg.duration;
      }
    }

    if (viewMode === 'list') {
      render();
    }
  } catch (e) {
    // Ignore parse errors and invalid messages
    console.error('Error processing message:', e.message);
  }
}

// Setup keyboard input
function setupInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit();
    }

    if (key.name === 'q') {
      process.exit();
    }

    if (key.name === 'c') {
      requests.clear();
      selectedIndex = 0;
      detailSnapshot = null;
      detailScrollOffset = 0;
      viewMode = 'list';
      render();
      return;
    }

    if (viewMode === 'list') {
      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
      } else if (key.name === 'down') {
        const reqArray = getFilteredRequests();
        selectedIndex = Math.min(reqArray.length - 1, selectedIndex + 1);
        render();
      } else if (key.name === 'return') {
        const reqArray = getFilteredRequests();
        const req = reqArray[selectedIndex];
        if (req) {
          detailSnapshot = JSON.parse(JSON.stringify(req));
          detailScrollOffset = 0;
          viewMode = 'detail';
          render();
        }
      } else if (key.name === 'e') {
        showOnlyErrors = !showOnlyErrors;
        selectedIndex = 0;
        render();
      } else if (key.name === 'f') {
        process.stdout.write('\x1b[2J\x1b[H');
        process.stdout.write('Filter (press Enter to confirm): ');

        let input = filterText;
        const inputHandler = (str, key) => {
          if (key.name === 'return') {
            filterText = input;
            selectedIndex = 0;
            process.stdin.removeListener('keypress', inputHandler);
            render();
          } else if (key.name === 'backspace') {
            input = input.slice(0, -1);
            process.stdout.write('\x1b[2J\x1b[H');
            process.stdout.write('Filter (press Enter to confirm): ' + input);
          } else if (key.name === 'escape') {
            process.stdin.removeListener('keypress', inputHandler);
            render();
          } else if (str && !key.ctrl) {
            input += str;
            process.stdout.write(str);
          }
        };
        process.stdin.on('keypress', inputHandler);
      }
    } else {
      if (key.name === 'escape' || key.name === 'backspace') {
        detailSnapshot = null;
        detailScrollOffset = 0;
        viewMode = 'list';
        render();
      } else if (key.name === 'up') {
        detailScrollOffset = Math.max(0, detailScrollOffset - 1);
        render();
      } else if (key.name === 'down') {
        detailScrollOffset += 1;
        render();
      } else if (key.name === 'pageup') {
        const { height } = getTerminalSize();
        detailScrollOffset = Math.max(0, detailScrollOffset - (height - 12));
        render();
      } else if (key.name === 'pagedown') {
        const { height } = getTerminalSize();
        detailScrollOffset += (height - 12);
        render();
      }
    }
  });
}

// Main
function main() {
  console.log(`
${colors.cyan}react-native-network-activity${colors.reset}
${colors.dim}────────────────────${colors.reset}

Starting WebSocket server on port ${PORT}...
Waiting for connections from your React Native app...

${colors.bright}Setup in your app:${colors.reset}
  import { NetworkDebugger } from 'react-native-network-activity';
  NetworkDebugger.enableRemote();

${colors.dim}Press any key to show the monitor UI...${colors.reset}
`);

  const wss = new WebSocket.Server({ 
    port: PORT,
    maxPayload: MAX_MESSAGE_SIZE, // Limit WebSocket message size
    perMessageDeflate: false // Disable compression to reduce attack surface
  });

  wss.on('connection', (ws) => {
    console.log(colors.green + 'App connected!' + colors.reset);

    // Set maximum message size
    ws._socket.setMaxListeners(0);
    
    ws.on('message', (data) => {
      // Check if data is a Buffer or string
      const dataStr = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      
      // Additional size check before processing
      if (dataStr.length > MAX_MESSAGE_SIZE) {
        console.error('Message exceeds maximum size, closing connection');
        ws.close(1009, 'Message too large');
        return;
      }
      
      handleMessage(dataStr);
    });

    ws.on('close', () => {
      console.log(colors.yellow + 'App disconnected' + colors.reset);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err.message);
    });
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`${colors.red}Port ${PORT} is already in use. Is another monitor running?${colors.reset}`);
      process.exit(1);
    }
    console.error('WebSocket error:', err);
  });

  setupInput();

  process.stdin.once('keypress', () => {
    render();
  });

  process.stdout.on('resize', () => {
    render();
  });
}

main();
