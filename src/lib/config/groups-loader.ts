import fs from "fs";
import path from "path";
import { parse } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema mirrors config/groups.yaml.
// ---------------------------------------------------------------------------

const GroupsFileSchema = z.object({
  staff_groups: z
    .array(z.string().uuid("staff_groups entries must be valid UUIDs"))
    .min(1, "At least one staff group is required"),
  admin_group: z.string().uuid("admin_group must be a valid UUID"),
});

export type GroupsConfig = z.infer<typeof GroupsFileSchema>;

let _groups: GroupsConfig | undefined;

export function loadGroups(filePath?: string): GroupsConfig {
  if (_groups) return _groups;

  const resolved = filePath ?? path.join(process.cwd(), "config", "groups.yaml");
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = parse(raw) as unknown;

  const result = GroupsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config/groups.yaml:\n${issues}`);
  }

  _groups = result.data;
  return _groups;
}
