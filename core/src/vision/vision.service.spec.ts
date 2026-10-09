import type { LlmClient } from '../llm/llm.client';
import { VisionService } from './vision.service';

describe('VisionService', () => {
  it('sends text + image parts and returns the text', async () => {
    const chat = jest.fn(() =>
      Promise.resolve({ content: 'A teal square.', model: 'v' }),
    );
    const service = new VisionService({ chat } as unknown as LlmClient);

    const result = await service.analyze({
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'What?',
    });

    expect(result).toEqual({ text: 'A teal square.', model: 'v' });
    expect(chat).toHaveBeenCalledWith({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What?' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
            },
          ],
        },
      ],
    });
  });

  it('forwards the session id when present', async () => {
    const chat = jest.fn(() => Promise.resolve({ content: 'ok', model: 'v' }));
    const service = new VisionService({ chat } as unknown as LlmClient);

    await service.analyze({
      dataUrl: 'data:image/png;base64,AAAA',
      prompt: 'What?',
      sessionId: 's1',
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1' }) as unknown,
    );
  });
});
