export const workspaceFileSchema = "lambda-graph.workspace.v1" as const;

export type WorkspaceFileMode = "pretty" | "text";

export type WorkspaceFileRowV1 = {
  id?: string;
  source: string;
  latex?: string;
  mode: WorkspaceFileMode;
};

export type WorkspaceFileViewV1 = {
  expressionSizeScale?: number;
  sidebarWidth?: number;
};

export type WorkspaceFileV1 = {
  schema: typeof workspaceFileSchema;
  rows: WorkspaceFileRowV1[];
  view?: WorkspaceFileViewV1;
};

export function readWorkspaceFile(value: unknown): WorkspaceFileV1 | null {
  if (!isRecord(value)) return null;
  if (value.schema !== workspaceFileSchema) return null;
  if (!Array.isArray(value.rows)) return null;

  const rows = value.rows.map(readWorkspaceFileRow);
  if (rows.some((row) => row === null)) return null;

  const view = readWorkspaceFileView(value.view);
  if (view === null) return null;

  const file: WorkspaceFileV1 = {
    schema: workspaceFileSchema,
    rows: rows as WorkspaceFileRowV1[]
  };
  if (view) file.view = view;
  return file;
}

function readWorkspaceFileRow(value: unknown): WorkspaceFileRowV1 | null {
  if (!isRecord(value)) return null;
  if (typeof value.source !== "string") return null;
  if (value.id !== undefined && typeof value.id !== "string") return null;
  if (value.mode !== "pretty" && value.mode !== "text") return null;
  if (value.latex !== undefined && typeof value.latex !== "string") return null;

  const row: WorkspaceFileRowV1 = {
    source: value.source,
    mode: value.mode
  };
  if (typeof value.id === "string") row.id = value.id;
  if (typeof value.latex === "string") row.latex = value.latex;
  return row;
}

function readWorkspaceFileView(value: unknown): WorkspaceFileViewV1 | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const view: WorkspaceFileViewV1 = {};
  if (value.expressionSizeScale !== undefined) {
    if (!isFiniteNumber(value.expressionSizeScale)) return null;
    view.expressionSizeScale = value.expressionSizeScale;
  }
  if (value.sidebarWidth !== undefined) {
    if (!isFiniteNumber(value.sidebarWidth)) return null;
    view.sidebarWidth = value.sidebarWidth;
  }
  return view;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
