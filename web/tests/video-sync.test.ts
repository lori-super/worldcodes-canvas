import { beforeEach, expect, mock, test } from "bun:test";
const post = mock(async () => ({ data: { id: "created-task" } }));
const get = mock(async (url: string) => ({ data: url.endsWith('/content') ? new Blob(['video'], { type: 'video/mp4' }) : { status: 'completed' } }));
mock.module('axios', () => ({ default: { post, get, isCancel: () => false, isAxiosError: () => false } }));
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
const { defaultConfig } = await import('../src/stores/use-config-store');
const { createVideoGenerationTask, requestVideoGeneration } = await import('../src/services/api/video');
const { normalizeProfileVideo } = await import('../src/lib/video-profiles');
const config = { ...defaultConfig, model: 'worldcodes-video::sd-2.5-480p', videoSeconds: '5', size: '16:9', vquality: '480p', channels: defaultConfig.channels.map(c => ({ ...c, apiKey: 'test-key' })) };
beforeEach(() => { post.mockClear(); get.mockClear(); });
test('WorldCodes compatible video models send the verified JSON fields without empty media arrays', async () => {
    await createVideoGenerationTask(config, 'test');
    expect(post.mock.calls[0][0]).toBe('/v1/videos');
    expect(post.mock.calls[0][1]).toEqual({ model: 'sd-2.5-480p', prompt: 'test', seconds: '5', resolution: '480p', aspect_ratio: '16:9' });
});
test('public reference images are sent as URLs within the model limits', async () => {
    const image = { id: 'i', name: 'i.png', type: 'image/png', dataUrl: 'https://media.canvas.worldcodes.online/a.png' };
    await createVideoGenerationTask({ ...config, model: 'worldcodes-video::grok-imagine-video-1.5-preview', vquality: '720' }, 'test', { images: [image] });
    expect(post.mock.calls[0][1]).toMatchObject({ model: 'grok-imagine-video-1.5-preview', resolution: '720p', images: ['https://media.canvas.worldcodes.online/a.png'] });
    expect(createVideoGenerationTask({ ...config, model: 'worldcodes-video::grok-imagine-video-1.5-preview' }, 'test', { images: [image, { ...image, id: 'j' }] })).rejects.toThrow();
});
test('MiniMax H3 sends DMC content with public URLs, 768P and an integer duration', async () => {
    const images = [
        { id: 'f', name: 'f.png', type: 'image/png', dataUrl: 'https://media.canvas.worldcodes.online/f.png', role: 'first_frame' as const },
        { id: 'l', name: 'l.png', type: 'image/png', dataUrl: 'https://media.canvas.worldcodes.online/l.png', role: 'last_frame' as const },
    ];
    await createVideoGenerationTask({ ...config, model: 'worldcodes-video::MiniMax-H3', videoSeconds: '3', vquality: '720', size: '9:16' }, 'test', { images });
    expect(post.mock.calls[0][1]).toEqual({
        model: 'MiniMax-H3', duration: 3, ratio: '9:16', resolution: '768P',
        content: [
            { type: 'text', text: 'test' },
            { type: 'image_url', image_url: { url: 'https://media.canvas.worldcodes.online/f.png', role: 'first_frame' } },
            { type: 'image_url', image_url: { url: 'https://media.canvas.worldcodes.online/l.png', role: 'last_frame' } },
        ],
    });
});
test('profiles snap durations, resolutions and ratios to the model options', () => {
    expect(normalizeProfileVideo('seedance-2.5-480p', '11', '720', 'auto')).toEqual({ videoSeconds: '10', vquality: '480p', size: '16:9' });
    expect(normalizeProfileVideo('omni', '30', '1080', '9:16')).toEqual({ videoSeconds: '10', vquality: '1080p', size: '9:16' });
    expect(normalizeProfileVideo('wan-3.0-720p-30s', '5', '720p', '1:1')).toEqual({ videoSeconds: '30', vquality: '720p', size: '1:1' });
    expect(normalizeProfileVideo('MiniMax-H3', '40', '720', '16:9')).toEqual({ videoSeconds: '15', vquality: '768p', size: '16:9' });
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
