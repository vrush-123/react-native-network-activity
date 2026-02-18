# react-native-network-activity

Network monitoring tool for React Native - Terminal UI similar to browser DevTools.

![Terminal UI](https://img.shields.io/badge/Terminal-UI-blue)
![React Native](https://img.shields.io/badge/React%20Native-0.70+-green)
![Node](https://img.shields.io/badge/Node-18+-orange)

## Features

- Real-time network request monitoring in your terminal
- Intercepts both `fetch` and `XMLHttpRequest` calls
- Color-coded HTTP methods and status codes
- View request/response headers and bodies
- Filter requests by URL or show only errors
- Navigate and inspect individual requests
- Works with iOS Simulator, Android Emulator, and physical devices

## Installation

```bash
npm install react-native-network-activity
# or
yarn add react-native-network-activity
```

## Quick Start

### 1. Start the Terminal Monitor

```bash
npx react-native-network-activity
```

### 2. Add to Your React Native App

```typescript
// App.tsx or index.js
import { NetworkDebugger } from 'react-native-network-activity';

// Enable only in development
if (__DEV__) {
  NetworkDebugger.enableRemote();
}
```

That's it! Network requests will now appear in your terminal.

## Usage

### Terminal Monitor

```bash
# Start with default port (8973)
npx react-native-network-activity

# Use a custom port
npx react-native-network-activity --port 9000

# Show help
npx react-native-network-activity --help
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate requests |
| `Enter` | View request details |
| `Esc` / `Backspace` | Back to list |
| `f` | Filter requests |
| `e` | Toggle errors only |
| `c` | Clear all requests |
| `q` | Quit |

### Client API

```typescript
import { NetworkDebugger } from 'react-native-network-activity';

// Enable remote monitoring (recommended)
NetworkDebugger.enableRemote();

// For physical devices, specify your computer's IP
NetworkDebugger.enableRemote('192.168.1.100');

// Custom port
NetworkDebugger.enableRemote('localhost', 9000);

// Disable monitoring
NetworkDebugger.disable();

// Enable console logging instead of remote
NetworkDebugger.enable({
  logHeaders: true,
  logBody: true,
  logResponse: true,
});
```

### Configuration Options

```typescript
interface NetworkDebuggerOptions {
  // Log request/response headers to console (default: false)
  logHeaders?: boolean;

  // Log request body to console (default: true)
  logBody?: boolean;

  // Log response body to console (default: true)
  logResponse?: boolean;

  // Only log requests matching these URL patterns
  filterUrls?: string[];

  // Exclude requests matching these URL patterns
  excludeUrls?: string[];

  // Maximum body length to log (default: 5000)
  maxBodyLength?: number;

  // Use ANSI colors in console output (default: true)
  colorize?: boolean;
}
```

## Physical Device Setup

For physical devices, you need to specify your computer's IP address:

### Find Your IP

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'

# Windows
ipconfig
```

### Configure the Client

```typescript
if (__DEV__) {
  // Replace with your computer's IP
  NetworkDebugger.enableRemote('192.168.1.100');
}
```

### Ensure Network Access

Both your computer and device must be on the same network. The default port is `8973`.

## How It Works

1. **Client Side**: The `NetworkDebugger` class monkey-patches `global.fetch` and `XMLHttpRequest.prototype` to intercept all network requests.

2. **Communication**: Request/response data is sent via WebSocket to the terminal monitor.

3. **Terminal UI**: A Node.js CLI renders an interactive terminal UI showing all network activity.

## Troubleshooting

### Monitor shows "Waiting for connections"

- Ensure `NetworkDebugger.enableRemote()` is called in your app
- Check that the app is running and reachable
- For Android emulator, the client automatically uses `10.0.2.2`
- For physical devices, verify the IP address is correct

### Port already in use

```bash
# Use a different port
npx react-native-network-activity --port 9000

# And in your app
NetworkDebugger.enableRemote('localhost', 9000);
```

### Requests not appearing

- Check the `excludeUrls` option - some URLs are excluded by default
- Ensure requests are made after `enableRemote()` is called
- Verify both client and monitor are using the same port

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import {
  NetworkDebugger,
  NetworkRequest,
  NetworkDebuggerOptions,
  enableRemoteNetworkMonitor,
} from 'react-native-network-activity';
```

## Security Considerations

⚠️ **IMPORTANT SECURITY NOTES:**

1. **Development Only**: This package is designed for **development use only**. Never enable network monitoring in production builds as it:
   - Exposes sensitive network traffic (headers, bodies, tokens)
   - Uses unencrypted WebSocket connections (ws://)
   - Stores request/response data in memory
   - Has no authentication mechanism

2. **Always Use `__DEV__` Guard**: Always wrap the monitor in a development check:
   ```typescript
   if (__DEV__) {
     NetworkDebugger.enableRemote();
   }
   ```

3. **Network Security**: The WebSocket server accepts connections from any device on your network. Only use on trusted networks (localhost, VPN, or isolated development networks).

4. **Sensitive Data**: Be aware that all network requests, including those containing:
   - Authentication tokens
   - API keys
   - User credentials
   - Personal information
   
   Will be visible in the terminal monitor. Never share terminal output containing sensitive data.

5. **Memory Limits**: The monitor has built-in limits to prevent memory exhaustion:
   - Maximum 1000 stored requests (oldest removed when limit reached)
   - Maximum 10MB per message
   - Response bodies truncated to 100KB for storage

6. **Input Validation**: All incoming WebSocket messages are validated and sanitized to prevent injection attacks.

## License

MIT
