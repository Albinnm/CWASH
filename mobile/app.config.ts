import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.EAS_BUILD === 'true') {
    const address = process.env.EXPO_PUBLIC_API_URL || '';
    if (!/^https:\/\//.test(address) || address.includes('example.test')) {
      throw new Error('Set EXPO_PUBLIC_API_URL to your deployed HTTPS CWASH backend in the EAS build environment before creating an installable build.');
    }
  }
  return { ...config, name: 'CWASH', slug: 'cwash' };
};
