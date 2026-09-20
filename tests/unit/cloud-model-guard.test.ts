import { describe, expect, it } from 'vitest';
import { isCloudRoutedModel } from '@/lib/env';

/**
 * The rule that keeps identity cards in the country.
 *
 * Ollama can serve hosted models alongside local ones, and a hosted tag
 * forwards the image to ollama.com. The model-list check in `lib/ocr/ollama.ts`
 * cannot catch that mistake, because a cloud tag genuinely *is* installed on
 * the host and so passes - which is why this guard exists at configuration
 * time instead, and why it is worth testing on its own.
 */

describe('isCloudRoutedModel', () => {
  it('rejects the suffixed form Ollama actually publishes', () => {
    expect(isCloudRoutedModel('gpt-oss:120b-cloud')).toBe(true);
    expect(isCloudRoutedModel('deepseek-v3.1:671b-cloud')).toBe(true);
    expect(isCloudRoutedModel('qwen3-coder:480b-cloud')).toBe(true);
  });

  it('rejects the bare form as well', () => {
    expect(isCloudRoutedModel('qwen3.5:cloud')).toBe(true);
  });

  it('is not fooled by casing or stray whitespace in an environment variable', () => {
    expect(isCloudRoutedModel('  GPT-OSS:120B-CLOUD  ')).toBe(true);
    expect(isCloudRoutedModel('Qwen3.5:Cloud')).toBe(true);
  });

  it('accepts the local tags this deployment actually uses', () => {
    expect(isCloudRoutedModel('qwen3.5:0.8b')).toBe(false);
    expect(isCloudRoutedModel('llava:7b')).toBe(false);
    expect(isCloudRoutedModel('minicpm-v')).toBe(false);
  });

  /*
   * Matching is on the tag, not anywhere in the string. A local model whose
   * *name* happens to contain "cloud" is not routed anywhere, and refusing it
   * would be a false alarm that an operator would work around - probably by
   * disabling the check.
   */
  it('does not reject a local model whose name merely contains the word', () => {
    expect(isCloudRoutedModel('cloudy-vision:7b')).toBe(false);
    expect(isCloudRoutedModel('nimbus-cloud-reader:3b')).toBe(false);
  });

  it('treats an untagged name as local', () => {
    expect(isCloudRoutedModel('llava')).toBe(false);
  });
});
