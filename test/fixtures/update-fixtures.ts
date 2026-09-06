import * as fs from "fs";
import * as path from "path";
import { sliceStl } from "../../engine/slicer";

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

const outDir = "test/fixtures/expected";
fs.mkdirSync(outDir, { recursive: true });

for (const c of cases) {
  const { name, stlPath, ...opts } = c;
  const output = path.join(outDir, `${name}.svg`);
  const result = await sliceStl({ ...opts, stlPath, output });
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  console.log(`${name}: ${result.sheets} sheets, ${result.parts} parts`);
}
