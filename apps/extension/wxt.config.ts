import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'CareerRafiq Beta',
    description: 'AI Job Fit Copilot extension beta for capture and quick evaluation.',
    permissions: ['activeTab', 'tabs'],
    host_permissions: ['<all_urls>'],
  },
});
