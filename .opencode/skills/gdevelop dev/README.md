# GDevelop WebGPU Engineer — OpenCode Skill

A repository-aware OpenCode Agent Skill for safely implementing WebGPU in the GDevelop engine.

## Install in this repository

Copy the folder `gdevelop-webgpu-engineer` into:

```text
< GDevelop repository >/.opencode/skills/gdevelop-webgpu-engineer/
```

The final layout should be:

```text
.opencode/
└── skills/
    └── gdevelop-webgpu-engineer/
        ├── SKILL.md
        └── references/
            ├── architecture-map.md
            └── webgpu-debug-playbook.md
```

OpenCode discovers project skills from `.opencode/skills/<skill-id>/SKILL.md`.

## Install globally

On Windows, copy the folder to:

```text
%USERPROFILE%\.config\opencode\skills\gdevelop-webgpu-engineer\
```

This makes it available across repositories.

## Use it

From the GDevelop repository, ask OpenCode to use:

```text
@gdevelop-webgpu-engineer
```

Example task:

```text
@gdevelop-webgpu-engineer
Investigate why the local Preview returns 404 for three-webgpu.js.
Trace the source import, build output, runtime staging, and Preview URL.
Do not modify files until you identify the root cause and show me the plan.
```

## Important: Skill vs MCP

This package is an OpenCode **Skill**. It gives the coding agent detailed GDevelop/WebGPU architecture instructions and a disciplined workflow.

It is **not itself an MCP server** and does not create filesystem, Git, terminal, or browser tools. Those tools must be provided by OpenCode's configured environment/MCP servers. The skill explicitly tells the agent to use them when available and not pretend to have access when they are absent.

For deeper repository understanding, the skill directs OpenCode to inspect the actual checkout and build a verified call graph instead of trusting stale assumptions.
