import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CareerRafiqCore, type CareerRafiqCoreState } from '@career-rafiq/core';

// Legacy compatibility path only.
// The shipped runtime uses the repository-backed API with SQLite persistence.

export function getDefaultStateFilePath(): string {
  return process.env['CAREERRAFIQ_STATE_FILE']
    ? resolve(process.env['CAREERRAFIQ_STATE_FILE'])
    : resolve(process.cwd(), 'apps', 'api', 'data', 'core-state.json');
}

export async function loadApiCoreFromFile(filePath = getDefaultStateFilePath()): Promise<CareerRafiqCore> {
  const core = new CareerRafiqCore();
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as CareerRafiqCoreState;
    core.importState(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return core;
}

export async function saveApiCoreToFile(core: CareerRafiqCore, filePath = getDefaultStateFilePath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(core.exportState(), null, 2), 'utf8');
}
