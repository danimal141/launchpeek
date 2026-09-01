import { describe, expect, test } from "bun:test";
import { actionCommand } from "../src/core/actions";
import type { Job } from "../src/types";

const job = {
  label: "com.example.demo",
  plistPath: "/Users/me/Library/LaunchAgents/com.example.demo.plist",
} as Job;

describe("actionCommand", () => {
  test("SPEC どおりのコマンドを組み立てる", () => {
    expect(actionCommand("kickstart", job, 504)).toEqual([
      "launchctl",
      "kickstart",
      "-k",
      "gui/504/com.example.demo",
    ]);
    expect(actionCommand("enable", job, 504)).toEqual([
      "launchctl",
      "enable",
      "gui/504/com.example.demo",
    ]);
    expect(actionCommand("disable", job, 504)).toEqual([
      "launchctl",
      "disable",
      "gui/504/com.example.demo",
    ]);
    expect(actionCommand("bootstrap", job, 504)).toEqual([
      "launchctl",
      "bootstrap",
      "gui/504",
      "/Users/me/Library/LaunchAgents/com.example.demo.plist",
    ]);
    expect(actionCommand("bootout", job, 504)).toEqual([
      "launchctl",
      "bootout",
      "gui/504/com.example.demo",
    ]);
    expect(actionCommand("kill", job, 504)).toEqual([
      "launchctl",
      "kill",
      "SIGTERM",
      "gui/504/com.example.demo",
    ]);
  });
});
