import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type ProviderKind } from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";

import { MAX_CUSTOM_MODEL_LENGTH, useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import {
  serverConfigQueryOptions,
  serverLinearConfigQueryOptions,
  serverQueryKeys,
} from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { preferredTerminalEditor } from "../terminal-links";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { APP_VERSION } from "../branding";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
] as const;

function getCustomModelsForProvider(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
    default:
      return settings.customCodexModels;
  }
}

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
    default:
      return defaults.customCodexModels;
  }
}

function patchCustomModels(provider: ProviderKind, models: string[]) {
  switch (provider) {
    case "codex":
    default:
      return { customCodexModels: models };
  }
}

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverLinearConfigQuery = useQuery(serverLinearConfigQueryOptions());
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [editingLinearCredentialId, setEditingLinearCredentialId] = useState<string | null>(null);
  const [linearCredentialNameInput, setLinearCredentialNameInput] = useState("");
  const [linearCredentialApiKeyInput, setLinearCredentialApiKeyInput] = useState("");
  const [linearCredentialMessage, setLinearCredentialMessage] = useState<string | null>(null);
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const linearConfig = serverLinearConfigQuery.data ?? null;
  const saveLinearCredentialMutation = useMutation({
    mutationFn: async (input: { credentialId?: string | null; name: string; apiKey: string }) => {
      const api = ensureNativeApi();
      return api.server.upsertLinearCredential(input);
    },
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: serverQueryKeys.linearConfig() }),
        queryClient.invalidateQueries({ queryKey: serverQueryKeys.linearProjectBindings() }),
        queryClient.invalidateQueries({ queryKey: ["linear"] }),
      ]);
      setEditingLinearCredentialId(null);
      setLinearCredentialNameInput("");
      setLinearCredentialApiKeyInput("");
      setLinearCredentialMessage(
        variables.credentialId
          ? `Updated Linear credential "${variables.name}".`
          : `Saved Linear credential "${variables.name}".`,
      );
    },
    onError: (error) => {
      setLinearCredentialMessage(
        error instanceof Error ? error.message : "Failed to save the Linear credential.",
      );
    },
  });
  const deleteLinearCredentialMutation = useMutation({
    mutationFn: async (credentialId: string) => {
      const api = ensureNativeApi();
      return api.server.deleteLinearCredential({ credentialId });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: serverQueryKeys.linearConfig() }),
        queryClient.invalidateQueries({ queryKey: serverQueryKeys.linearProjectBindings() }),
        queryClient.invalidateQueries({ queryKey: ["linear"] }),
      ]);
      setEditingLinearCredentialId(null);
      setLinearCredentialNameInput("");
      setLinearCredentialApiKeyInput("");
      setLinearCredentialMessage(
        "Removed the Linear credential and cleared any project bindings using it.",
      );
    },
    onError: (error) => {
      setLinearCredentialMessage(
        error instanceof Error ? error.message : "Failed to delete the Linear credential.",
      );
    },
  });

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    void api.shell
      .openInEditor(keybindingsConfigPath, preferredTerminalEditor())
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [keybindingsConfigPath]);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Code handles light and dark mode.
                </p>
              </div>

              <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                {THEME_OPTIONS.map((option) => {
                  const selected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary/60 bg-primary/8 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                      onClick={() => setTheme(option.value)}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs">{option.description}</span>
                      </span>
                      {selected ? (
                        <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
              </p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p>Binary source</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-foreground">
                      {codexBinaryPath || "PATH"}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Linear Integration</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save multiple named Linear credentials on the server and bind each project to the
                  right workspace/team.
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  Status:{" "}
                  <span className="font-medium text-foreground">
                    {linearConfig
                      ? linearConfig.configured
                        ? `${linearConfig.credentials.length} credential${linearConfig.credentials.length === 1 ? "" : "s"} available`
                        : "Not configured"
                      : "Loading..."}
                  </span>
                </div>

                <div className="grid gap-3 rounded-xl border border-border/70 bg-background p-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <label htmlFor="linear-credential-name" className="block space-y-1">
                    <span className="text-xs font-medium text-foreground">Credential label</span>
                    <Input
                      id="linear-credential-name"
                      value={linearCredentialNameInput}
                      onChange={(event) => {
                        setLinearCredentialNameInput(event.target.value);
                        setLinearCredentialMessage(null);
                      }}
                      placeholder="Personal workspace"
                    />
                  </label>
                  <label htmlFor="linear-api-key" className="block space-y-1">
                    <span className="text-xs font-medium text-foreground">Linear API key</span>
                    <Input
                      id="linear-api-key"
                      type="password"
                      autoComplete="off"
                      value={linearCredentialApiKeyInput}
                      onChange={(event) => {
                        setLinearCredentialApiKeyInput(event.target.value);
                        setLinearCredentialMessage(null);
                      }}
                      placeholder="lin_api_..."
                    />
                  </label>
                  <p className="text-xs text-muted-foreground md:col-span-2">
                    Stored on the server in your local app state directory, not in browser
                    `localStorage`. Environment credentials stay read-only and appear below when
                    `LINEAR_API_KEY` is set.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void saveLinearCredentialMutation.mutateAsync({
                          credentialId: editingLinearCredentialId,
                          name: linearCredentialNameInput,
                          apiKey: linearCredentialApiKeyInput,
                        });
                      }}
                      disabled={
                        saveLinearCredentialMutation.isPending ||
                        linearCredentialNameInput.trim().length === 0 ||
                        linearCredentialApiKeyInput.trim().length === 0
                      }
                    >
                      {saveLinearCredentialMutation.isPending
                        ? "Saving..."
                        : editingLinearCredentialId
                          ? "Update credential"
                          : "Add credential"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingLinearCredentialId(null);
                        setLinearCredentialNameInput("");
                        setLinearCredentialApiKeyInput("");
                        setLinearCredentialMessage(null);
                      }}
                      disabled={saveLinearCredentialMutation.isPending}
                    >
                      Clear form
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {(linearConfig?.credentials ?? []).length > 0 ? (
                    (linearConfig?.credentials ?? []).map((credential) => (
                      <div
                        key={credential.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {credential.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {credential.source === "env"
                              ? "Environment variable"
                              : credential.updatedAt
                                ? `Saved credential · updated ${new Date(credential.updatedAt).toLocaleString()}`
                                : "Saved credential"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {credential.source === "saved" ? (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  setEditingLinearCredentialId(credential.id);
                                  setLinearCredentialNameInput(credential.name);
                                  setLinearCredentialApiKeyInput("");
                                  setLinearCredentialMessage(
                                    `Editing "${credential.name}". Enter a replacement API key to update it.`,
                                  );
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  void deleteLinearCredentialMutation.mutateAsync(credential.id);
                                }}
                                disabled={deleteLinearCredentialMutation.isPending}
                              >
                                Delete
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Read only</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                      No Linear credentials saved yet.
                    </div>
                  )}
                </div>

                {linearCredentialMessage ? (
                  <p className="text-xs text-muted-foreground">{linearCredentialMessage}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(provider, [
                                      ...getDefaultCustomModelsForProvider(defaults, provider),
                                    ]),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                    {slug}
                                  </code>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Git</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customize generated Git naming defaults used by PR worktree preparation.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="pr-worktree-branch-prefix" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">
                    PR worktree branch prefix
                  </span>
                  <Input
                    id="pr-worktree-branch-prefix"
                    value={settings.pullRequestWorktreeBranchPrefix}
                    onChange={(event) =>
                      updateSettings({
                        pullRequestWorktreeBranchPrefix: event.target.value,
                      })
                    }
                    placeholder="t3code"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Used for generated fork PR worktree branches such as{" "}
                    <code>{settings.pullRequestWorktreeBranchPrefix}/pr-42/main</code>.
                  </span>
                </label>

                <div className="flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        pullRequestWorktreeBranchPrefix: defaults.pullRequestWorktreeBranchPrefix,
                      })
                    }
                  >
                    Reset Git defaults
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">About</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Application version and environment information.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Version</p>
                  <p className="text-xs text-muted-foreground">
                    Current version of the application.
                  </p>
                </div>
                <code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>
              </div>
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
