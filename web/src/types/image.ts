export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    role?: "first_frame" | "last_frame" | "reference_image";
};
