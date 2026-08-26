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
import { sliceStl } from "../../engine/slicer.ts";

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
        sheet: [number, number];
      };
      saveSvg: { sheetsDir: string };
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
        const output = path.join(os.tmpdir(), `openslicer-${Date.now()}.svg`);
        try {
          const result = await sliceStl({
            stlPath: params.stlPath,
            output,
            mode: params.mode,
            thickness: params.thickness,
            count: params.count,
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
      saveSvg: async ({ sheetsDir }) => {
        try {
          const folders = await Utils.openFileDialog({
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
          const files = await fs.promises.readdir(sheetsDir);
          for (const file of files) {
            const src = path.join(sheetsDir, file);
            const dest = path.join(folders[0], file);
            await fs.promises.copyFile(src, dest);
          }
          rpc.send.saveDone({ ok: true, path: folders[0] });
        } catch (e) {
          rpc.send.saveDone({ ok: false, error: String(e) });
        }
      },
    },
  },
});

ApplicationMenu.setApplicationMenu([
  {
    label: "OpenSlicer",
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
  title: "OpenSlicer",
  url,
  frame: { width: 1100, height: 800, x: 100, y: 100 },
  rpc,
});

console.log("OpenSlicer main process started");
