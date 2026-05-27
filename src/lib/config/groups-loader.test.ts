import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const UUID_A = "12345678-1234-1234-1234-123456789abc";
const UUID_B = "87654321-4321-4321-4321-cba987654321";
const UUID_ADMIN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function writeTmp(yaml: string): string {
  const p = join(tmpdir(), `mrbs-groups-${Date.now()}-${Math.random()}.yaml`);
  writeFileSync(p, yaml, "utf-8");
  return p;
}

describe("loadGroups", () => {
  const tmpFiles: string[] = [];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }
    tmpFiles.length = 0;
  });

  function tmp(yaml: string): string {
    const p = writeTmp(yaml);
    tmpFiles.push(p);
    return p;
  }

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  it("parses a valid groups config with one staff group", async () => {
    const p = tmp(`
staff_groups:
  - "${UUID_A}"
admin_group: "${UUID_ADMIN}"
`);
    const { loadGroups } = await import("./groups-loader");
    const result = loadGroups(p);
    expect(result.staff_groups).toEqual([UUID_A]);
    expect(result.admin_group).toBe(UUID_ADMIN);
  });

  it("parses multiple staff groups", async () => {
    const p = tmp(`
staff_groups:
  - "${UUID_A}"
  - "${UUID_B}"
admin_group: "${UUID_ADMIN}"
`);
    const { loadGroups } = await import("./groups-loader");
    const result = loadGroups(p);
    expect(result.staff_groups).toEqual([UUID_A, UUID_B]);
  });

  it("parses the real config/groups.yaml without errors", async () => {
    const { loadGroups } = await import("./groups-loader");
    // The real file uses placeholder UUIDs (valid format, not real group IDs)
    expect(() => loadGroups()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Validation failures
  // ---------------------------------------------------------------------------

  it("throws when staff_groups is empty", async () => {
    const p = tmp(`
staff_groups: []
admin_group: "${UUID_ADMIN}"
`);
    const { loadGroups } = await import("./groups-loader");
    expect(() => loadGroups(p)).toThrow("At least one staff group");
  });

  it("throws when admin_group is not a UUID", async () => {
    const p = tmp(`
staff_groups:
  - "${UUID_A}"
admin_group: "not-a-uuid"
`);
    const { loadGroups } = await import("./groups-loader");
    expect(() => loadGroups(p)).toThrow("Invalid config/groups.yaml");
  });

  it("throws when a staff_groups entry is not a UUID", async () => {
    const p = tmp(`
staff_groups:
  - "All Staff"
admin_group: "${UUID_ADMIN}"
`);
    const { loadGroups } = await import("./groups-loader");
    expect(() => loadGroups(p)).toThrow("Invalid config/groups.yaml");
  });

  it("throws when admin_group is missing", async () => {
    const p = tmp(`
staff_groups:
  - "${UUID_A}"
`);
    const { loadGroups } = await import("./groups-loader");
    expect(() => loadGroups(p)).toThrow("Invalid config/groups.yaml");
  });

  it("throws when staff_groups is missing", async () => {
    const p = tmp(`
admin_group: "${UUID_ADMIN}"
`);
    const { loadGroups } = await import("./groups-loader");
    expect(() => loadGroups(p)).toThrow("Invalid config/groups.yaml");
  });
});
