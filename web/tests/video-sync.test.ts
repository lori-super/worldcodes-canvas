import { beforeEach, expect, mock, test } from "bun:test";
const post = mock(async () => ({ data: { id: "created-task" } }));
const get = mock(async (url: string) => ({ data: url.endsWith('/content') ? new Blob(['video'], { type: 'video/mp4' }) : { status: 'completed' } }));
mock.module('axios', () => ({ default: { post, get, isCancel: () => false, isAxiosError: () => false } }));
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
const { defaultConfig } = await import('../src/stores/use-config-store');
const { createVideoGenerationTask, requestVideoGeneration } = await import('../src/services/api/video');
const config = { ...defaultConfig, model: 'worldcodes-video::seedance2.5', videoSeconds: '5', size: '16:9', vquality: '480p', channels: defaultConfig.channels.map(c => ({ ...c, apiKey: 'test-key' })) };
beforeEach(() => { post.mockClear(); get.mockClear(); });
test('WorldCodes retains verified JSON video profile parameters', async () => {
    await createVideoGenerationTask(config, 'test');
    expect(post.mock.calls[0][0]).toBe('/v1/videos');
    expect(post.mock.calls[0][1]).toMatchObject({ model: 'seedance2.5', seconds: '5', resolution: '480p', aspect_ratio: '16:9', images: [], videos: [], audios: [] });
});
test('resuming a saved video task only polls and downloads, with the existing timeouts', async () => {
    const created = mock(async () => {});
    const result = await requestVideoGeneration(config, 'test', {}, { task: { id: 'saved-task', provider: 'openai', model: config.model }, onTaskCreated: created });
    expect(post).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(get.mock.calls.map(c => c[0])).toEqual(['/v1/videos/saved-task', '/v1/videos/saved-task/content']);
    expect(get.mock.calls[0][1]).toMatchObject({ timeout: 30000 });
    expect(get.mock.calls[1][1]).toMatchObject({ timeout: 120000 });
    expect(result.blob?.size).toBe(5);
});
test('the task is persisted before the first poll', async () => {
    let saved = false;
    get.mockImplementationOnce(async () => { expect(saved).toBe(true); return { data: { status: 'completed' } }; });
    await requestVideoGeneration(config, 'test', {}, { onTaskCreated: async task => { expect(task.id).toBe('created-task'); saved = true; } });
    expect(saved).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
});
