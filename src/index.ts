/**
 * react-native-network-monitor
 *
 * Network monitoring tool for React Native - Terminal UI similar to browser DevTools
 *
 * @example
 * // In your React Native app
 * import { NetworkDebugger } from 'react-native-network-monitor';
 *
 * if (__DEV__) {
 *   NetworkDebugger.enableRemote();
 * }
 *
 * // Then run the CLI in your terminal:
 * // npx react-native-network-monitor
 */

// Export the main debugger
export {
  NetworkDebugger,
  enableNetworkDebugging,
  disableNetworkDebugging,
  enableRemoteNetworkMonitor,
} from './client/NetworkDebugger';

// Export types
export type {
  NetworkRequest,
  NetworkDebuggerOptions,
  RequestMessage,
  ResponseMessage,
  ErrorMessage,
  MonitorMessage,
} from './types';

// Export constants
export { DEFAULT_OPTIONS, DEFAULT_MONITOR_PORT } from './types';
