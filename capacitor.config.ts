import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iamtouchstone.smartstock',
  appName: 'SmartStock',
  webDir: 'dist',
  server: {
    url: 'https://smart-stock-seven.vercel.app',
    cleartext: true
  },
  android: {
    webContentsDebuggingEnabled: true
  }
};

export default config;
