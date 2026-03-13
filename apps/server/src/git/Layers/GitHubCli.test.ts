import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { GitHubCliLive } from "./GitHubCli.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitHubCliLive);

afterEach(() => {
  mockedRunProcess.mockReset();
});

layer("GitHubCliLive", (it) => {
  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 42,
          title: "Add PR thread creation",
          url: "https://github.com/pingdotgg/codething-mvp/pull/42",
          baseRefName: "main",
          headRefName: "feature/pr-threads",
          state: "OPEN",
          mergedAt: null,
          isCrossRepository: true,
          headRepository: {
            nameWithOwner: "octocat/codething-mvp",
          },
          headRepositoryOwner: {
            login: "octocat",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "#42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          nameWithOwner: "octocat/codething-mvp",
          url: "https://github.com/octocat/codething-mvp",
          sshUrl: "git@github.com:octocat/codething-mvp.git",
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/codething-mvp",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockRejectedValueOnce(
        new Error(
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
        ),
      );

      const error = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.getPullRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
    }),
  );

  it.effect("returns an empty check list when GitHub reports no checks for the branch", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockRejectedValueOnce(
        new Error(
          "gh pr checks https://github.com/pingdotgg/codething-mvp/pull/42 --json bucket,completedAt,description,event,link,name,startedAt,state,workflow failed (code=1, signal=null). no checks reported on the 'main' branch",
        ),
      );

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.listPullRequestChecks({
          cwd: "/repo",
          reference: "https://github.com/pingdotgg/codething-mvp/pull/42",
        });
      });

      assert.deepStrictEqual(result, []);
    }),
  );

  it.effect("returns only unresolved review threads as findings", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "PRRT_unresolved",
                      isResolved: false,
                      path: "apps/web/src/App.tsx",
                      line: 44,
                      originalLine: 44,
                      comments: {
                        nodes: [
                          {
                            id: "PRRC_root",
                            body: "Please simplify this branch.",
                            url: "https://github.com/pingdotgg/codething-mvp/pull/42#discussion_r1",
                            createdAt: "2026-03-10T12:00:00Z",
                            updatedAt: "2026-03-10T12:05:00Z",
                            author: {
                              login: "coderabbitai",
                            },
                          },
                          {
                            id: "PRRC_reply",
                            body: "Still needs work.",
                            url: "https://github.com/pingdotgg/codething-mvp/pull/42#discussion_r2",
                            createdAt: "2026-03-10T12:06:00Z",
                            updatedAt: "2026-03-10T12:10:00Z",
                            author: {
                              login: "reviewer",
                            },
                          },
                        ],
                      },
                    },
                    {
                      id: "PRRT_resolved",
                      isResolved: true,
                      path: "apps/web/src/Old.tsx",
                      line: 12,
                      originalLine: 12,
                      comments: {
                        nodes: [
                          {
                            id: "PRRC_resolved",
                            body: "Already fixed.",
                            url: "https://github.com/pingdotgg/codething-mvp/pull/42#discussion_r3",
                            createdAt: "2026-03-10T11:00:00Z",
                            updatedAt: "2026-03-10T11:02:00Z",
                            author: {
                              login: "reviewer",
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const gh = yield* GitHubCli;
        return yield* gh.listPullRequestReviewFindings({
          cwd: "/repo",
          repository: "pingdotgg/codething-mvp",
          number: 42,
        });
      });

      assert.deepStrictEqual(result, [
        {
          id: "PRRT_unresolved",
          authorLogin: "coderabbitai",
          authorName: null,
          body: "Please simplify this branch.",
          path: "apps/web/src/App.tsx",
          line: 44,
          url: "https://github.com/pingdotgg/codething-mvp/pull/42#discussion_r1",
          createdAt: "2026-03-10T12:00:00Z",
          updatedAt: "2026-03-10T12:10:00Z",
        },
      ]);
    }),
  );
});
