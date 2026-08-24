import { Bot, Cloud, Database, ImagePlus, Library, Settings2, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const modelRows = [
    ["Grok Imagine", "生图", "文生图与创意视觉"],
    ["GPT Image 2", "生图", "文生图、参考图与编辑"],
    ["Nano Banana 2", "生图", "文生图与参考图生成"],
    ["MiniMax H3", "视频", "文生视频，支持图片、视频和音频参考"],
];

const englishModelRows = [
    ["Grok Imagine", "Image", "Text-to-image and creative visuals"],
    ["GPT Image 2", "Image", "Generation, references, and editing"],
    ["Nano Banana 2", "Image", "Generation with image references"],
    ["MiniMax H3", "Video", "Text-to-video with image, video, and audio references"],
];

export default function DocsPage() {
    const { i18n } = useTranslation();
    const chinese = i18n.resolvedLanguage !== "en-US";
    const rows = chinese ? modelRows : englishModelRows;

    const labels = chinese
        ? { title: "WorldCodes Canvas 使用文档", intro: "画布、模型、提示词、参考素材、存储与本地 Agent 的站内说明。", start: "快速开始", models: "模型与渠道", prompts: "提示词库", storage: "参考素材与存储", agent: "本地 Agent", deployment: "部署结构" }
        : { title: "WorldCodes Canvas Documentation", intro: "In-site guidance for canvases, models, prompts, references, storage, and the local Agent.", start: "Quick start", models: "Models and channel", prompts: "Prompt library", storage: "References and storage", agent: "Local Agent", deployment: "Deployment" };

    const sections = [
        ["start", labels.start],
        ["models", labels.models],
        ["prompts", labels.prompts],
        ["storage", labels.storage],
        ["agent", labels.agent],
        ["deployment", labels.deployment],
    ];

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="hidden lg:block">
                    <nav className="sticky top-8 space-y-1 border-l border-stone-200 pl-4 text-sm dark:border-stone-800">
                        {sections.map(([id, label]) => (
                            <a key={id} href={`#${id}`} className="block py-1.5 text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white">
                                {label}
                            </a>
                        ))}
                    </nav>
                </aside>

                <article className="min-w-0 max-w-4xl">
                    <header className="border-b border-stone-200 pb-10 dark:border-stone-800">
                        <div className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                            <img src="/logo.svg" alt="" className="size-4" />
                            WorldCodes Canvas
                        </div>
                        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">{labels.title}</h1>
                        <p className="mt-4 max-w-2xl text-base leading-8 text-stone-500 dark:text-stone-400">{labels.intro}</p>
                    </header>

                    <section id="start" className="scroll-mt-8 border-b border-stone-200 py-10 dark:border-stone-800">
                        <SectionTitle icon={<Workflow />} title={labels.start} />
                        {chinese ? (
                            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
                                <Step number="1" title="确认模型渠道">前往配置页检查 WorldCodes Relay 与模型分组。</Step>
                                <Step number="2" title="创建画布">在画布中添加文本、图片、视频、音频或生成配置节点。</Step>
                                <Step number="3" title="连接并生成">连接参考节点，选择模型参数后开始生成。</Step>
                            </ol>
                        ) : (
                            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
                                <Step number="1" title="Check the channel">Verify WorldCodes Relay and model capabilities in Settings.</Step>
                                <Step number="2" title="Create a canvas">Add text, image, video, audio, or generation nodes.</Step>
                                <Step number="3" title="Connect and generate">Connect references, select parameters, and start generation.</Step>
                            </ol>
                        )}
                        <div className="mt-6 flex flex-wrap gap-3">
                            <Link to="/config" className="inline-flex items-center gap-2 rounded-lg bg-stone-950 px-4 py-2 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950"><Settings2 className="size-4" />{chinese ? "打开配置" : "Open settings"}</Link>
                            <Link to="/canvas" className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium dark:border-stone-700"><ImagePlus className="size-4" />{chinese ? "打开画布" : "Open canvas"}</Link>
                        </div>
                    </section>

                    <section id="models" className="scroll-mt-8 border-b border-stone-200 py-10 dark:border-stone-800">
                        <SectionTitle icon={<Cloud />} title={labels.models} />
                        <p className="mt-4 leading-7 text-stone-600 dark:text-stone-300">
                            {chinese ? "站点默认通过同源 WorldCodes Relay 调用模型。浏览器只保存并发送用户自己的 WorldCodes API Key；上游供应商密钥和路由只保留在 Relay。" : "The site calls models through the same-origin WorldCodes Relay. The browser stores and sends only the user's WorldCodes API key; provider credentials and upstream routing remain inside Relay."}
                        </p>
                        <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                            {rows.map(([name, capability, use], index) => (
                                <div key={name} className={`grid gap-2 px-4 py-3 text-sm sm:grid-cols-[160px_90px_1fr] ${index ? "border-t border-stone-200 dark:border-stone-800" : ""}`}>
                                    <span className="font-medium">{name}</span><span className="text-stone-500 dark:text-stone-400">{capability}</span><span className="text-stone-600 dark:text-stone-300">{use}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section id="prompts" className="scroll-mt-8 border-b border-stone-200 py-10 dark:border-stone-800">
                        <SectionTitle icon={<Library />} title={labels.prompts} />
                        <p className="mt-4 leading-7 text-stone-600 dark:text-stone-300">
                            {chinese ? "内置 7 组提示词源，数据 JSON 随站点静态包发布，并缓存到当前浏览器 IndexedDB。页面不会跳转到来源站点；预览图可继续使用其公开 HTTPS 地址。" : "Seven built-in prompt sources ship as static JSON with this site and are cached in this browser's IndexedDB. The UI never navigates to source sites; preview images may continue to use their public HTTPS addresses."}
                        </p>
                        <Link to="/prompts" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium dark:border-stone-700"><Library className="size-4" />{chinese ? "打开提示词库" : "Open prompt library"}</Link>
                    </section>

                    <section id="storage" className="scroll-mt-8 border-b border-stone-200 py-10 dark:border-stone-800">
                        <SectionTitle icon={<Database />} title={labels.storage} />
                        <div className="mt-6 grid gap-4 sm:grid-cols-2">
                            <InfoCard title={chinese ? "编辑期间：浏览器本地" : "During editing: local browser"}>
                                {chinese ? "本地参考图片、音频和视频保存在当前浏览器的 IndexedDB，不经过站点应用服务器。清理浏览器数据会删除这些本地素材。" : "Local image, audio, and video references are stored in this browser's IndexedDB and do not pass through the application server. Clearing browser data removes them."}
                            </InfoCard>
                            <InfoCard title={chinese ? "生成期间：R2 临时对象" : "During generation: temporary R2 objects"}>
                                {chinese ? "MiniMax H3 需要公网可读参考素材时，Relay 只签发上传地址；浏览器直接上传到 R2，PixStag 通过短读取域名访问临时对象。任务结束后清理，异常任务按生命周期自动过期。" : "When MiniMax H3 needs public references, Relay issues a signed upload URL, the browser uploads directly to R2, and PixStag reads temporary objects through the short media domain. Objects are removed after the task or expire automatically."}
                            </InfoCard>
                        </div>
                    </section>

                    <section id="agent" className="scroll-mt-8 border-b border-stone-200 py-10 dark:border-stone-800">
                        <SectionTitle icon={<Bot />} title={labels.agent} />
                        <div className="mt-4 space-y-4 leading-7 text-stone-600 dark:text-stone-300">
                            <p>{chinese ? "Agent 是可选的本地桥接器，用来让 Codex 读取和操作当前画布。生图、视频生成和素材管理本身不依赖 Agent。" : "The Agent is an optional local bridge that lets Codex read and operate the active canvas. Image/video generation and asset management do not require it."}</p>
                            <p>{chinese ? "它需要访问用户本机的 Codex、Skills 和工作区，因此不能作为多人共享服务部署在 Relay 服务器。正确方式是每位需要 Agent 的用户在自己的电脑上运行 WorldCodes Canvas Agent，再通过 localhost 与网页连接。" : "It needs access to the user's local Codex, Skills, and workspace, so it must not run as a shared service on Relay. Each Agent user runs WorldCodes Canvas Agent locally and connects the site through localhost."}</p>
                            <div className="rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                {chinese ? "站点已显示 Agent 入口，但对话依赖用户电脑上的 WorldCodes Canvas Agent；Relay 不保存或代跑本地工作区。" : "The Agent entry is visible, but chat requires WorldCodes Canvas Agent on the user's computer; Relay neither stores nor runs local workspaces."}
                            </div>
                        </div>
                    </section>

                    <section id="deployment" className="scroll-mt-8 py-10">
                        <SectionTitle icon={<Cloud />} title={labels.deployment} />
                        <div className="mt-6 rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                            <div className="grid gap-4 text-sm sm:grid-cols-[150px_1fr]">
                                <strong>{chinese ? "站点子域名" : "Site subdomain"}</strong><span className="text-stone-600 dark:text-stone-300">WorldCodes Canvas Web</span>
                                <strong>Relay API</strong><span className="text-stone-600 dark:text-stone-300">PixStag / MiniMax H3 / image providers / signed media uploads</span>
                                <strong>Cloudflare R2</strong><span className="text-stone-600 dark:text-stone-300">{chinese ? "临时参考媒体对象存储" : "Temporary reference media objects"}</span>
                                <strong>Local Agent</strong><span className="text-stone-600 dark:text-stone-300">{chinese ? "仅在用户电脑运行，不进入 Relay" : "Runs only on the user's computer, never inside Relay"}</span>
                            </div>
                        </div>
                    </section>
                </article>
            </div>
        </main>
    );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
    return <h2 className="flex items-center gap-3 text-2xl font-semibold [&_svg]:size-5">{icon}{title}</h2>;
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
    return <li className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><span className="text-xs font-semibold text-stone-400">0{number}</span><h3 className="mt-2 font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{children}</p></li>;
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
    return <div className="rounded-xl border border-stone-200 p-5 dark:border-stone-800"><h3 className="font-medium">{title}</h3><p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{children}</p></div>;
}
