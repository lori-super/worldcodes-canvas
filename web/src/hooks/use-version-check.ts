import { useCallback, useMemo, useState } from "react";
import { APP_VERSION } from "@/constant/env";
import type { ReleaseInfo } from "@/lib/release";

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const localReleases = useMemo(readLocalReleases, []);
    const latestVersion = currentVersion;
    const releases = localReleases;
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
    }, []);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        hasNewVersion,
    };
}
