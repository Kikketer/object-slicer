import "./style.css";
import { Electroview, type RPCSchema } from "electrobun/view";
import { createPreview3D, type PreviewSlice } from "./preview3d";

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

const rpc = Electroview.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {
      stlSelected: ({ path, canceled }) => {
        if (canceled || !path) {
          setInfo("No STL selected.");
          return;
        }
        currentStl = path;
        stlPath.textContent = currentStl;
        setInfo(`Loaded STL: ${currentStl}`);
      },
      sliceDone: ({ ok, error, svg, info, sheets, parts, sheetsDir, preview: previewData }) => {
        if (!ok || !svg) {
          setInfo(`Error: ${error || "unknown"}`, true);
          return;
        }
        currentSvg = svg;
        currentSheetsDir = sheetsDir ?? "";
        currentPreview = previewData as PreviewSlice[] | undefined;
        preview.innerHTML = currentSvg;
        saveBtn.disabled = false;
        if (currentPreview && currentPreview.length) {
          viewer.setPreview(currentPreview, (slice) => {
            if (slice) {
              viewer.highlight(slice);
              renderSelectedCut(slice);
            } else {
              viewer.clearHighlight?.();
              selectedCut.innerHTML = `<p class="empty-cut">Click a slice in the 3D view to see its cut shape.</p>`;
            }
          });
        }
        const infoText = JSON.stringify(info, null, 2);
        setInfo(
          `Done. ${sheets} sheet(s), ${parts} part(s).\nInfo:\n${infoText}`,
        );
      },
      saveDone: ({ ok, error, path }) => {
        if (!ok) {
          setInfo(`Save failed: ${error || "unknown"}`, true);
          return;
        }
        setInfo(`Saved: ${path}`);
      },
    },
  },
});

new Electroview({ rpc });

const pickBtn = document.getElementById("pick-stl") as HTMLButtonElement;
const sliceBtn = document.getElementById("slice") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const stlPath = document.getElementById("stl-path") as HTMLSpanElement;
const infoBox = document.getElementById("info") as HTMLPreElement;
const preview = document.getElementById("preview") as HTMLDivElement;
const preview3d = document.getElementById("preview-3d") as HTMLDivElement;
const selectedCut = document.getElementById("selected-cut") as HTMLDivElement;
const mode = document.getElementById("mode") as HTMLSelectElement;
const thickness = document.getElementById("thickness") as HTMLInputElement;
const count = document.getElementById("count") as HTMLInputElement;
const scale = document.getElementById("scale") as HTMLInputElement;
const sheetW = document.getElementById("sheet-w") as HTMLInputElement;
const sheetH = document.getElementById("sheet-h") as HTMLInputElement;

const viewer = createPreview3D(preview3d);

let currentSvg = "";
let currentStl = "";
let currentSheetsDir = "";
let currentPreview: PreviewSlice[] | undefined;

function setInfo(text: string, isError = false) {
  infoBox.textContent = text;
  infoBox.classList.toggle("error", isError);
}

function renderSelectedCut(slice: PreviewSlice) {
  const w = 240;
  const h = 240;
  const allX = slice.paths.flatMap((ring) => ring.map((p) => p[0]));
  const allY = slice.paths.flatMap((ring) => ring.map((p) => p[1]));
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const scale = Math.min(w / dx, h / dy) * 0.85;
  const pad = 10;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const offX = w / 2 - cx * scale;
  const offY = h / 2 + cy * scale;

  function pt(p: number[]) {
    return `${p[0] * scale + offX},${-p[1] * scale + offY}`;
  }

  const rings = slice.paths
    .map((ring) => `M ${pt(ring[0])} L ${ring.slice(1).map(pt).join(" L ")} Z`)
    .join(" ");

  selectedCut.innerHTML =
    `<h3>${slice.id} (${slice.axis}, ${slice.position.toFixed(2)}mm)</h3>` +
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%">` +
    `<path d="${rings}" fill="none" stroke="#cc0000" stroke-width="0.5"/>` +
    `</svg>`;
}

pickBtn.addEventListener("click", () => {
  setInfo("Opening file dialog…");
  rpc.send.selectStl({});
});

sliceBtn.addEventListener("click", () => {
  if (!currentStl) {
    setInfo("Pick an STL first.", true);
    return;
  }
  setInfo("Slicing… this may take a few seconds.");
  saveBtn.disabled = true;
  preview.innerHTML = "";
  rpc.send.slice({
    stlPath: currentStl,
    mode: mode.value as "stacked" | "interlocking",
    thickness: parseFloat(thickness.value),
    count: parseInt(count.value, 10),
    scale: parseFloat(scale.value),
    sheet: [parseFloat(sheetW.value), parseFloat(sheetH.value)],
  });
});

saveBtn.addEventListener("click", () => {
  if (!currentSheetsDir) return;
  setInfo("Choose a folder to save sheet SVGs…");
  rpc.send.saveSvg({ sheetsDir: currentSheetsDir, stlPath: currentStl });
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    const name = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${name}`)?.classList.add("active");
    selectedCut.style.display = name === "svg" ? "none" : "";
  });
});

rpc.send.rendererReady({ title: document.title });
