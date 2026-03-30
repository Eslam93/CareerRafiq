export { createApiServer } from './api-server.js';

import { createApiServer } from './api-server.js';
import { CareerRafiqApiService } from './service.js';

export async function startApiServer(port = Number(process.env['PORT'] ?? 8787)): Promise<void> {
  const service = new CareerRafiqApiService();
  const server = createApiServer(service);
  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });
  // eslint-disable-next-line no-console
  console.log(`CareerRafiq API listening on http://localhost:${port}`);
}

if (process.env['CAREERRAFIQ_START_API'] === '1') {
  void startApiServer();
}
