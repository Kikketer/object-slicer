import {
  BrowserWindow,
  BrowserView,
  Updater,
  Utils,
  ApplicationMenu,
  type RPCSchema,
} from "electrobun/main";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sliceStl } from "../../engine/slicer";

type SliceInputs = {
  stlPath: string;
  mode: "stacked" | "interlocking";
  thickness: number;
  count: number;
  scale: number;
  sheet: [number, number];
};

let lastInputs: SliceInputs | null = null;
let lastSummary: { sheets?: number; parts?: number; info?: unknown } | null = null;

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

type AppRPC = {
  bun: RPCSchema<{
    requests: {};
    messages: {
      rendererReady: { title: string };
      selectStl: {};
      slice: {
        stlPath: string;
        mode: "stacked" | "interlocking";
        thickness: number;
        count: number;
        scale: number;
        sheet: [number, number];
      };
      saveSvg: { sheetsDir: string; stlPath: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      stlSelected: { path: string; canceled: boolean };
      sliceDone: {
        ok: boolean;
        error?: string;
        svg?: string;
        info?: unknown;
        sheets?: number;
        parts?: number;
        sheetsDir?: string;
        preview?: unknown;
      };
      saveDone: { ok: boolean; error?: string; path?: string };
    };
  }>;
};

const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {
      rendererReady: ({ title }) => console.log("view ready:", title),
      selectStl: async () => {
        try {
          const paths = await Utils.openFileDialog({
            canChooseFiles: true,
            canChooseDirectory: false,
            allowsMultipleSelection: false,
          });
          console.log("openFileDialog returned:", paths);
          rpc.send.stlSelected({ path: paths[0] ?? "", canceled: !paths.length });
        } catch (e) {
          console.error("openFileDialog failed:", e);
          rpc.send.stlSelected({ path: "", canceled: true });
        }
      },
      slice: async (params) => {
        const output = path.join(os.tmpdir(), `objectslicer-${Date.now()}.svg`);
        try {
          const result = await sliceStl({
            stlPath: params.stlPath,
            output,
            mode: params.mode,
            thickness: params.thickness,
            count: params.count,
            scale: params.scale,
            sheet: params.sheet,
          });
          if (!result.ok || !result.output) {
            rpc.send.sliceDone({
              ok: false,
              error: result.error || "slicer failed",
            });
            return;
          }
          const svg = await Bun.file(result.output).text();
          lastInputs = params;
          lastSummary = {
            sheets: result.sheets,
            parts: result.parts,
            info: result.info,
          };
          rpc.send.sliceDone({
            ok: true,
            svg,
            info: result.info,
            sheets: result.sheets,
            parts: result.parts,
            sheetsDir: result.sheetsDir,
            preview: result.preview,
          });
        } catch (e) {
          rpc.send.sliceDone({ ok: false, error: String(e) });
        }
      },
      saveSvg: async ({ sheetsDir, stlPath }) => {
        try {
          const home = os.homedir();
          const downloads = path.join(home, "Downloads");
          const documents = path.join(home, "Documents");
          const startingFolder = fs.existsSync(downloads)
            ? downloads
            : fs.existsSync(documents)
              ? documents
              : home;
          const folders = await Utils.openFileDialog({
            startingFolder,
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          });
          if (!folders.length) {
            rpc.send.saveDone({
              ok: false,
              error: "no save folder selected",
            });
            return;
          }
          const base = stlPath ? path.basename(stlPath, path.extname(stlPath)) : "sheets";
          const outDir = path.join(folders[0], `${base}_sheets`);
          await fs.promises.mkdir(outDir, { recursive: true });
          const files = await fs.promises.readdir(sheetsDir);
          for (const file of files) {
            const src = path.join(sheetsDir, file);
            const dest = path.join(outDir, file);
            await fs.promises.copyFile(src, dest);
          }
          if (lastInputs) {
            const record = {
              savedAt: new Date().toISOString(),
              inputs: lastInputs,
              summary: lastSummary,
            };
            await fs.promises.writeFile(
              path.join(outDir, "slice-info.txt"),
              JSON.stringify(record, null, 2),
              "utf8",
            );
          }
          rpc.send.saveDone({ ok: true, path: outDir });
        } catch (e) {
          rpc.send.saveDone({ ok: false, error: String(e) });
        }
      },
    },
  },
});

ApplicationMenu.setApplicationMenu([
  {
    label: "ObjectSlicer",
    submenu: [
      { label: "Quit", action: "quit", accelerator: "CommandOrControl+Q" },
    ],
  },
]);

ApplicationMenu.on("application-menu-clicked", (event) => {
  const { action } = (event as { data: { action: string } }).data;
  if (action === "quit") {
    Utils.quit();
  }
});

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("HMR not running; use hutch run dev:hmr for HMR");
    }
  }
  return "views://mainview/index.html";
}

const url = await getMainViewUrl();

new BrowserWindow({
  title: "ObjectSlicer",
  url,
  frame: { width: 1100, height: 800, x: 100, y: 100 },
  rpc,
});

console.log("ObjectSlicer main process started");
