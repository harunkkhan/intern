// Downloading a chart as a standalone file.
//
// The charts already draw their colours as literal SVG attributes, which is
// most of what makes this possible — a Tailwind class means nothing once the
// markup leaves the page. Three things still have to be baked in on the way
// out: the font (inherited from the document, so text would fall back to the
// renderer's default serif), the background (an SVG is transparent, which turns
// black on anything dark), and explicit pixel dimensions (a bare viewBox is
// scaled to whatever the viewer feels like).

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Rasterised at 2x so the PNG stays sharp when dropped into a doc or a chat. */
const PNG_SCALE = 2;

function prepare(svg: SVGSVGElement, background: string): {
  markup: string;
  width: number;
  height: number;
} {
  const box = svg.viewBox.baseVal;
  const width = box.width || svg.clientWidth || 960;
  const height = box.height || svg.clientHeight || 470;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("font-family", FONT_STACK);
  // Layout classes on the live element size it to its container; in a file they
  // are dead weight at best and unresolvable at worst.
  clone.removeAttribute("class");

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "100%");
  rect.setAttribute("height", "100%");
  rect.setAttribute("fill", background);
  clone.insertBefore(rect, clone.firstChild);

  return {
    markup: new XMLSerializer().serializeToString(clone),
    width,
    height,
  };
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function toPng(
  markup: string,
  width: number,
  height: number,
): Promise<Blob> {
  // Routed through a blob URL rather than a base64 data URI: the markup carries
  // arbitrary label text, and btoa throws on anything outside Latin-1.
  const svgUrl = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("could not rasterise the chart"));
      image.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * PNG_SCALE;
    canvas.height = height * PNG_SCALE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("could not rasterise the chart");
    context.scale(PNG_SCALE, PNG_SCALE);
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("could not encode the PNG")),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export type ExportFormat = "png" | "svg";

/**
 * Writes the chart inside `container` to the user's downloads.
 *
 * Takes the container rather than the SVG so the charts don't have to forward
 * refs out of themselves just to be exportable.
 */
export async function downloadChart(
  container: HTMLElement | null,
  filename: string,
  format: ExportFormat,
): Promise<void> {
  const svg = container?.querySelector("svg");
  if (!svg) throw new Error("no chart to export");

  const background = document.documentElement.classList.contains("dark")
    ? "#0a0a0a"
    : "#ffffff";
  const { markup, width, height } = prepare(svg as SVGSVGElement, background);

  if (format === "svg") {
    save(
      new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
      `${filename}.svg`,
    );
    return;
  }
  save(await toPng(markup, width, height), `${filename}.png`);
}
