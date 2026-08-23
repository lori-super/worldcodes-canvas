import type { ReactNode } from "react";
import { useEffect } from "react";

import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    usePromptSourceScheduler();

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        let changed = false;
        for (const key of Array.from(searchParams.keys())) {
            if (!["apikey", "baseurl"].includes(key.toLowerCase())) continue;
            searchParams.delete(key);
            changed = true;
        }
        if (changed) window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
    }, []);

    return <>{children}</>;
}
