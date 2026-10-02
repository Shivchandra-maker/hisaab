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
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_hisaab',
      iconColor: '#1D6B55',
    },
  },
};

export default config;
