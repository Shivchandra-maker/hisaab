import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app shell. The app is the same web build (dist/) running in a WebView;
 * native code in android/app/src/main/java/app/hisaab/ adds SMS + notification capture.
 */
const config: CapacitorConfig = {
  appId: 'app.hisaab',
  appName: 'Hisaab',
  webDir: 'dist',
  android: {
    // Keep the WebView's storage (your IndexedDB data) across app updates.
    allowMixedContent: false,
    // Android 15 draws apps under the status bar; keep the app below it.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_hisaab',
      iconColor: '#1D6B55',
    },
  },
};

export default config;
