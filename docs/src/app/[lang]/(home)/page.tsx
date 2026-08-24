import Link from 'next/link';
import { BookOpen, Bot, Database, Rocket, Workflow } from 'lucide-react';
import { appNames } from '@/lib/shared';
import { localizePath, type Locale } from '@/lib/i18n';
import type { Metadata } from 'next';

const messages = {
  en: {
    eyebrow: 'WorldCodes multimodal creation workspace',
    center: 'Documentation',
    description: 'In-site guidance for canvas workflows, image and video models, reference assets, temporary R2 storage, and the optional local Agent.',
    start: 'Read the documentation',
    cards: [
      ['Canvas workflows', 'Compose prompts, references, and generation nodes on one board.'],
      ['Reference storage', 'Keep editing assets in the browser and use temporary R2 objects only when generation requires public URLs.'],
      ['Local Agent', 'Run the optional Agent on each user’s computer, never as a shared Relay service.'],
    ],
  },
  'zh-CN': {
    eyebrow: 'WorldCodes 多模态创作工作台',
    center: '文档中心',
    description: '站内说明覆盖画布工作流、图片与视频模型、参考素材、R2 临时存储和可选本地 Agent。',
    start: '阅读站内文档',
    cards: [
      ['画布工作流', '在同一画布编排提示词、参考素材与生成节点。'],
      ['参考素材存储', '编辑素材保存在浏览器；仅在生成需要公网地址时使用 R2 临时对象。'],
      ['本地 Agent', 'Agent 只在每位用户自己的电脑运行，不作为 Relay 共享服务。'],
    ],
  },
};

const cardIcons = [Workflow, Database, Bot];

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];
  const appName = appNames[locale];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-16 md:px-10 md:py-24">
      <section className="grid items-center gap-12 lg:grid-cols-[1fr_0.8fr]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Rocket className="size-3.5 text-blue-600 dark:text-blue-400" />
            {text.eyebrow}
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-6xl [font-family:var(--font-display)]">
            {appName}
            <span className="block text-zinc-500 dark:text-zinc-400">{text.center}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">{text.description}</p>
          <Link
            href={localizePath(locale, '/docs/overview/features')}
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <BookOpen className="size-4" />
            {text.start}
          </Link>
        </div>

        <div className="flex min-h-80 items-center justify-center rounded-3xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
          <img src="/logo.svg" alt={appName} className="size-40 drop-shadow-2xl md:size-52" />
        </div>
      </section>

      <section className="mt-16 grid gap-4 border-t border-zinc-200 pt-10 md:grid-cols-3 dark:border-zinc-800">
        {text.cards.map(([title, description], index) => {
          const Icon = cardIcons[index];
          return (
            <div key={title} className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <Icon className="size-5 text-blue-600 dark:text-blue-400" />
              <h2 className="mt-4 font-medium text-zinc-950 dark:text-zinc-50">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{description}</p>
            </div>
          );
        })}
      </section>
    </main>
  );
}

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];

  return {
    title: `${appNames[locale]} ${text.center}`,
    description: text.description,
    alternates: {
      languages: {
        en: '/',
        'zh-CN': '/zh-CN',
      },
    },
  };
}
