/**
 * Minimal duck-typed subset of Eliza core types we use.
 *
 * We deliberately don't import from `@elizaos/core` so the plugin compiles
 * standalone and stays compatible across the (currently fast-moving)
 * 1.x ↔ 2.x type changes. Eliza's runtime checks plugin shape structurally
 * (looks for `name`, `actions[]`, etc.), so duck typing is safe.
 *
 * If Eliza core's types diverge in a breaking way, this is the only file
 * that needs an update — the rest of the plugin is shape-stable.
 */

export interface ElizaContent {
  text?: string;
  [k: string]: unknown;
}

export interface ElizaMemory {
  content: ElizaContent;
  [k: string]: unknown;
}

export interface ElizaState {
  [k: string]: unknown;
}

export interface ElizaRuntime {
  getSetting: (key: string) => string | null | undefined;
  [k: string]: unknown;
}

export type ElizaHandlerCallback = (response: ElizaContent) => Promise<unknown>;

export interface ElizaAction {
  name: string;
  description: string;
  similes?: string[];
  examples?: unknown[];
  validate: (
    runtime: ElizaRuntime,
    message: ElizaMemory,
    state?: ElizaState
  ) => Promise<boolean>;
  handler: (
    runtime: ElizaRuntime,
    message: ElizaMemory,
    state?: ElizaState,
    options?: unknown,
    callback?: ElizaHandlerCallback
  ) => Promise<unknown>;
}

export interface ElizaPlugin {
  name: string;
  description: string;
  init?: (
    config: Record<string, unknown>,
    runtime: ElizaRuntime
  ) => Promise<void>;
  actions?: ElizaAction[];
}
