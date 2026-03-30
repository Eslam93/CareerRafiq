import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiProvider } from './ai.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAiProvider', () => {
  it('retries CV profile suggestions with a more compact prompt after a timeout-like failure', async () => {
    const timeoutError = new Error('This operation was aborted');
    timeoutError.name = 'AbortError';

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              cvName: 'Resume.pdf',
              primaryRole: 'Frontend Engineer',
              secondaryRoles: ['UI Engineer'],
              seniority: 'senior',
              careerTrack: 'individual_contributor',
              coreStack: ['React', 'TypeScript'],
              positioningSummary: 'Senior frontend engineer focused on React and TypeScript.',
              excludedDomains: [],
              summary: 'Generated successfully.',
              overallConfidence: 0.81,
              fieldEvidence: [],
            }),
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
          },
        ),
      );

    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new OpenAiProvider('test-key', 'https://api.openai.com/v1', 'gpt-5-mini', 45000);
    const rawText = Array.from({ length: 400 }, (_, index) => `Senior frontend engineer accomplishment ${index} with React and TypeScript.`).join('\n');

    const result = await provider.suggestCvProfile({
      fileName: 'Resume.pdf',
      rawText,
    });

    expect(result.output.primaryRole).toBe('Frontend Engineer');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}'));
    const firstPrompt = String(firstBody.input?.[1]?.content?.[0]?.text ?? '');
    const secondPrompt = String(secondBody.input?.[1]?.content?.[0]?.text ?? '');

    expect(firstPrompt.length).toBeGreaterThan(secondPrompt.length);
    expect(secondPrompt).toContain('CV excerpt:');
  });
});
