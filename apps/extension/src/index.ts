export * from './api-client.js';
export * from './config.js';
export * from './content-messages.js';
export * from './popup-app.js';
export * from './runtime.js';
export * from './state.js';

export const extensionAppName = 'CareerRafiq Extension';
export const extensionQuickResultSlots = [
  'verdict',
  'recommendedCvId',
  'conciseExplanation',
  'majorGapsSummary',
] as const;
