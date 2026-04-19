import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const GENERATION_TIMEOUT_MS = 120_000;

export async function generateImage(
  prompt: string,
  imageInput?: string[]
): Promise<string> {
  const hasImages = imageInput && imageInput.length > 0;
  const input: Record<string, unknown> = {
    prompt,
    size: '2K',
    max_images: 1,
    aspect_ratio: hasImages ? 'match_input_image' : '1:1',
    disable_safety_checker: true,
    sequential_image_generation: 'disabled',
  };
  if (hasImages) input.image_input = imageInput;

  const output = await Promise.race([
    replicate.run('bytedance/seedream-4.5', { input }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('generation timeout')),
        GENERATION_TIMEOUT_MS
      )
    ),
  ]);

  const first = Array.isArray(output) ? output[0] : output;

  if (typeof first === 'string') return first;

  if (first && typeof (first as { url?: unknown }).url === 'function') {
    const u = (first as { url: () => URL | string }).url();
    return u instanceof URL ? u.href : String(u);
  }

  throw new Error(`Resposta inesperada da Replicate: ${JSON.stringify(output)}`);
}
