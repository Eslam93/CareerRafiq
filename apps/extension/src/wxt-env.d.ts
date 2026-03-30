/// <reference types="wxt/client" />

interface ImportMetaEnv {
  readonly WXT_API_BASE_URL?: string;
  readonly WXT_WEB_APP_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
