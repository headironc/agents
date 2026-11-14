import path from "node:path";
import { z } from "zod";
import { memberCategories, publicMembers } from "./delivery.ts";
import {
  adoptKeyPattern,
  isLegacyPrivateRun,
  legacyFileMembers,
  privateRunDirectory,
  recordedProducts,
  validLegacyProductRoots,
} from "./install-legacy.ts";
import type { RecordedProduct } from "./install-legacy.ts";
import { canonicalDigest, SourceEntrySchema } from "./source.ts";

export { adoptKeyPattern, recordedProducts } from "./install-legacy.ts";
export type { RecordedProduct } from "./install-legacy.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z.string().regex(/^[0-9]+$/);
const mode = z.number().int().min(0).max(0o7777);
const uid = z.number().int().nonnegative();
const bytewise = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

export function isNormalizedAbsolute(value: string): boolean {
  return (
    path.isAbsolute(value) &&
    path.normalize(value) === value &&
    (value === "/" || !value.endsWith("/")) &&
    !/[\0\r\n]/.test(value)
  );
}
const absolutePath = z
  .string()
  .refine(isNormalizedAbsolute, "Expected a normalized absolute path");

export const activeAdoptKeyPattern =
  /^(?:codex|dsh|antigravity):(?:[a-z0-9]+(?:-[a-z0-9]+)*|AGENTS\.md|README\.md|policy\/[a-z-]+\.md|tools\/[a-z-]+\.mjs|capability\/(?:README\.md|codex\.toml|codex-sessions\.toml|dsh-headless\.patch\.yml|rust-lints\.toml))$/;
const adoptKey = z.string().regex(adoptKeyPattern);

/** Build outputs and host tool files copied into each persistent runtime. */
export const installerBuildFiles = [
  "install.mjs",
  "install-licenses.txt",
] as const;
export const runtimeFiles = [
  {
    role: "node",
    source: ".cache/agents-tools/bin/node",
    name: "node",
    mode: 0o500,
  },
  {
    role: "node-license",
    source: ".cache/agents-tools/licenses/node-LICENSE",
    name: "NODE-LICENSE.txt",
    mode: 0o400,
  },
  {
    role: "installer",
    source: `.cache/agents-build/${installerBuildFiles[0]}`,
    name: "install.mjs",
    mode: 0o400,
  },
  {
    role: "installer-licenses",
    source: `.cache/agents-build/${installerBuildFiles[1]}`,
    name: "INSTALLER-LICENSES.txt",
    mode: 0o400,
  },
] as const;

const RootSchema = z.strictObject({
  path: absolutePath,
  variable: z
    .enum([
      "HOME",
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
      "DSH_HOME",
      "XDG_STATE_HOME",
      "AGENTS_BACKUP_ROOT",
    ])
    .nullable(),
  // The deepest existing physical component, so later commands can detect a replaced ancestor.
  anchor: z.strictObject({ path: absolutePath, dev: decimal, ino: decimal }),
});
export type RootRecord = z.infer<typeof RootSchema>;
export const InstallRootsSchema = z.strictObject({
  home: RootSchema,
  codex: RootSchema.optional(),
  claude: RootSchema.optional(),
  dsh: RootSchema.optional(),
  antigravity: RootSchema.optional(),
  state: RootSchema,
  deploy: RootSchema,
  backup: RootSchema,
});
export type InstallRoots = z.infer<typeof InstallRootsSchema>;

/** The recorded roots own the product selection, including legacy dual/triple-product plans. */
export function installationProducts(roots: InstallRoots): RecordedProduct[] {
  return recordedProducts.filter((product) => roots[product] !== undefined);
}

export const TargetStateSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("absent") }),
  z.strictObject({ type: z.literal("link"), value: z.string().min(1) }),
  z.strictObject({
    type: z.literal("file"),
    mode,
    uid,
    bytes: z.number().int().nonnegative(),
    sha256: digest,
  }),
  z.strictObject({ type: z.literal("directory"), mode, uid, sha256: digest }),
]);
export type TargetState = z.infer<typeof TargetStateSchema>;

export const InstallTargetSchema = z.strictObject({
  order: z.number().int().nonnegative(),
  kind: z.enum(["file", "directory"]),
  category: z.enum(memberCategories),
  product: z.enum(recordedProducts),
  key: adoptKey,
  path: absolutePath,
  source: absolutePath,
  installed: TargetStateSchema,
  before: TargetStateSchema,
  action: z.enum(["create", "replace", "unchanged"]),
  adopted: z.boolean(),
  backup: absolutePath.nullable(),
});
export type InstallTarget = z.infer<typeof InstallTargetSchema>;

const RuntimeSchema = z.strictObject({
  platform: z.enum(["darwin", "linux"]),
  arch: z.string().min(1),
  node: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  files: z.array(
    z.strictObject({
      role: z.enum(
        runtimeFiles.map((file) => file.role) as [string, ...string[]],
      ),
      path: absolutePath,
      source: z.string().min(1),
      mode,
      sha256: digest,
    }),
  ),
});
export type RuntimeRecord = z.infer<typeof RuntimeSchema>;

export const runIdPattern = /^[0-9]{8}T[0-9]{9}Z-[a-f0-9]{12}$/;
const runId = z.string().regex(runIdPattern);

export const InstallPlanSchema = z
  .strictObject({
    version: z.union([
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
    ]),
    createdAt: z.iso.datetime({ precision: 3 }),
    run: z.strictObject({
      id: runId,
      directory: absolutePath,
      plan: absolutePath,
      receipt: absolutePath,
      source: absolutePath,
      runtime: absolutePath,
    }),
    review: absolutePath,
    host: z.strictObject({
      hostname: z.string().min(1),
      machine: z.string().regex(/^[0-9A-Za-z-]{32,36}$/),
      uid,
      platform: z.enum(["darwin", "linux"]),
      arch: z.string().min(1),
    }),
    roots: InstallRootsSchema,
    checkout: z.strictObject({
      directory: absolutePath,
      commit: z.string().regex(/^[a-f0-9]{40}$/),
    }),
    report: z.strictObject({
      path: absolutePath,
      sha256: digest,
      source: digest,
    }),
    candidate: z.strictObject({
      entries: z.array(SourceEntrySchema).min(1),
      sha256: digest,
    }),
    runtime: RuntimeSchema,
    adopt: z.array(adoptKey),
    selectedTargets: z.array(adoptKey).min(1).optional(),
    // Missing target parents, parent first; apply creates each with mode 0700.
    newDirectories: z.array(absolutePath),
    targets: z.array(InstallTargetSchema).min(1),
    reported: z.union([
      z.array(absolutePath),
      z.array(z.strictObject({ path: absolutePath, state: TargetStateSchema })),
    ]),
    sha256: digest,
  })
  .superRefine((plan, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    const { sha256, ...body } = plan;
    if (plan.version >= 7) {
      if (!installationProducts(plan.roots).length)
        issue("Plans require at least one product root");
    } else if (!validLegacyProductRoots(plan.version as 5 | 6, plan.roots))
      issue("Legacy product roots must match the plan version");
    if (canonicalDigest(body) !== sha256) issue("Plan digest mismatch");
    if (plan.selectedTargets) {
      const keys = plan.targets.map((target) => target.key).sort(bytewise);
      if (
        plan.selectedTargets.some(
          (key, index) =>
            index > 0 && bytewise(plan.selectedTargets![index - 1]!, key) >= 0,
        ) ||
        canonicalDigest(keys) !== canonicalDigest(plan.selectedTargets)
      )
        issue("Selected targets must match the complete target list");
    }
    for (const collision of installPathCollisions(plan))
      issue(`Installation paths overlap: ${collision}`);
    const paths = plan.candidate.entries.map((entry) => entry.path);
    if (
      paths.some(
        (item, index) => index > 0 && bytewise(paths[index - 1]!, item) >= 0,
      ) ||
      canonicalDigest(plan.candidate.entries) !== plan.candidate.sha256
    )
      issue("Candidate entries must be sorted, unique and bound");
    const run = plan.run;
    const privateRun = privateRunDirectory(plan.version, plan.roots, run.id);
    if (
      run.directory !== path.join(plan.roots.deploy.path, run.id) ||
      run.plan !== path.join(run.directory, "deployment-plan.json") ||
      run.receipt !== path.join(run.directory, "deployment-receipt.json") ||
      run.source !== path.join(privateRun, "source") ||
      run.runtime !== path.join(privateRun, "runtime")
    )
      issue("Run paths must derive from the deploy root and run id");
    if (
      new Set(plan.runtime.files.map((file) => file.role)).size !==
        runtimeFiles.length ||
      plan.runtime.files.length !== runtimeFiles.length
    ) {
      issue("Runtime must contain each required file once");
    }
    if (
      new Set(plan.targets.map((target) => target.path)).size !==
      plan.targets.length
    )
      issue("Target paths must be unique");
    if (
      plan.adopt.some(
        (item, index) =>
          index > 0 && bytewise(plan.adopt[index - 1]!, item) >= 0,
      )
    )
      issue("Adopted keys must be sorted and unique");
    const fileMembers: {
      product: RecordedProduct;
      category: (typeof memberCategories)[number];
      relative: string;
      source: string;
    }[] =
      plan.version === 9 ? publicMembers([]) : legacyFileMembers(plan.version);
    plan.targets.forEach((target, index) => {
      const inside = (root: string, file: string) => {
        const relative = path.relative(root, file);
        return (
          relative !== "" &&
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        );
      };
      const name = target.key.slice(target.product.length + 1);
      const prefix =
        target.product !== "antigravity" || plan.version < 8
          ? ""
          : plan.version === 8
            ? "antigravity-cli/"
            : "config/";
      const relative =
        target.category === "skill" ? `${prefix}skills/${name}` : name;
      const member =
        target.category === "skill"
          ? /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
            ? { relative, source: `delivery/skills/${name}` }
            : undefined
          : fileMembers.find(
              (member) =>
                member.product === target.product &&
                member.category === target.category &&
                member.relative ===
                  (target.category === "instructions"
                    ? relative
                    : `${prefix}${relative}`),
            );
      if (
        !target.key.startsWith(`${target.product}:`) ||
        !member ||
        target.path !==
          path.join(plan.roots[target.product]?.path ?? "", member.relative) ||
        target.source !== path.join(plan.run.source, member.source) ||
        target.kind !== (target.category === "skill" ? "directory" : "file") ||
        !plan.roots[target.product] ||
        !inside(plan.roots[target.product]!.path, target.path)
      )
        issue(`Target ${index} must match its product's delivery member`);
      if (
        target.backup !== null &&
        target.backup !==
          path.join(plan.roots.backup.path, run.id, String(index))
      )
        issue(`Target ${index} backup must belong to this run`);
      const { before } = target;
      const consistent =
        target.order === index &&
        (target.action === "create") === (before.type === "absent") &&
        (target.backup !== null) ===
          (before.type === "file" || before.type === "directory") &&
        (target.action === "unchanged") ===
          sameTarget(before, target.installed) &&
        (!target.adopted ||
          (target.action === "replace" && plan.adopt.includes(target.key)));
      if (!consistent) issue(`Inconsistent target ${index}`);
    });
    for (const key of plan.adopt)
      if (!plan.targets.some((target) => target.adopted && target.key === key))
        issue(`Unused adopted key: ${key}`);
  });
export type InstallPlan = z.infer<typeof InstallPlanSchema>;

/** Public targets cannot overlap source or recovery storage; Codex worktrees may share its root. */
export function installPathCollisions(
  plan: {
    roots: InstallRoots;
    checkout: { directory: string };
    review: string;
    run: { source: string; runtime: string };
    targets: { path: string }[];
  },
  resolvePath: (file: string) => string = (file) => file,
): string[] {
  const overlaps = (left: string, right: string) => {
    left = resolvePath(left);
    right = resolvePath(right);
    const contains = (root: string, file: string) => {
      const relative = path.relative(root, file);
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      );
    };
    return contains(left, right) || contains(right, left);
  };
  const codexWorktree = (directory: string) => {
    if (!plan.roots.codex) return false;
    const relative = path.relative(
      resolvePath(path.join(plan.roots.codex.path, "worktrees")),
      resolvePath(directory),
    );
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const roots = recordedProducts.flatMap((product) =>
    plan.roots[product] ? [plan.roots[product]!.path] : [],
  );
  const protectedPaths = [
    plan.roots.deploy.path,
    plan.roots.backup.path,
    plan.checkout.directory,
    plan.review,
  ];
  const privateRun = path.dirname(plan.run.source);
  const legacyPrivateRun = isLegacyPrivateRun(plan.roots, privateRun);
  const collisions: string[] = [];
  for (let index = 0; index < protectedPaths.length; index++)
    for (const other of protectedPaths.slice(index + 1))
      if (overlaps(protectedPaths[index]!, other)) collisions.push(other);
  for (let index = 0; index < roots.length; index++)
    for (const other of roots.slice(index + 1))
      if (overlaps(roots[index]!, other)) collisions.push(other);
  for (const root of roots)
    if (
      protectedPaths.some(
        (other) =>
          overlaps(root, other) &&
          !(
            root === plan.roots.codex?.path &&
            other === plan.checkout.directory &&
            codexWorktree(other)
          ),
      )
    )
      collisions.push(root);
  if (
    protectedPaths.some((other) => overlaps(privateRun, other)) ||
    roots.some(
      (root) =>
        overlaps(root, privateRun) &&
        // V5/V6 recovery storage lives under Codex; public targets remain checked below.
        !(root === plan.roots.codex?.path && legacyPrivateRun),
    )
  )
    collisions.push(privateRun);
  for (const target of plan.targets)
    if (
      [...protectedPaths, privateRun].some((other) =>
        overlaps(target.path, other),
      )
    )
      collisions.push(target.path);
  return [...new Set(collisions)];
}

function sameTarget(left: TargetState, right: TargetState): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}

/**
 * Written before each change and after its readback. Step and directory phases are observations to
 * re-check against the filesystem; recovery never infers an effect from a phase alone.
 */
export const InstallReceiptSchema = z
  .strictObject({
    version: z.union([
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
    ]),
    plan: z.strictObject({ path: absolutePath, sha256: digest }),
    run: z.strictObject({ id: runId, directory: absolutePath }),
    // The persistent recovery command is `<node> <installer> rollback --receipt <receipt>`.
    runtime: z.strictObject({
      node: absolutePath,
      nodeSha256: digest,
      installer: absolutePath,
      installerSha256: digest,
    }),
    status: z.enum([
      "applying",
      "installed",
      "failed-rolled-back",
      "failed-incomplete",
      "rolling-back",
      "rolled-back",
      "rollback-incomplete",
    ]),
    startedAt: z.iso.datetime({ precision: 3 }),
    updatedAt: z.iso.datetime({ precision: 3 }),
    directories: z.array(
      z.strictObject({
        path: absolutePath,
        phase: z.enum([
          "pending",
          "created",
          "removed",
          "retained",
          "not-created",
        ]),
      }),
    ),
    steps: z.array(
      z.strictObject({
        order: z.number().int().nonnegative(),
        phase: z.enum([
          "pending",
          "applied",
          "restored",
          "not-applied",
          "conflict-retained",
        ]),
        backup: z
          .strictObject({ path: absolutePath, sha256: digest, mode })
          .nullable(),
      }),
    ),
    errors: z.array(z.string()),
  })
  .superRefine((receipt, context) => {
    if (
      receipt.plan.path !==
      path.join(receipt.run.directory, "deployment-plan.json")
    ) {
      context.addIssue({
        code: "custom",
        message: "Receipt must bind the run's persistent plan",
      });
    }
    const orders = receipt.steps.map((step) => step.order);
    if (orders.some((order, index) => index > 0 && orders[index - 1]! >= order))
      context.addIssue({
        code: "custom",
        message: "Steps must follow plan order",
      });
  });
export type InstallReceipt = z.infer<typeof InstallReceiptSchema>;
