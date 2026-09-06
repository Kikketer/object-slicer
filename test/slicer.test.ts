import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sliceStl } from "../engine/slicer";

const models = {
  jaw: "/Users/chris/Downloads/Jaw.stl",
  hollowBall: "/Users/chris/Downloads/HollowBall.stl",
  simpleSphere: "/Users/chris/Downloads/SimpleSphere.stl",
};

const cases = [
  {
    name: "jaw-interlocking",
    stlPath: models.jaw,
    mode: "interlocking" as const,
    thickness: 3,
    count: 15,
    sheet: [100, 100] as [number, number],
    scale: 1,
  },
  {
    name: "jaw-stacked",
    stlPath: models.jaw,
    mode: "stacked" as const,
    thickness: 3,
    count: 10,
    sheet: [100, 100] as [number, number],
    scale: 1,
  },
  {
    name: "hollowBall-interlocking",
    stlPath: models.hollowBall,
    mode: "interlocking" as const,
    thickness: 3,
    count: 6,
    sheet: [200, 200] as [number, number],
    scale: 1,
  },
  {
    name: "simpleSphere-stacked",
    stlPath: models.simpleSphere,
    mode: "stacked" as const,
    thickness: 3,
    count: 5,
    sheet: [200, 200] as [number, number],
    scale: 1,
  },
];

const expectedDir = "test/fixtures/expected";

function sheetsDir(file: string) {
  return file.replace(/\.svg$/, "") + "_sheets";
}

for (const c of cases) {
  it(c.name, async () => {
    const { name, stlPath, ...opts } = c;
    const expectedSvg = path.join(expectedDir, `${name}.svg`);
    const expectedSheetsDir = sheetsDir(expectedSvg);
    const tmpOutput = path.join(os.tmpdir(), `objectslicer-test-${name}.svg`);

    try {
      const result = await sliceStl({ ...opts, stlPath, output: tmpOutput });
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.sheets).toBeGreaterThan(0);

      const actual = await Bun.file(tmpOutput).text();
      const expected = await Bun.file(expectedSvg).text();
      expect(actual).toBe(expected);

      const tmpSheetsDir = sheetsDir(tmpOutput);
      const expectedFiles = fs.readdirSync(expectedSheetsDir)
        .filter((f) => f.endsWith(".svg"))
        .sort();
      const actualFiles = fs.readdirSync(tmpSheetsDir)
        .filter((f) => f.endsWith(".svg"))
        .sort();
      expect(actualFiles).toEqual(expectedFiles);

      for (const f of expectedFiles) {
        const a = await Bun.file(path.join(tmpSheetsDir, f)).text();
        const e = await Bun.file(path.join(expectedSheetsDir, f)).text();
        expect(a).toBe(e);
      }
    } finally {
      try {
        fs.rmSync(tmpOutput, { force: true });
        fs.rmSync(sheetsDir(tmpOutput), { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  });
}
