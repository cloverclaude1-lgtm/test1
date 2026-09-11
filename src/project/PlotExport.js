import { jsPDF } from 'jspdf';
import { STAGE_LAYOUTS } from '../stage/stageLayouts.js';
import { FIXTURE_TYPES } from '../fixtures/Fixture.js';
import { downloadBlob } from './ProjectManager.js';

// ---------------------------------------------------------------------------
// Lighting plot export — a one-page (or more, if the rig is large) PDF: a
// scaled top-down schematic of the stage with numbered fixture positions,
// plus a legend table. This is the kind of document a tour manager or venue
// wants for load-in approval. Purely a client-side render of data the app
// already has (the current stage layout + fixture list) — no server involved.
// ---------------------------------------------------------------------------

const PAGE_W = 297; // A4 landscape, mm
const PAGE_H = 210;
const MARGIN = 14;
const SCHEM_Y0 = 33;
const SCHEM_H = 110;
const ROW_H = 6;

function resolveStageConfig(project) {
  if (project.stageLayout === 'custom' && project.customStageLayout) {
    return { ...STAGE_LAYOUTS.arena, ...project.customStageLayout, label: 'Custom' };
  }
  return STAGE_LAYOUTS[project.stageLayout] || STAGE_LAYOUTS.arena;
}

function sanitizeFileName(name) {
  return name.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'lightstage-plot';
}

/** Builds and downloads the plot PDF for the given project. */
export function exportPlotPDF(project) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const config = resolveStageConfig(project);
  const fixtures = project.fixtures || [];

  drawHeader(doc, project, config, fixtures.length);
  drawSchematic(doc, config, fixtures);
  drawLegend(doc, fixtures);

  downloadBlob(doc.output('blob'), `${sanitizeFileName(project.name || 'lightstage-plot')}.plot.pdf`);
}

function drawHeader(doc, project, config, fixtureCount) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(project.name || 'Untitled Show', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const date = new Date().toLocaleDateString();
  const meta = `Lighting Plot · ${config.label} (${config.width}m x ${config.depth}m) · ${fixtureCount} fixture(s) · Generated ${date}`;
  doc.text(meta, MARGIN, 23);

  doc.setDrawColor(180);
  doc.line(MARGIN, 27, PAGE_W - MARGIN, 27);
}

/** Scaled top-down view: stage boundary + a numbered marker per fixture at its
 * actual x/z position (y — height — isn't shown here; it's in the legend table). */
function drawSchematic(doc, config, fixtures) {
  const areaW = PAGE_W - MARGIN * 2;
  const scale = Math.min(areaW / config.width, SCHEM_H / config.depth);
  const drawW = config.width * scale;
  const drawH = config.depth * scale;
  const x0 = MARGIN + (areaW - drawW) / 2;
  const y0 = SCHEM_Y0 + (SCHEM_H - drawH) / 2;

  doc.setDrawColor(120);
  doc.setLineWidth(0.4);
  doc.rect(x0, y0, drawW, drawH);

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('BACKDROP', x0 + drawW / 2, y0 - 2, { align: 'center' });
  doc.text('AUDIENCE', x0 + drawW / 2, y0 + drawH + 6, { align: 'center' });

  // Stage x runs [-width/2, width/2] (left→right); z runs [-depth/2, depth/2] with
  // negative z toward the backdrop and positive z toward the audience (matches
  // Fixture.js's inferRole() and StageRenderer's floor/camera framing), so z maps
  // to page-Y directly (larger z = further down the page, toward "AUDIENCE").
  fixtures.forEach((f, i) => {
    const px = x0 + ((f.position.x + config.width / 2) / config.width) * drawW;
    const py = y0 + ((f.position.z + config.depth / 2) / config.depth) * drawH;
    doc.setFillColor(40, 42, 54);
    doc.setDrawColor(90);
    doc.circle(px, py, 2.6, 'FD');
    doc.setFontSize(6);
    doc.setTextColor(255);
    doc.text(String(i + 1), px, py + 0.9, { align: 'center' });
  });
  doc.setTextColor(0);
}

const LEGEND_COLS = [
  { label: '#', x: MARGIN, key: (f, i) => String(i + 1) },
  { label: 'Name', x: MARGIN + 8, key: (f) => f.name },
  { label: 'Type', x: MARGIN + 63, key: (f) => FIXTURE_TYPES[f.type]?.label || f.type },
  { label: 'X (m)', x: MARGIN + 108, key: (f) => f.position.x.toFixed(1) },
  { label: 'Y (m)', x: MARGIN + 128, key: (f) => f.position.y.toFixed(1) },
  { label: 'Z (m)', x: MARGIN + 148, key: (f) => f.position.z.toFixed(1) },
  { label: 'Role', x: MARGIN + 168, key: (f) => f.role },
];

function printLegendHeader(doc, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  LEGEND_COLS.forEach((c) => doc.text(c.label, c.x, y));
  doc.setDrawColor(180);
  doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5);
  doc.setFont('helvetica', 'normal');
}

function drawLegend(doc, fixtures) {
  let y = SCHEM_Y0 + SCHEM_H + 10;
  printLegendHeader(doc, y);
  y += ROW_H;

  fixtures.forEach((f, i) => {
    if (y > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN + 6;
      printLegendHeader(doc, y);
      y += ROW_H;
    }
    LEGEND_COLS.forEach((c) => doc.text(c.key(f, i), c.x, y));
    y += ROW_H;
  });
}
